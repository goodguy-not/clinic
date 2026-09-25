import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import { mediaAssetResponseSchema } from '@clinic/contracts';
import { uuidv7 } from '../src/common/uuid';
import { MediaErasureService } from '../src/media/media-erasure.service';
import {
  createHarness,
  resetDatabase,
  TEST_MEDIA_ROOT,
  type Harness,
  ownerPrisma,
} from './harness';
import { as, asVisitor, loginAs } from './website-support';
import { uploadPhoto } from './media-support';

/**
 * PROOF THAT A RETENTION POLICY NOBODY HAS DECIDED YET CAN BE CARRIED OUT.
 *
 * Milestone 9.5, checkpoint A5, coordinator revision.
 *
 * THE FROZEN BOUNDARY IS NOT "KEEP FOR EVER". Physical retention and deletion
 * timing is owner-policy work for later; what this checkpoint owes is that the
 * later decision, whatever it turns out to be, is an ordinary piece of work
 * rather than a redesign. The first version of this subsystem quietly failed
 * that: `storage_key` was NOT NULL, so "these bytes are gone" was a state the
 * schema could not express, and any retention policy would have had to arrive
 * as a migration altering nullability on a live table full of a clinic's
 * photographs.
 *
 * THE POLICY HAS SINCE BEEN DECIDED (Milestone 10, checkpoint A3): the nightly
 * `MEDIA_ERASURE` job erases the bytes of a photograph never attached for thirty
 * days or archived for thirty days — `media-erasure.int-spec.ts` is its suite.
 * What stays here is what this suite always proved about the SCHEMA: an erasure
 * is two UPDATEs and an unlink, the record survives it, and a half-erased row is
 * refused. The erasure below is now the real service, on an asset made due by
 * ageing its archiving, because `media_asset_erasure_guard` refuses any other.
 *
 * IT ASSERTS FOUR THINGS, IN THE TWO SHAPES A POLICY MIGHT TAKE:
 *
 *   BYTES ONLY (the expected shape, and the `website_request` precedent): the
 *   files can be removed, the row survives to say a photograph existed and
 *   where it was used, and the origin refuses the next anonymous request
 *   through the SAME predicate everything else goes through.
 *
 *   ROWS AS WELL (if a policy ever demands it): the `no_delete` triggers refuse
 *   it by default — which is the protection working — and a future migration
 *   that lifts them for named tables can then delete in dependency order with
 *   no foreign key, no cascade and no model obstacle in the way.
 *
 * Everything is synthetic. See `media-support.ts`.
 */
describe('media retention readiness (real PostgreSQL)', () => {
  let harness: Harness;
  let manager: string;
  let receptionist: string;
  let therapistId: string;

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

    const actorId = (
      await harness.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM app_user WHERE role = 'MANAGER'::user_role LIMIT 1
      `
    )[0]!.id;

    therapistId = uuidv7();
    await harness.prisma.$executeRaw`
      INSERT INTO therapist (
        id, full_name, specialty, status, created_at, created_by_user_id,
        is_public, public_slug, public_display_name,
        -- Checkpoint A6: a published fixture carries the published name too.
        published_public_display_name, public_display_order
      ) VALUES (
        ${therapistId}::uuid, 'همکار نمونه', 'گفتاردرمانی', 'ACTIVE'::catalog_status,
        transaction_timestamp(), ${actorId}::uuid,
        TRUE, 'retention-colleague', 'همکار نمونه', 'همکار نمونه', 0
      )
    `;
  });

  /** Upload, attach to a published therapist, and publish. Fully live. */
  const publishedPhoto = async () => {
    const asset = await uploadPhoto(harness, receptionist);

    const attached = mediaAssetResponseSchema.parse(
      (
        await request(harness.app.getHttpServer())
          .post(`/media/${asset.id}/attachments`)
          .set(as(receptionist))
          .send({ ownerType: 'THERAPIST_PROFILE', ownerId: therapistId, position: 0 })
      ).body,
    ).media;

    await request(harness.app.getHttpServer())
      .patch(`/media/attachments/${attached.attachments[0]!.id}/publication`)
      .set(as(manager))
      .send({ isPublished: true });

    return harness.prisma.$queryRaw<{ id: string; storage_key: string }[]>`
      SELECT id, storage_key FROM media_rendition WHERE media_asset_id = ${asset.id}::uuid
    `.then((renditions) => ({ asset, renditions }));
  };

  it('holds every byte until somebody decides otherwise', async () => {
    // The starting state, stated so the erasure below is visibly a CHANGE and
    // not the way things already were. No purge marker exists on anything.
    const { asset, renditions } = await publishedPhoto();

    const rows = await harness.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM media_asset
      WHERE bytes_purged_at IS NOT NULL OR master_storage_key IS NULL
    `;

    expect(Number(rows[0]!.n)).toBe(0);
    expect(
      mediaAssetResponseSchema.parse(
        (await request(harness.app.getHttpServer()).get(`/media/${asset.id}`).set(as(manager)))
          .body,
      ).media.bytesPurgedAt,
    ).toBeNull();

    for (const rendition of renditions) {
      await expect(
        access(join(TEST_MEDIA_ROOT, ...rendition.storage_key.split('/'))),
      ).resolves.toBeUndefined();
    }
  });

  it('lets a future policy erase the bytes, keep the record, and stop serving at once', async () => {
    const { asset, renditions } = await publishedPhoto();
    const rendition = renditions[0]!;

    // Live before the erasure, so the refusal afterwards is attributable to it.
    const before = await request(harness.app.getHttpServer())
      .get(`/public/media/${rendition.id}`)
      .set(asVisitor());
    expect(before.status).toBe(200);

    const master = (
      await harness.prisma.$queryRaw<{ master_storage_key: string }[]>`
        SELECT master_storage_key FROM media_asset WHERE id = ${asset.id}::uuid
      `
    )[0]!.master_storage_key;

    // ---- the retention job, on a photograph archived thirty days ago -------
    await makeDue(asset.id);
    const result = await harness.app.get(MediaErasureService).run({ backupWaitMs: 0, pollMs: 0 });
    expect(result).toEqual({ eligible: 1, erased: 1, deferred: 0 });

    for (const key of [master, ...renditions.map((r) => r.storage_key)]) {
      await expect(access(join(TEST_MEDIA_ROOT, ...key.split('/')))).rejects.toThrow();
    }

    // ---- what the product then says -----------------------------------------

    // THE ORIGIN REFUSES, through the same predicate and with the same code
    // every other refusal uses. A stranger cannot tell erasure from an
    // unpublished photograph, which is the disclosure rule holding.
    const after = await request(harness.app.getHttpServer())
      .get(`/public/media/${rendition.id}`)
      .set(asVisitor());

    expect(after.status).toBe(404);
    expect(after.body.error.code).toBe('MEDIA_NOT_FOUND');
    expect(after.headers['cache-control']).toBe('no-store');

    // THE RECORD SURVIVES. A colleague can still see that this photograph
    // existed, when it arrived, and which profile it was on — which is what
    // makes the erasure auditable rather than a hole.
    const library = mediaAssetResponseSchema.parse(
      (await request(harness.app.getHttpServer()).get(`/media/${asset.id}`).set(as(manager))).body,
    ).media;

    expect(library.bytesPurgedAt).not.toBeNull();
    expect(library.isPubliclyServed).toBe(false);
    expect(library.attachments).toHaveLength(1);
    expect(library.attachments[0]?.ownerId).toBe(therapistId);
    expect(library.createdAt).toBe(asset.createdAt);

    // AND THE PUBLIC PAGE SIMPLY HAS NO PHOTOGRAPH, rather than a broken one.
    const team = await request(harness.app.getHttpServer())
      .get('/public/team/retention-colleague')
      .set(asVisitor());

    expect(team.status).toBe(200);
    expect(team.body.therapist.photo).toBeNull();
  });

  /** Archived thirty-one days ago: the owner's ARCHIVED rule makes it due. */
  const makeDue = async (assetId: string) => {
    const archived = await request(harness.app.getHttpServer())
      .patch(`/media/${assetId}/archive`)
      .set(as(manager))
      .send({ archived: true });
    expect(archived.status).toBe(200);

    await ownerPrisma().$executeRaw`
      UPDATE media_asset SET archived_at = archived_at - interval '31 days'
      WHERE id = ${assetId}::uuid
    `;
  };

  it('refuses a half-erased row in both directions', async () => {
    // The CHECK is what stops a future job leaving a row that claims to have
    // been erased while still naming a file, or one that has lost its file with
    // nothing to say why. Both are refused by PostgreSQL rather than by the job
    // remembering to do both halves.
    const { asset } = await publishedPhoto();
    // Due, so that the erasure guard lets the statement reach the CHECK.
    await makeDue(asset.id);

    await expect(
      harness.prisma.$executeRaw`
        UPDATE media_asset SET bytes_purged_at = transaction_timestamp()
        WHERE id = ${asset.id}::uuid
      `,
    ).rejects.toThrow(/media_asset_purge_chk/);

    await expect(
      harness.prisma.$executeRaw`
        UPDATE media_asset SET master_storage_key = NULL WHERE id = ${asset.id}::uuid
      `,
    ).rejects.toThrow(/media_asset_purge_chk/);

    // A rendition is refused one step earlier, by `media_rendition_erasure_only`,
    // which admits only the complete erasure transition.
    await expect(
      ownerPrisma().$executeRaw`
        UPDATE media_rendition SET storage_key = NULL WHERE media_asset_id = ${asset.id}::uuid
      `,
    ).rejects.toThrow(/the only permitted change is its erasure/);
  });

  it('refuses row deletion by default, and permits it to a policy that lifts the guard explicitly', async () => {
    const { asset } = await publishedPhoto();

    // THE PROTECTION, WORKING. Nothing routine, and no stray statement, can
    // destroy the record that a photograph existed.
    await expect(
      ownerPrisma().$executeRaw`DELETE FROM media_asset WHERE id = ${asset.id}::uuid`,
    ).rejects.toThrow(/protected/);

    // AND THE PATH OUT, IF A POLICY EVER DEMANDS ROWS AS WELL AS BYTES. A future
    // migration lifts the guard for named tables, deletes in dependency order,
    // and puts it back. What this proves is the part that could have been
    // impossible: there is no foreign key, no cascade and no model obstacle in
    // the way, so the retention checkpoint is a decision plus a job rather than
    // a redesign.
    //
    // NOTHING IN THE APPLICATION DOES THIS. It is done here, by hand, in a
    // disposable test database, precisely because no production code should be
    // able to.
    for (const table of ['media_attachment', 'media_rendition', 'media_asset']) {
      await ownerPrisma().$executeRawUnsafe(
        `ALTER TABLE "${table}" DISABLE TRIGGER "${table}_no_delete"`,
      );
    }

    try {
      await ownerPrisma()
        .$executeRaw`DELETE FROM media_attachment WHERE media_asset_id = ${asset.id}::uuid`;
      await ownerPrisma()
        .$executeRaw`DELETE FROM media_rendition WHERE media_asset_id = ${asset.id}::uuid`;
      await ownerPrisma().$executeRaw`DELETE FROM media_asset WHERE id = ${asset.id}::uuid`;
    } finally {
      for (const table of ['media_attachment', 'media_rendition', 'media_asset']) {
        await ownerPrisma().$executeRawUnsafe(
          `ALTER TABLE "${table}" ENABLE TRIGGER "${table}_no_delete"`,
        );
      }
    }

    const remaining = await harness.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM media_asset WHERE id = ${asset.id}::uuid
    `;
    expect(Number(remaining[0]!.n)).toBe(0);

    // The audit trail is untouched by any of it: `audit_log` holds the ACTS and
    // never held the content, which is the asymmetry the whole privacy design
    // rests on. It carries no foreign key to these tables, so erasing them
    // cannot cascade into the one table that may never be pruned.
    const trail = await harness.prisma.$queryRaw<{ action: string }[]>`
      SELECT action FROM audit_log WHERE entity_id = ${asset.id}::uuid
    `;
    expect(trail.map((row) => row.action)).toContain('media.uploaded');
  });

  it('never wrote the uploaded photograph anywhere a retention policy would have to find it', async () => {
    // The strongest retention property this product has is that the riskiest
    // bytes were never stored at all. A policy has to reason about the master
    // and the renditions, and about nothing else.
    const { asset } = await publishedPhoto();

    const stored = await harness.prisma.$queryRaw<{ master_storage_key: string }[]>`
      SELECT master_storage_key FROM media_asset WHERE id = ${asset.id}::uuid
    `;
    const master = await readFile(
      join(TEST_MEDIA_ROOT, ...stored[0]!.master_storage_key.split('/')),
    );

    expect(master.byteLength).toBeGreaterThan(0);
    expect(master.byteLength).not.toBe(asset.sourceByteSize);

    const columns = await harness.prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('media_asset', 'media_rendition', 'media_attachment')
        AND data_type IN ('bytea', 'text', 'character varying')
    `;

    // No column anywhere in the subsystem holds image data, so an erasure is a
    // filesystem operation plus two UPDATEs and can never be a `bytea` rewrite
    // of a table the clinic's backups are full of.
    expect(columns.map((c) => c.column_name)).not.toContain('bytes');
    expect(columns.map((c) => c.column_name)).not.toContain('data');
  });
});
