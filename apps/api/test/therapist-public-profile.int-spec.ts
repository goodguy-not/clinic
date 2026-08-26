import request from 'supertest';
import { publicTeamResponseSchema, therapistPublicProfileResponseSchema } from '@clinic/contracts';
import { uuidv7 } from '../src/common/uuid';
import { createHarness, internalHeaders, resetDatabase, type Harness } from './harness';
import { as, auditActionsFor, loginAs } from './website-support';

/**
 * A therapist's public profile, maintained through the real manager path.
 *
 * Milestone 9, checkpoint A2. A1 shipped these columns with no writer and said
 * so; this suite is the proof that the checkpoint closed that gap — a manager
 * can put a colleague on the website and take them off again with no SQL, no
 * seed change and no deployment.
 *
 * THE OPT-IN IS THE RULE UNDER TEST. An active therapist is not a public one,
 * nothing falls back to the personnel record, and preparing the content
 * publishes nobody.
 *
 * Everything is synthetic. No real colleague, photograph or biography appears.
 */
describe('therapist public profile (real PostgreSQL)', () => {
  let harness: Harness;
  let manager: string;
  let receptionist: string;
  let therapistId: string;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
    manager = await loginAs(harness, 'MANAGER');
    receptionist = await loginAs(harness, 'RECEPTIONIST');

    const actor = (
      await harness.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM app_user WHERE role = 'MANAGER'::user_role LIMIT 1
      `
    )[0]!.id;

    therapistId = uuidv7();
    await harness.prisma.$executeRaw`
      INSERT INTO therapist (id, full_name, specialty, status, created_at, created_by_user_id)
      VALUES (
        ${therapistId}::uuid, 'Synthetic Colleague', 'Synthetic Specialty',
        'ACTIVE'::catalog_status, transaction_timestamp(), ${actor}::uuid
      )
    `;
  });

  const server = () => harness.app.getHttpServer();

  const profileBody = (overrides: Record<string, unknown> = {}) => ({
    publicSlug: 'synthetic-colleague',
    displayName: 'Synthetic Display Name',
    title: 'Synthetic Public Title',
    bio: 'Synthetic biography written for a test.',
    photoPath: 'team/synthetic.jpg',
    displayOrder: 10,
    ...overrides,
  });

  const writeProfile = (session: string, overrides: Record<string, unknown> = {}) =>
    request(server())
      .patch(`/catalog/therapists/${therapistId}/public-profile`)
      .set(as(session))
      .send(profileBody(overrides));

  const setVisibility = (session: string, isPublic: boolean) =>
    request(server())
      .patch(`/catalog/therapists/${therapistId}/public-profile/visibility`)
      .set(as(session))
      .send({ isPublic });

  describe('the authority', () => {
    it('refuses a receptionist all three routes', async () => {
      // `therapist.read` is a receptionist's, to run the diary.
      // `therapist.publish_profile` is not, and A1 separated them precisely so
      // this line could be true — including for the READ, because a draft
      // biography of a colleague who has not agreed to be published is not
      // diary information.
      const read = await request(server())
        .get(`/catalog/therapists/${therapistId}/public-profile`)
        .set(as(receptionist));
      const write = await writeProfile(receptionist);
      const publish = await setVisibility(receptionist, true);

      for (const response of [read, write, publish]) {
        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('AUTH_FORBIDDEN');
      }
    });

    it('lets a manager maintain the profile and the opt-in with no SQL', async () => {
      const written = await writeProfile(manager);
      const published = await setVisibility(manager, true);

      expect(written.status).toBe(200);
      expect(therapistPublicProfileResponseSchema.parse(written.body).profile.isPublic).toBe(false);
      expect(published.status).toBe(200);
      expect(therapistPublicProfileResponseSchema.parse(published.body).profile.isPublic).toBe(
        true,
      );
    });
  });

  describe('the opt-in', () => {
    it('publishes nobody when the content is written', async () => {
      // Two acts, and this is the one that is not a publication. A manager who
      // writes a biography has not thereby put anybody on the internet.
      await writeProfile(manager);

      const team = await request(server()).get('/public/team').set(internalHeaders());

      expect(publicTeamResponseSchema.parse(team.body).therapists).toEqual([]);
    });

    it('refuses publication without an approved name and address', async () => {
      const attempt = await setVisibility(manager, true);

      expect(attempt.status).toBe(422);
      expect(attempt.body.error.code).toBe('THERAPIST_PUBLIC_PROFILE_INCOMPLETE');
    });

    it('refuses removing the approved name from somebody already published', async () => {
      // The same rule from the other side, and the same code: a published
      // colleague cannot be left public with nothing to publish them under.
      await writeProfile(manager);
      await setVisibility(manager, true);

      const cleared = await writeProfile(manager, { displayName: null });

      expect(cleared.status).toBe(422);
      expect(cleared.body.error.code).toBe('THERAPIST_PUBLIC_PROFILE_INCOMPLETE');
    });

    it('takes the colleague off the site again on request', async () => {
      await writeProfile(manager);
      await setVisibility(manager, true);
      await setVisibility(manager, false);

      const team = await request(server()).get('/public/team').set(internalHeaders());

      expect(publicTeamResponseSchema.parse(team.body).therapists).toEqual([]);
    });

    it('never substitutes the personnel record', async () => {
      await writeProfile(manager);
      await setVisibility(manager, true);

      const team = await request(server()).get('/public/team').set(internalHeaders());
      const body = JSON.stringify(team.body);

      expect(body).toContain('Synthetic Display Name');
      expect(body).not.toContain('Synthetic Colleague');
      expect(body).not.toContain('Synthetic Specialty');
    });
  });

  describe('the slug, through the real A2 write path', () => {
    it('may be corrected while the colleague is private', async () => {
      await writeProfile(manager);

      const corrected = await writeProfile(manager, { publicSlug: 'synthetic-corrected' });

      expect(corrected.status).toBe(200);
      expect(therapistPublicProfileResponseSchema.parse(corrected.body).profile.publicSlug).toBe(
        'synthetic-corrected',
      );
    });

    it('is refused a rename once the page has been reachable', async () => {
      // THE A1 INVARIANT, THROUGH THE MANAGER PATH RATHER THAN THROUGH RAW SQL.
      // A1 could only prove it against the trigger; this is the first time the
      // rule is exercised by the surface a person actually uses, and the answer
      // is a code with a Persian sentence rather than a 500.
      await writeProfile(manager);
      await setVisibility(manager, true);

      const renamed = await writeProfile(manager, { publicSlug: 'a-different-address' });

      expect(renamed.status).toBe(409);
      expect(renamed.body.error.code).toBe('PUBLIC_SLUG_IMMUTABLE');
    });

    it('refuses the unpublish-rename-republish round trip', async () => {
      await writeProfile(manager);
      await setVisibility(manager, true);
      await setVisibility(manager, false);

      const renamed = await writeProfile(manager, { publicSlug: 'round-trip' });

      expect(renamed.status).toBe(409);
      expect(renamed.body.error.code).toBe('PUBLIC_SLUG_IMMUTABLE');
    });

    it('refuses clearing a published slug', async () => {
      await writeProfile(manager);
      await setVisibility(manager, true);

      const cleared = await writeProfile(manager, { publicSlug: null });

      expect(cleared.status).toBe(409);
      expect(cleared.body.error.code).toBe('PUBLIC_SLUG_IMMUTABLE');
    });
  });

  describe('the audit trail', () => {
    it('separates preparing the content from publishing the person', async () => {
      await writeProfile(manager);
      await setVisibility(manager, true);
      await setVisibility(manager, false);

      expect(await auditActionsFor(harness, 'therapist', therapistId)).toEqual([
        'therapist.public_profile_updated',
        'therapist.public_profile_published',
        'therapist.public_profile_unpublished',
      ]);
    });

    it('records the biography as a length rather than as a copy of it', async () => {
      await writeProfile(manager);

      const rows = await harness.prisma.$queryRaw<{ after: Record<string, unknown> }[]>`
        SELECT after FROM audit_log
        WHERE entity_type = 'therapist' AND entity_id = ${therapistId}::uuid
      `;

      expect(rows[0]!.after).toMatchObject({ bioLength: expect.any(Number) });
      expect(JSON.stringify(rows[0]!.after)).not.toContain('Synthetic biography');
    });
  });
});
