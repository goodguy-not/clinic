import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import {
  jobStatusResponseSchema,
  mediaAssetResponseSchema,
  testimonialConsentWithdrawalListResponseSchema,
  type MediaAsset,
} from '@clinic/contracts';
import { CliModule } from '../src/cli/cli.module';
import { API_ENV } from '../src/config/config.module';
import { MediaErasureService } from '../src/media/media-erasure.service';
import { ScheduledJobsService, type JobReport } from '../src/jobs/scheduled-jobs.service';
import {
  createHarness,
  ownerPrisma,
  resetDatabase,
  seedUser,
  TEST_INTERNAL_KEY,
  TEST_MEDIA_ROOT,
  testDatabaseUrl,
  type Harness,
} from './harness';
import { uploadPhoto } from './media-support';
import { as, asVisitor, loginAs, testimonialDraft } from './website-support';

/**
 * Milestone 10, checkpoint A3 — the nightly jobs, and the owner's erasure
 * rules, against a real database and a real media directory.
 *
 * The jobs run from their own application context, built from `CliModule`
 * exactly as `cli run-jobs` builds it, on the same media root the API under
 * test writes to. Time is moved only by ageing rows as the owner.
 *
 * Everything is synthetic.
 */
describe('scheduled jobs and erasure (real PostgreSQL)', () => {
  let harness: Harness;
  let jobsModule: TestingModule;
  let jobs: ScheduledJobsService;
  let manager: string;
  let receptionist: string;

  const NO_WAIT = { backupWaitMs: 0, pollMs: 0 };
  const server = () => harness.app.getHttpServer();

  beforeAll(async () => {
    harness = await createHarness();
    jobsModule = await Test.createTestingModule({ imports: [CliModule] })
      .overrideProvider(API_ENV)
      .useValue({
        NODE_ENV: 'test',
        API_PORT: 3001,
        DATABASE_URL: testDatabaseUrl(),
        INTERNAL_API_KEY: TEST_INTERNAL_KEY,
        PASSWORD_BLOCKED_TERMS: undefined,
        MEDIA_STORAGE_DIR: TEST_MEDIA_ROOT,
      })
      .compile();
    await jobsModule.init();
    jobs = jobsModule.get(ScheduledJobsService);
  }, 60_000);

  afterAll(async () => {
    await jobsModule.close();
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    manager = await loginAs(harness, 'MANAGER');
    receptionist = await loginAs(harness, 'RECEPTIONIST');
  });

  const run = (only?: JobReport['job']) =>
    jobs.run({ ...(only === undefined ? {} : { only }), media: NO_WAIT });

  const report = (reports: JobReport[], job: JobReport['job']) =>
    reports.find((one) => one.job === job);

  const keysOf = async (assetId: string): Promise<string[]> => {
    const rows = await harness.prisma.$queryRaw<{ key: string }[]>`
      SELECT master_storage_key AS key FROM media_asset
      WHERE id = ${assetId}::uuid AND master_storage_key IS NOT NULL
      UNION ALL
      SELECT storage_key FROM media_rendition
      WHERE media_asset_id = ${assetId}::uuid AND storage_key IS NOT NULL
    `;
    return rows.map((row) => row.key);
  };

  const onDisk = async (key: string) =>
    access(join(TEST_MEDIA_ROOT, ...key.split('/'))).then(
      () => true,
      () => false,
    );

  const age = (
    table: 'media_asset',
    column: 'created_at' | 'archived_at',
    id: string,
    days: number,
  ) =>
    ownerPrisma().$executeRawUnsafe(
      `UPDATE ${table} SET ${column} = ${column} - interval '${days} days' WHERE id = $1::uuid`,
      id,
    );

  const archive = (assetId: string, archived = true) =>
    request(server()).patch(`/media/${assetId}/archive`).set(as(manager)).send({ archived });

  const library = async (assetId: string): Promise<MediaAsset> =>
    mediaAssetResponseSchema.parse(
      (await request(server()).get(`/media/${assetId}`).set(as(manager))).body,
    ).media;

  describe('the runner', () => {
    it('runs all four jobs, records each success and audits it with counts only', async () => {
      const reports = await run();

      expect(reports.map((one) => [one.job, one.outcome])).toEqual([
        ['WEBSITE_REQUEST_PURGE', 'SUCCEEDED'],
        ['SESSION_PRUNE', 'SUCCEEDED'],
        ['TESTIMONIAL_ERASURE', 'SUCCEEDED'],
        ['MEDIA_ERASURE', 'SUCCEEDED'],
      ]);

      const recorded = await harness.prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM scheduled_job WHERE last_succeeded_at IS NOT NULL
      `;
      expect(recorded[0]?.n).toBe(4);

      const audit = await harness.prisma.$queryRaw<
        { actor_type: string; entity_type: string; metadata: Record<string, unknown> }[]
      >`
        SELECT actor_type::text, entity_type, metadata FROM audit_log
        WHERE action = 'scheduled_job.succeeded'
      `;
      expect(audit).toHaveLength(4);
      for (const row of audit) {
        expect(row.actor_type).toBe('SYSTEM');
        expect(row.entity_type).toBe('scheduled_job');
        // The job's name and numbers — never an id, never content.
        const { job, ...counts } = row.metadata;
        expect(typeof job).toBe('string');
        for (const value of Object.values(counts)) expect(typeof value).toBe('number');
      }
    });

    it('is safe to run twice', async () => {
      await run();
      const second = await run();

      expect(second.every((one) => one.outcome === 'SUCCEEDED')).toBe(true);
      expect(report(second, 'MEDIA_ERASURE')?.counts['erased']).toBe(0);
    });

    it('writes nothing on a dry run', async () => {
      const reports = await jobs.run({ dryRun: true });

      expect(reports.every((one) => one.outcome === 'DRY_RUN')).toBe(true);
      const written = await harness.prisma.$queryRaw<{ n: number }[]>`
        SELECT (SELECT count(*) FROM scheduled_job WHERE last_succeeded_at IS NOT NULL)
             + (SELECT count(*) FROM audit_log WHERE action = 'scheduled_job.succeeded') AS n
      `;
      expect(Number(written[0]?.n)).toBe(0);
    });

    it('shows the manager when each job last succeeded, and nobody else', async () => {
      const before = jobStatusResponseSchema.parse(
        (await request(server()).get('/operations/job-status').set(as(manager))).body,
      );
      expect(before.warning).toBe(true);
      expect(before.jobs.every((one) => one.state === 'NEVER_RUN')).toBe(true);

      await run();

      const after = jobStatusResponseSchema.parse(
        (await request(server()).get('/operations/job-status').set(as(manager))).body,
      );
      expect(after.warning).toBe(false);
      expect(after.jobs.every((one) => one.state === 'OK' && one.ageHours === 0)).toBe(true);

      const refused = await request(server()).get('/operations/job-status').set(as(receptionist));
      expect(refused.status).toBe(403);
    });
  });

  describe('SESSION_PRUNE', () => {
    it('removes a session over for thirty days, and keeps a recent or live one', async () => {
      const user = await seedUser(harness);
      const issue = () =>
        harness.prisma.$transaction((tx) => harness.sessions.createSession(tx, user.id));
      const [old, recent, live] = [await issue(), await issue(), await issue()];

      const shift = (id: string, days: number) =>
        ownerPrisma().$executeRawUnsafe(
          `UPDATE user_session SET created_at = created_at - interval '${days} days',
             last_seen_at = last_seen_at - interval '${days} days',
             idle_expires_at = idle_expires_at - interval '${days} days',
             absolute_expires_at = absolute_expires_at - interval '${days} days'
           WHERE id = $1::uuid`,
          id,
        );
      await shift(old.sessionId, 31);
      await shift(recent.sessionId, 29);
      const ids = async () =>
        (await harness.prisma.$queryRaw<{ id: string }[]>`SELECT id FROM user_session`)
          .map((row) => row.id)
          .sort();
      const before = await ids();

      const reports = await run('SESSION_PRUNE');

      expect(reports[0]?.counts).toEqual({ removed: 1 });
      expect(await ids()).toEqual(before.filter((id) => id !== old.sessionId));
      expect(before).toEqual(expect.arrayContaining([recent.sessionId, live.sessionId]));
    });
  });

  describe('MEDIA_ERASURE — the owner’s two thirty-day rules', () => {
    it('erases a photograph never attached for thirty days, and keeps a younger one', async () => {
      const due = await uploadPhoto(harness, receptionist);
      const young = await uploadPhoto(harness, receptionist, { altText: 'عکس دوم آزمون' });
      await age('media_asset', 'created_at', due.id, 31);
      await age('media_asset', 'created_at', young.id, 29);
      const dueKeys = await keysOf(due.id);

      const reports = await run('MEDIA_ERASURE');

      expect(report(reports, 'MEDIA_ERASURE')).toMatchObject({
        outcome: 'SUCCEEDED',
        counts: { eligible: 1, erased: 1, deferred: 0 },
      });
      for (const key of dueKeys) expect(await onDisk(key)).toBe(false);
      expect(await keysOf(due.id)).toEqual([]);
      expect((await library(due.id)).bytesPurgedAt).not.toBeNull();

      expect((await library(young.id)).bytesPurgedAt).toBeNull();
      for (const key of await keysOf(young.id)) expect(await onDisk(key)).toBe(true);

      const trail = await harness.prisma.$queryRaw<
        { actor_type: string; metadata: unknown; before: unknown; after: unknown }[]
      >`
        SELECT actor_type::text, metadata, before, after FROM audit_log
        WHERE action = 'media.bytes_erased' AND entity_id = ${due.id}::uuid
      `;
      expect(trail).toEqual([
        { actor_type: 'SYSTEM', metadata: { rule: 'UNATTACHED' }, before: null, after: null },
      ]);
    });

    it('keeps a photograph that was once attached, however old', async () => {
      const asset = await uploadPhoto(harness, receptionist);
      const created = await request(server())
        .post('/content/testimonials')
        .set(as(receptionist))
        .send(testimonialDraft());
      const attached = await request(server())
        .post(`/media/${asset.id}/attachments`)
        .set(as(receptionist))
        .send({
          ownerType: 'PUBLIC_TESTIMONIAL',
          ownerId: created.body.testimonial.id,
          position: 0,
        });
      const attachmentId = mediaAssetResponseSchema.parse(attached.body).media.attachments[0]!.id;
      await request(server()).delete(`/media/attachments/${attachmentId}`).set(as(receptionist));
      await age('media_asset', 'created_at', asset.id, 400);

      await run('MEDIA_ERASURE');

      expect((await library(asset.id)).bytesPurgedAt).toBeNull();
    });

    it('lets an archived photograph be restored for thirty days, then erases it for good', async () => {
      const kept = await uploadPhoto(harness, receptionist);
      const erased = await uploadPhoto(harness, receptionist, { altText: 'عکس سوم آزمون' });
      for (const asset of [kept, erased]) expect((await archive(asset.id)).status).toBe(200);
      await age('media_asset', 'archived_at', kept.id, 29);
      await age('media_asset', 'archived_at', erased.id, 31);

      await run('MEDIA_ERASURE');

      expect((await archive(kept.id, false)).status).toBe(200);

      const restore = await archive(erased.id, false);
      expect(restore.status).toBe(404);
      expect(restore.body.error.code).toBe('MEDIA_NOT_FOUND');

      const attach = await request(server())
        .post(`/media/${erased.id}/attachments`)
        .set(as(receptionist))
        .send({ ownerType: 'CLINIC_SPACE', ownerId: null, position: 0 });
      expect(attach.status).toBe(404);

      // The record survives, saying the photograph existed and when it went.
      const record = await library(erased.id);
      expect(record.bytesPurgedAt).not.toBeNull();
      expect(record.status).toBe('ARCHIVED');
    });

    it('never breaks a backup running at the same time: it waits, then leaves the work for later', async () => {
      const asset = await uploadPhoto(harness, receptionist);
      await age('media_asset', 'created_at', asset.id, 31);
      const keys = await keysOf(asset.id);

      // A stand-in for backup.sql: one session holding the files lock SHARED,
      // as a backup does from before its snapshot until its last file is copied.
      const backup = new PrismaClient({
        datasourceUrl: `${testDatabaseUrl()}&connection_limit=1`,
      });
      await backup.$executeRaw`SELECT pg_advisory_lock_shared(4919, 10)`;

      try {
        const during = await run('MEDIA_ERASURE');

        expect(report(during, 'MEDIA_ERASURE')).toMatchObject({
          outcome: 'INCOMPLETE',
          counts: { eligible: 1, erased: 0, deferred: 1 },
        });
        // Not a byte touched, not a key cleared, no success recorded.
        expect(await keysOf(asset.id)).toEqual(keys);
        for (const key of keys) expect(await onDisk(key)).toBe(true);
        const status = jobStatusResponseSchema.parse(
          (await request(server()).get('/operations/job-status').set(as(manager))).body,
        );
        expect(status.jobs.find((one) => one.job === 'MEDIA_ERASURE')?.state).toBe('NEVER_RUN');
      } finally {
        await backup.$executeRaw`SELECT pg_advisory_unlock_shared(4919, 10)`;
        await backup.$disconnect();
      }

      const after = await run('MEDIA_ERASURE');

      expect(report(after, 'MEDIA_ERASURE')).toMatchObject({
        outcome: 'SUCCEEDED',
        counts: { erased: 1, deferred: 0 },
      });
      for (const key of keys) expect(await onDisk(key)).toBe(false);
    });

    it('finishes an erasure whose process died between the commit and the unlink', async () => {
      const asset = await uploadPhoto(harness, receptionist);
      await age('media_asset', 'created_at', asset.id, 31);
      const keys = await keysOf(asset.id);
      const media = harness.app.get(MediaErasureService);

      // The database half only — as if the process stopped before unlinking.
      await harness.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(4919, 10)`;
        await tx.$queryRaw`SELECT id FROM media_asset WHERE id = ${asset.id}::uuid FOR UPDATE`;
        await media.eraseLocked(tx, asset.id, 'UNATTACHED', {
          actor: { type: 'SYSTEM' },
          requestId: '01926a3c-0000-7000-8000-00000000abcd',
        });
      });
      for (const key of keys) expect(await onDisk(key)).toBe(true);

      const reports = await run('MEDIA_ERASURE');

      expect(report(reports, 'MEDIA_ERASURE')?.outcome).toBe('SUCCEEDED');
      for (const key of keys) expect(await onDisk(key)).toBe(false);
    });

    it('is refused by the database when a photograph is not due, whatever the caller', async () => {
      const asset = await uploadPhoto(harness, receptionist);

      await expect(
        harness.prisma.$executeRaw`
          UPDATE media_asset SET master_storage_key = NULL, bytes_purged_at = now()
          WHERE id = ${asset.id}::uuid
        `,
      ).rejects.toThrow(/not due for erasure/);
      await expect(
        ownerPrisma().$executeRaw`
          UPDATE media_rendition SET storage_key = NULL, bytes_purged_at = now()
          WHERE media_asset_id = ${asset.id}::uuid
        `,
      ).rejects.toThrow(/not due for erasure/);
    });
  });

  describe('TESTIMONIAL_ERASURE — a family withdraws consent', () => {
    const BODY = 'Synthetic words from a synthetic family, to be erased.';
    const LABEL = 'Synthetic label to be erased';

    /** Approved, published, with a published photograph of the note. */
    const publishedTestimonialWithPhoto = async () => {
      const created = await request(server())
        .post('/content/testimonials')
        .set(as(receptionist))
        .send(testimonialDraft({ body: BODY, authorLabel: LABEL, kind: 'HANDWRITTEN' }));
      const id: string = created.body.testimonial.id;
      await request(server())
        .patch(`/content/testimonials/${id}/approval`)
        .set(as(manager))
        .send({ approved: true });
      await request(server())
        .patch(`/content/testimonials/${id}/publication`)
        .set(as(manager))
        .send({ isPublic: true });

      const photo = await uploadPhoto(harness, receptionist, { altText: 'عکس یادداشت آزمون' });
      const attached = await request(server())
        .post(`/media/${photo.id}/attachments`)
        .set(as(receptionist))
        .send({ ownerType: 'PUBLIC_TESTIMONIAL', ownerId: id, position: 0 });
      const attachmentId = mediaAssetResponseSchema.parse(attached.body).media.attachments[0]!.id;
      await request(server())
        .patch(`/media/attachments/${attachmentId}/publication`)
        .set(as(manager))
        .send({ isPublished: true });

      return { id, photo };
    };

    const withdraw = (id: string, token = manager) =>
      request(server()).post(`/content/testimonials/${id}/consent-withdrawal`).set(as(token));

    it('takes it off the site at once and out of every staff read, and only a manager may', async () => {
      const { id, photo } = await publishedTestimonialWithPhoto();
      const rendition = photo.renditions[0]!.id;
      expect(
        (await request(server()).get(`/public/media/${rendition}`).set(asVisitor())).status,
      ).toBe(200);

      expect((await withdraw(id, receptionist)).status).toBe(403);
      expect((await withdraw(id)).status).toBe(204);
      expect((await withdraw(id)).status).toBe(204); // a retry is not an error

      const site = await request(server()).get('/public/testimonials').set(asVisitor());
      expect(JSON.stringify(site.body)).not.toContain(BODY);
      expect(
        (await request(server()).get(`/public/media/${rendition}`).set(asVisitor())).status,
      ).toBe(404);

      expect(
        (await request(server()).get(`/content/testimonials/${id}`).set(as(manager))).status,
      ).toBe(404);
      const list = await request(server()).get('/content/testimonials').set(as(manager));
      expect(JSON.stringify(list.body)).not.toContain(id);
      const edit = await request(server())
        .patch(`/content/testimonials/${id}`)
        .set(as(receptionist))
        .send(testimonialDraft());
      expect(edit.status).toBe(404);
      const another = await uploadPhoto(harness, receptionist, { altText: 'عکس دیگر آزمون' });
      const attach = await request(server())
        .post(`/media/${another.id}/attachments`)
        .set(as(receptionist))
        .send({ ownerType: 'PUBLIC_TESTIMONIAL', ownerId: id, position: 0 });
      expect(attach.status).toBe(404);
      expect(attach.body.error.code).toBe('TESTIMONIAL_NOT_FOUND');

      // The record that it happened stays readable, with dates only.
      const withdrawals = testimonialConsentWithdrawalListResponseSchema.parse(
        (
          await request(server())
            .get('/content/testimonials/consent-withdrawals')
            .set(as(receptionist))
        ).body,
      ).withdrawals;
      expect(withdrawals).toHaveLength(1);
      expect(withdrawals[0]).toMatchObject({ id, contentErasedAt: null });
      expect(
        new Date(withdrawals[0]!.erasureDueBy).getTime() -
          new Date(withdrawals[0]!.consentWithdrawnAt).getTime(),
      ).toBe(7 * 86_400_000);
    });

    it('erases the words, the attribution and the photograph, and keeps only that it happened', async () => {
      const { id, photo } = await publishedTestimonialWithPhoto();
      const keys = await keysOf(photo.id);
      await withdraw(id);

      const reports = await run('TESTIMONIAL_ERASURE');

      expect(report(reports, 'TESTIMONIAL_ERASURE')).toMatchObject({
        outcome: 'SUCCEEDED',
        counts: { eligible: 1, erased: 1, photographs: 1, deferred: 0 },
      });

      const row = await harness.prisma.$queryRaw<
        { body: string | null; author_label: string | null; erased: boolean; withdrawn: boolean }[]
      >`
        SELECT body, author_label, content_erased_at IS NOT NULL AS erased,
               consent_withdrawn_at IS NOT NULL AS withdrawn
        FROM public_testimonial WHERE id = ${id}::uuid
      `;
      expect(row).toEqual([{ body: null, author_label: null, erased: true, withdrawn: true }]);
      for (const key of keys) expect(await onDisk(key)).toBe(false);
      expect((await library(photo.id)).bytesPurgedAt).not.toBeNull();

      // The trail has the acts and never the content.
      const trail = await harness.prisma.$queryRaw<{ action: string; text: string }[]>`
        SELECT action, row_to_json(a)::text AS text FROM audit_log a
        WHERE entity_id IN (${id}::uuid, ${photo.id}::uuid)
        ORDER BY occurred_at, id
      `;
      expect(trail.map((one) => one.action)).toEqual(
        expect.arrayContaining([
          'public_testimonial.consent_withdrawn',
          'public_testimonial.unpublished',
          'public_testimonial.content_erased',
          'media.bytes_erased',
        ]),
      );
      const everything = (
        await harness.prisma.$queryRaw<{ text: string }[]>`
        SELECT string_agg(row_to_json(a)::text, ' ') AS text FROM audit_log a
      `
      )[0]!.text;
      expect(everything).not.toContain(BODY);
      expect(everything).not.toContain(LABEL);

      const withdrawals = testimonialConsentWithdrawalListResponseSchema.parse(
        (await request(server()).get('/content/testimonials/consent-withdrawals').set(as(manager)))
          .body,
      ).withdrawals;
      expect(withdrawals[0]?.contentErasedAt).not.toBeNull();
    });

    it('makes the withdrawal and the erasure final, in the database', async () => {
      const { id } = await publishedTestimonialWithPhoto();
      await withdraw(id);

      await expect(
        ownerPrisma().$executeRaw`
          UPDATE public_testimonial SET consent_withdrawn_at = NULL, consent_withdrawn_by_user_id = NULL
          WHERE id = ${id}::uuid
        `,
      ).rejects.toThrow(/only permitted change is its erasure/);

      await run('TESTIMONIAL_ERASURE');

      await expect(
        ownerPrisma().$executeRaw`
          UPDATE public_testimonial SET body = 'restored', content_erased_at = NULL
          WHERE id = ${id}::uuid
        `,
      ).rejects.toThrow(/erasure is final/);
    });

    it('refuses to erase a testimonial whose consent was never withdrawn', async () => {
      const created = await request(server())
        .post('/content/testimonials')
        .set(as(receptionist))
        .send(testimonialDraft());

      await expect(
        harness.prisma.$executeRaw`
          UPDATE public_testimonial SET body = NULL, author_label = NULL, content_erased_at = now()
          WHERE id = ${created.body.testimonial.id as string}::uuid
        `,
      ).rejects.toThrow(/before consent is withdrawn/);
    });
  });
});
