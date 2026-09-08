import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  MEDIA_MASTER_MAX_DIMENSION,
  MEDIA_RENDITION_FORMATS,
  MEDIA_RENDITION_WIDTHS,
  MEDIA_SOURCE_MAX_PIXELS,
  MEDIA_SOURCE_MIN_DIMENSION,
  type MediaContentType,
  type MediaRenditionFormat,
} from '@clinic/contracts';
import { AppError } from '../common/app-error';

/**
 * Everything this product does to a photograph, and nothing it does to a row.
 *
 * Milestone 9.5, checkpoint A5. THIS FILE TOUCHES NO DATABASE AND NO DISK. It
 * takes a buffer somebody uploaded and returns buffers, so that the part of the
 * media subsystem with the sharpest security properties is the part that can be
 * tested exhaustively without a database, a session or a request.
 *
 * THE THREE RULES IT ENFORCES, IN ORDER, BECAUSE THE ORDER IS LOAD-BEARING:
 *
 *  1. DECIDE THE TYPE FROM THE BYTES. The filename and the browser-supplied
 *     content type are things the caller chose; neither is consulted. A `.jpg`
 *     that is really a PDF is refused as an unsupported type, and an SVG is
 *     refused whatever it is called.
 *  2. APPLY THE ORIENTATION. A telephone held sideways records upright pixels
 *     and an EXIF field saying "turn this". `rotate()` with no argument reads
 *     that field and rewrites the PIXELS.
 *  3. THEN DISCARD EVERYTHING ELSE. sharp writes no metadata unless asked, and
 *     this file never asks: no EXIF, no XMP, no ICC profile, no thumbnail.
 *
 * REVERSING 2 AND 3 WOULD BE A BUG THAT LOOKS LIKE A FEATURE. Stripping first
 * and rotating never produces a picture lying on its side that no renderer can
 * correct, because the field that said to correct it is gone.
 *
 * WHY THE ORIGINAL IS NEVER RETURNED FROM HERE. There is no function in this
 * file that hands back the uploaded buffer, and `deriveMedia` returns a MASTER
 * plus renditions. The uploaded bytes are unreferenced the moment the request
 * that carried them ends, so the GPS coordinate of a family's home — which is
 * exactly what an unedited telephone photograph carries — exists in this system
 * for milliseconds and is written nowhere.
 */

/**
 * Magic numbers, checked against the head of the buffer.
 *
 * SNIFFED RATHER THAN TRUSTED, and sniffed here rather than relying on the
 * decoder alone, because the decoder is deliberately more permissive than this
 * product is: sharp will happily read TIFF, GIF, JPEG 2000, PDF and SVG. The
 * allow-list is what makes "this workflow accepts three photograph formats" a
 * property of the code rather than of a comment.
 */
const SIGNATURES: readonly {
  readonly type: MediaContentType;
  readonly test: (b: Buffer) => boolean;
}[] = [
  {
    type: 'image/jpeg',
    test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    type: 'image/png',
    test: (b) =>
      b.length > 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    type: 'image/webp',
    // RIFF....WEBP. The four bytes between are the little-endian file size and
    // are deliberately not checked: a truncated file is a decode failure, not
    // a type failure, and the two carry different refusal codes.
    test: (b) =>
      b.length > 12 &&
      b.subarray(0, 4).toString('latin1') === 'RIFF' &&
      b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];

/**
 * What the bytes actually are, or `null` for anything this product does not
 * accept — including an SVG, which has no magic number at all because it is a
 * text document.
 */
export function sniffContentType(buffer: Buffer): MediaContentType | null {
  for (const signature of SIGNATURES) {
    if (signature.test(buffer)) return signature.type;
  }

  return null;
}

/** The sharp format names that correspond to the three accepted content types. */
const DECODER_FORMAT: Record<MediaContentType, string> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export type DerivedRendition = {
  readonly format: MediaRenditionFormat;
  readonly width: number;
  readonly height: number;
  readonly bytes: Buffer;
  readonly contentHash: string;
};

export type DerivedMedia = {
  readonly sourceContentType: MediaContentType;
  readonly master: {
    readonly width: number;
    readonly height: number;
    readonly bytes: Buffer;
    readonly contentHash: string;
  };
  readonly renditions: readonly DerivedRendition[];
};

/**
 * The ladder for one master width.
 *
 * Every listed width strictly smaller than the master, plus the master's own
 * width. NOTHING IS EVER ENLARGED: a 700-pixel photograph produces 320, 640 and
 * 700, and never a blurred 1920 that claims to be sharper than what was
 * uploaded.
 */
export function renditionWidthsFor(masterWidth: number): readonly number[] {
  const ladder = MEDIA_RENDITION_WIDTHS.filter((width) => width < masterWidth);

  return [...ladder, masterWidth];
}

/**
 * Take an uploaded photograph and produce everything this product will keep.
 *
 * THROWS `AppError` WITH A STABLE CODE AND NOTHING ELSE. A decoder failure is
 * `MEDIA_FILE_CORRUPT`, an unlisted format is `MEDIA_TYPE_UNSUPPORTED`, and a
 * picture outside the publishable size range is `MEDIA_IMAGE_UNUSABLE`. A
 * caller never sees a libvips message: those name file paths and internal
 * offsets, and they would reach a browser through the error envelope.
 */
export async function deriveMedia(source: Buffer): Promise<DerivedMedia> {
  const sourceContentType = sniffContentType(source);

  if (sourceContentType === null) throw new AppError('MEDIA_TYPE_UNSUPPORTED');

  // `limitInputPixels` is the decompression-bomb guard, and it is set on the
  // very first decoder that touches the buffer: a PNG of a few hundred
  // kilobytes can describe a bitmap of many gigabytes, and the byte cap the
  // upload route enforces says nothing whatever about that.
  const probe = sharp(source, { limitInputPixels: MEDIA_SOURCE_MAX_PIXELS });

  let width: number;
  let height: number;
  let format: string | undefined;

  try {
    const metadata = await probe.metadata();
    format = metadata.format;
    // POST-ORIENTATION dimensions. A photograph tagged as rotated a quarter
    // turn reports its stored width here and its displayed width after
    // `rotate()`, and the second is the one every later decision needs.
    const rotated = metadata.orientation !== undefined && metadata.orientation >= 5;
    width = rotated ? (metadata.height ?? 0) : (metadata.width ?? 0);
    height = rotated ? (metadata.width ?? 0) : (metadata.height ?? 0);
  } catch {
    throw new AppError('MEDIA_FILE_CORRUPT');
  }

  // The signature said one of three things; the decoder has to agree. They
  // disagree on a file whose header was forged, which is a type refusal rather
  // than a corruption one because the fix is to send a different file.
  if (format !== DECODER_FORMAT[sourceContentType]) throw new AppError('MEDIA_TYPE_UNSUPPORTED');

  if (width <= 0 || height <= 0) throw new AppError('MEDIA_FILE_CORRUPT');

  if (
    width < MEDIA_SOURCE_MIN_DIMENSION ||
    height < MEDIA_SOURCE_MIN_DIMENSION ||
    width * height > MEDIA_SOURCE_MAX_PIXELS
  ) {
    throw new AppError('MEDIA_IMAGE_UNUSABLE');
  }

  const master = await encode(source, {
    format: 'jpeg',
    width: Math.min(width, MEDIA_MASTER_MAX_DIMENSION),
    height: Math.min(height, MEDIA_MASTER_MAX_DIMENSION),
    // The master is the source of every later rendition, so it is encoded at a
    // quality where a second generation is not visible. 4:4:4 chroma for the
    // same reason: subsampling a master and then subsampling its children
    // twice is where photographs of handwriting go soft.
    quality: 92,
    chromaSubsampling: '4:4:4',
  });

  const renditions: DerivedRendition[] = [];

  for (const renditionWidth of renditionWidthsFor(master.width)) {
    for (const renditionFormat of MEDIA_RENDITION_FORMATS) {
      // Derived from the MASTER rather than from the upload. The master is
      // already oriented and already stripped, so no rendition can inherit a
      // metadata field the master does not have, and the expensive decode of a
      // full-resolution telephone photograph happens once.
      renditions.push({
        format: renditionFormat,
        ...(await encode(master.bytes, {
          format: renditionFormat,
          width: renditionWidth,
          height: MEDIA_MASTER_MAX_DIMENSION,
          quality: 82,
        })),
      });
    }
  }

  return {
    sourceContentType,
    master: {
      width: master.width,
      height: master.height,
      bytes: master.bytes,
      contentHash: master.contentHash,
    },
    renditions,
  };
}

type EncodeOptions = {
  readonly format: MediaRenditionFormat;
  readonly width: number;
  readonly height: number;
  readonly quality: number;
  readonly chromaSubsampling?: string;
};

/**
 * One encode. THE ONLY PLACE IN THIS APPLICATION THAT WRITES IMAGE BYTES.
 *
 * `rotate()` FIRST, WITH NO ARGUMENT: read the EXIF orientation and apply it to
 * the pixels. `flatten()` next, because a PNG with transparency becomes black
 * rather than white when it is encoded as JPEG, and a photograph of a
 * handwritten note on a transparent background is a note nobody can read.
 *
 * NO `withMetadata()` AND NO `keepMetadata()` ANYWHERE, WHICH IS WHY THE OUTPUT
 * CARRIES NONE. sharp's default is to write nothing, so the absence of EXIF,
 * XMP, ICC and thumbnails is the default rather than a call somebody could
 * delete. `image-processing.spec.ts` asserts the absence at byte level anyway,
 * because a default that nothing tests is a default that changes in a minor
 * release.
 */
async function encode(
  input: Buffer,
  options: EncodeOptions,
): Promise<{ width: number; height: number; bytes: Buffer; contentHash: string }> {
  const pipeline = sharp(input, { limitInputPixels: MEDIA_SOURCE_MAX_PIXELS })
    .rotate()
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize({
      width: options.width,
      height: options.height,
      fit: 'inside',
      withoutEnlargement: true,
    });

  const encoded =
    options.format === 'webp'
      ? pipeline.webp({ quality: options.quality })
      : pipeline.jpeg({
          quality: options.quality,
          ...(options.chromaSubsampling === undefined
            ? {}
            : { chromaSubsampling: options.chromaSubsampling }),
          // Progressive so a photograph on a slow mobile connection appears
          // whole and blurred rather than half-drawn.
          progressive: true,
          mozjpeg: true,
        });

  let bytes: Buffer;
  let info: sharp.OutputInfo;

  try {
    const result = await encoded.toBuffer({ resolveWithObject: true });
    bytes = result.data;
    info = result.info;
  } catch {
    throw new AppError('MEDIA_FILE_CORRUPT');
  }

  return {
    width: info.width,
    height: info.height,
    bytes,
    contentHash: createHash('sha256').update(bytes).digest('hex'),
  };
}
