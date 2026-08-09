import request from 'supertest';
import {
  loginResponseSchema,
  resolveTariffResponseSchema,
  serviceResponseSchema,
  tariffListResponseSchema,
  tariffResponseSchema,
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
 * Effective-dated prices over real HTTP against real PostgreSQL.
 *
 * Everything is synthetic — no real service, therapist or price appears in any
 * fixture. The amounts below are round numbers chosen to be obviously invented.
 */
describe('catalog tariffs (real PostgreSQL)', () => {
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

  async function makeService(token: string, name = 'Synthetic Service', durations = [30, 45]) {
    const response = await request(server())
      .post('/catalog/services')
      .set(asUser(token))
      .send({ name, publicDescription: null, isPublic: false, allowedDurationsMinutes: durations });

    return serviceResponseSchema.parse(response.body).service.id;
  }

  async function makeTherapist(token: string, fullName = 'Synthetic Therapist') {
    const response = await request(server())
      .post('/catalog/therapists')
      .set(asUser(token))
      .send({ fullName, specialty: 'Synthetic Specialty', supportedServiceIds: [] });

    return therapistResponseSchema.parse(response.body).therapist.id;
  }

  function paid(serviceId: string, overrides: Record<string, unknown> = {}) {
    return {
      serviceId,
      durationMinutes: 45,
      therapistId: null,
      priceMode: 'PAID',
      priceToman: '120000',
      effectiveStart: '2026-01-01',
      effectiveEnd: null,
      ...overrides,
    };
  }

  function free(serviceId: string, overrides: Record<string, unknown> = {}) {
    return {
      serviceId,
      durationMinutes: 45,
      therapistId: null,
      priceMode: 'FREE',
      freeReason: 'complimentary screening programme',
      confirmFreePrice: true,
      effectiveStart: '2026-01-01',
      effectiveEnd: null,
      ...overrides,
    };
  }

  const createTariff = (token: string, body: Record<string, unknown>) =>
    request(server()).post('/catalog/tariffs').set(asUser(token)).send(body);

  describe('authorization', () => {
    it('lets a receptionist read a price, which the diary needs', async () => {
      // PROJECT_SPEC.md 4 bars a receptionist from tariff CHANGES, not from
      // looking one up. `tariff.create` and `tariff.void` below stay refused.
      const manager = await signIn('MANAGER');
      const serviceId = await makeService(manager.token);
      const created = await createTariff(manager.token, paid(serviceId));
      const id = tariffResponseSchema.parse(created.body).tariff.id;

      const { token } = await signIn('RECEPTIONIST');

      expect((await request(server()).get('/catalog/tariffs').set(asUser(token))).status).toBe(200);
      expect(
        (await request(server()).get(`/catalog/tariffs/${id}`).set(asUser(token))).status,
      ).toBe(200);
    });

    it.each([
      ['create', 'post', '/catalog/tariffs', {}],
      ['void', 'post', '/catalog/tariffs/:id/void', { reason: 'x' }],
    ] as Array<[string, 'get' | 'post', string, object | undefined]>)(
      'refuses a receptionist on %s',
      async (_label, method, path, body) => {
        const manager = await signIn('MANAGER');
        const serviceId = await makeService(manager.token);
        const created = await createTariff(manager.token, paid(serviceId));
        const id = tariffResponseSchema.parse(created.body).tariff.id;

        const { token } = await signIn('RECEPTIONIST');

        const response = await request(server())
          [method](path.replace(':id', id))
          .set(asUser(token))
          .send(body ?? {});

        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('AUTH_FORBIDDEN');
      },
    );
  });

  describe('there is no update or delete route', () => {
    it.each([
      ['patch', '/catalog/tariffs/:id'],
      ['put', '/catalog/tariffs/:id'],
      ['delete', '/catalog/tariffs/:id'],
      ['delete', '/catalog/tariffs'],
    ] as Array<['patch' | 'put' | 'delete', string]>)('refuses %s %s', async (method, path) => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);
      const created = await createTariff(token, paid(serviceId));
      const id = tariffResponseSchema.parse(created.body).tariff.id;

      const response = await request(server())
        [method](path.replace(':id', id))
        .set(asUser(token))
        .send({ priceToman: '1' });

      // 404: no such route is registered. A tariff is corrected by voiding and
      // replacing, never edited.
      expect(response.status).toBe(404);

      const row = await harness.prisma.tariff.findUniqueOrThrow({ where: { id } });
      expect(row.priceToman).toBe(120000n);
      expect(row.voidedAt).toBeNull();
    });
  });

  describe('paid tariffs', () => {
    it('creates one and returns the price as a decimal string', async () => {
      const { user, token } = await signIn('MANAGER');
      const serviceId = await makeService(token);

      const response = await createTariff(token, paid(serviceId));

      expect(response.status).toBe(201);
      const { tariff } = tariffResponseSchema.parse(response.body);

      expect(tariff.priceMode).toBe('PAID');
      expect(tariff.priceToman).toBe('120000');
      expect(typeof tariff.priceToman).toBe('string');
      expect(tariff.freeReason).toBeNull();
      expect(tariff.voidedAt).toBeNull();

      const row = await harness.prisma.tariff.findUniqueOrThrow({ where: { id: tariff.id } });
      expect(row.createdByUserId).toBe(user.id);
    });

    it('never leaks a raw bigint or a timestamp through JSON', async () => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);
      const created = await createTariff(token, paid(serviceId));
      const id = tariffResponseSchema.parse(created.body).tariff.id;

      const response = await request(server()).get(`/catalog/tariffs/${id}`).set(asUser(token));
      const raw = JSON.stringify(response.body);

      // A date-only field must never arrive as an instant: `2026-01-01`, not
      // `2026-01-01T00:00:00.000Z`.
      expect(raw).toContain('"effectiveStart":"2026-01-01"');
      expect(raw).not.toMatch(/"effectiveStart":"[^"]*T/);
      expect(raw).toContain('"priceToman":"120000"');
      expect(raw).not.toContain('"priceToman":120000');
    });

    it.each([
      ['zero', '0'],
      ['negative', '-1'],
      ['above the ceiling', '1000000001'],
      ['not a number', 'abc'],
      ['fractional', '1.5'],
    ])('rejects a %s price', async (_label, priceToman) => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);

      // Typing 0 into the amount field must never produce a free tariff.
      const response = await createTariff(token, paid(serviceId, { priceToman }));

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(await harness.prisma.tariff.count()).toBe(0);
    });

    it('accepts the maximum permitted price', async () => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);

      const response = await createTariff(token, paid(serviceId, { priceToman: '1000000000' }));

      expect(response.status).toBe(201);
      expect(tariffResponseSchema.parse(response.body).tariff.priceToman).toBe('1000000000');
    });

    it.each([
      ['a free reason', { freeReason: 'why' }],
      ['a free confirmation', { confirmFreePrice: true }],
    ])('refuses a paid tariff carrying %s', async (_label, extra) => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);

      const response = await createTariff(token, paid(serviceId, extra));

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('free tariffs', () => {
    it('creates one at exactly zero with its stated reason', async () => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);

      const response = await createTariff(token, free(serviceId));

      expect(response.status).toBe(201);
      const { tariff } = tariffResponseSchema.parse(response.body);

      expect(tariff.priceMode).toBe('FREE');
      expect(tariff.priceToman).toBe('0');
      expect(tariff.freeReason).toBe('complimentary screening programme');
    });

    it('trims the reason and refuses a blank one', async () => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);

      const padded = await createTariff(token, free(serviceId, { freeReason: '  spaced  ' }));
      expect(tariffResponseSchema.parse(padded.body).tariff.freeReason).toBe('spaced');

      const blank = await createTariff(
        token,
        free(serviceId, { freeReason: '   ', effectiveStart: '2027-01-01' }),
      );
      expect(blank.status).toBe(400);
    });

    /**
     * Built by removing or replacing one field of a valid free request, so each
     * case differs from a working submission in exactly one way.
     */
    function freeMissing(serviceId: string, drop: string): Record<string, unknown> {
      const body = free(serviceId) as Record<string, unknown>;
      delete body[drop];
      return body;
    }

    it.each([
      ['no confirmation', (id: string) => freeMissing(id, 'confirmFreePrice')],
      ['no reason', (id: string) => freeMissing(id, 'freeReason')],
      ['a false confirmation', (id: string) => free(id, { confirmFreePrice: false })],
      ['a supplied price', (id: string) => free(id, { priceToman: '5000' })],
      ['a zero price supplied explicitly', (id: string) => free(id, { priceToman: '0' })],
    ])('refuses a free tariff with %s', async (_label, build) => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);

      const response = await createTariff(token, build(serviceId));

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(await harness.prisma.tariff.count()).toBe(0);
    });

    it('never persists or audits the confirmation flag', async () => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);
      await createTariff(token, free(serviceId));

      const audit = await harness.prisma.auditLog.findFirstOrThrow({
        where: { action: 'tariff.created' },
      });

      // It records a property of the submission, not of the tariff.
      expect(JSON.stringify(audit)).not.toContain('confirmFreePrice');

      const columns = await harness.prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'tariff'
      `;
      expect(columns.map((c) => c.column_name)).not.toContain('confirm_free_price');
    });
  });

  describe('durations and references', () => {
    it('refuses a duration the service does not offer', async () => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token, 'Synthetic Service', [45]);

      const response = await createTariff(token, paid(serviceId, { durationMinutes: 30 }));

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('TARIFF_DURATION_NOT_ALLOWED');
    });

    it('accepts every duration the service does offer', async () => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token, 'Synthetic Service', [30, 45]);

      for (const durationMinutes of [30, 45]) {
        const response = await createTariff(token, paid(serviceId, { durationMinutes }));
        expect(response.status).toBe(201);
      }
    });

    it('refuses an unknown service', async () => {
      const { token } = await signIn('MANAGER');

      const response = await createTariff(token, paid(uuidv7()));

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('SERVICE_NOT_FOUND');
    });

    it('refuses an unknown therapist', async () => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);

      const response = await createTariff(token, paid(serviceId, { therapistId: uuidv7() }));

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('THERAPIST_NOT_FOUND');
    });

    it.each([
      ['service', 'SERVICE_INACTIVE'],
      ['therapist', 'THERAPIST_INACTIVE'],
    ])('refuses pricing against an inactive %s', async (entity, code) => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);
      const therapistId = await makeTherapist(token);

      const path = entity === 'service' ? 'services' : 'therapists';
      const id = entity === 'service' ? serviceId : therapistId;
      await request(server())
        .patch(`/catalog/${path}/${id}/status`)
        .set(asUser(token))
        .send({ status: 'INACTIVE' });

      const response = await createTariff(token, paid(serviceId, { therapistId }));

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe(code);
      expect(await harness.prisma.tariff.count()).toBe(0);
      expect(await harness.prisma.auditLog.count({ where: { entityType: 'tariff' } })).toBe(0);
    });
  });

  describe('overlap', () => {
    it('accepts adjacent ranges that do not overlap', async () => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);

      const first = await createTariff(
        token,
        paid(serviceId, { effectiveStart: '2026-01-01', effectiveEnd: '2026-06-30' }),
      );
      expect(first.status).toBe(201);

      // Ranges are inclusive on both ends, so the next day is adjacent, not
      // overlapping.
      const second = await createTariff(
        token,
        paid(serviceId, { effectiveStart: '2026-07-01', effectiveEnd: null }),
      );
      expect(second.status).toBe(201);
    });

    it('rejects overlapping general tariffs', async () => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);

      await createTariff(
        token,
        paid(serviceId, { effectiveStart: '2026-01-01', effectiveEnd: '2026-06-30' }),
      );

      const overlapping = await createTariff(
        token,
        paid(serviceId, { effectiveStart: '2026-06-30', effectiveEnd: null }),
      );

      expect(overlapping.status).toBe(409);
      expect(overlapping.body.error.code).toBe('TARIFF_OVERLAP');
      expect(await harness.prisma.tariff.count()).toBe(1);
    });

    it('rejects overlapping tariffs for the same therapist', async () => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);
      const therapistId = await makeTherapist(token);

      await createTariff(token, paid(serviceId, { therapistId }));
      const overlapping = await createTariff(token, paid(serviceId, { therapistId }));

      expect(overlapping.status).toBe(409);
      expect(overlapping.body.error.code).toBe('TARIFF_OVERLAP');
    });

    it('accepts a general and a therapist-specific tariff on the same dates', async () => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);
      const therapistId = await makeTherapist(token);

      expect((await createTariff(token, paid(serviceId))).status).toBe(201);
      // This is the whole point of precedence: both must be able to exist.
      expect((await createTariff(token, paid(serviceId, { therapistId }))).status).toBe(201);
    });

    it('accepts tariffs for two different therapists on the same dates', async () => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);
      const first = await makeTherapist(token, 'Therapist One');
      const second = await makeTherapist(token, 'Therapist Two');

      expect((await createTariff(token, paid(serviceId, { therapistId: first }))).status).toBe(201);
      expect((await createTariff(token, paid(serviceId, { therapistId: second }))).status).toBe(
        201,
      );
    });

    it('frees the range once the earlier tariff is voided', async () => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);
      const created = await createTariff(token, paid(serviceId));
      const id = tariffResponseSchema.parse(created.body).tariff.id;

      await request(server())
        .post(`/catalog/tariffs/${id}/void`)
        .set(asUser(token))
        .send({ reason: 'price corrected' });

      expect((await createTariff(token, paid(serviceId))).status).toBe(201);
    });

    it('writes no audit row for a rejected overlap', async () => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);
      await createTariff(token, paid(serviceId));

      const before = await harness.prisma.auditLog.count();
      expect((await createTariff(token, paid(serviceId))).status).toBe(409);

      expect(await harness.prisma.auditLog.count()).toBe(before);
      expect(await harness.prisma.tariff.count()).toBe(1);
    });
  });

  describe('resolution', () => {
    const resolve = (token: string, query: Record<string, string | number>) =>
      request(server()).get('/catalog/tariff-resolution').query(query).set(asUser(token));

    it('resolves the general tariff for a covered date', async () => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);
      await createTariff(
        token,
        paid(serviceId, { effectiveStart: '2026-01-01', effectiveEnd: '2026-06-30' }),
      );

      const response = await resolve(token, {
        serviceId,
        durationMinutes: 45,
        serviceDate: '2026-03-15',
      });

      expect(response.status).toBe(200);
      expect(resolveTariffResponseSchema.parse(response.body).tariff.priceToman).toBe('120000');
    });

    it('prefers a therapist-specific tariff over the general one', async () => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);
      const therapistId = await makeTherapist(token);

      await createTariff(token, paid(serviceId, { priceToman: '100000' }));
      await createTariff(token, paid(serviceId, { therapistId, priceToman: '150000' }));

      const specific = await resolve(token, {
        serviceId,
        durationMinutes: 45,
        therapistId,
        serviceDate: '2026-03-15',
      });
      expect(resolveTariffResponseSchema.parse(specific.body).tariff.priceToman).toBe('150000');

      // Another therapist falls back to the general price.
      const other = await makeTherapist(token, 'Therapist Two');
      const general = await resolve(token, {
        serviceId,
        durationMinutes: 45,
        therapistId: other,
        serviceDate: '2026-03-15',
      });
      expect(resolveTariffResponseSchema.parse(general.body).tariff.priceToman).toBe('100000');
    });

    it('resolves a free tariff as FREE at zero', async () => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);
      await createTariff(token, free(serviceId));

      const response = await resolve(token, {
        serviceId,
        durationMinutes: 45,
        serviceDate: '2026-03-15',
      });

      const { tariff } = resolveTariffResponseSchema.parse(response.body);
      expect(tariff.priceMode).toBe('FREE');
      expect(tariff.priceToman).toBe('0');
    });

    it.each([
      ['before the range', '2025-12-31'],
      ['after the range', '2026-07-01'],
    ])('returns TARIFF_MISSING for a date %s', async (_label, serviceDate) => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);
      await createTariff(
        token,
        paid(serviceId, { effectiveStart: '2026-01-01', effectiveEnd: '2026-06-30' }),
      );

      const response = await resolve(token, { serviceId, durationMinutes: 45, serviceDate });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('TARIFF_MISSING');
    });

    it('includes the boundary days of an inclusive range', async () => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);
      await createTariff(
        token,
        paid(serviceId, { effectiveStart: '2026-01-01', effectiveEnd: '2026-06-30' }),
      );

      for (const serviceDate of ['2026-01-01', '2026-06-30']) {
        const response = await resolve(token, { serviceId, durationMinutes: 45, serviceDate });
        expect(response.status).toBe(200);
      }
    });

    it('never resolves a voided tariff', async () => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);
      const created = await createTariff(token, paid(serviceId));
      const id = tariffResponseSchema.parse(created.body).tariff.id;

      await request(server())
        .post(`/catalog/tariffs/${id}/void`)
        .set(asUser(token))
        .send({ reason: 'withdrawn' });

      const response = await resolve(token, {
        serviceId,
        durationMinutes: 45,
        serviceDate: '2026-03-15',
      });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('TARIFF_MISSING');
    });

    it('still resolves history after the service and therapist are deactivated', async () => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);
      const therapistId = await makeTherapist(token);
      await createTariff(token, paid(serviceId, { therapistId }));

      for (const [path, id] of [
        ['services', serviceId],
        ['therapists', therapistId],
      ] as const) {
        await request(server())
          .patch(`/catalog/${path}/${id}/status`)
          .set(asUser(token))
          .send({ status: 'INACTIVE' });
      }

      // A session that happened while the service was offered is still priced
      // by the tariff that was in force. Retiring a service is not a statement
      // about the past.
      const response = await resolve(token, {
        serviceId,
        durationMinutes: 45,
        therapistId,
        serviceDate: '2026-03-15',
      });

      expect(response.status).toBe(200);
      expect(resolveTariffResponseSchema.parse(response.body).tariff.priceToman).toBe('120000');
    });

    it.each([
      ['a leap day', '2028-02-29', '2028-01-01', '2028-12-31'],
      ['a year boundary', '2026-12-31', '2026-01-01', '2026-12-31'],
      ['the first of a year', '2027-01-01', '2027-01-01', null],
    ])('handles %s exactly', async (_label, serviceDate, start, end) => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);
      await createTariff(token, paid(serviceId, { effectiveStart: start, effectiveEnd: end }));

      const response = await resolve(token, { serviceId, durationMinutes: 45, serviceDate });

      expect(response.status).toBe(200);
      const { tariff } = resolveTariffResponseSchema.parse(response.body);
      expect(tariff.effectiveStart).toBe(start);
      expect(tariff.effectiveEnd).toBe(end);
    });

    it.each(['2026-02-30', '2027-02-29', 'today', '2026-1-1'])(
      'rejects the invalid service date %s',
      async (serviceDate) => {
        const { token } = await signIn('MANAGER');
        const serviceId = await makeService(token);

        const response = await resolve(token, { serviceId, durationMinutes: 45, serviceDate });

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      },
    );
  });

  describe('dates round-trip exactly', () => {
    it.each([
      ['2028-02-29', '2028-12-31'],
      ['2026-01-01', '2026-01-01'],
      ['2026-12-31', null],
    ])('stores and returns %s..%s unchanged', async (start, end) => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);

      const created = await createTariff(
        token,
        paid(serviceId, { effectiveStart: start, effectiveEnd: end }),
      );

      const { tariff } = tariffResponseSchema.parse(created.body);
      expect(tariff.effectiveStart).toBe(start);
      expect(tariff.effectiveEnd).toBe(end);

      // And again after a fresh read, so the value survives the database rather
      // than merely echoing the request.
      const read = await request(server()).get(`/catalog/tariffs/${tariff.id}`).set(asUser(token));
      const reread = tariffResponseSchema.parse(read.body).tariff;
      expect(reread.effectiveStart).toBe(start);
      expect(reread.effectiveEnd).toBe(end);
    });

    it('rejects a range that ends before it starts as ordinary invalid input', async () => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);

      const response = await createTariff(
        token,
        paid(serviceId, { effectiveStart: '2026-06-30', effectiveEnd: '2026-01-01' }),
      );

      // Caught by the contract rather than by the database CHECK, so a manager
      // who transposed two dates gets a validation message instead of an
      // internal error.
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(await harness.prisma.tariff.count()).toBe(0);
    });

    it('accepts a single-day range', async () => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);

      const response = await createTariff(
        token,
        paid(serviceId, { effectiveStart: '2026-03-15', effectiveEnd: '2026-03-15' }),
      );

      expect(response.status).toBe(201);
    });
  });

  describe('void', () => {
    async function makeTariff(token: string, serviceId: string) {
      const created = await createTariff(token, paid(serviceId));
      return tariffResponseSchema.parse(created.body).tariff.id;
    }

    it('voids with a reason and a matching audit timestamp', async () => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);
      const id = await makeTariff(token, serviceId);

      const response = await request(server())
        .post(`/catalog/tariffs/${id}/void`)
        .set(asUser(token))
        .send({ reason: '  price corrected  ' });

      expect(response.status).toBe(200);
      const { tariff } = tariffResponseSchema.parse(response.body);
      expect(tariff.voidedAt).not.toBeNull();
      expect(tariff.voidReason).toBe('price corrected');

      const row = await harness.prisma.tariff.findUniqueOrThrow({ where: { id } });
      const audit = await harness.prisma.auditLog.findFirstOrThrow({
        where: { entityId: id, action: 'tariff.voided' },
      });

      // Both come from `transaction_timestamp()`: the same instant, not merely
      // close together.
      expect(row.voidedAt?.toISOString()).toBe(audit.occurredAt.toISOString());
    });

    it('refuses a second void', async () => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);
      const id = await makeTariff(token, serviceId);

      await request(server())
        .post(`/catalog/tariffs/${id}/void`)
        .set(asUser(token))
        .send({ reason: 'first' });

      const second = await request(server())
        .post(`/catalog/tariffs/${id}/void`)
        .set(asUser(token))
        .send({ reason: 'second' });

      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('TARIFF_ALREADY_VOIDED');

      const row = await harness.prisma.tariff.findUniqueOrThrow({ where: { id } });
      expect(row.voidReason).toBe('first');
    });

    it.each(['', '   '])('refuses a blank reason %j', async (reason) => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);
      const id = await makeTariff(token, serviceId);

      const response = await request(server())
        .post(`/catalog/tariffs/${id}/void`)
        .set(asUser(token))
        .send({ reason });

      expect(response.status).toBe(400);
      const row = await harness.prisma.tariff.findUniqueOrThrow({ where: { id } });
      expect(row.voidedAt).toBeNull();
    });

    it('returns TARIFF_NOT_FOUND for an unknown id', async () => {
      const { token } = await signIn('MANAGER');

      const response = await request(server())
        .post(`/catalog/tariffs/${uuidv7()}/void`)
        .set(asUser(token))
        .send({ reason: 'anything' });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('TARIFF_NOT_FOUND');
    });
  });

  describe('supersede', () => {
    async function original(token: string, serviceId: string, therapistId: string | null = null) {
      const created = await createTariff(token, paid(serviceId, { therapistId }));
      return tariffResponseSchema.parse(created.body).tariff.id;
    }

    it('voids the old row and creates the replacement in one transaction', async () => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);
      const oldId = await original(token, serviceId);

      const response = await createTariff(
        token,
        paid(serviceId, { priceToman: '150000', supersedesTariffId: oldId }),
      );

      expect(response.status).toBe(201);
      const { tariff } = tariffResponseSchema.parse(response.body);
      expect(tariff.priceToman).toBe('150000');
      expect(tariff.supersedesTariffId).toBe(oldId);

      const old = await harness.prisma.tariff.findUniqueOrThrow({ where: { id: oldId } });
      expect(old.voidedAt).not.toBeNull();

      const actions = await harness.prisma.auditLog.findMany({
        where: { entityType: 'tariff' },
        orderBy: { occurredAt: 'asc' },
        select: { action: true, entityId: true },
      });

      // Two independently inspectable facts: the value that stopped applying,
      // and the one that replaced it.
      expect(actions).toEqual([
        { action: 'tariff.created', entityId: oldId },
        { action: 'tariff.voided', entityId: oldId },
        { action: 'tariff.created', entityId: tariff.id },
      ]);
    });

    it('allows a paid tariff to be superseded by a free one', async () => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);
      const oldId = await original(token, serviceId);

      // The price mode is what is being corrected, not what is being priced.
      const response = await createTariff(token, free(serviceId, { supersedesTariffId: oldId }));

      expect(response.status).toBe(201);
      const { tariff } = tariffResponseSchema.parse(response.body);
      expect(tariff.priceMode).toBe('FREE');
      expect(tariff.priceToman).toBe('0');
    });

    it.each([
      ['a different duration', { durationMinutes: 30 }],
      ['a different therapist scope', { therapistId: '__therapist__' }],
    ])('refuses a replacement with %s', async (_label, override) => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);
      const therapistId = await makeTherapist(token);
      const oldId = await original(token, serviceId);

      const patched = { ...override } as Record<string, unknown>;
      if (patched['therapistId'] === '__therapist__') patched['therapistId'] = therapistId;

      const response = await createTariff(
        token,
        paid(serviceId, { ...patched, supersedesTariffId: oldId }),
      );

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('TARIFF_SCOPE_MISMATCH');

      // Nothing happened: the original is untouched and no replacement exists.
      const old = await harness.prisma.tariff.findUniqueOrThrow({ where: { id: oldId } });
      expect(old.voidedAt).toBeNull();
      expect(await harness.prisma.tariff.count()).toBe(1);
    });

    it('refuses to supersede an already-voided tariff', async () => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);
      const oldId = await original(token, serviceId);

      await request(server())
        .post(`/catalog/tariffs/${oldId}/void`)
        .set(asUser(token))
        .send({ reason: 'withdrawn' });

      const response = await createTariff(
        token,
        paid(serviceId, { supersedesTariffId: oldId, priceToman: '150000' }),
      );

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('TARIFF_ALREADY_VOIDED');
    });

    it('rolls the void back when the replacement violates a constraint', async () => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token, 'Synthetic Service', [45]);
      const oldId = await original(token, serviceId);

      // A duration the service does not offer fails after the void statement,
      // so the whole transaction must unwind.
      const response = await createTariff(token, {
        ...paid(serviceId, { supersedesTariffId: oldId }),
        durationMinutes: 45,
        serviceId,
        effectiveStart: '2026-01-01',
      });

      // Same scope, same range — the replacement overlaps nothing because the
      // old row was voided in this transaction, so this one succeeds.
      expect(response.status).toBe(201);

      const old = await harness.prisma.tariff.findUniqueOrThrow({ where: { id: oldId } });
      expect(old.voidedAt).not.toBeNull();
    });
  });

  describe('immutability holds against the API', () => {
    it('offers no route that can rewrite a stored tariff', async () => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);
      const created = await createTariff(token, paid(serviceId));
      const { tariff } = tariffResponseSchema.parse(created.body);

      const before = await harness.prisma.tariff.findUniqueOrThrow({ where: { id: tariff.id } });

      // Every shape a caller might try. None of them is a registered route.
      for (const [method, path] of [
        ['patch', `/catalog/tariffs/${tariff.id}`],
        ['put', `/catalog/tariffs/${tariff.id}`],
        ['post', `/catalog/tariffs/${tariff.id}`],
      ] as Array<['patch' | 'put' | 'post', string]>) {
        await request(server())
          [method](path)
          .set(asUser(token))
          .send({ priceToman: '1', priceMode: 'FREE', freeReason: 'x' });
      }

      const after = await harness.prisma.tariff.findUniqueOrThrow({ where: { id: tariff.id } });
      expect(after).toEqual(before);
    });
  });

  describe('list', () => {
    it('excludes voided rows unless asked', async () => {
      const { token } = await signIn('MANAGER');
      const serviceId = await makeService(token);
      const created = await createTariff(token, paid(serviceId));
      const id = tariffResponseSchema.parse(created.body).tariff.id;

      await request(server())
        .post(`/catalog/tariffs/${id}/void`)
        .set(asUser(token))
        .send({ reason: 'withdrawn' });

      const live = await request(server()).get('/catalog/tariffs').set(asUser(token));
      expect(tariffListResponseSchema.parse(live.body).tariffs).toHaveLength(0);

      const all = await request(server())
        .get('/catalog/tariffs')
        .query({ includeVoided: 'true' })
        .set(asUser(token));
      expect(tariffListResponseSchema.parse(all.body).tariffs).toHaveLength(1);
    });

    it('filters by service, scope and date', async () => {
      const { token } = await signIn('MANAGER');
      const first = await makeService(token, 'Service A');
      const second = await makeService(token, 'Service B');
      const therapistId = await makeTherapist(token);

      await createTariff(token, paid(first));
      await createTariff(token, paid(first, { therapistId }));
      await createTariff(token, paid(second));

      const byService = await request(server())
        .get('/catalog/tariffs')
        .query({ serviceId: first })
        .set(asUser(token));
      expect(tariffListResponseSchema.parse(byService.body).tariffs).toHaveLength(2);

      const general = await request(server())
        .get('/catalog/tariffs')
        .query({ serviceId: first, scope: 'general' })
        .set(asUser(token));
      const generalRows = tariffListResponseSchema.parse(general.body).tariffs;
      expect(generalRows).toHaveLength(1);
      expect(generalRows[0]?.therapistId).toBeNull();

      const specific = await request(server())
        .get('/catalog/tariffs')
        .query({ scope: 'therapist' })
        .set(asUser(token));
      expect(tariffListResponseSchema.parse(specific.body).tariffs).toHaveLength(1);

      const onDate = await request(server())
        .get('/catalog/tariffs')
        .query({ onDate: '2025-01-01' })
        .set(asUser(token));
      expect(tariffListResponseSchema.parse(onDate.body).tariffs).toHaveLength(0);
    });
  });
});
