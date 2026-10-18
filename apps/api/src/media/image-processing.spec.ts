import sharp from 'sharp';
import {
  MEDIA_MASTER_MAX_DIMENSION,
  MEDIA_RENDITION_WIDTHS,
  MEDIA_SOURCE_MIN_DIMENSION,
} from '@clinic/contracts';
import { AppError } from '../common/app-error';
import { deriveMedia, renditionWidthsFor, sniffContentType } from './image-processing';

/**
 * Deriving a full-size photograph is genuinely slow — one decode and twelve
 * encodes, measured at a couple of seconds for a twelve-megapixel image on an
 * ordinary machine — so the tests that do it name their own budget rather than
 * inheriting Jest's five-second default. A generous number: this bounds a hang,
 * it is not a performance assertion, and a machine under load must not turn a
 * correctness suite red.
 */
const DERIVE_TIMEOUT_MS = 60_000;

/**
 * The image pipeline, proved at BYTE LEVEL.
 *
 * Milestone 9.5, checkpoint A5. Every fixture in this file is generated here,
 * in code, from flat colour and noise. NO REAL PHOTOGRAPH, no clinic image, no
 * family material and no committed binary appears anywhere in this suite — the
 * synthetic images carry synthetic camera makes and synthetic coordinates,
 * chosen so that the assertions below can look for them by name in the output.
 *
 * WHY THE ASSERTIONS ARE ABOUT BYTES RATHER THAN ABOUT CALLS. "We call
 * `rotate()` and never call `withMetadata()`" is a statement about this
 * repository's source, and the property that matters is a statement about what
 * leaves the process: no EXIF block, no GPS tag, no camera make, and no
 * orientation flag, in anything the clinic stores or serves. So each derived
 * buffer is re-parsed and also scanned as raw bytes for the marker sequences
 * and the synthetic strings that were demonstrably present in the source.
 */

/**
 * A synthetic "telephone photograph": a landscape gradient tagged as if the
 * telephone had been held rotated a quarter turn, carrying a camera make, a
 * model and a GPS fix.
 *
 * `orientation: 6` is the common one — the sensor recorded a landscape image
 * and the EXIF field says to rotate it a quarter turn clockwise for display.
 * A pipeline that ignored it would publish every such photograph on its side.
 */
async function syntheticPhone(options?: { width?: number; height?: number }): Promise<Buffer> {
  const width = options?.width ?? 1200;
  const height = options?.height ?? 800;

  const flat = await sharp({
    create: { width, height, channels: 3, background: { r: 30, g: 90, b: 160 } },
  })
    .jpeg({ quality: 92 })
    .toBuffer();

  return sharp(flat)
    .withMetadata({ orientation: 6 })
    .withExif({
      IFD0: { Make: 'SyntheticPhoneMake', Model: 'SyntheticPhoneModel' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '35/1 41/1 0/1',
        GPSLongitudeRef: 'E',
        GPSLongitude: '51/1 25/1 0/1',
      },
    })
    .jpeg({ quality: 92 })
    .toBuffer();
}

/** The strings and marker sequences that must be present in the source and absent afterwards. */
const METADATA_FINGERPRINTS = ['Exif\0\0', 'SyntheticPhoneMake', 'SyntheticPhoneModel'];

function containsAny(bytes: Buffer, needles: readonly string[]): string[] {
  const haystack = bytes.toString('latin1');
  return needles.filter((needle) => haystack.includes(needle));
}

describe('the image pipeline', () => {
  describe('deciding the type from the bytes', () => {
    it('recognises exactly the three accepted photograph formats', async () => {
      const jpeg = await sharp({
        create: { width: 8, height: 8, channels: 3, background: '#123456' },
      })
        .jpeg()
        .toBuffer();
      const png = await sharp({
        create: { width: 8, height: 8, channels: 3, background: '#123456' },
      })
        .png()
        .toBuffer();
      const webp = await sharp({
        create: { width: 8, height: 8, channels: 3, background: '#123456' },
      })
        .webp()
        .toBuffer();

      expect(sniffContentType(jpeg)).toBe('image/jpeg');
      expect(sniffContentType(png)).toBe('image/png');
      expect(sniffContentType(webp)).toBe('image/webp');
    });

    it('refuses an SVG, whatever it is called', () => {
      // The case worth naming. An SVG is a document with a script engine
      // attached, and serving one from the clinic's own origin would put
      // uploader-authored markup on the clinic's own domain. It has no magic
      // number at all, because it is text.
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect/></svg>',
      );

      expect(sniffContentType(svg)).toBeNull();
    });

    it('refuses a file that only claims to be a photograph', () => {
      // A PDF, a GIF and plain text. The filename and the browser-supplied
      // content type are never consulted, so renaming any of these to `.jpg`
      // changes nothing.
      expect(sniffContentType(Buffer.from('%PDF-1.7\n'))).toBeNull();
      expect(sniffContentType(Buffer.from('GIF89a'))).toBeNull();
      expect(sniffContentType(Buffer.from('not an image at all'))).toBeNull();
      expect(sniffContentType(Buffer.alloc(0))).toBeNull();
    });
  });

  describe('the responsive ladder', () => {
    it('never enlarges: a small photograph produces only the widths below it', () => {
      expect(renditionWidthsFor(700)).toEqual([320, 640, 700]);
      expect(renditionWidthsFor(300)).toEqual([300]);
    });

    it('adds the master width itself, so the largest rendition is as sharp as the master', () => {
      expect(renditionWidthsFor(2560)).toEqual([...MEDIA_RENDITION_WIDTHS, 2560]);
    });
  });

  describe('deriving from a synthetic telephone photograph', () => {
    it('applies the orientation to the PIXELS', async () => {
      // The source is 1200x800 and tagged "rotate a quarter turn", so the
      // photograph a person sees is 800x1200. Every stored copy reports the
      // second, with nothing left to say it was ever rotated.
      const derived = await deriveMedia(await syntheticPhone());

      expect(derived.master.width).toBe(800);
      expect(derived.master.height).toBe(1200);

      for (const rendition of derived.renditions) {
        expect(rendition.height).toBeGreaterThan(rendition.width);
      }
    });

    it('proves the source really did carry the metadata being looked for', async () => {
      // The negative assertions below are only worth anything if the fixture
      // demonstrably has something to lose.
      const source = await syntheticPhone();
      const metadata = await sharp(source).metadata();

      expect(metadata.orientation).toBe(6);
      expect(metadata.exif).toBeDefined();
      expect(containsAny(source, METADATA_FINGERPRINTS).sort()).toEqual(
        [...METADATA_FINGERPRINTS].sort(),
      );
    });

    it('leaves no EXIF, no GPS, no camera make and no orientation in anything stored', async () => {
      const derived = await deriveMedia(await syntheticPhone());
      const stored = [derived.master, ...derived.renditions];

      for (const output of stored) {
        const metadata = await sharp(output.bytes).metadata();

        // Structural: there is no EXIF block at all, so there is no GPS tag in
        // it. This is the complete proof — a GPS coordinate can only live
        // inside EXIF or XMP, and neither is present.
        expect(metadata.exif).toBeUndefined();
        expect(metadata.xmp).toBeUndefined();
        expect(metadata.icc).toBeUndefined();
        expect(metadata.orientation).toBeUndefined();

        // Byte level: none of the marker sequences or synthetic strings that
        // were present in the source survives anywhere in the output.
        expect(
          containsAny(output.bytes, [...METADATA_FINGERPRINTS, 'EXIF', 'http://ns.adobe.com/']),
        ).toEqual([]);
      }
    });

    it('returns a master and renditions, and no way to reach the uploaded bytes', async () => {
      const source = await syntheticPhone();
      const derived = await deriveMedia(source);

      // The shape carries the master, the renditions and three facts about what
      // arrived. There is no field holding the upload.
      expect(Object.keys(derived).sort()).toEqual(['master', 'renditions', 'sourceContentType']);
      expect(derived.sourceContentType).toBe('image/jpeg');
      expect(derived.master.bytes.equals(source)).toBe(false);

      for (const rendition of derived.renditions) {
        expect(rendition.bytes.equals(source)).toBe(false);
      }
    });

    it(
      'produces both formats at every ladder width, and hashes each one',
      async () => {
        const derived = await deriveMedia(await syntheticPhone());
        const widths = renditionWidthsFor(derived.master.width);

        expect(derived.renditions).toHaveLength(widths.length * 2);

        for (const rendition of derived.renditions) {
          expect(widths).toContain(rendition.width);
          expect(rendition.contentHash).toMatch(/^[0-9a-f]{64}$/);
          expect(rendition.bytes.byteLength).toBeGreaterThan(0);
        }

        // Content identity: two renditions of the same photograph at different
        // widths are different resources, and no two share a hash.
        const hashes = derived.renditions.map((rendition) => rendition.contentHash);
        expect(new Set(hashes).size).toBe(hashes.length);
      },
      DERIVE_TIMEOUT_MS,
    );

    it(
      'bounds the master by the configured longest edge',
      async () => {
        const derived = await deriveMedia(await syntheticPhone({ width: 4000, height: 3000 }));

        expect(Math.max(derived.master.width, derived.master.height)).toBeLessThanOrEqual(
          MEDIA_MASTER_MAX_DIMENSION,
        );
      },
      DERIVE_TIMEOUT_MS,
    );
  });

  describe('refusing', () => {
    const codeOf = async (bytes: Buffer): Promise<string> => {
      try {
        await deriveMedia(bytes);
      } catch (error) {
        return error instanceof AppError ? error.code : 'NOT_AN_APP_ERROR';
      }

      return 'NO_ERROR';
    };

    it('gives a stable code for an unsupported type', async () => {
      expect(await codeOf(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe(
        'MEDIA_TYPE_UNSUPPORTED',
      );
      expect(await codeOf(Buffer.from('%PDF-1.7\n'))).toBe('MEDIA_TYPE_UNSUPPORTED');
    });

    it('gives a stable code for a file whose header lies', async () => {
      // A real JPEG signature in front of bytes no decoder can read. The
      // signature says one thing and the decoder disagrees, which is a
      // corruption rather than a type refusal: the caller sent a JPEG, and it
      // is broken.
      const forged = Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        Buffer.from('not actually a photograph, at any length whatsoever'),
      ]);

      expect(await codeOf(forged)).toBe('MEDIA_FILE_CORRUPT');
    });

    it('gives a stable code for a truncated photograph', async () => {
      const source = await syntheticPhone();

      expect(await codeOf(source.subarray(0, 40))).toBe('MEDIA_FILE_CORRUPT');
    });

    it('gives a stable code for a photograph too small to publish', async () => {
      const tiny = await sharp({
        create: {
          width: MEDIA_SOURCE_MIN_DIMENSION - 1,
          height: MEDIA_SOURCE_MIN_DIMENSION - 1,
          channels: 3,
          background: '#204080',
        },
      })
        .jpeg()
        .toBuffer();

      expect(await codeOf(tiny)).toBe('MEDIA_IMAGE_UNUSABLE');
    });

    it('never lets a decoder message reach the caller', async () => {
      // libvips messages name file paths and internal offsets, and the error
      // envelope would carry one straight to a browser.
      try {
        await deriveMedia(Buffer.from('%PDF-1.7\n'));
        throw new Error('expected a refusal');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).message).not.toMatch(/vips|libvips|heif|buffer contains/i);
      }
    });
  });

  describe('a PNG with transparency', () => {
    it('is flattened onto white rather than onto black', async () => {
      // A photograph of a handwritten note on a transparent background becomes
      // unreadable if it is composited onto the JPEG default. The top-left
      // pixel of every stored copy is white.
      const transparent = await sharp({
        create: {
          width: 400,
          height: 400,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .png()
        .toBuffer();

      const derived = await deriveMedia(transparent);
      const { data } = await sharp(derived.master.bytes)
        .extract({ left: 0, top: 0, width: 1, height: 1 })
        .raw()
        .toBuffer({ resolveWithObject: true });

      expect(data[0]).toBeGreaterThan(240);
      expect(data[1]).toBeGreaterThan(240);
      expect(data[2]).toBeGreaterThan(240);
    });
  });
});
