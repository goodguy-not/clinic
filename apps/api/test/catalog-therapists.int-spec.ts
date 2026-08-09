import request from 'supertest';
import {
  loginResponseSchema,
  serviceResponseSchema,
  therapistListResponseSchema,
  therapistResponseSchema,
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
 * Therapists over real HTTP against real PostgreSQL.
 *
 * Everything is synthetic. No real therapist name or specialty appears in any
 * fixture — these are records about real people, and the rule against real
 * clinic data in tests matters most here.
 */
describe('catalog therapists (real PostgreSQL)', () => {
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
  const asUser = (token: string) => internalHeaders({ 'x-session-id': token });

  async function signIn(role: 'MANAGER' | 'RECEPTIONIST') {
    const user = await seedUser(harness, { role });
    const response = await request(server())
      .post('/auth/login')
      .set(internalHeaders())
      .send({ username: user.username, password: TEST_PASSWORD });

    return { user, token: loginResponseSchema.parse(response.body).sessionToken };
  }

  async function createServiceFixture(token: string, name: string): Promise<string> {
    const response = await request(server())
      .post('/catalog/services')
      .set(asUser(token))
      .send({ name, publicDescription: null, isPublic: false, allowedDurationsMinutes: [45] });

    return serviceResponseSchema.parse(response.body).service.id;
  }

  function createTherapist(
    token: string,
    overrides: Record<string, unknown> = {},
  ): Promise<request.Response> {
    return request(server())
      .post('/catalog/therapists')
      .set(asUser(token))
      .send({
        fullName: 'Synthetic Therapist',
        specialty: 'Synthetic Specialty',
        supportedServiceIds: [],
        ...overrides,
      });
  }

  describe('authorization', () => {
    const routes: Array<[string, 'get' | 'post' | 'patch', string, object | undefined]> = [
      // Reading is no longer refused: from the Milestone 4 booking checkpoint a
      // receptionist holds `therapist.read`, because somebody entering an
      // appointment has to choose a therapist. Every WRITE stays with the
      // manager, which is what this table now states.
      [
        'create',
        'post',
        '/catalog/therapists',
        { fullName: 'X', specialty: 'Y', supportedServiceIds: [] },
      ],
      [
        'update',
        'patch',
        '/catalog/therapists/:id',
        { fullName: 'X', specialty: 'Y', supportedServiceIds: [] },
      ],
      ['status', 'patch', '/catalog/therapists/:id/status', { status: 'INACTIVE' }],
    ];

    it('lets a receptionist read, which booking requires', async () => {
      const manager = await signIn('MANAGER');
      const created = await createTherapist(manager.token);
      const id = therapistResponseSchema.parse(created.body).therapist.id;

      const { token } = await signIn('RECEPTIONIST');

      expect((await request(server()).get('/catalog/therapists').set(asUser(token))).status).toBe(
        200,
      );
      expect(
        (await request(server()).get(`/catalog/therapists/${id}`).set(asUser(token))).status,
      ).toBe(200);
    });

    it.each(routes)('refuses a receptionist on %s', async (_label, method, path, body) => {
      const manager = await signIn('MANAGER');
      const created = await createTherapist(manager.token);
      const id = therapistResponseSchema.parse(created.body).therapist.id;

      const { token } = await signIn('RECEPTIONIST');

      const response = await request(server())
        [method](path.replace(':id', id))
        .set(asUser(token))
        .send(body ?? {});

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('allows a manager on every route', async () => {
      const { token } = await signIn('MANAGER');

      const created = await createTherapist(token);
      expect(created.status).toBe(201);
      const id = therapistResponseSchema.parse(created.body).therapist.id;

      expect((await request(server()).get('/catalog/therapists').set(asUser(token))).status).toBe(
        200,
      );
      expect(
        (await request(server()).get(`/catalog/therapists/${id}`).set(asUser(token))).status,
      ).toBe(200);
    });
  });

  describe('there is no delete route', () => {
    it.each(['/catalog/therapists', '/catalog/therapists/:id'])(
      'refuses DELETE %s',
      async (path) => {
        const { token } = await signIn('MANAGER');
        const created = await createTherapist(token);
        const id = therapistResponseSchema.parse(created.body).therapist.id;

        const response = await request(server()).delete(path.replace(':id', id)).set(asUser(token));

        // 404 because no such route is registered — not 403, which would mean one
        // exists and was refused.
        expect(response.status).toBe(404);
        expect(await harness.prisma.therapist.count()).toBe(1);
      },
    );
  });

  describe('creation and canonical text', () => {
    it('creates a therapist and records who created it', async () => {
      const { user, token } = await signIn('MANAGER');

      const response = await createTherapist(token);

      expect(response.status).toBe(201);
      const { therapist } = therapistResponseSchema.parse(response.body);

      expect(therapist.fullName).toBe('Synthetic Therapist');
      expect(therapist.specialty).toBe('Synthetic Specialty');
      expect(therapist.status).toBe('ACTIVE');
      expect(therapist.deactivatedAt).toBeNull();
      expect(therapist.supportedServiceIds).toEqual([]);

      const row = await harness.prisma.therapist.findUniqueOrThrow({
        where: { id: therapist.id },
      });
      expect(row.createdByUserId).toBe(user.id);
    });

    it('persists a padded full name and specialty in trimmed form', async () => {
      const { token } = await signIn('MANAGER');

      const response = await createTherapist(token, {
        fullName: '   Padded Name   ',
        specialty: '  Padded Specialty  ',
      });

      expect(response.status).toBe(201);
      const { therapist } = therapistResponseSchema.parse(response.body);
      expect(therapist.fullName).toBe('Padded Name');
      expect(therapist.specialty).toBe('Padded Specialty');

      const row = await harness.prisma.therapist.findUniqueOrThrow({
        where: { id: therapist.id },
      });
      expect(row.fullName).toBe('Padded Name');
      expect(row.specialty).toBe('Padded Specialty');
    });

    it('preserves internal spacing rather than collapsing it', async () => {
      const { token } = await signIn('MANAGER');

      const response = await createTherapist(token, { fullName: 'Two  Spaces Inside' });

      expect(therapistResponseSchema.parse(response.body).therapist.fullName).toBe(
        'Two  Spaces Inside',
      );
    });

    it.each([
      ['fullName', ''],
      ['fullName', '   '],
      ['specialty', ''],
      ['specialty', '\t\n'],
    ])('rejects a whitespace-only %s (%j)', async (field, value) => {
      const { token } = await signIn('MANAGER');

      const response = await createTherapist(token, { [field]: value });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(await harness.prisma.therapist.count()).toBe(0);
    });

    it.each(['fullName', 'specialty'])('enforces the maximum length of %s', async (field) => {
      const { token } = await signIn('MANAGER');

      expect((await createTherapist(token, { [field]: 'x'.repeat(120) })).status).toBe(201);

      const tooLong = await createTherapist(token, { [field]: 'y'.repeat(121) });
      expect(tooLong.status).toBe(400);
      expect(tooLong.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('allows two therapists with the same name and specialty', async () => {
      const { token } = await signIn('MANAGER');

      // Different real people may share both. Refusing the second would refuse
      // a real person, and there is no approved duplicate-warning workflow for
      // therapists in this milestone.
      expect((await createTherapist(token)).status).toBe(201);
      expect((await createTherapist(token)).status).toBe(201);

      expect(await harness.prisma.therapist.count()).toBe(2);
    });

    it('rejects an unexpected field rather than ignoring it', async () => {
      const { token } = await signIn('MANAGER');

      // The approved field list is closed: no phone, email, national id,
      // biography, login or settlement percentage reaches this table.
      for (const extra of [
        { phone: '0000' },
        { email: 'a@b.c' },
        { username: 'someone' },
        { password: 'x'.repeat(20) },
        { sharePercentage: 60 },
      ]) {
        const response = await createTherapist(token, extra);
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      }
    });
  });

  describe('supported services', () => {
    it('accepts a therapist with no supported services', async () => {
      const { token } = await signIn('MANAGER');

      const response = await createTherapist(token, { supportedServiceIds: [] });

      expect(response.status).toBe(201);
      const { therapist } = therapistResponseSchema.parse(response.body);
      expect(therapist.supportedServiceIds).toEqual([]);
      expect(
        await harness.prisma.therapistService.count({ where: { therapistId: therapist.id } }),
      ).toBe(0);
    });

    it('persists several supported services', async () => {
      const { token } = await signIn('MANAGER');
      const first = await createServiceFixture(token, 'Service A');
      const second = await createServiceFixture(token, 'Service B');

      const response = await createTherapist(token, { supportedServiceIds: [second, first] });

      expect(response.status).toBe(201);
      const { therapist } = therapistResponseSchema.parse(response.body);

      // Ordered by service name, so the reading is deterministic regardless of
      // the order they were submitted in.
      expect(therapist.supportedServiceIds).toEqual([first, second]);
      expect(
        await harness.prisma.therapistService.count({ where: { therapistId: therapist.id } }),
      ).toBe(2);
    });

    it('deduplicates a repeated service id', async () => {
      const { token } = await signIn('MANAGER');
      const service = await createServiceFixture(token, 'Service A');

      const response = await createTherapist(token, {
        supportedServiceIds: [service, service, service],
      });

      expect(response.status).toBe(201);
      expect(therapistResponseSchema.parse(response.body).therapist.supportedServiceIds).toEqual([
        service,
      ]);
    });

    it('replaces the whole association set atomically', async () => {
      const { token } = await signIn('MANAGER');
      const first = await createServiceFixture(token, 'Service A');
      const second = await createServiceFixture(token, 'Service B');
      const third = await createServiceFixture(token, 'Service C');

      const created = await createTherapist(token, { supportedServiceIds: [first, second] });
      const id = therapistResponseSchema.parse(created.body).therapist.id;

      const response = await request(server())
        .patch(`/catalog/therapists/${id}`)
        .set(asUser(token))
        .send({
          fullName: 'Synthetic Therapist',
          specialty: 'Synthetic Specialty',
          supportedServiceIds: [third],
        });

      expect(response.status).toBe(200);
      expect(therapistResponseSchema.parse(response.body).therapist.supportedServiceIds).toEqual([
        third,
      ]);

      const rows = await harness.prisma.therapistService.findMany({ where: { therapistId: id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.serviceId).toBe(third);
    });

    it('can be cleared to none', async () => {
      const { token } = await signIn('MANAGER');
      const service = await createServiceFixture(token, 'Service A');

      const created = await createTherapist(token, { supportedServiceIds: [service] });
      const id = therapistResponseSchema.parse(created.body).therapist.id;

      const response = await request(server())
        .patch(`/catalog/therapists/${id}`)
        .set(asUser(token))
        .send({
          fullName: 'Synthetic Therapist',
          specialty: 'Synthetic Specialty',
          supportedServiceIds: [],
        });

      expect(response.status).toBe(200);
      expect(therapistResponseSchema.parse(response.body).therapist.supportedServiceIds).toEqual(
        [],
      );
      expect(await harness.prisma.therapistService.count({ where: { therapistId: id } })).toBe(0);
    });

    it('rejects an unknown service id on create and writes nothing', async () => {
      const { token } = await signIn('MANAGER');

      const response = await createTherapist(token, { supportedServiceIds: [uuidv7()] });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('SERVICE_NOT_FOUND');
      expect(await harness.prisma.therapist.count()).toBe(0);
      expect(await harness.prisma.auditLog.count({ where: { entityType: 'therapist' } })).toBe(0);
    });

    it('rolls back the whole update when a service id is unknown', async () => {
      const { token } = await signIn('MANAGER');
      const service = await createServiceFixture(token, 'Service A');

      const created = await createTherapist(token, { supportedServiceIds: [service] });
      const id = therapistResponseSchema.parse(created.body).therapist.id;
      const auditBefore = await harness.prisma.auditLog.count();

      const response = await request(server())
        .patch(`/catalog/therapists/${id}`)
        .set(asUser(token))
        .send({
          fullName: 'Renamed Therapist',
          specialty: 'Renamed Specialty',
          supportedServiceIds: [service, uuidv7()],
        });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('SERVICE_NOT_FOUND');

      // The rename in the same request rolled back with the association change.
      const row = await harness.prisma.therapist.findUniqueOrThrow({ where: { id } });
      expect(row.fullName).toBe('Synthetic Therapist');
      expect(row.specialty).toBe('Synthetic Specialty');

      const rows = await harness.prisma.therapistService.findMany({ where: { therapistId: id } });
      expect(rows.map((entry) => entry.serviceId)).toEqual([service]);

      expect(await harness.prisma.auditLog.count()).toBe(auditBefore);
    });

    it('keeps an association whose service is later deactivated', async () => {
      const { token } = await signIn('MANAGER');
      const service = await createServiceFixture(token, 'Service A');

      const created = await createTherapist(token, { supportedServiceIds: [service] });
      const id = therapistResponseSchema.parse(created.body).therapist.id;

      await request(server())
        .patch(`/catalog/services/${service}/status`)
        .set(asUser(token))
        .send({ status: 'INACTIVE' });

      // Configuration somebody entered is not discarded because a service was
      // retired; reactivating it must not have to restore a decision nobody
      // reversed.
      const response = await request(server()).get(`/catalog/therapists/${id}`).set(asUser(token));

      expect(response.status).toBe(200);
      expect(therapistResponseSchema.parse(response.body).therapist.supportedServiceIds).toEqual([
        service,
      ]);
      expect(await harness.prisma.therapistService.count({ where: { therapistId: id } })).toBe(1);
    });

    it('allows associating with an already-inactive service', async () => {
      const { token } = await signIn('MANAGER');
      const service = await createServiceFixture(token, 'Service A');

      await request(server())
        .patch(`/catalog/services/${service}/status`)
        .set(asUser(token))
        .send({ status: 'INACTIVE' });

      // No approved rule forbids it, so none is invented here.
      const response = await createTherapist(token, { supportedServiceIds: [service] });

      expect(response.status).toBe(201);
      expect(therapistResponseSchema.parse(response.body).therapist.supportedServiceIds).toEqual([
        service,
      ]);
    });
  });

  describe('reading', () => {
    it('lists therapists by name', async () => {
      const { token } = await signIn('MANAGER');

      await createTherapist(token, { fullName: 'Beta Therapist' });
      await createTherapist(token, { fullName: 'Alpha Therapist' });

      const response = await request(server()).get('/catalog/therapists').set(asUser(token));

      const { therapists } = therapistListResponseSchema.parse(response.body);
      expect(therapists.map((therapist) => therapist.fullName)).toEqual([
        'Alpha Therapist',
        'Beta Therapist',
      ]);
    });

    it.each([
      ['read', 'get' as const],
      ['update', 'patch' as const],
    ])('returns THERAPIST_NOT_FOUND on %s of an unknown id', async (_label, method) => {
      const { token } = await signIn('MANAGER');

      const response = await request(server())
        [method](`/catalog/therapists/${uuidv7()}`)
        .set(asUser(token))
        .send({ fullName: 'X', specialty: 'Y', supportedServiceIds: [] });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('THERAPIST_NOT_FOUND');
    });
  });

  describe('status lifecycle', () => {
    it('deactivates, records the time, and reactivates clearing it', async () => {
      const { token } = await signIn('MANAGER');
      const created = await createTherapist(token);
      const id = therapistResponseSchema.parse(created.body).therapist.id;

      const off = await request(server())
        .patch(`/catalog/therapists/${id}/status`)
        .set(asUser(token))
        .send({ status: 'INACTIVE' });

      expect(off.status).toBe(200);
      const deactivated = therapistResponseSchema.parse(off.body).therapist;
      expect(deactivated.status).toBe('INACTIVE');
      expect(deactivated.deactivatedAt).not.toBeNull();

      const on = await request(server())
        .patch(`/catalog/therapists/${id}/status`)
        .set(asUser(token))
        .send({ status: 'ACTIVE' });

      const reactivated = therapistResponseSchema.parse(on.body).therapist;
      expect(reactivated.status).toBe('ACTIVE');
      expect(reactivated.deactivatedAt).toBeNull();
    });

    it('is idempotent and writes no audit row for a status that did not change', async () => {
      const { token } = await signIn('MANAGER');
      const created = await createTherapist(token);
      const id = therapistResponseSchema.parse(created.body).therapist.id;

      const before = await harness.prisma.auditLog.count();

      const response = await request(server())
        .patch(`/catalog/therapists/${id}/status`)
        .set(asUser(token))
        .send({ status: 'ACTIVE' });

      expect(response.status).toBe(200);
      expect(therapistResponseSchema.parse(response.body).therapist.status).toBe('ACTIVE');
      expect(await harness.prisma.auditLog.count()).toBe(before);
    });

    it('keeps supported services across deactivation and reactivation', async () => {
      const { token } = await signIn('MANAGER');
      const service = await createServiceFixture(token, 'Service A');
      const created = await createTherapist(token, { supportedServiceIds: [service] });
      const id = therapistResponseSchema.parse(created.body).therapist.id;

      for (const status of ['INACTIVE', 'ACTIVE']) {
        await request(server())
          .patch(`/catalog/therapists/${id}/status`)
          .set(asUser(token))
          .send({ status });
      }

      const response = await request(server()).get(`/catalog/therapists/${id}`).set(asUser(token));
      expect(therapistResponseSchema.parse(response.body).therapist.supportedServiceIds).toEqual([
        service,
      ]);
    });
  });

  describe('audit', () => {
    it('writes one row per mutation, naming the actor and the approved actions', async () => {
      const { user, token } = await signIn('MANAGER');

      const created = await createTherapist(token);
      const id = therapistResponseSchema.parse(created.body).therapist.id;

      await request(server()).patch(`/catalog/therapists/${id}`).set(asUser(token)).send({
        fullName: 'Renamed Therapist',
        specialty: 'Synthetic Specialty',
        supportedServiceIds: [],
      });

      await request(server())
        .patch(`/catalog/therapists/${id}/status`)
        .set(asUser(token))
        .send({ status: 'INACTIVE' });

      const rows = await harness.prisma.auditLog.findMany({
        where: { entityType: 'therapist' },
        orderBy: { occurredAt: 'asc' },
      });

      expect(rows.map((row) => row.action)).toEqual([
        'therapist.created',
        'therapist.updated',
        'therapist.status_changed',
      ]);

      for (const row of rows) {
        expect(row.actorUserId).toBe(user.id);
        expect(row.entityId).toBe(id);
      }
    });

    it('shares one instant between the state change and its audit row', async () => {
      const { token } = await signIn('MANAGER');
      const created = await createTherapist(token);
      const id = therapistResponseSchema.parse(created.body).therapist.id;

      await request(server())
        .patch(`/catalog/therapists/${id}/status`)
        .set(asUser(token))
        .send({ status: 'INACTIVE' });

      const row = await harness.prisma.therapist.findUniqueOrThrow({ where: { id } });
      const audit = await harness.prisma.auditLog.findFirstOrThrow({
        where: { entityId: id, action: 'therapist.status_changed' },
      });

      // Both come from `transaction_timestamp()`, so they are the same instant
      // rather than merely close together.
      expect(row.deactivatedAt?.toISOString()).toBe(audit.occurredAt.toISOString());
    });

    it('records the supported service ids without unrelated service content', async () => {
      const { token } = await signIn('MANAGER');
      const service = await createServiceFixture(token, 'Service A');

      await createTherapist(token, { supportedServiceIds: [service] });

      const row = await harness.prisma.auditLog.findFirstOrThrow({
        where: { action: 'therapist.created' },
      });
      const after = row.after as Record<string, unknown>;

      expect(after['supportedServiceIds']).toEqual([service]);
      expect(after['fullName']).toBe('Synthetic Therapist');
      // Ids, not a copy of the service rows: the service's own name and
      // description are its record's business, and duplicating them here would
      // make the trail disagree with the service the day it is renamed.
      expect(JSON.stringify(after)).not.toContain('Service A');
    });

    it('carries no session or credential material', async () => {
      const { token } = await signIn('MANAGER');
      await createTherapist(token);

      const row = await harness.prisma.auditLog.findFirstOrThrow({
        where: { action: 'therapist.created' },
      });

      const payload = JSON.stringify(row.after).toLowerCase();
      for (const term of ['password', 'token', 'secret', 'hash', 'session']) {
        expect(payload).not.toContain(term);
      }
    });
  });
});
