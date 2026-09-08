import sharp from 'sharp';
import request from 'supertest';
import {
  MEDIA_SOURCE_MAX_BYTES,
  PUBLIC_MEDIA_PATH_PREFIX,
  mediaAssetListResponseSchema,
  mediaAssetResponseSchema,
} from '@clinic/contracts';
import { createHarness, resetDatabase, type Harness } from './harness';
import { as, auditActionsFor, loginAs } from './website-support';
import {
  metadataFingerprintsIn,
  storedMasterBytes,
  storedRenditionBytes,
  syntheticPhonePhoto,
  syntheticPng,
  uploadPhoto,
} from './media-support';

/**
 * Uploading a photograph: what the product keeps, what it refuses, and what it
 * never writes at all.
 *
 * Milestone 9.5, checkpoint A5.
 *
 * THE PRIVACY ASSERTIONS GO TO THE FILES ON DISK RATHER THAN TO A RESPONSE.
 * What has to be true is not "the route declines to serve EXIF" — it is that no
 * EXIF exists in anything the clinic STORED, so a backup, a disk image or a
 * future feature cannot yield one. Every stored copy is read straight off the
 * filesystem and scanned as bytes.
 *
 * Everything is synthetic. See `media-support.ts`.
 */
describe('media upload (real PostgreSQL)', () => {
  let harness: Harness;
  let manager: string;
  let receptionist: string;

  beforeAll(async () => {
    harness = await createHarness();
  }, 60_000);

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
    manager = await loginAs(harness, 'MANAGER');
    receptionist = await loginAs(harness, 'RECEPTIONIST');
  });

  const server = () => harness.app.getHttpServer();

  describe('a supported telephone photograph', () => {
    it('is accepted from a receptionist and produces a responsive ladder', async () => {
      // The receptionist is the person holding the telephone. `media.upload` is
      // theirs, and nothing it produces is reachable by a visitor.
      const asset = await uploadPhoto(harness, receptionist);

      // 900x600 tagged "rotate a quarter turn" is a 600x900 photograph.
      expect(asset.width).toBe(600);
      expect(asset.height).toBe(900);
      expect(asset.status).toBe('ACTIVE');
      expect(asset.sourceContentType).toBe('image/jpeg');
      expect(asset.attachments).toEqual([]);
      expect(asset.isPubliclyServed).toBe(false);

      // Widths below the master, plus the master's own, in both formats.
      const widths = [...new Set(asset.renditions.map((r) => r.width))].sort((a, b) => a - b);
      expect(widths).toEqual([320, 600]);
      expect(asset.renditions).toHaveLength(widths.length * 2);
      expect([...new Set(asset.renditions.map((r) => r.format))].sort()).toEqual(['jpeg', 'webp']);

      for (const rendition of asset.renditions) {
        expect(rendition.path).toBe(`${PUBLIC_MEDIA_PATH_PREFIX}${rendition.id}`);
        expect(rendition.contentHash).toMatch(/^[0-9a-f]{64}$/);
        expect(rendition.byteSize).toBeGreaterThan(0);
      }
    }, 60_000);

    it('writes one audit row naming what arrived and never what it was called', async () => {
      const asset = await uploadPhoto(harness, receptionist, {
        fileName: 'a-family-surname-2026.jpg',
      });

      expect(await auditActionsFor(harness, 'media_asset', asset.id)).toEqual(['media.uploaded']);

      const rows = await harness.prisma.$queryRaw<{ after: unknown }[]>`
        SELECT after FROM audit_log
        WHERE entity_type = 'media_asset' AND entity_id = ${asset.id}::uuid
      `;

      const after = JSON.stringify(rows[0]?.after);
      expect(after).toContain('sourceContentType');
      expect(after).toContain('renditionCount');
      // The original file name is a caller-chosen string and is very often a
      // family's surname. `audit_log` can never be pruned, so it is recorded
      // nowhere.
      expect(after).not.toContain('a-family-surname');
      expect(after).not.toContain('fileName');
    }, 60_000);
  });

  describe('EXIF and GPS, at byte level, in what is actually stored', () => {
    it('proves the uploaded fixture really did carry camera metadata', async () => {
      // The negative assertions below are only worth something if the source
      // demonstrably had something to lose.
      const source = await syntheticPhonePhoto();

      expect(
        await sharp(source)
          .metadata()
          .then((m) => m.exif),
      ).toBeDefined();
      expect(metadataFingerprintsIn(source)).toContain('SyntheticPhoneMake');
    });

    it('leaves none of it in the master or in any rendition on disk', async () => {
      const asset = await uploadPhoto(harness, receptionist);

      const stored = [
        await storedMasterBytes(harness, asset.id),
        ...(await Promise.all(
          asset.renditions.map((rendition) => storedRenditionBytes(harness, rendition.id)),
        )),
      ];

      for (const bytes of stored) {
        const metadata = await sharp(bytes).metadata();

        // A GPS coordinate can live only inside EXIF or XMP. Neither exists, so
        // there is no coordinate — this is a complete proof rather than a scan
        // for one tag.
        expect(metadata.exif).toBeUndefined();
        expect(metadata.xmp).toBeUndefined();
        expect(metadata.icc).toBeUndefined();
        expect(metadata.orientation).toBeUndefined();

        expect(metadataFingerprintsIn(bytes)).toEqual([]);
      }
    }, 60_000);

    it('stores no copy of the uploaded bytes anywhere', async () => {
      // The strongest form of "no original phone photograph is publicly
      // reachable": there is no original on disk at all. Every stored file
      // differs from the upload, and the row records the source only as a type
      // and a size.
      const source = await syntheticPhonePhoto();
      const asset = await uploadPhoto(harness, receptionist, { bytes: source });

      const stored = [
        await storedMasterBytes(harness, asset.id),
        ...(await Promise.all(
          asset.renditions.map((rendition) => storedRenditionBytes(harness, rendition.id)),
        )),
      ];

      for (const bytes of stored) {
        expect(bytes.equals(source)).toBe(false);
      }

      expect(asset.sourceByteSize).toBe(source.byteLength);
    }, 60_000);

    it('applies the orientation to the pixels, so nothing is stored on its side', async () => {
      const asset = await uploadPhoto(harness, receptionist);
      const master = await storedMasterBytes(harness, asset.id);
      const metadata = await sharp(master).metadata();

      expect(metadata.width).toBe(600);
      expect(metadata.height).toBe(900);
    }, 60_000);
  });

  describe('the master is not a servable thing', () => {
    it('has no rendition row, so no identifier can name it', async () => {
      const asset = await uploadPhoto(harness, receptionist);

      const rows = await harness.prisma.$queryRaw<{ storage_key: string }[]>`
        SELECT r.storage_key
        FROM media_rendition r
        JOIN media_asset a ON a.id = r.media_asset_id
        WHERE a.id = ${asset.id}::uuid AND r.storage_key = a.master_storage_key
      `;

      expect(rows).toEqual([]);
    }, 60_000);

    it('is absent from every field the staff response carries', async () => {
      const asset = await uploadPhoto(harness, receptionist);
      const body = JSON.stringify(asset);

      expect(body).not.toContain('master');
      expect(body).not.toContain('storageKey');
      expect(body).not.toContain('storage_key');
    }, 60_000);
  });

  describe('refusing, with stable machine-readable codes', () => {
    const upload = (bytes: Buffer, fileName: string) =>
      request(server())
        .post('/media')
        .set(as(receptionist))
        .field('altText', 'برچسب مصنوعی')
        .attach('file', bytes, fileName);

    it('refuses an SVG renamed to look like a photograph', async () => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">' +
          '<script>fetch("https://example.invalid")</script></svg>',
      );

      const response = await upload(svg, 'portrait.jpg');

      expect(response.status).toBe(415);
      expect(response.body.error.code).toBe('MEDIA_TYPE_UNSUPPORTED');
    });

    it('refuses a PDF, whatever the file is called', async () => {
      const response = await upload(Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n'), 'photo.jpeg');

      expect(response.status).toBe(415);
      expect(response.body.error.code).toBe('MEDIA_TYPE_UNSUPPORTED');
    });

    it('refuses a truncated photograph as corrupt rather than as the wrong type', async () => {
      const source = await syntheticPhonePhoto();
      const response = await upload(source.subarray(0, 64), 'synthetic.jpg');

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('MEDIA_FILE_CORRUPT');
    });

    it('refuses a photograph too small to publish', async () => {
      const response = await upload(await syntheticPng(64), 'tiny.png');

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('MEDIA_IMAGE_UNUSABLE');
    });

    it('refuses an oversized upload while the body is still arriving', async () => {
      // Incompressible noise, so the encoder cannot shrink it under the cap.
      const oversized = Buffer.alloc(MEDIA_SOURCE_MAX_BYTES + 1024, 0);
      for (let index = 0; index < oversized.length; index += 1) oversized[index] = index % 251;

      const response = await upload(oversized, 'huge.jpg');

      expect(response.status).toBe(413);
      expect(response.body.error.code).toBe('MEDIA_FILE_TOO_LARGE');
    }, 60_000);

    it('refuses an upload with no file part', async () => {
      const response = await request(server())
        .post('/media')
        .set(as(receptionist))
        .field('altText', 'برچسب مصنوعی');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses an upload with no alt text, and one carrying markup', async () => {
      const bytes = await syntheticPhonePhoto();

      const missing = await request(server())
        .post('/media')
        .set(as(receptionist))
        .attach('file', bytes, 'synthetic.jpg');

      expect(missing.status).toBe(400);
      expect(missing.body.error.code).toBe('VALIDATION_FAILED');

      const markup = await request(server())
        .post('/media')
        .set(as(receptionist))
        .field('altText', '<img src=x onerror=alert(1)>')
        .attach('file', bytes, 'synthetic.jpg');

      expect(markup.status).toBe(400);
      expect(markup.body.error.code).toBe('VALIDATION_FAILED');
    }, 60_000);

    it('never leaks a decoder message into a response', async () => {
      const response = await upload(Buffer.from('%PDF-1.7\n'), 'photo.jpg');

      expect(JSON.stringify(response.body)).not.toMatch(/vips|libvips|\/tmp|C:\\\\/i);
    });

    it('writes no row and no file when it refuses', async () => {
      await upload(Buffer.from('%PDF-1.7\n'), 'photo.jpg');

      const assets = await harness.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*)::bigint AS count FROM media_asset
      `;

      expect(Number(assets[0]?.count)).toBe(0);
    });
  });

  describe('the library read', () => {
    it('is behind a permission and shows a receptionist their own upload', async () => {
      const asset = await uploadPhoto(harness, receptionist);

      const list = await request(server()).get('/media').set(as(receptionist));

      expect(list.status).toBe(200);
      const parsed = mediaAssetListResponseSchema.parse(list.body);
      expect(parsed.media.map((item) => item.id)).toEqual([asset.id]);

      const one = await request(server()).get(`/media/${asset.id}`).set(as(manager));
      expect(one.status).toBe(200);
      expect(mediaAssetResponseSchema.parse(one.body).media.id).toBe(asset.id);
    }, 60_000);

    it('is unreachable without a session', async () => {
      const response = await request(server()).get('/media');

      expect(response.status).toBe(401);
    });
  });
});
