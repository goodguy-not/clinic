import sharp from 'sharp';
import request from 'supertest';
import { mediaAssetResponseSchema, type MediaAsset } from '@clinic/contracts';
import { as } from './website-support';
import type { Harness } from './harness';

/**
 * Shared fixtures for the Milestone 9.5 media suites.
 *
 * EVERY IMAGE IN THIS REPOSITORY'S TESTS IS GENERATED HERE, IN CODE. There is
 * no committed binary, no photograph of anything real, and nothing that came
 * off anybody's telephone. The fixtures carry SYNTHETIC camera makes and
 * SYNTHETIC coordinates, chosen so that the privacy assertions can look for
 * them by name in the stored output and prove they are gone.
 *
 * No real patient photograph, family document, handwritten note or clinic
 * document appears anywhere in this suite, and none may.
 */

/**
 * The synthetic strings written into every fixture's EXIF, and looked for
 * afterwards by `metadataFingerprintsIn`. They exist so the privacy assertions
 * can name something the source demonstrably carried.
 */
const SYNTHETIC_CAMERA_MAKE = 'SyntheticPhoneMake';
const SYNTHETIC_CAMERA_MODEL = 'SyntheticPhoneModel';

/**
 * EVERY CALL IS A DIFFERENT PHOTOGRAPH (Milestone 9.5 stabilisation).
 *
 * The API treats the same bytes from the same colleague as a retry and returns
 * the asset it already has, so two calls that meant "two photographs" must not
 * produce identical bytes. One channel steps per call; a test that wants the
 * same photograph twice keeps the buffer and sends it twice.
 */
let shade = 0;
const nextShade = (): number => 40 + (shade++ % 180);

/**
 * A synthetic "telephone photograph".
 *
 * Landscape pixels, tagged `orientation: 6` — the common case, where the
 * telephone was held rotated a quarter turn — and carrying a camera make, a
 * model and a GPS fix. Small enough that a suite of them is fast, large enough
 * to produce a real responsive ladder.
 */
export async function syntheticPhonePhoto(options?: {
  width?: number;
  height?: number;
}): Promise<Buffer> {
  const width = options?.width ?? 900;
  const height = options?.height ?? 600;

  const flat = await sharp({
    create: { width, height, channels: 3, background: { r: 30, g: nextShade(), b: 160 } },
  })
    .jpeg({ quality: 92 })
    .toBuffer();

  return sharp(flat)
    .withMetadata({ orientation: 6 })
    .withExif({
      IFD0: { Make: SYNTHETIC_CAMERA_MAKE, Model: SYNTHETIC_CAMERA_MODEL },
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

/** A plain synthetic PNG, for the paths that do not need EXIF. */
export async function syntheticPng(size = 400): Promise<Buffer> {
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: { r: 200, g: nextShade(), b: 40 },
    },
  })
    .png()
    .toBuffer();
}

/** Uploads one synthetic photograph and returns the asset the API reports. */
export async function uploadPhoto(
  harness: Harness,
  sessionToken: string,
  options?: { bytes?: Buffer; altText?: string; fileName?: string },
): Promise<MediaAsset> {
  const bytes = options?.bytes ?? (await syntheticPhonePhoto());

  const response = await request(harness.app.getHttpServer())
    .post('/media')
    .set(as(sessionToken))
    .field('altText', options?.altText ?? 'عکس مصنوعی برای آزمون')
    .attach('file', bytes, options?.fileName ?? 'synthetic.jpg');

  if (response.status !== 201) {
    throw new Error(`upload failed: ${response.status} ${JSON.stringify(response.body)}`);
  }

  return mediaAssetResponseSchema.parse(response.body).media;
}

/**
 * The bytes of one stored rendition, read straight off the disk.
 *
 * The privacy assertions go to the FILE rather than to the serving route,
 * deliberately: what has to be true is that no EXIF exists in what the clinic
 * STORED, not merely that the route declines to hand it over.
 */
export async function storedRenditionBytes(harness: Harness, renditionId: string): Promise<Buffer> {
  const rows = await harness.prisma.$queryRaw<{ storage_key: string }[]>`
    SELECT storage_key FROM media_rendition WHERE id = ${renditionId}::uuid
  `;

  const key = rows[0]?.storage_key;
  if (key === undefined) throw new Error(`no rendition ${renditionId}`);

  return readUnderRoot(key);
}

/** The same, for the master — which no route anywhere can serve. */
export async function storedMasterBytes(harness: Harness, assetId: string): Promise<Buffer> {
  const rows = await harness.prisma.$queryRaw<{ master_storage_key: string }[]>`
    SELECT master_storage_key FROM media_asset WHERE id = ${assetId}::uuid
  `;

  const key = rows[0]?.master_storage_key;
  if (key === undefined) throw new Error(`no asset ${assetId}`);

  return readUnderRoot(key);
}

async function readUnderRoot(key: string): Promise<Buffer> {
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { TEST_MEDIA_ROOT } = await import('./harness');

  return readFile(join(TEST_MEDIA_ROOT, ...key.split('/')));
}

/**
 * Whether a buffer carries any of the metadata fingerprints the fixtures were
 * built with. Returns the ones it found, so a failure names them.
 */
export function metadataFingerprintsIn(bytes: Buffer): string[] {
  const haystack = bytes.toString('latin1');

  return [
    'Exif\0\0',
    'EXIF',
    'SyntheticPhoneMake',
    'SyntheticPhoneModel',
    'http://ns.adobe.com/',
  ].filter((needle) => haystack.includes(needle));
}
