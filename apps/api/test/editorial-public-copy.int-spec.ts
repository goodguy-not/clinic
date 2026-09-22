import request from 'supertest';
import {
  publicServiceListResponseSchema,
  publicTeamResponseSchema,
  servicePublicCopyListResponseSchema,
  servicePublicCopyResponseSchema,
  serviceResponseSchema,
  therapistProfileCopyListResponseSchema,
  therapistProfileCopyResponseSchema,
  therapistPublicProfileResponseSchema,
} from '@clinic/contracts';
import { uuidv7 } from '../src/common/uuid';
import { createHarness, internalHeaders, resetDatabase, type Harness } from './harness';
import { as, auditActionsFor, loginAs } from './website-support';

/**
 * The editorial split: who may write public copy, who may publish it, and what
 * a visitor sees in between.
 *
 * Milestone 9.5, checkpoint A6, over real HTTP against real PostgreSQL.
 *
 * THE SUITE IS ORGANISED AROUND THE ONE DEFECT THIS CHECKPOINT CANNOT SHIP
 * WITH: a receptionist's unreviewed sentence reaching a visitor without a
 * manager deciding it should. Every authority test therefore has both halves —
 * what the front desk may do, and what it may not — because a test that only
 * proves they can write would pass just as well if they could also publish, and
 * one that only proves they cannot publish would pass on a product where they
 * cannot do anything.
 *
 * THE PROOF THAT MATTERS IS THE PUBLIC READ. Several tests below assert on
 * `/public/services` and `/public/team` rather than on the editorial response,
 * because "the draft did not leak" is a statement about what the website says,
 * not about what an internal endpoint returns.
 *
 * Everything is synthetic. No real service, colleague, description or biography
 * appears in any fixture here, and none may.
 */
describe('editorial public copy (real PostgreSQL)', () => {
  let harness: Harness;
  let manager: string;
  let receptionist: string;
  let serviceId: string;
  let therapistId: string;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  const server = () => harness.app.getHttpServer();

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
    manager = await loginAs(harness, 'MANAGER');
    receptionist = await loginAs(harness, 'RECEPTIONIST');

    const actorId = (
      await harness.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM app_user WHERE role = 'MANAGER'::user_role LIMIT 1
      `
    )[0]!.id;

    // The service is created through the real manager form, so the row under
    // test is one the product actually produces.
    const created = await request(server())
      .post('/catalog/services')
      .set(as(manager))
      .send({
        name: 'خدمت نمونه',
        publicDescription: 'شرح نمونهٔ منتشرشده.',
        isPublic: true,
        publicSlug: 'synthetic-service',
        allowedDurationsMinutes: [30, 45],
      });

    expect(created.status).toBe(201);
    serviceId = serviceResponseSchema.parse(created.body).service.id;

    therapistId = uuidv7();
    await harness.prisma.$executeRaw`
      INSERT INTO therapist (id, full_name, specialty, status, created_at, created_by_user_id)
      VALUES (
        ${therapistId}::uuid, 'Synthetic Colleague', 'Synthetic Specialty',
        'ACTIVE'::catalog_status, transaction_timestamp(), ${actorId}::uuid
      )
    `;
  });

  // --- helpers --------------------------------------------------------------

  const draftServiceCopy = (session: string, description: string | null) =>
    request(server())
      .patch(`/content/service-copy/${serviceId}`)
      .set(as(session))
      .send({ description });

  const publishServiceCopy = (session: string, isPublished: boolean) =>
    request(server())
      .patch(`/content/service-copy/${serviceId}/publication`)
      .set(as(session))
      .send({ isPublished });

  /**
   * The editorial request states the whole of the copy it replaces, so the
   * helper fills in the two fields a caller is not exercising rather than
   * letting a half-sent form silently clear a paragraph.
   */
  const draftProfileCopy = (session: string, body: Record<string, unknown>) =>
    request(server())
      .patch(`/content/therapist-profiles/${therapistId}`)
      .set(as(session))
      .send({
        displayName: 'نام عمومی نمونه',
        title: 'عنوان عمومی نمونه',
        bio: 'زندگی‌نامهٔ نمونهٔ منتشرشده.',
        ...body,
      });

  const writeProfile = (session: string, overrides: Record<string, unknown> = {}) =>
    request(server())
      .patch(`/catalog/therapists/${therapistId}/public-profile`)
      .set(as(session))
      .send({
        publicSlug: 'synthetic-colleague',
        displayName: 'نام عمومی نمونه',
        title: 'عنوان عمومی نمونه',
        bio: 'زندگی‌نامهٔ نمونهٔ منتشرشده.',
        photoPath: null,
        displayOrder: 1,
        ...overrides,
      });

  const setVisibility = (session: string, isPublic: boolean) =>
    request(server())
      .patch(`/catalog/therapists/${therapistId}/public-profile/visibility`)
      .set(as(session))
      .send({ isPublic });

  const publicServices = async () =>
    publicServiceListResponseSchema.parse(
      (await request(server()).get('/public/services').set(internalHeaders())).body,
    ).services;

  const publicTeam = async () =>
    publicTeamResponseSchema.parse(
      (await request(server()).get('/public/team').set(internalHeaders())).body,
    ).therapists;

  /** Publishes the colleague through the real two-act manager path. */
  async function publishColleague(): Promise<void> {
    expect((await writeProfile(manager)).status).toBe(200);
    expect((await setVisibility(manager, true)).status).toBe(200);
  }

  // --- a service ------------------------------------------------------------

  describe('a service, drafted by the front desk', () => {
    it('lets a receptionist read and rewrite the public description', async () => {
      const list = await request(server()).get('/content/service-copy').set(as(receptionist));
      const one = await request(server())
        .get(`/content/service-copy/${serviceId}`)
        .set(as(receptionist));
      const drafted = await draftServiceCopy(receptionist, 'شرح تازه که هنوز تأیید نشده است.');

      expect(list.status).toBe(200);
      expect(servicePublicCopyListResponseSchema.parse(list.body).copies).toHaveLength(1);
      expect(one.status).toBe(200);
      expect(drafted.status).toBe(200);

      const copy = servicePublicCopyResponseSchema.parse(drafted.body).copy;
      expect(copy.description).toBe('شرح تازه که هنوز تأیید نشده است.');
      expect(copy.hasUnpublishedChanges).toBe(true);
    });

    it('LEAVES THE WEBSITE SAYING EXACTLY WHAT IT SAID BEFORE', async () => {
      // The acceptance criterion of this checkpoint, asserted where it is true
      // or false: the public read.
      const before = await publicServices();

      await draftServiceCopy(receptionist, 'شرح تازه که هنوز تأیید نشده است.');

      expect(await publicServices()).toEqual(before);
      expect(before).toEqual([
        {
          slug: 'synthetic-service',
          name: 'خدمت نمونه',
          description: 'شرح نمونهٔ منتشرشده.',
          image: null,
        },
      ]);
    });

    it('changes the website when, and only when, a manager publishes', async () => {
      await draftServiceCopy(receptionist, 'شرح تازه که هنوز تأیید نشده است.');
      expect((await publicServices())[0]!.description).toBe('شرح نمونهٔ منتشرشده.');

      const published = await publishServiceCopy(manager, true);

      expect(published.status).toBe(200);
      expect(servicePublicCopyResponseSchema.parse(published.body).copy.hasUnpublishedChanges).toBe(
        false,
      );
      expect((await publicServices())[0]!.description).toBe('شرح تازه که هنوز تأیید نشده است.');
    });

    it('refuses a receptionist publishing the prepared copy', async () => {
      await draftServiceCopy(receptionist, 'شرح تازه که هنوز تأیید نشده است.');

      const attempt = await publishServiceCopy(receptionist, true);

      expect(attempt.status).toBe(403);
      expect(attempt.body.error.code).toBe('AUTH_FORBIDDEN');

      // AND THE ROW DID NOT MOVE. A 403 that nevertheless wrote would be the
      // worst possible outcome of this test passing.
      expect((await publicServices())[0]!.description).toBe('شرح نمونهٔ منتشرشده.');
    });

    it('refuses a receptionist WITHDRAWING published copy', async () => {
      // The other direction of the same authority. Taking a sentence off the
      // clinic's page is not a lesser act than putting it there.
      const attempt = await publishServiceCopy(receptionist, false);

      expect(attempt.status).toBe(403);
      expect(attempt.body.error.code).toBe('AUTH_FORBIDDEN');
      expect((await publicServices())[0]!.description).toBe('شرح نمونهٔ منتشرشده.');
    });

    it('lets a manager withdraw the published sentence and leave the service listed', async () => {
      const withdrawn = await publishServiceCopy(manager, false);
      const listed = await publicServices();

      expect(withdrawn.status).toBe(200);
      expect(listed).toHaveLength(1);
      expect(listed[0]!.description).toBeNull();
      // The draft survives, so the copy can be corrected rather than rewritten.
      expect(servicePublicCopyResponseSchema.parse(withdrawn.body).copy.description).toBe(
        'شرح نمونهٔ منتشرشده.',
      );
    });

    it('writes nothing when the draft already matches the page', async () => {
      const first = await publishServiceCopy(manager, true);
      const second = await publishServiceCopy(manager, true);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(await auditActionsFor(harness, 'service', serviceId)).toEqual(['service.created']);
    });
  });

  // --- a service: what the front desk still cannot reach ---------------------

  describe('a service, and the authority that did not move', () => {
    const operationalBody = {
      name: 'نام تازه',
      publicDescription: 'شرح تازه.',
      isPublic: true,
      publicSlug: 'synthetic-service',
      allowedDurationsMinutes: [60],
    };

    it('refuses a receptionist the operational form outright', async () => {
      // Durations, name, address and visibility all arrive on this one request,
      // and the whole request is refused before a statement runs.
      const attempt = await request(server())
        .patch(`/catalog/services/${serviceId}`)
        .set(as(receptionist))
        .send(operationalBody);

      expect(attempt.status).toBe(403);
      expect(attempt.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('refuses a receptionist creating, retiring or reactivating a service', async () => {
      const created = await request(server())
        .post('/catalog/services')
        .set(as(receptionist))
        .send({ ...operationalBody, publicSlug: 'another-service' });
      const retired = await request(server())
        .patch(`/catalog/services/${serviceId}/status`)
        .set(as(receptionist))
        .send({ status: 'INACTIVE' });

      for (const response of [created, retired]) {
        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('AUTH_FORBIDDEN');
      }
    });

    it('cannot reach an operational field THROUGH the editorial route', async () => {
      // The request schema is strict, so this is refused as a malformed body
      // rather than silently ignored — and the row is unchanged either way,
      // because the statement behind the route names one column.
      const attempt = await request(server())
        .patch(`/content/service-copy/${serviceId}`)
        .set(as(receptionist))
        .send({
          description: 'شرح تازه.',
          name: 'نام تازه',
          isPublic: false,
          publicSlug: 'stolen-slug',
          allowedDurationsMinutes: [60],
        });

      expect(attempt.status).toBe(400);
      expect(attempt.body.error.code).toBe('VALIDATION_FAILED');

      const after = serviceResponseSchema.parse(
        (await request(server()).get(`/catalog/services/${serviceId}`).set(as(manager))).body,
      ).service;

      expect(after.name).toBe('خدمت نمونه');
      expect(after.allowedDurationsMinutes).toEqual([30, 45]);
      expect(after.publicSlug).toBe('synthetic-service');
      expect(after.isPublic).toBe(true);
      expect(after.status).toBe('ACTIVE');
    });

    it('leaves a published address untouched by any amount of drafting', async () => {
      await draftServiceCopy(receptionist, 'یک');
      await draftServiceCopy(receptionist, 'دو');

      expect((await publicServices())[0]!.slug).toBe('synthetic-service');
    });
  });

  // --- a colleague ----------------------------------------------------------

  describe('a colleague, drafted by the front desk', () => {
    it('lets a receptionist read and rewrite the public display name, title and biography', async () => {
      const list = await request(server()).get('/content/therapist-profiles').set(as(receptionist));
      const drafted = await draftProfileCopy(receptionist, {
        displayName: 'نام عمومی تازه',
        title: 'عنوان تازه',
        bio: 'زندگی‌نامهٔ تازه که هنوز تأیید نشده است.',
      });

      expect(list.status).toBe(200);
      expect(therapistProfileCopyListResponseSchema.parse(list.body).copies).toHaveLength(1);
      expect(drafted.status).toBe(200);

      const copy = therapistProfileCopyResponseSchema.parse(drafted.body).copy;
      expect(copy.displayName).toBe('نام عمومی تازه');
      expect(copy.title).toBe('عنوان تازه');
      expect(copy.bio).toBe('زندگی‌نامهٔ تازه که هنوز تأیید نشده است.');
    });

    it('LEAVES A LIVE PROFILE SAYING EXACTLY WHAT IT SAID BEFORE', async () => {
      await publishColleague();
      const before = await publicTeam();

      await draftProfileCopy(receptionist, {
        displayName: 'نام عمومی تازه',
        title: 'عنوان تازه',
        bio: 'زندگی‌نامهٔ تازه که هنوز تأیید نشده است.',
      });

      expect(await publicTeam()).toEqual(before);
      expect(before[0]).toMatchObject({
        displayName: 'نام عمومی نمونه',
        title: 'عنوان عمومی نمونه',
        bio: 'زندگی‌نامهٔ نمونهٔ منتشرشده.',
      });
    });

    it('changes the live profile when, and only when, a manager publishes', async () => {
      await publishColleague();
      await draftProfileCopy(receptionist, {
        displayName: 'نام عمومی تازه',
        title: 'عنوان تازه',
        bio: 'زندگی‌نامهٔ تازه.',
      });

      expect((await publicTeam())[0]).toMatchObject({
        displayName: 'نام عمومی نمونه',
        title: 'عنوان عمومی نمونه',
      });

      const promoted = await setVisibility(manager, true);

      // ALL THREE PREPARED FIELDS CROSS IN ONE ACT, the display name included.
      expect(promoted.status).toBe(200);
      expect((await publicTeam())[0]).toMatchObject({
        displayName: 'نام عمومی تازه',
        title: 'عنوان تازه',
        bio: 'زندگی‌نامهٔ تازه.',
      });
    });

    it('LEAVES A LIVE NAME ALONE WHILE THE FRONT DESK RENAMES THE DRAFT', async () => {
      // The field the coordinator review opened, asserted where it matters: a
      // receptionist may prepare the name a colleague would appear under, and
      // the website goes on printing the name a manager last approved.
      await publishColleague();

      const drafted = await draftProfileCopy(receptionist, { displayName: 'نام عمومی تازه' });

      expect(drafted.status).toBe(200);
      expect(therapistProfileCopyResponseSchema.parse(drafted.body).copy).toMatchObject({
        displayName: 'نام عمومی تازه',
        publishedDisplayName: 'نام عمومی نمونه',
        hasUnpublishedChanges: true,
      });
      expect((await publicTeam())[0]).toMatchObject({ displayName: 'نام عمومی نمونه' });
    });

    it('does not take a colleague off the website by clearing the draft name', async () => {
      // Clearing a draft is an editorial act, not an unpublication. The
      // published name is a different column and nobody disappears.
      await publishColleague();

      const cleared = await draftProfileCopy(receptionist, { displayName: null });
      const team = await publicTeam();

      expect(cleared.status).toBe(200);
      expect(team).toHaveLength(1);
      expect(team[0]).toMatchObject({ displayName: 'نام عمومی نمونه' });

      // And the publication that WOULD leave that page nameless is refused —
      // the same rule, checked where it becomes real.
      const republished = await setVisibility(manager, true);
      expect(republished.status).toBe(422);
      expect(republished.body.error.code).toBe('THERAPIST_PUBLIC_PROFILE_INCOMPLETE');
      expect((await publicTeam())[0]).toMatchObject({ displayName: 'نام عمومی نمونه' });
    });

    it('publishes nobody when the front desk drafts for an unpublished colleague', async () => {
      // The opt-in is untouched by drafting: writing a biography for somebody
      // who has not agreed to appear does not make them appear.
      await draftProfileCopy(receptionist, { title: 'عنوان', bio: 'زندگی‌نامه.' });

      expect(await publicTeam()).toEqual([]);
    });

    it('refuses a receptionist the opt-in, in both directions', async () => {
      const publishAttempt = await setVisibility(receptionist, true);

      await publishColleague();
      const withdrawAttempt = await setVisibility(receptionist, false);

      for (const response of [publishAttempt, withdrawAttempt]) {
        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('AUTH_FORBIDDEN');
      }

      // The colleague is still on the site: the refusal wrote nothing.
      expect(await publicTeam()).toHaveLength(1);
    });

    it('refuses a receptionist the manager profile surface, read included', async () => {
      // The A2 decision is unchanged. The slug, the photograph, the display
      // order and the opt-in are not editorial, and the route carrying them
      // still answers a receptionist with a refusal — including its read.
      const read = await request(server())
        .get(`/catalog/therapists/${therapistId}/public-profile`)
        .set(as(receptionist));
      const write = await writeProfile(receptionist);

      for (const response of [read, write]) {
        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('AUTH_FORBIDDEN');
      }
    });

    it('cannot reach the slug, photograph, display order or opt-in through the editorial route', async () => {
      // The display name is COPY and is draftable; these four are the
      // publication decision and its presentation, and the request schema is
      // strict, so a body carrying one is refused whole.
      await publishColleague();

      const attempt = await draftProfileCopy(receptionist, {
        publicSlug: 'stolen-slug',
        photoPath: 'team/stolen.jpg',
        isPublic: false,
        displayOrder: 99,
      });

      expect(attempt.status).toBe(400);
      expect(attempt.body.error.code).toBe('VALIDATION_FAILED');

      const profile = therapistPublicProfileResponseSchema.parse(
        (
          await request(server())
            .get(`/catalog/therapists/${therapistId}/public-profile`)
            .set(as(manager))
        ).body,
      ).profile;

      expect(profile.publicSlug).toBe('synthetic-colleague');
      expect(profile.photoPath).toBeNull();
      expect(profile.displayOrder).toBe(1);
      expect(profile.isPublic).toBe(true);
      // The refusal wrote nothing at all, the name included.
      expect(profile.displayName).toBe('نام عمومی نمونه');
    });

    it('refuses a receptionist the personnel record and the schedule behind it', async () => {
      const personnel = await request(server())
        .patch(`/catalog/therapists/${therapistId}`)
        .set(as(receptionist))
        .send({
          fullName: 'نام تازه',
          specialty: 'تخصص تازه',
          serviceIds: [],
        });
      const status = await request(server())
        .patch(`/catalog/therapists/${therapistId}/status`)
        .set(as(receptionist))
        .send({ status: 'INACTIVE' });

      for (const response of [personnel, status]) {
        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('AUTH_FORBIDDEN');
      }
    });
  });

  // --- the trail ------------------------------------------------------------

  describe('the audit trail', () => {
    it('separates drafting a service description from publishing it', async () => {
      await draftServiceCopy(receptionist, 'شرح تازه.');
      await publishServiceCopy(manager, true);
      await publishServiceCopy(manager, false);

      expect(await auditActionsFor(harness, 'service', serviceId)).toEqual([
        'service.created',
        'service.public_copy_drafted',
        'service.public_copy_published',
        'service.public_copy_published',
      ]);
    });

    it('separates drafting a colleague copy from publishing the person', async () => {
      await publishColleague();
      await draftProfileCopy(receptionist, {
        displayName: 'نام عمومی تازه',
        title: 'عنوان تازه',
        bio: 'زندگی‌نامهٔ تازه.',
      });
      await setVisibility(manager, true);

      expect(await auditActionsFor(harness, 'therapist', therapistId)).toEqual([
        'therapist.public_profile_updated',
        'therapist.public_profile_published',
        'therapist.public_profile_drafted',
        'therapist.public_profile_published',
      ]);
    });

    it('records copy as a length rather than as a copy of it', async () => {
      await draftServiceCopy(receptionist, 'یک متن نمونهٔ کاملاً یکتا برای این آزمون.');
      await draftProfileCopy(receptionist, {
        displayName: 'نام عمومی تازه',
        title: 'عنوان تازه',
        bio: 'یک زندگی‌نامهٔ کاملاً یکتا برای این آزمون.',
      });

      const rows = await harness.prisma.$queryRaw<{ after: Record<string, unknown> }[]>`
        SELECT after FROM audit_log
        WHERE action IN ('service.public_copy_drafted', 'therapist.public_profile_drafted')
        ORDER BY id ASC
      `;

      expect(rows).toHaveLength(2);
      expect(rows[0]!.after).toMatchObject({ descriptionLength: expect.any(Number) });
      expect(rows[1]!.after).toMatchObject({ bioLength: expect.any(Number) });
      expect(JSON.stringify(rows)).not.toContain('کاملاً یکتا');
    });

    it('names the actor on a receptionist draft', async () => {
      // The point of an editorial trail: a manager reviewing what appeared on
      // the website can see who prepared it, not merely that it changed.
      await draftServiceCopy(receptionist, 'شرح تازه.');

      const rows = await harness.prisma.$queryRaw<{ role: string }[]>`
        SELECT u.role::text AS role
        FROM audit_log a JOIN app_user u ON u.id = a.actor_user_id
        WHERE a.action = 'service.public_copy_drafted'
      `;

      expect(rows).toEqual([{ role: 'RECEPTIONIST' }]);
    });
  });

  // --- rollout --------------------------------------------------------------

  describe('rollout compatibility', () => {
    it('still serves the legacy photograph path a manager set', async () => {
      // The pre-media path is deliberately NOT split and is deliberately not
      // removed: the accepted public site still reads it, and the Web
      // checkpoint that finishes the A5 migration is what takes it away.
      await writeProfile(manager, { photoPath: 'team/synthetic.jpg' });
      await setVisibility(manager, true);

      expect((await publicTeam())[0]).toMatchObject({ photoPath: 'team/synthetic.jpg' });
    });

    it('publishes a service and its prepared description in one manager act', async () => {
      // A service crossing onto the website carries its description with it, so
      // a clinic publishing something new does not get a blank page while it
      // waits for a second act. The setup of this suite is that write; this
      // asserts what it produced.
      expect((await publicServices())[0]!.description).toBe('شرح نمونهٔ منتشرشده.');
    });
  });
});
