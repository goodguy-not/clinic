import request from 'supertest';
import {
  loginResponseSchema,
  serviceListResponseSchema,
  serviceMutationResponseSchema,
  serviceResponseSchema,
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
 * Clinic services over real HTTP against real PostgreSQL.
 *
 * Everything is synthetic. No real service name, description or duration
 * appears in any fixture.
 */
describe('catalog services (real PostgreSQL)', () => {
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

  function validService(overrides: Record<string, unknown> = {}) {
    return {
      name: 'Synthetic Service',
      publicDescription: 'Synthetic description.',
      isPublic: true,
      allowedDurationsMinutes: [30, 45],
      ...overrides,
    };
  }

  async function createService(token: string, overrides: Record<string, unknown> = {}) {
    const response = await request(server())
      .post('/catalog/services')
      .set(asUser(token))
      .send(validService(overrides));

    return response;
  }

  describe('authorization', () => {
    const routes: Array<[string, 'get' | 'post' | 'patch', string, object | undefined]> = [
      // Reading is granted to a receptionist from the booking checkpoint; every
      // write below stays with the manager.
      [
        'create',
        'post',
        '/catalog/services',
        { name: 'X', publicDescription: null, isPublic: false, allowedDurationsMinutes: [30] },
      ],
      [
        'update',
        'patch',
        '/catalog/services/:id',
        { name: 'X', publicDescription: null, isPublic: false, allowedDurationsMinutes: [30] },
      ],
      ['status', 'patch', '/catalog/services/:id/status', { status: 'INACTIVE' }],
    ];

    it('lets a receptionist read, which booking requires', async () => {
      const manager = await signIn('MANAGER');
      const created = await createService(manager.token);
      const id = serviceResponseSchema.parse(created.body).service.id;

      const { token } = await signIn('RECEPTIONIST');

      expect((await request(server()).get('/catalog/services').set(asUser(token))).status).toBe(
        200,
      );
      expect(
        (await request(server()).get(`/catalog/services/${id}`).set(asUser(token))).status,
      ).toBe(200);
    });

    it.each(routes)('refuses a receptionist on %s', async (_label, method, path, body) => {
      const manager = await signIn('MANAGER');
      const created = await createService(manager.token);
      const id = serviceResponseSchema.parse(created.body).service.id;

      const { token } = await signIn('RECEPTIONIST');
      const url = path.replace(':id', id);

      const response = await request(server())
        [method](url)
        .set(asUser(token))
        .send(body ?? {});

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('allows a manager on every route', async () => {
      const { token } = await signIn('MANAGER');

      const created = await createService(token);
      expect(created.status).toBe(201);

      const id = serviceResponseSchema.parse(created.body).service.id;

      expect((await request(server()).get('/catalog/services').set(asUser(token))).status).toBe(
        200,
      );
      expect(
        (await request(server()).get(`/catalog/services/${id}`).set(asUser(token))).status,
      ).toBe(200);
    });
  });

  describe('creation', () => {
    it('returns whether the exact public cache identity was affected', async () => {
      const { token } = await signIn('MANAGER');

      const unaddressable = serviceMutationResponseSchema.parse(
        (await createService(token, { name: 'Unaddressable synthetic service' })).body,
      );
      const published = serviceMutationResponseSchema.parse(
        (
          await createService(token, {
            name: 'Published synthetic service',
            publicSlug: 'published-synthetic-service',
          })
        ).body,
      );

      expect(unaddressable.publication).toEqual({
        publicSlug: null,
        affectsPublicCache: false,
      });
      expect(published.publication).toEqual({
        publicSlug: 'published-synthetic-service',
        affectsPublicCache: true,
      });
    });

    it('creates a service with its durations and records who created it', async () => {
      const { user, token } = await signIn('MANAGER');

      const response = await createService(token);

      expect(response.status).toBe(201);
      const { service } = serviceResponseSchema.parse(response.body);

      expect(service.name).toBe('Synthetic Service');
      expect(service.isPublic).toBe(true);
      expect(service.status).toBe('ACTIVE');
      expect(service.deactivatedAt).toBeNull();
      expect(service.allowedDurationsMinutes).toEqual([30, 45]);

      const row = await harness.prisma.service.findUniqueOrThrow({ where: { id: service.id } });
      expect(row.createdByUserId).toBe(user.id);
    });

    it('persists a padded name in trimmed canonical form', async () => {
      const { token } = await signIn('MANAGER');

      const response = await createService(token, { name: '   Padded Service   ' });

      expect(response.status).toBe(201);
      const { service } = serviceResponseSchema.parse(response.body);
      expect(service.name).toBe('Padded Service');

      const row = await harness.prisma.service.findUniqueOrThrow({ where: { id: service.id } });
      expect(row.name).toBe('Padded Service');
    });

    it('refuses to let "Name" and " Name " become two services', async () => {
      const { token } = await signIn('MANAGER');

      expect((await createService(token, { name: 'Duplicate Target' })).status).toBe(201);

      const padded = await createService(token, { name: '  Duplicate Target  ' });

      expect(padded.status).toBe(409);
      expect(padded.body.error.code).toBe('SERVICE_NAME_TAKEN');
      expect(await harness.prisma.service.count()).toBe(1);
    });

    it('maps a duplicate name to SERVICE_NAME_TAKEN', async () => {
      const { token } = await signIn('MANAGER');

      await createService(token);
      const duplicate = await createService(token);

      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error.code).toBe('SERVICE_NAME_TAKEN');
    });

    it.each(['', '   ', '\t\n'])('rejects a blank name %j', async (name) => {
      const { token } = await signIn('MANAGER');

      const response = await createService(token, { name });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(await harness.prisma.service.count()).toBe(0);
    });

    it('enforces the maximum name length', async () => {
      const { token } = await signIn('MANAGER');

      expect((await createService(token, { name: 'x'.repeat(120) })).status).toBe(201);

      const tooLong = await createService(token, { name: 'y'.repeat(121) });
      expect(tooLong.status).toBe(400);
      expect(tooLong.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('enforces the maximum public description length', async () => {
      const { token } = await signIn('MANAGER');

      const atLimit = await createService(token, {
        name: 'At Limit',
        publicDescription: 'x'.repeat(2000),
      });
      expect(atLimit.status).toBe(201);

      const tooLong = await createService(token, {
        name: 'Over Limit',
        publicDescription: 'y'.repeat(2001),
      });
      expect(tooLong.status).toBe(400);
      expect(tooLong.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('requires at least one duration', async () => {
      const { token } = await signIn('MANAGER');

      const response = await createService(token, { allowedDurationsMinutes: [] });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('deduplicates and orders durations', async () => {
      const { token } = await signIn('MANAGER');

      const response = await createService(token, { allowedDurationsMinutes: [60, 30, 60, 45] });

      const { service } = serviceResponseSchema.parse(response.body);
      expect(service.allowedDurationsMinutes).toEqual([30, 45, 60]);
    });

    it('rejects an implausible duration', async () => {
      const { token } = await signIn('MANAGER');

      for (const minutes of [0, -30, 481]) {
        const response = await createService(token, { allowedDurationsMinutes: [minutes] });
        expect(response.status).toBe(400);
      }
    });

    it('rejects an unexpected field rather than ignoring it', async () => {
      const { token } = await signIn('MANAGER');

      const response = await request(server())
        .post('/catalog/services')
        .set(asUser(token))
        .send({ ...validService(), status: 'INACTIVE' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('reading', () => {
    it('lists services by name', async () => {
      const { token } = await signIn('MANAGER');

      await createService(token, { name: 'Beta' });
      await createService(token, { name: 'Alpha' });

      const response = await request(server()).get('/catalog/services').set(asUser(token));

      const { services } = serviceListResponseSchema.parse(response.body);
      expect(services.map((service) => service.name)).toEqual(['Alpha', 'Beta']);
    });

    it('returns SERVICE_NOT_FOUND for an unknown id', async () => {
      const { token } = await signIn('MANAGER');

      const response = await request(server())
        .get(`/catalog/services/${uuidv7()}`)
        .set(asUser(token));

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('SERVICE_NOT_FOUND');
    });
  });

  describe('updating', () => {
    it('edits fields and replaces durations', async () => {
      const { token } = await signIn('MANAGER');
      const created = await createService(token);
      const id = serviceResponseSchema.parse(created.body).service.id;

      const response = await request(server())
        .patch(`/catalog/services/${id}`)
        .set(asUser(token))
        .send({
          name: '  Renamed Service  ',
          publicDescription: null,
          isPublic: false,
          allowedDurationsMinutes: [45, 60],
        });

      expect(response.status).toBe(200);
      const { service } = serviceResponseSchema.parse(response.body);

      expect(service.name).toBe('Renamed Service');
      expect(service.publicDescription).toBeNull();
      expect(service.isPublic).toBe(false);
      expect(service.allowedDurationsMinutes).toEqual([45, 60]);
    });

    it('removes an unreferenced duration', async () => {
      const { token } = await signIn('MANAGER');
      const created = await createService(token);
      const id = serviceResponseSchema.parse(created.body).service.id;

      const response = await request(server())
        .patch(`/catalog/services/${id}`)
        .set(asUser(token))
        .send({ ...validService(), allowedDurationsMinutes: [30] });

      expect(response.status).toBe(200);
      expect(serviceResponseSchema.parse(response.body).service.allowedDurationsMinutes).toEqual([
        30,
      ]);
    });

    it('maps a duplicate rename to SERVICE_NAME_TAKEN', async () => {
      const { token } = await signIn('MANAGER');
      await createService(token, { name: 'Existing' });
      const other = await createService(token, { name: 'Other' });
      const id = serviceResponseSchema.parse(other.body).service.id;

      const response = await request(server())
        .patch(`/catalog/services/${id}`)
        .set(asUser(token))
        .send({ ...validService(), name: 'Existing' });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('SERVICE_NAME_TAKEN');
    });

    it('returns SERVICE_NOT_FOUND for an unknown id', async () => {
      const { token } = await signIn('MANAGER');

      const response = await request(server())
        .patch(`/catalog/services/${uuidv7()}`)
        .set(asUser(token))
        .send(validService());

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('SERVICE_NOT_FOUND');
    });
  });

  describe('a duration that has tariff history cannot be withdrawn', () => {
    /**
     * Tariff endpoints do not exist yet, so the fixture is written directly.
     * Adding a temporary API to make a test convenient would put a route into
     * the application that nothing else needs and that would have to be
     * removed later.
     */
    async function seedTariff(
      serviceId: string,
      actorId: string,
      options: { voided: boolean },
    ): Promise<void> {
      const id = uuidv7();

      await harness.prisma.$executeRaw`
        INSERT INTO tariff (
          id, service_id, duration_minutes, price_mode, price_toman,
          effective_start, created_at, created_by_user_id
        ) VALUES (
          ${id}::uuid, ${serviceId}::uuid, 45, 'PAID'::tariff_price_mode, 120000,
          DATE '2026-01-01', transaction_timestamp(), ${actorId}::uuid
        )
      `;

      if (options.voided) {
        await harness.prisma.$executeRaw`
          UPDATE tariff
          SET voided_at = transaction_timestamp(), void_reason = 'synthetic void'
          WHERE id = ${id}::uuid
        `;
      }
    }

    it.each([
      ['an active tariff', false],
      ['a voided tariff', true],
    ])('refuses removal when %s prices it', async (_label, voided) => {
      const { user, token } = await signIn('MANAGER');
      const created = await createService(token);
      const id = serviceResponseSchema.parse(created.body).service.id;

      await seedTariff(id, user.id, { voided });

      const auditBefore = await harness.prisma.auditLog.count();

      const response = await request(server())
        .patch(`/catalog/services/${id}`)
        .set(asUser(token))
        .send({ ...validService(), name: 'Renamed Too', allowedDurationsMinutes: [30] });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('SERVICE_DURATION_IN_USE');

      // The whole transaction rolled back: the duration survives, the unrelated
      // rename in the same request did not happen, and no audit row claims it did.
      const after = await harness.prisma.service.findUniqueOrThrow({ where: { id } });
      expect(after.name).toBe('Synthetic Service');

      const durations = await harness.prisma.serviceDuration.findMany({
        where: { serviceId: id },
      });
      expect(durations.map((row) => row.durationMinutes).sort((a, b) => a - b)).toEqual([30, 45]);

      expect(await harness.prisma.auditLog.count()).toBe(auditBefore);
    });

    it('allows removing a different, unpriced duration', async () => {
      const { user, token } = await signIn('MANAGER');
      const created = await createService(token);
      const id = serviceResponseSchema.parse(created.body).service.id;

      await seedTariff(id, user.id, { voided: false });

      // 45 is priced and kept; 30 is not priced and removed.
      const response = await request(server())
        .patch(`/catalog/services/${id}`)
        .set(asUser(token))
        .send({ ...validService(), allowedDurationsMinutes: [45] });

      expect(response.status).toBe(200);
      expect(serviceResponseSchema.parse(response.body).service.allowedDurationsMinutes).toEqual([
        45,
      ]);
    });
  });

  describe('activation', () => {
    it('deactivates, records the time, and reactivates clearing it', async () => {
      const { token } = await signIn('MANAGER');
      const created = await createService(token);
      const id = serviceResponseSchema.parse(created.body).service.id;

      const deactivated = await request(server())
        .patch(`/catalog/services/${id}/status`)
        .set(asUser(token))
        .send({ status: 'INACTIVE' });

      expect(deactivated.status).toBe(200);
      const off = serviceResponseSchema.parse(deactivated.body).service;
      expect(off.status).toBe('INACTIVE');
      expect(off.deactivatedAt).not.toBeNull();

      const reactivated = await request(server())
        .patch(`/catalog/services/${id}/status`)
        .set(asUser(token))
        .send({ status: 'ACTIVE' });

      expect(reactivated.status).toBe(200);
      const on = serviceResponseSchema.parse(reactivated.body).service;
      expect(on.status).toBe('ACTIVE');
      expect(on.deactivatedAt).toBeNull();
    });

    it('is idempotent and writes no audit row for a status that did not change', async () => {
      const { token } = await signIn('MANAGER');
      const created = await createService(token);
      const id = serviceResponseSchema.parse(created.body).service.id;

      const before = await harness.prisma.auditLog.count();

      const response = await request(server())
        .patch(`/catalog/services/${id}/status`)
        .set(asUser(token))
        .send({ status: 'ACTIVE' });

      expect(response.status).toBe(200);
      expect(serviceResponseSchema.parse(response.body).service.status).toBe('ACTIVE');
      expect(await harness.prisma.auditLog.count()).toBe(before);
    });
  });

  describe('audit', () => {
    it('writes one row per mutation, naming the actor', async () => {
      const { user, token } = await signIn('MANAGER');

      const created = await createService(token);
      const id = serviceResponseSchema.parse(created.body).service.id;

      await request(server())
        .patch(`/catalog/services/${id}`)
        .set(asUser(token))
        .send({ ...validService(), name: 'Renamed' });

      await request(server())
        .patch(`/catalog/services/${id}/status`)
        .set(asUser(token))
        .send({ status: 'INACTIVE' });

      const rows = await harness.prisma.auditLog.findMany({
        where: { entityType: 'service' },
        orderBy: { occurredAt: 'asc' },
      });

      expect(rows.map((row) => row.action)).toEqual([
        'service.created',
        'service.updated',
        'service.status_changed',
      ]);

      for (const row of rows) {
        expect(row.actorUserId).toBe(user.id);
        expect(row.entityId).toBe(id);
      }
    });

    it('shares one instant between the state change and its audit row', async () => {
      const { token } = await signIn('MANAGER');
      const created = await createService(token);
      const id = serviceResponseSchema.parse(created.body).service.id;

      await request(server())
        .patch(`/catalog/services/${id}/status`)
        .set(asUser(token))
        .send({ status: 'INACTIVE' });

      const row = await harness.prisma.service.findUniqueOrThrow({ where: { id } });
      const audit = await harness.prisma.auditLog.findFirstOrThrow({
        where: { entityId: id, action: 'service.status_changed' },
      });

      // Both come from `transaction_timestamp()`, so they are the same instant
      // rather than merely close together.
      expect(row.deactivatedAt?.toISOString()).toBe(audit.occurredAt.toISOString());
    });

    it('leaves no audit row when the mutation fails', async () => {
      const { token } = await signIn('MANAGER');
      await createService(token, { name: 'Taken Name' });

      const before = await harness.prisma.auditLog.count();

      const duplicate = await createService(token, { name: 'Taken Name' });
      expect(duplicate.status).toBe(409);

      expect(await harness.prisma.auditLog.count()).toBe(before);
    });
  });
});
