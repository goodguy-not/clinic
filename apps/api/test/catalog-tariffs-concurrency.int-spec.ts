import request from 'supertest';
import {
  loginResponseSchema,
  serviceResponseSchema,
  tariffResponseSchema,
  therapistResponseSchema,
} from '@clinic/contracts';
import {
  createHarness,
  internalHeaders,
  resetDatabase,
  seedUser,
  TEST_PASSWORD,
  type Harness,
} from './harness';

/**
 * What happens when two requests arrive at once.
 *
 * Every case here is synchronised on an observable database condition, never on
 * a timer. A `sleep` long enough to be reliable is slow, and one short enough
 * to be fast is a test that passes on a quiet machine and fails in CI — the
 * worst kind, because the failure looks like a defect in the code under test.
 *
 * Two mechanisms do the work:
 *
 *  - an uncommitted transaction held open by the test, which makes a lock
 *    conflict certain rather than likely;
 *  - `waitUntilBlocked`, which polls `pg_stat_activity` until the other request
 *    is provably waiting on a lock. That is a condition, not a duration: it
 *    returns as soon as the state is reached and fails loudly if it never is.
 */
describe('catalog tariff concurrency (real PostgreSQL)', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  const server = () => harness.app.getHttpServer();
  const asUser = (token: string) => internalHeaders({ 'x-session-id': token });

  async function signIn() {
    const user = await seedUser(harness, { role: 'MANAGER' });
    const response = await request(server())
      .post('/auth/login')
      .set(internalHeaders())
      .send({ username: user.username, password: TEST_PASSWORD });

    return { user, token: loginResponseSchema.parse(response.body).sessionToken };
  }

  async function makeService(token: string, name = 'Synthetic Service') {
    const response = await request(server())
      .post('/catalog/services')
      .set(asUser(token))
      .send({
        name,
        publicDescription: null,
        isPublic: false,
        allowedDurationsMinutes: [45],
      });

    return serviceResponseSchema.parse(response.body).service.id;
  }

  async function makeTherapist(token: string) {
    const response = await request(server())
      .post('/catalog/therapists')
      .set(asUser(token))
      .send({ fullName: 'Synthetic Therapist', specialty: 'Synthetic', supportedServiceIds: [] });

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

  const createTariff = (token: string, body: Record<string, unknown>) =>
    request(server()).post('/catalog/tariffs').set(asUser(token)).send(body);

  /**
   * Returns once at least `count` backends are waiting on a lock for a query
   * matching `pattern`.
   *
   * The bound is an iteration count rather than a deadline so a failure says
   * "this never happened", not "this was slow". Each iteration is one cheap
   * round trip, so reaching the bound means the condition genuinely never held.
   */
  async function waitUntilBlocked(pattern: string, count = 1): Promise<void> {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const rows = await harness.prisma.$queryRaw<{ blocked: bigint }[]>`
        SELECT count(*) AS blocked
        FROM pg_stat_activity
        WHERE wait_event_type = 'Lock'
          AND state = 'active'
          AND query ILIKE ${pattern}
      `;

      if (Number(rows[0]?.blocked ?? 0) >= count) return;

      // Yield to the event loop so the in-flight request can progress. Not a
      // delay: the next iteration re-checks the same condition immediately.
      await new Promise((resolve) => setImmediate(resolve));
    }

    throw new Error(`No request ever blocked on a lock matching ${pattern}`);
  }

  describe('creation races a deactivation', () => {
    it.each([
      ['service', 'SERVICE_INACTIVE'],
      ['therapist', 'THERAPIST_INACTIVE'],
    ])(
      'fails with %s when the deactivation commits first',
      async (entity, code) => {
        const { token } = await signIn();
        const serviceId = await makeService(token);
        const therapistId = await makeTherapist(token);

        const table = entity === 'service' ? 'service' : 'therapist';
        const targetId = entity === 'service' ? serviceId : therapistId;

        let inFlight!: Promise<request.Response>;

        await harness.prisma.$transaction(async (tx) => {
          // Deactivate inside a transaction the test controls, and hold it open.
          // The row's exclusive lock is taken; the change is not yet visible.
          await tx.$executeRawUnsafe(
            `UPDATE ${table} SET status = 'INACTIVE'::catalog_status,
               deactivated_at = transaction_timestamp() WHERE id = $1::uuid`,
            targetId,
          );

          // `.then` is what dispatches a supertest request — assigning it alone
          // builds the request without sending it, and nothing would ever block.
          inFlight = createTariff(token, paid(serviceId, { therapistId })).then(
            (response) => response,
          );

          // Prove it really is waiting on this row before committing, so the
          // ordering under test is a fact rather than an assumption.
          await waitUntilBlocked(`%FROM ${table}%FOR SHARE%`);
        });

        // The transaction has now committed and released the lock, so the
        // creation resumes and sees a service that is committed-inactive.
        const created = await inFlight;

        expect(created.status).toBe(422);
        expect(created.body.error.code).toBe(code);

        // Nothing was written, and nothing claims it was.
        expect(await harness.prisma.tariff.count()).toBe(0);
        expect(await harness.prisma.auditLog.count({ where: { entityType: 'tariff' } })).toBe(0);
      },
      30000,
    );

    /**
     * The opposite ordering.
     *
     * Deliberately sequential rather than a contrived race. Making the creation
     * provably win a simultaneous race would mean holding a share lock to stall
     * the deactivation, and a queued exclusive waiter can block later share
     * requests — the test would be racing PostgreSQL's own wait queue and could
     * hang. The semantics under test are about the outcome, and this states them
     * exactly: a creation that commits while the service is active stays valid,
     * and the deactivation applies afterwards without disturbing it.
     */
    it('keeps a tariff that committed while the service was still active', async () => {
      const { token } = await signIn();
      const serviceId = await makeService(token);

      const created = await createTariff(token, paid(serviceId));
      expect(created.status).toBe(201);

      const deactivated = await request(server())
        .patch(`/catalog/services/${serviceId}/status`)
        .set(asUser(token))
        .send({ status: 'INACTIVE' });
      expect(deactivated.status).toBe(200);

      // Both are true, in that order: the tariff survives, and the service is
      // inactive. Deactivation is not retroactive.
      expect(await harness.prisma.tariff.count()).toBe(1);
      const service = await harness.prisma.service.findUniqueOrThrow({ where: { id: serviceId } });
      expect(service.status).toBe('INACTIVE');

      // And the price it recorded still resolves for a date it covers.
      const resolution = await request(server())
        .get('/catalog/tariff-resolution')
        .query({ serviceId, durationMinutes: 45, serviceDate: '2026-03-15' })
        .set(asUser(token));
      expect(resolution.status).toBe(200);
    }, 30000);

    it('never creates a tariff against a service that was already committed inactive', async () => {
      const { token } = await signIn();
      const serviceId = await makeService(token);

      // Fired together with no coordination at all. Either order is legitimate;
      // the invariant is what must hold in both.
      const [creation] = await Promise.all([
        createTariff(token, paid(serviceId)),
        request(server())
          .patch(`/catalog/services/${serviceId}/status`)
          .set(asUser(token))
          .send({ status: 'INACTIVE' }),
      ]);

      const tariffs = await harness.prisma.tariff.count();

      if (creation.status === 201) {
        expect(tariffs).toBe(1);
      } else {
        expect(creation.status).toBe(422);
        expect(creation.body.error.code).toBe('SERVICE_INACTIVE');
        expect(tariffs).toBe(0);
      }
    }, 30000);
  });

  describe('two overlapping creations', () => {
    it('lets exactly one succeed and refuses the other with TARIFF_OVERLAP', async () => {
      const { token } = await signIn();
      const serviceId = await makeService(token);

      const results = await Promise.allSettled([
        createTariff(token, paid(serviceId, { priceToman: '100000' })),
        createTariff(token, paid(serviceId, { priceToman: '200000' })),
      ]);

      const responses = results.map((result) =>
        result.status === 'fulfilled' ? result.value : undefined,
      );

      const created = responses.filter((response) => response?.status === 201);
      const refused = responses.filter((response) => response?.status === 409);

      // The EXCLUDE constraint decides this, not an application pre-check: the
      // second inserter blocks until the first commits, then is refused.
      expect(created).toHaveLength(1);
      expect(refused).toHaveLength(1);
      expect(refused[0]?.body.error.code).toBe('TARIFF_OVERLAP');

      expect(await harness.prisma.tariff.count()).toBe(1);
      // Exactly one audit row: the loser's transaction took its own with it.
      expect(await harness.prisma.auditLog.count({ where: { action: 'tariff.created' } })).toBe(1);
    }, 30000);

    it('lets a general and a therapist-specific creation both succeed', async () => {
      const { token } = await signIn();
      const serviceId = await makeService(token);
      const therapistId = await makeTherapist(token);

      const results = await Promise.all([
        createTariff(token, paid(serviceId)),
        createTariff(token, paid(serviceId, { therapistId })),
      ]);

      // Different scopes, so the two exclusion constraints do not see each
      // other. Refusing one here would break price precedence.
      for (const response of results) expect(response.status).toBe(201);
      expect(await harness.prisma.tariff.count()).toBe(2);
    }, 30000);
  });

  describe('two writers target one tariff', () => {
    async function seedTariff(token: string, serviceId: string): Promise<string> {
      const created = await createTariff(token, paid(serviceId));
      return tariffResponseSchema.parse(created.body).tariff.id;
    }

    function expectExactlyOneWinner(
      responses: Array<request.Response | undefined>,
      successStatus: number,
    ): void {
      const won = responses.filter((response) => response?.status === successStatus);
      const lost = responses.filter((response) => response?.status === 409);

      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect(lost[0]?.body.error.code).toBe('TARIFF_ALREADY_VOIDED');
    }

    async function settled(
      promises: Array<Promise<request.Response>>,
    ): Promise<Array<request.Response | undefined>> {
      const results = await Promise.allSettled(promises);
      return results.map((result) => (result.status === 'fulfilled' ? result.value : undefined));
    }

    it('two simultaneous voids produce exactly one success', async () => {
      const { token } = await signIn();
      const serviceId = await makeService(token);
      const id = await seedTariff(token, serviceId);

      const responses = await settled([
        request(server())
          .post(`/catalog/tariffs/${id}/void`)
          .set(asUser(token))
          .send({ reason: 'first writer' }),
        request(server())
          .post(`/catalog/tariffs/${id}/void`)
          .set(asUser(token))
          .send({ reason: 'second writer' }),
      ]);

      expectExactlyOneWinner(responses, 200);

      // One void, one audit row. The loser blocked on the row lock, re-read the
      // committed `voided_at`, and refused rather than voiding twice.
      const row = await harness.prisma.tariff.findUniqueOrThrow({ where: { id } });
      expect(row.voidedAt).not.toBeNull();
      expect(
        await harness.prisma.auditLog.count({ where: { entityId: id, action: 'tariff.voided' } }),
      ).toBe(1);
    }, 30000);

    it('a void racing a supersede produces exactly one success', async () => {
      const { token } = await signIn();
      const serviceId = await makeService(token);
      const id = await seedTariff(token, serviceId);

      const responses = await settled([
        request(server())
          .post(`/catalog/tariffs/${id}/void`)
          .set(asUser(token))
          .send({ reason: 'withdrawn' }),
        createTariff(token, paid(serviceId, { priceToman: '150000', supersedesTariffId: id })),
      ]);

      const won = responses.filter(
        (response) => response?.status === 200 || response?.status === 201,
      );
      const lost = responses.filter((response) => response?.status === 409);

      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect(lost[0]?.body.error.code).toBe('TARIFF_ALREADY_VOIDED');

      expect(
        await harness.prisma.auditLog.count({ where: { entityId: id, action: 'tariff.voided' } }),
      ).toBe(1);
    }, 30000);

    it('two simultaneous supersedes produce exactly one success', async () => {
      const { token } = await signIn();
      const serviceId = await makeService(token);
      const id = await seedTariff(token, serviceId);

      const responses = await settled([
        createTariff(token, paid(serviceId, { priceToman: '150000', supersedesTariffId: id })),
        createTariff(token, paid(serviceId, { priceToman: '160000', supersedesTariffId: id })),
      ]);

      expectExactlyOneWinner(responses, 201);

      // The original is voided once, and exactly one replacement exists.
      expect(
        await harness.prisma.auditLog.count({ where: { entityId: id, action: 'tariff.voided' } }),
      ).toBe(1);
      expect(await harness.prisma.tariff.count({ where: { supersedesTariffId: id } })).toBe(1);
      expect(await harness.prisma.tariff.count()).toBe(2);
    }, 30000);
  });
});
