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
        'therapist.read',
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
      expect(routes).toBe(82);
    });
  });
});
