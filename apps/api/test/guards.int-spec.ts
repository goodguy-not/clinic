import request from 'supertest';
import { MetadataScanner, ModulesContainer } from '@nestjs/core';
import { PATH_METADATA } from '@nestjs/common/constants';
import { loginResponseSchema, sessionResponseSchema } from '@clinic/contracts';
import { ENDPOINT_ACCESS_KEY } from '../src/auth/decorators/endpoint-access';
import {
  createHarness,
  internalHeaders,
  resetDatabase,
  seedUser,
  TEST_INTERNAL_KEY,
  TEST_PASSWORD,
  type Harness,
} from './harness';

describe('guard chain (real PostgreSQL)', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
  });

  const server = () => harness.app.getHttpServer();

  async function signIn(role: 'MANAGER' | 'RECEPTIONIST'): Promise<string> {
    const user = await seedUser(harness, { role });
    const response = await request(server())
      .post('/auth/login')
      .set(internalHeaders())
      .send({ username: user.username, password: TEST_PASSWORD });

    return loginResponseSchema.parse(response.body).sessionToken;
  }

  describe('internal key', () => {
    it('exempts only /health', async () => {
      const response = await request(server()).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.service).toBe('api');
    });

    it('requires the key on /health/db', async () => {
      const without = await request(server()).get('/health/db');
      expect(without.status).toBe(401);
      expect(without.body.error.code).toBe('AUTH_INTERNAL_KEY_INVALID');

      const withKey = await request(server()).get('/health/db').set(internalHeaders());
      expect(withKey.status).toBe(200);
    });

    it('rejects a wrong key of the same length and of a different length', async () => {
      const sameLength = await request(server())
        .get('/health/db')
        .set({ 'x-internal-key': 'x'.repeat(TEST_INTERNAL_KEY.length) });
      expect(sameLength.status).toBe(401);

      const differentLength = await request(server())
        .get('/health/db')
        .set({ 'x-internal-key': 'short' });
      expect(differentLength.status).toBe(401);
    });

    it('requires the key on login', async () => {
      const response = await request(server())
        .post('/auth/login')
        .send({ username: 'someone', password: TEST_PASSWORD });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('AUTH_INTERNAL_KEY_INVALID');
    });
  });

  describe('client-supplied identity is ignored', () => {
    it('ignores x-user-id, x-user-role, x-permissions and authorization', async () => {
      const token = await signIn('RECEPTIONIST');
      const manager = await seedUser(harness, { username: 'realmanager', role: 'MANAGER' });

      const response = await request(server())
        .get('/auth/session')
        .set(
          internalHeaders({
            'x-session-id': token,
            'x-user-id': manager.id,
            'x-user-role': 'MANAGER',
            'x-permissions': 'user.create,user.read,session.revoke_any',
            authorization: 'Bearer forged',
          }),
        );

      const body = sessionResponseSchema.parse(response.body);

      // Identity came from the opaque token alone. Every claim in the headers
      // was discarded — including the forged permission list, which named three
      // permissions a receptionist genuinely does not hold.
      expect(body.user.role).toBe('RECEPTIONIST');
      expect(body.user.id).not.toBe(manager.id);
      expect(body.user.permissions).not.toContain('user.create');
      expect(body.user.permissions).not.toContain('user.read');
      expect(body.user.permissions).not.toContain('session.revoke_any');
    });

    it('cannot authenticate with identity headers and no session token', async () => {
      const manager = await seedUser(harness, { role: 'MANAGER' });

      const response = await request(server())
        .get('/auth/session')
        .set(internalHeaders({ 'x-user-id': manager.id, 'x-user-role': 'MANAGER' }));

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('AUTH_SESSION_INVALID');
    });
  });

  describe('permission model', () => {
    it('gives a receptionist the family, child and booking workflow, and a manager the full set', async () => {
      const receptionist = await signIn('RECEPTIONIST');
      const manager = await signIn('MANAGER');

      const asReceptionist = sessionResponseSchema.parse(
        (
          await request(server())
            .get('/auth/session')
            .set(internalHeaders({ 'x-session-id': receptionist }))
        ).body,
      );
      const asManager = sessionResponseSchema.parse(
        (
          await request(server())
            .get('/auth/session')
            .set(internalHeaders({ 'x-session-id': manager }))
        ).body,
      );

      // Milestone 3 gave the receptionist their first permissions, Milestone 4
      // added the operational set — four catalog reads, availability read, and
      // the diary: book, move, cancel, complete, and override availability with a
      // recorded reason — and Milestone 5 added reading a family account and
      // raising the charge for a session that happened, which is the ordinary end
      // of that diary work. `charge.void` and `charge.adjust` are deliberately
      // absent (DECISION_LOG, 2026-08-14 — Charge adjustment and void authority
      // is manager-only) and are asserted absent below. The list is exact, so a
      // permission leaking into that role fails here rather than in review.
      expect([...asReceptionist.user.permissions].sort()).toEqual([
        'appointment.cancel',
        'appointment.complete',
        'appointment.create',
        'appointment.override_availability',
        'appointment.read',
        'appointment.update',
        // Milestone 9, checkpoint A2: drafting public content and reading the
        // drafts. `article.publish` and `testimonial.approve` are the manager's
        // alone and are asserted absent below.
        'article.draft',
        'article.read',
        'availability.read',
        'charge.post',
        'charge.read',
        'child.create',
        'child.read',
        'child.update',
        'child.update_status',
        'family.create',
        'family.read',
        'family.update',
        'family.update_status',
        // Milestone 9.5, checkpoint A5: the media library, minus the name that
        // makes a photograph visible. `media.publish` — publish, unpublish,
        // archive, restore — is the manager's alone and is asserted absent
        // below.
        'media.attach',
        'media.read',
        'media.upload',
        // Milestone 6: recording money and the whole promise workflow.
        // `payment.void` stays with the manager.
        'payment.create',
        'payment.read',
        'promise.create',
        'promise.read',
        'promise.resolve',
        'room.read',
        'service.read',
        'tariff.read',
        'testimonial.draft',
        'testimonial.read',
        'therapist.read',
        // Milestone 9, checkpoint A4: answering the clinic's contact form.
        // Reading the inbox and moving a request along the accepted lifecycle,
        // including linking one to a family this role can already register.
        'website_request.process',
        'website_request.read',
      ]);

      // Still no user administration, no session administration, no catalog
      // WRITE of any kind, no authority over the schedule itself, and nothing
      // that reverses a recorded session.
      for (const forbidden of [
        'user.read',
        'user.create',
        'session.revoke_any',
        'tariff.create',
        'tariff.void',
        'service.create',
        'room.update',
        'therapist.update_status',
        'availability.manage',
        'appointment.reopen',
        // The money side of the same boundary: raising a charge is theirs,
        // withdrawing one and reducing one are the manager's.
        'charge.void',
        'charge.adjust',
        // Milestone 9: the content side of the same boundary. Writing the words
        // is theirs; deciding that the world sees them is not.
        'article.publish',
        'testimonial.approve',
        'therapist.publish_profile',
        'clinic_profile.read',
        'clinic_profile.update',
      ]) {
        expect(asReceptionist.user.permissions).not.toContain(forbidden);
      }

      expect(asManager.user.permissions).toEqual(
        expect.arrayContaining(['user.read', 'user.create', 'session.revoke_any', 'family.read']),
      );
    });
  });

  describe('response headers', () => {
    it('sets no-store everywhere except public liveness', async () => {
      const liveness = await request(server()).get('/health');
      expect(liveness.headers['cache-control']).toBeUndefined();

      const db = await request(server()).get('/health/db').set(internalHeaders());
      expect(db.headers['cache-control']).toBe('no-store');
      expect(db.headers['referrer-policy']).toBe('no-referrer');
    });

    it('echoes a valid request id and replaces a malformed one', async () => {
      const valid = '3f1b0f4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';

      const echoed = await request(server()).get('/health').set({ 'x-request-id': valid });
      expect(echoed.headers['x-request-id']).toBe(valid);

      const replaced = await request(server()).get('/health').set({ 'x-request-id': 'not-a-uuid' });
      expect(replaced.headers['x-request-id']).not.toBe('not-a-uuid');
      expect(replaced.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('includes the request id in every error envelope', async () => {
      const response = await request(server()).get('/health/db');

      expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
    });
  });

  describe('endpoint metadata coverage', () => {
    it('classifies every registered controller route', () => {
      const modules = harness.app.get(ModulesContainer);
      const scanner = new MetadataScanner();
      const unclassified: string[] = [];

      for (const module of modules.values()) {
        for (const wrapper of module.controllers.values()) {
          const instance = wrapper.instance as object | undefined;
          if (instance == null) continue;

          const prototype = Object.getPrototypeOf(instance) as object;

          for (const methodName of scanner.getAllMethodNames(prototype)) {
            const handler = (prototype as Record<string, unknown>)[methodName];
            if (typeof handler !== 'function') continue;

            // Only actual routes carry a path; helpers on the controller do not.
            const isRoute = Reflect.hasMetadata(PATH_METADATA, handler);
            if (!isRoute) continue;

            const access =
              Reflect.getMetadata(ENDPOINT_ACCESS_KEY, handler) ??
              Reflect.getMetadata(ENDPOINT_ACCESS_KEY, instance.constructor);

            if (access === undefined) {
              unclassified.push(`${instance.constructor.name}.${methodName}`);
            }
          }
        }
      }

      // Deny-by-default is enforced at runtime by the first guard; this test is
      // what turns "a route was never classified" from a 403 someone discovers
      // in production into a failing build.
      expect(unclassified).toEqual([]);
    });

    it('finds the routes it is meant to be checking', () => {
      // Guards the test above against silently passing because it enumerated
      // nothing at all.
      const modules = harness.app.get(ModulesContainer);
      const scanner = new MetadataScanner();
      let routes = 0;

      for (const module of modules.values()) {
        for (const wrapper of module.controllers.values()) {
          const instance = wrapper.instance as object | undefined;
          if (instance == null) continue;
          const prototype = Object.getPrototypeOf(instance) as object;

          for (const methodName of scanner.getAllMethodNames(prototype)) {
            const handler = (prototype as Record<string, unknown>)[methodName];
            if (typeof handler === 'function' && Reflect.hasMetadata(PATH_METADATA, handler)) {
              routes += 1;
            }
          }
        }
      }

      // health:   /health, /health/db
      // auth:     login, logout, session, password
      // users:    list, create, role, status, password-reset, unlock, sessions/revoke
      // services:   list, read, create, update, status
      // rooms:      list, read, create, update, status
      // therapists: list, read, create, update, status
      // tariffs:    list, resolution, read, create, void
      // families:   search, read, create, confirm-registration, update,
      //             confirm-update, status
      // children:   create, confirm-registration, confirm-update, read,
      //             update, status
      // drafts:     current, discard
      // availability: windows list, windows replace, exceptions list,
      //               exception add, exception remove, resolution
      // appointments: create, read, view, move, cancel, complete, reopen,
      //               attendance
      // appointment day: read
      // appointment series: preview, create, read, cancel-from (POST),
      //                     update-from (PATCH)
      // session charges: post for a participant (the explicit, idempotent
      //                  re-post), read a participant's charge, void a charge
      //                  (manager-only)
      // charge adjustments: grant a concession, void one (both manager-only)
      // family account:  read one family's ledger
      // payments:        record money a family paid (`payment.create`, held by
      //                  the manager and the receptionist), read one family's
      //                  payment history (`payment.read`, held by both), void a
      //                  payment (`payment.void`, manager-only)
      // promises:        record a promise and read one family's promise history
      //                  (`promise.create` / `promise.read`, both held by the
      //                  manager and the receptionist), and the three ways one
      //                  ends — fulfil, reschedule, cancel — under the single
      //                  `promise.resolve`, held by both because none of them
      //                  moves a rial
      // dashboard:       the clinic day at a glance — one route, whose response
      //                  SHAPE depends on `report.read_financial` rather than
      //                  whose access does (Milestone 7, checkpoint C2)
      // reports:         the three OPERATIONAL reads (Milestone 7, checkpoint
      //                  C3) — sessions and therapist activity under
      //                  `appointment.read`, promises under `promise.read`. No
      //                  new `report.*` permission: each carries no money at
      //                  all, which is why both roles read them under the
      //                  authorities they already hold
      // reports:         the two FINANCIAL reads (Milestone 7, checkpoint C4) —
      //                  payments under `payment.read` + `report.read_financial`,
      //                  family accounts under `charge.read` + `payment.read` +
      //                  `promise.read` + `report.read_financial`. Both are
      //                  manager-only, and the refusal is this guard's rather
      //                  than a thinner response
      // reports:         the five CSV EXPORTS (Milestone 7, checkpoint C5) — one
      //                  per report, each naming its report's own read
      //                  authorities PLUS `report.export`. All five are
      //                  manager-only, including the three operational reports a
      //                  receptionist may read on the screen: carrying data out
      //                  of the building is a separate authority, and the refusal
      //                  is this guard's
      // share rules:     the five therapist share-rule routes (Milestone 8,
      //                  checkpoint C2) — list, resolve, get, create and void,
      //                  under `therapist_share.read` / `.create` / `.void`. All
      //                  five are MANAGER-ONLY INCLUDING THE READS, which is
      //                  where they differ from the tariff's: a receptionist
      //                  looks up what a session costs a family, and what a
      //                  therapist takes home is not diary work
      // ratings:         the four applied-share routes (Milestone 8, checkpoint
      //                  C3) — rate an unrated session, read what one earns,
      //                  withdraw a rating, and the atomic correction, under
      //                  `settlement.rate` / `.read` / `.void_rating` and, for
      //                  the correction, BOTH `.void_rating` AND `.rate`.
      //                  Manager-only in every direction including the read, for
      //                  the reason the share rules are
      //
      // CHECKPOINT C4 ADDS NO ROUTE, deliberately. The therapist/clinic
      // allocation of a concession is a field on the EXISTING manager-only
      // charge-adjustment request, under the existing `charge.adjust`
      // authority — a new permission would have implied that bearing part of a
      // discount is a different kind of financial act from granting one, and it
      // is the same act with an extra stated fact.
      //
      // statement:       the ONE settlement statement read (Milestone 8,
      //                  checkpoint C5) — one therapist, one explicit range,
      //                  under `settlement.read` alone. Manager-only, and the
      //                  refusal is WHOLE: there is deliberately no thinner
      //                  receptionist variant with the money removed, because
      //                  the response is financial in its entirety. No
      //                  therapist-facing route, ever.
      //
      // periods:         the THREE closed-period routes — close one therapist's
      //                  explicit inclusive range under `settlement.close`
      //                  (Milestone 8, checkpoint C6), list the closed periods
      //                  under `settlement.read` (C6), and read the materialised
      //                  lines of ONE period under `settlement.read` (the C7
      //                  support read). ONE WRITE AND NEVER MORE: there is no
      //                  update, delete or reopen route, because a closed period
      //                  is immutable and is never reopened, and a route naming
      //                  an act the product refuses to have reads as an act it
      //                  has. The third route is a READ and changes nothing
      //                  about that — it selects the stored lines and re-derives
      //                  no figure. Closing is its own authority because it is
      //                  IRREVERSIBLE in a way rating and withdrawing are not.
      //                  The receptionist is refused whole on all three.
      //
      // export:          the ONE settlement CSV export (Milestone 8, checkpoint
      //                  C8) — `/settlement/statement/export`, the statement's
      //                  own path plus the Milestone 7 `/export` suffix, under
      //                  `settlement.read` AND `report.export`. The sixth
      //                  exportable surface in the product and the first outside
      //                  `ReportsModule`: the read model it projects is this
      //                  module's, so the file sits beside its screen. It is one
      //                  route and not two — there is no per-period export and
      //                  no bulk "every therapist" file, either of which would be
      //                  a report nobody has approved.
      //
      // public site:     the FIVE public reads (Milestone 9, checkpoint A1) —
      //                  the published services, one published service, the
      //                  opted-in team, one opted-in profile, and the clinic's
      //                  own public facts. Every one is classified `internal`:
      //                  the internal key WITHOUT a session, exactly like login,
      //                  because a visitor has none and the browser still never
      //                  speaks to NestJS. FIVE READS AND NO WRITE — the public
      //                  request form is a later checkpoint, so nothing an
      //                  anonymous caller sends can make this application write.
      //
      // public content:  checkpoint A2 adds FOUR more `internal` public reads —
      //                  the published articles, one published article, the
      //                  approved testimonials, and the sitemap's URL facts —
      //                  bringing the public surface to nine reads and still no
      //                  write.
      //
      // public request:  checkpoint A3 adds THE ONE ANONYMOUS WRITE IN THE
      //                  PRODUCT — `POST /public/requests`, the contact form —
      //                  and it is classified `internal` like every read beside
      //                  it. That is the A1 question re-opened deliberately and
      //                  answered the same way: accepting a write from a stranger
      //                  does not put NestJS on the internet, the browser still
      //                  speaks only to Next.js, and `/health` remains the one
      //                  route in the product that bypasses the key. It holds no
      //                  permission, because the caller by definition has no
      //                  account, and there is NO PUBLIC READ OF WHAT IT WRITES:
      //                  the inbox is checkpoint A4 and is staff-only.
      //
      // request inbox:   checkpoint A4 adds FOUR routes, and every one of them
      //                  names a permission: the inbox page and one request
      //                  under `website_request.read`, the status change under
      //                  `website_request.process`, and the family link under
      //                  BOTH that and `family.read`. NONE of them is
      //                  `internal`, none is on a `/public` path, and the
      //                  promise the A3 note above made is kept — what a
      //                  stranger writes is readable only by somebody signed
      //                  in. The ninety-day erasure is deliberately not among
      //                  them: it is an operator command, and no HTTP route in
      //                  this product destroys anything.
      //
      // content admin:   SIXTEEN manager-and-author routes, and every one of
      //                  them names a permission. Five for articles (list, get,
      //                  create, edit, publish), six for testimonials (list,
      //                  get, create, edit, approve, publish), three for a
      //                  therapist public profile (read, content, opt-in) and
      //                  two for the clinic's own profile (read, replace).
      //
      //                  The split inside them is the point: `article.read` and
      //                  `article.draft` are a receptionist's, `article.publish`
      //                  and `testimonial.approve` are a manager's alone, and
      //                  the therapist and clinic routes carry the three names
      //                  A1 froze. Nothing here is `internal` and nothing here
      //                  is reachable without a session.
      //
      // media:           Milestone 9.5 checkpoint A5 adds EIGHT routes. SEVEN
      //                  are staff routes on `MediaController`, each naming one
      //                  of three permissions — `media.read` for the library and
      //                  one asset, `media.upload` for the upload, `media.attach`
      //                  for attaching and detaching, and `media.publish`, the
      //                  manager's alone, for publishing an attachment and for
      //                  archiving an asset.
      //
      //                  THE EIGHTH IS THE ONLY ROUTE IN THIS PRODUCT THAT
      //                  RETURNS SOMETHING OTHER THAN JSON, and it is declared
      //                  on `PublicSiteController` rather than in the media
      //                  module: `GET /public/media/:renditionId`, classified
      //                  `internal` like every public read beside it, bringing
      //                  the public surface to TEN reads and one write. It is
      //                  filed there deliberately, so the file answering "what
      //                  can the world see?" goes on answering it completely.
      expect(routes).toBe(145);
    });
  });
});
