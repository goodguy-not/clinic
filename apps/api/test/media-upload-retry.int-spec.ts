import request from 'supertest';
import { mediaAssetResponseSchema } from '@clinic/contracts';
import { createHarness, resetDatabase, type Harness } from './harness';
import { syntheticPhonePhoto, uploadPhoto } from './media-support';
import { as, loginAs } from './website-support';

/**
 * A retried upload is one asset.
 *
 * Milestone 9.5 stabilisation, restoring the frozen A5 outcome. A colleague
 * whose upload was interrupted — a dropped connection, a web restart, a double
 * click — sends the same photograph again and must end up with ONE asset in
 * the library, not two. The identity is the photograph itself (a digest of the
 * uploaded bytes, held in PostgreSQL), so it survives any process restart; and
 * it is scoped to the colleague who uploaded it, so a replay can only ever hand
 * back an asset the caller created.
 *
 * Every photograph is generated in code by `media-support.ts`.
 */
describe('media upload retry (real PostgreSQL)', () => {
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
    await resetDatabase();
    manager = await loginAs(harness, 'MANAGER');
    receptionist = await loginAs(harness, 'RECEPTIONIST');
  });

  const counts = async () => {
    const [row] = await harness.prisma.$queryRaw<
      { assets: bigint; renditions: bigint; uploads: bigint }[]
    >`
      SELECT
        (SELECT count(*) FROM media_asset) AS assets,
        (SELECT count(*) FROM media_rendition) AS renditions,
        (SELECT count(*) FROM audit_log WHERE action = 'media.uploaded') AS uploads
    `;
    return {
      assets: Number(row!.assets),
      renditions: Number(row!.renditions),
      uploads: Number(row!.uploads),
    };
  };

  it('returns the same asset when the same colleague sends the same photograph again', async () => {
    const bytes = await syntheticPhonePhoto({ width: 910, height: 610 });

    const first = await uploadPhoto(harness, receptionist, { bytes });
    const after = await counts();
    const retried = await uploadPhoto(harness, receptionist, { bytes });

    expect(retried.id).toBe(first.id);
    expect(retried.renditions.map((r) => r.id)).toEqual(first.renditions.map((r) => r.id));
    // Nothing new was derived, stored, inserted or audited.
    expect(await counts()).toEqual(after);
    expect(after.assets).toBe(1);
    expect(after.uploads).toBe(1);
  }, 60_000);

  it('creates a new asset for a different photograph', async () => {
    const first = await uploadPhoto(harness, receptionist, {
      bytes: await syntheticPhonePhoto({ width: 910, height: 610 }),
    });
    const second = await uploadPhoto(harness, receptionist, {
      bytes: await syntheticPhonePhoto({ width: 920, height: 610 }),
    });

    expect(second.id).not.toBe(first.id);
    expect((await counts()).assets).toBe(2);
  }, 60_000);

  it('still recognises the retry after the API itself is restarted', async () => {
    const bytes = await syntheticPhonePhoto({ width: 930, height: 610 });
    const first = await uploadPhoto(harness, receptionist, { bytes });

    // A fresh application instance: no in-process state survives, only the
    // database. Sessions live in PostgreSQL, so the same token still works.
    await harness.close();
    harness = await createHarness();

    const retried = await uploadPhoto(harness, receptionist, { bytes });

    expect(retried.id).toBe(first.id);
    expect((await counts()).assets).toBe(1);
  }, 60_000);

  it('converges concurrent retries of one photograph on one asset', async () => {
    const bytes = await syntheticPhonePhoto({ width: 940, height: 610 });

    const results = await Promise.all(
      [0, 1, 2].map(() =>
        request(harness.app.getHttpServer())
          .post('/media')
          .set(as(receptionist))
          .field('altText', 'عکس مصنوعی برای آزمون')
          .attach('file', bytes, 'synthetic.jpg'),
      ),
    );

    const ids = results.map((response) => {
      expect(response.status).toBe(201);
      return mediaAssetResponseSchema.parse(response.body).media.id;
    });

    expect(new Set(ids).size).toBe(1);
    expect((await counts()).assets).toBe(1);
  }, 60_000);

  it('never hands one colleague an asset another colleague uploaded', async () => {
    const bytes = await syntheticPhonePhoto({ width: 950, height: 610 });

    const receptionists = await uploadPhoto(harness, receptionist, { bytes });
    const managers = await uploadPhoto(harness, manager, { bytes });

    expect(managers.id).not.toBe(receptionists.id);

    const owners = await harness.prisma.$queryRaw<{ id: string; created_by_user_id: string }[]>`
      SELECT id, created_by_user_id FROM media_asset ORDER BY id
    `;
    expect(new Set(owners.map((row) => row.created_by_user_id)).size).toBe(2);
  }, 60_000);

  it('does not resurrect an archived photograph: re-uploading after archiving is a new asset', async () => {
    const bytes = await syntheticPhonePhoto({ width: 960, height: 610 });
    const first = await uploadPhoto(harness, receptionist, { bytes });

    await request(harness.app.getHttpServer())
      .patch(`/media/${first.id}/archive`)
      .set(as(manager))
      .send({ archived: true })
      .expect(200);

    const again = await uploadPhoto(harness, receptionist, { bytes });

    expect(again.id).not.toBe(first.id);
    expect(again.status).toBe('ACTIVE');
  }, 60_000);

  it('keeps the first alt text when the same photograph is retried with a different one', async () => {
    const bytes = await syntheticPhonePhoto({ width: 970, height: 610 });

    const first = await uploadPhoto(harness, receptionist, { bytes, altText: 'متن نخست' });
    const retried = await uploadPhoto(harness, receptionist, { bytes, altText: 'متن دوم' });

    expect(retried.id).toBe(first.id);
    expect(retried.altText).toBe('متن نخست');
  }, 60_000);
});
