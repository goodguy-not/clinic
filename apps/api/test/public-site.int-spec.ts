import request from 'supertest';
import {
  publicClinicProfileResponseSchema,
  publicServiceDetailResponseSchema,
  publicServiceListResponseSchema,
  publicTeamResponseSchema,
  publicTherapistProfileResponseSchema,
} from '@clinic/contracts';
import { uuidv7 } from '../src/common/uuid';
import {
  createHarness,
  internalHeaders,
  resetDatabase,
  seedUser,
  TEST_PASSWORD,
  type Harness,
} from './harness';

/**
 * The public website's five reads, over real HTTP against real PostgreSQL.
 *
 * THE SUITE IS WRITTEN AS AN ATTACK. Almost every test here seeds a record the
 * clinic has NOT published — private, unpublished, deactivated, half-prepared —
 * and then tries to reach it through each route in turn. A public read that
 * returns a row the clinic did not publish is the one defect this checkpoint
 * cannot ship with, so the tests that matter are the ones that expect nothing
 * back.
 *
 * Everything is synthetic. No real therapist, service, address, telephone
 * number or biography appears in any fixture.
 */
describe('public website reads (real PostgreSQL)', () => {
  let harness: Harness;
  let actorId: string;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
    const actor = await seedUser(harness, { role: 'MANAGER' });
    actorId = actor.id;

    await harness.prisma.$executeRaw`
      UPDATE clinic_public_profile
      SET display_name = NULL, tagline = NULL, about = NULL, address_line = NULL,
          city_label = NULL, phone_primary = NULL, phone_secondary = NULL, email = NULL,
          working_hours_note = NULL, map_latitude = NULL, map_longitude = NULL,
          instagram_url = NULL, telegram_url = NULL
      WHERE singleton_key = 1
    `;
  });

  const server = () => harness.app.getHttpServer();

  type ServiceOptions = {
    name?: string;
    slug?: string | null;
    isPublic?: boolean;
    status?: 'ACTIVE' | 'INACTIVE';
    description?: string | null;
    durations?: number[];
  };

  async function seedService(options: ServiceOptions = {}): Promise<string> {
    const id = uuidv7();
    const status = options.status ?? 'ACTIVE';

    await harness.prisma.$executeRaw`
      INSERT INTO service (
        id, name, public_description,
        -- Checkpoint A6 split the copy in two. These fixtures describe a row
        -- whose description has been PUBLISHED — the state the manager form
        -- leaves behind when it takes a service onto the website — so both
        -- columns carry it and the public reads, which select the second, see
        -- what they saw before the split.
        published_public_description,
        is_public, public_slug, status, deactivated_at,
        created_by_user_id
      ) VALUES (
        ${id}::uuid,
        ${options.name ?? `Synthetic Service ${id.slice(-6)}`},
        ${options.description ?? null},
        ${options.description ?? null},
        ${options.isPublic ?? true},
        ${options.slug === undefined ? `service-${id.slice(-6).toLowerCase()}` : options.slug},
        ${status}::catalog_status,
        ${status === 'INACTIVE' ? new Date() : null},
        ${actorId}::uuid
      )
    `;

    // Deduplicated: `service_duration` is unique per (service, minutes), and a
    // fixture that offered the same length twice would fail on the insert
    // rather than on the assertion it was written for.
    for (const minutes of new Set(options.durations ?? [30, 45])) {
      await harness.prisma.$executeRaw`
        INSERT INTO service_duration (id, service_id, duration_minutes)
        VALUES (${uuidv7()}::uuid, ${id}::uuid, ${minutes})
      `;
    }

    return id;
  }

  type TherapistOptions = {
    fullName?: string;
    specialty?: string;
    slug?: string | null;
    displayName?: string | null;
    title?: string | null;
    bio?: string | null;
    isPublic?: boolean;
    status?: 'ACTIVE' | 'INACTIVE';
    order?: number;
  };

  async function seedTherapist(options: TherapistOptions = {}): Promise<string> {
    const id = uuidv7();
    const status = options.status ?? 'ACTIVE';
    const isPublic = options.isPublic ?? true;

    await harness.prisma.$executeRaw`
      INSERT INTO therapist (
        id, full_name, specialty, status, deactivated_at, is_public, public_slug,
        public_display_name, public_title, public_bio,
        -- Checkpoint A6: the same copy on the published side, because these
        -- fixtures describe a profile the clinic has published. The public
        -- reads select these three and never the drafts above.
        published_public_display_name, published_public_title, published_public_bio,
        public_display_order, created_by_user_id
      ) VALUES (
        ${id}::uuid,
        ${options.fullName ?? 'Synthetic Personnel Name'},
        ${options.specialty ?? 'Synthetic Internal Specialty'},
        ${status}::catalog_status,
        ${status === 'INACTIVE' ? new Date() : null},
        ${isPublic},
        ${options.slug === undefined ? `therapist-${id.slice(-6).toLowerCase()}` : options.slug},
        ${options.displayName === undefined ? 'Synthetic Public Name' : options.displayName},
        ${options.title ?? null},
        ${options.bio ?? null},
        ${options.displayName === undefined ? 'Synthetic Public Name' : options.displayName},
        ${options.title ?? null},
        ${options.bio ?? null},
        ${options.order ?? 0},
        ${actorId}::uuid
      )
    `;

    return id;
  }

  describe('route classification', () => {
    it('refuses every public read without the internal key', async () => {
      // "Public" describes the AUDIENCE OF THE FACTS, not the reachability of
      // the route. The browser never speaks to NestJS: these five are reachable
      // only from the Next.js server, exactly like login, and `/health` remains
      // the one route that genuinely bypasses the key.
      for (const path of [
        '/public/services',
        '/public/services/a-service',
        '/public/team',
        '/public/team/a-therapist',
        '/public/clinic-profile',
      ]) {
        const response = await request(server()).get(path);

        expect(response.status).toBe(401);
        expect(response.body.error.code).toBe('AUTH_INTERNAL_KEY_INVALID');
      }
    });

    it('serves them with the key and no session at all', async () => {
      // A visitor has no session, so a session cannot be required. That is safe
      // here and only here, because these reads are incapable of returning an
      // unpublished row — which every test below attacks directly.
      await seedService({ slug: 'a-service' });

      const response = await request(server()).get('/public/services').set(internalHeaders());

      expect(response.status).toBe(200);
      expect(publicServiceListResponseSchema.parse(response.body).services).toHaveLength(1);
    });

    it('exposes no write route on the public surface', async () => {
      // Nothing an anonymous caller sends can cause this application to write.
      // The public request form is a later checkpoint and arrives with its own
      // consent, rate-limiting and inbox decisions.
      for (const path of ['/public/services', '/public/team', '/public/clinic-profile']) {
        for (const method of ['post', 'patch', 'delete'] as const) {
          const response = await request(server())[method](path).set(internalHeaders()).send({});

          expect(response.status).toBe(404);
        }
      }
    });
  });

  describe('the service list', () => {
    it('returns only services that are public, active and addressable', async () => {
      await seedService({ name: 'AAA Published', slug: 'published-service' });
      await seedService({ name: 'BBB Private', isPublic: false, slug: 'private-service' });
      await seedService({ name: 'CCC Retired', status: 'INACTIVE', slug: 'retired-service' });
      await seedService({ name: 'DDD No slug', slug: null });

      const response = await request(server()).get('/public/services').set(internalHeaders());
      const body = publicServiceListResponseSchema.parse(response.body);

      expect(body.services.map((service) => service.slug)).toEqual(['published-service']);
    });

    it('states four facts and no more, whatever the row carries', async () => {
      // `publicServiceListResponseSchema` is strict, so an internal field
      // arriving in this response fails the parse rather than reaching a page.
      await seedService({
        name: 'Synthetic Published Service',
        slug: 'published-service',
        description: 'Synthetic public description.',
      });

      const response = await request(server()).get('/public/services').set(internalHeaders());
      const [service] = publicServiceListResponseSchema.parse(response.body).services;

      // `image` is Milestone 9.5 checkpoint A9's, and `null` is its ordinary
      // state: this service has no attached photograph, which is what most
      // services will look like.
      expect(service).toEqual({
        slug: 'published-service',
        name: 'Synthetic Published Service',
        description: 'Synthetic public description.',
        image: null,
      });

      const serialised = JSON.stringify(response.body);
      for (const internal of ['"id"', '"status"', '"isPublic"', '"createdAt"', 'createdByUserId']) {
        expect(serialised).not.toContain(internal);
      }
    });

    it('orders by name, so the page does not reshuffle between requests', async () => {
      await seedService({ name: 'Beta', slug: 'beta' });
      await seedService({ name: 'Alpha', slug: 'alpha' });

      const response = await request(server()).get('/public/services').set(internalHeaders());

      expect(
        publicServiceListResponseSchema.parse(response.body).services.map((s) => s.slug),
      ).toEqual(['alpha', 'beta']);
    });
  });

  describe('the service detail', () => {
    it('returns the published service and its session lengths', async () => {
      await seedService({
        name: 'Synthetic Published Service',
        slug: 'published-service',
        description: null,
        durations: [45, 30],
      });

      const response = await request(server())
        .get('/public/services/published-service')
        .set(internalHeaders());

      expect(response.status).toBe(200);
      expect(publicServiceDetailResponseSchema.parse(response.body).service).toEqual({
        slug: 'published-service',
        name: 'Synthetic Published Service',
        description: null,
        image: null,
        sessionDurationsMinutes: [30, 45],
      });
    });

    it('answers a private, retired or unknown slug identically', async () => {
      // A separate "exists but is not public" answer would be a side channel:
      // anybody could enumerate the clinic internal catalogue by watching which
      // spellings answered differently.
      await seedService({ isPublic: false, slug: 'private-service' });
      await seedService({ status: 'INACTIVE', slug: 'retired-service' });

      for (const slug of ['private-service', 'retired-service', 'never-existed']) {
        const response = await request(server())
          .get(`/public/services/${slug}`)
          .set(internalHeaders());

        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe('SERVICE_NOT_FOUND');
      }
    });

    it('refuses a malformed slug before it reaches a query', async () => {
      const response = await request(server())
        .get('/public/services/Not_A_Slug')
        .set(internalHeaders());

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('the team', () => {
    it('returns only therapists who opted in, and are still here', async () => {
      await seedTherapist({ slug: 'published-therapist', order: 1 });
      await seedTherapist({ slug: 'private-therapist', isPublic: false, order: 2 });
      await seedTherapist({ slug: 'departed-therapist', status: 'INACTIVE', order: 3 });
      await seedTherapist({ slug: null, displayName: null, isPublic: false, order: 4 });

      const response = await request(server()).get('/public/team').set(internalHeaders());
      const body = publicTeamResponseSchema.parse(response.body);

      expect(body.therapists.map((therapist) => therapist.slug)).toEqual(['published-therapist']);
    });

    it('never substitutes the personnel record for approved public content', async () => {
      // The rule this asserts: absence of approved content means NOT PUBLISHED,
      // never "publish the internal value instead".
      await seedTherapist({
        fullName: 'Internal Personnel Name',
        specialty: 'Internal Specialty',
        slug: 'published-therapist',
        displayName: 'Approved Public Name',
        title: null,
        bio: null,
      });

      const response = await request(server()).get('/public/team').set(internalHeaders());
      const [therapist] = publicTeamResponseSchema.parse(response.body).therapists;

      expect(therapist).toEqual({
        slug: 'published-therapist',
        displayName: 'Approved Public Name',
        title: null,
        bio: null,
        // Milestone 9.5: no uploaded portrait, and null rather than absent. A
        // therapist with no published photograph is a therapist the media
        // subsystem has nothing to say about.
        photo: null,
      });

      const serialised = JSON.stringify(response.body);
      expect(serialised).not.toContain('Internal Personnel Name');
      expect(serialised).not.toContain('Internal Specialty');
      expect(serialised).not.toContain('"specialty"');
      expect(serialised).not.toContain('"fullName"');
      expect(serialised).not.toContain('"isPublic"');
    });

    it('orders by the clinic own ordering, then by display name', async () => {
      await seedTherapist({ slug: 'third', displayName: 'C', order: 2 });
      await seedTherapist({ slug: 'first', displayName: 'A', order: 1 });
      await seedTherapist({ slug: 'second', displayName: 'B', order: 1 });

      const response = await request(server()).get('/public/team').set(internalHeaders());

      expect(publicTeamResponseSchema.parse(response.body).therapists.map((t) => t.slug)).toEqual([
        'first',
        'second',
        'third',
      ]);
    });

    it('returns one published profile, and hides every other kind', async () => {
      await seedTherapist({
        slug: 'published-therapist',
        title: 'Approved Public Title',
        bio: 'Approved synthetic biography.',
      });
      await seedTherapist({ slug: 'private-therapist', isPublic: false });
      await seedTherapist({ slug: 'departed-therapist', status: 'INACTIVE' });

      const found = await request(server())
        .get('/public/team/published-therapist')
        .set(internalHeaders());

      expect(publicTherapistProfileResponseSchema.parse(found.body).therapist).toEqual({
        slug: 'published-therapist',
        displayName: 'Synthetic Public Name',
        title: 'Approved Public Title',
        bio: 'Approved synthetic biography.',
        photo: null,
      });

      for (const slug of ['private-therapist', 'departed-therapist', 'never-existed']) {
        const response = await request(server()).get(`/public/team/${slug}`).set(internalHeaders());

        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe('THERAPIST_NOT_FOUND');
      }
    });
  });

  describe('the clinic profile', () => {
    it('reads as nulls before the owner has supplied anything', async () => {
      const response = await request(server()).get('/public/clinic-profile').set(internalHeaders());

      expect(response.status).toBe(200);
      const { clinic } = publicClinicProfileResponseSchema.parse(response.body);

      expect(Object.values(clinic).every((value) => value === null)).toBe(true);
    });

    it('returns exactly what the owner supplied, and nothing else', async () => {
      await harness.prisma.$executeRaw`
        UPDATE clinic_public_profile
        SET display_name = 'Synthetic Clinic',
            tagline = 'Synthetic tagline',
            phone_primary = '021-00000000',
            email = 'info@example.invalid',
            map_latitude = 35.7,
            map_longitude = 51.4,
            instagram_url = 'https://example.invalid/instagram'
        WHERE singleton_key = 1
      `;

      const response = await request(server()).get('/public/clinic-profile').set(internalHeaders());
      const { clinic } = publicClinicProfileResponseSchema.parse(response.body);

      expect(clinic).toEqual({
        displayName: 'Synthetic Clinic',
        tagline: 'Synthetic tagline',
        about: null,
        addressLine: null,
        cityLabel: null,
        phonePrimary: '021-00000000',
        phoneSecondary: null,
        email: 'info@example.invalid',
        workingHoursNote: null,
        mapLatitude: 35.7,
        mapLongitude: 51.4,
        instagramUrl: 'https://example.invalid/instagram',
        telegramUrl: null,
      });
    });
  });

  describe('the internal surface is unchanged', () => {
    it('still refuses a receptionist every catalog write, and grants no website authority', async () => {
      // The role map moved by three names this checkpoint, all of them the
      // manager's. This is the negative half, asserted over the wire rather than
      // in the unit test alone.
      const receptionist = await loginAs(harness, 'RECEPTIONIST');

      const session = await request(server())
        .get('/auth/session')
        .set(internalHeaders({ 'x-session-id': receptionist }));

      for (const forbidden of [
        'therapist.publish_profile',
        'clinic_profile.read',
        'clinic_profile.update',
      ]) {
        expect(session.body.user.permissions).not.toContain(forbidden);
      }
    });

    it('leaves the manager holding all three', async () => {
      const manager = await loginAs(harness, 'MANAGER');

      const session = await request(server())
        .get('/auth/session')
        .set(internalHeaders({ 'x-session-id': manager }));

      for (const granted of [
        'therapist.publish_profile',
        'clinic_profile.read',
        'clinic_profile.update',
      ]) {
        expect(session.body.user.permissions).toContain(granted);
      }
    });

    it('keeps a therapist public profile out of the personnel read, and puts a service slug on the service', async () => {
      // THE TWO ENTITIES ARE PUBLISHED DIFFERENTLY ON PURPOSE, and checkpoint
      // A2 is where that difference becomes visible in the internal contracts.
      //
      // A SERVICE'S public description, address and visibility are columns on
      // the catalog row, written by the same manager form under the same
      // `service.update` (DECISION_LOG, 2026-08-21), so `publicSlug` belongs on
      // the service read that form already uses.
      //
      // A THERAPIST'S public profile is a decision about a named human being
      // under a permission A1 separated for exactly that reason, so it stays
      // OFF the personnel read a receptionist holds `therapist.read` for. If it
      // were here, separating the authority would have bought nothing.
      const manager = await loginAs(harness, 'MANAGER');
      await seedService({ slug: 'published-service' });
      await seedTherapist({ slug: 'published-therapist' });

      const services = await request(server())
        .get('/catalog/services')
        .set(internalHeaders({ 'x-session-id': manager }));
      const therapists = await request(server())
        .get('/catalog/therapists')
        .set(internalHeaders({ 'x-session-id': manager }));

      expect(services.status).toBe(200);
      expect(therapists.status).toBe(200);
      expect(services.body.services[0].publicSlug).toBe('published-service');
      expect(JSON.stringify(therapists.body)).not.toContain('publicSlug');
      expect(JSON.stringify(therapists.body)).not.toContain('publicDisplayName');
      expect(JSON.stringify(therapists.body)).not.toContain('publicBio');
      expect(JSON.stringify(therapists.body)).not.toContain('isPublic');
    });
  });
});

/** Signs a synthetic user in and returns the session token. */
async function loginAs(harness: Harness, role: 'MANAGER' | 'RECEPTIONIST'): Promise<string> {
  const user = await seedUser(harness, { role });
  const response = await request(harness.app.getHttpServer())
    .post('/auth/login')
    .set(internalHeaders())
    .send({ username: user.username, password: TEST_PASSWORD });

  return response.body.sessionToken as string;
}
