import request from 'supertest';
import {
  availabilityWindowListResponseSchema,
  loginResponseSchema,
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
 * What happens when two availability requests arrive at once.
 *
 * The case that matters is two managers saving one therapist's week. A
 * replacement is a DELETE followed by INSERTs, so without serialisation the two
 * can interleave into the union of both submissions — a week neither of them
 * asked for, and one the exclusion constraint cannot always catch, because two
 * disjoint sets do not overlap. The therapist row is therefore locked FOR UPDATE
 * for the whole transaction.
 *
 * As in the tariff concurrency suite, every case is synchronised on an
 * observable database condition and never on a timer.
 */
describe('availability concurrency (real PostgreSQL)', () => {
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

  async function signIn() {
    const user = await seedUser(harness, { role: 'MANAGER' });
    const response = await request(server())
      .post('/auth/login')
      .set(internalHeaders())
      .send({ username: user.username, password: TEST_PASSWORD });

    return { user, token: loginResponseSchema.parse(response.body).sessionToken };
  }

  async function makeTherapist(token: string) {
    const response = await request(server())
      .post('/catalog/therapists')
      .set(asUser(token))
      .send({ fullName: 'Synthetic Therapist', specialty: 'Synthetic', supportedServiceIds: [] });

    return therapistResponseSchema.parse(response.body).therapist.id;
  }

  function window(overrides: Record<string, unknown> = {}) {
    return { weekday: 0, startTime: '09:00', endTime: '13:00', ...overrides };
  }

  const putWindows = (token: string, therapistId: string, windows: unknown[]) =>
    request(server())
      .put(`/availability/therapists/${therapistId}/windows`)
      .set(asUser(token))
      .send({ windows });

  /** See the tariff concurrency suite: an iteration bound, not a deadline. */
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

      await new Promise((resolve) => setImmediate(resolve));
    }

    throw new Error(`No request ever blocked on a lock matching ${pattern}`);
  }

  it('serialises two replacements of one therapist’s week', async () => {
    const { token } = await signIn();
    const therapistId = await makeTherapist(token);

    // Two submissions that do not overlap each other at all. If they were to
    // interleave, both sets would survive and the constraint would permit it —
    // which is exactly why the lock, and not the constraint, is what this test
    // is about.
    const morning = [window({ weekday: 0 })];
    const evening = [window({ weekday: 3, startTime: '16:00', endTime: '19:00' })];

    const [first, second] = await Promise.all([
      putWindows(token, therapistId, morning),
      putWindows(token, therapistId, evening),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const listed = await request(server())
      .get(`/availability/therapists/${therapistId}/windows`)
      .set(asUser(token));

    const stored = availabilityWindowListResponseSchema.parse(listed.body).windows;

    // Last writer wins, whole. One of the two submissions is the week, and
    // never a union of both.
    expect(stored).toHaveLength(1);
    expect([0, 3]).toContain(stored[0]?.weekday);
  }, 30000);

  it('refuses a replacement when a deactivation commits first', async () => {
    const { token } = await signIn();
    const therapistId = await makeTherapist(token);

    let inFlight!: Promise<request.Response>;

    await harness.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
          UPDATE therapist
          SET status = 'INACTIVE'::catalog_status, deactivated_at = transaction_timestamp()
          WHERE id = ${therapistId}::uuid
        `;

      // `.then` is what dispatches a supertest request; assigning it alone
      // would build the request without sending it and nothing would block.
      inFlight = putWindows(token, therapistId, [window()]).then((response) => response);

      // Proves the replacement really is waiting on this row before the
      // deactivation commits, so the ordering under test is a fact.
      await waitUntilBlocked('%FROM therapist%FOR UPDATE%');
    });

    const replaced = await inFlight;

    expect(replaced.status).toBe(422);
    expect(replaced.body.error.code).toBe('THERAPIST_INACTIVE');

    // Nothing was written, and nothing claims it was.
    const rows = await harness.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count FROM therapist_availability
      `;
    expect(Number(rows[0]?.count ?? 0)).toBe(0);

    const audit = await harness.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count FROM audit_log WHERE action = 'therapist_availability.updated'
      `;
    expect(Number(audit[0]?.count ?? 0)).toBe(0);
  }, 30000);

  it('lets exactly one of two colliding exceptions through', async () => {
    const { token } = await signIn();
    const therapistId = await makeTherapist(token);

    const body = { isAvailable: false, exceptionDate: '2026-09-05', reason: null };

    const responses = await Promise.all([
      request(server())
        .post(`/availability/therapists/${therapistId}/exceptions`)
        .set(asUser(token))
        .send(body),
      request(server())
        .post(`/availability/therapists/${therapistId}/exceptions`)
        .set(asUser(token))
        .send(body),
    ]);

    const statuses = responses.map((response) => response.status).sort();

    expect(statuses).toEqual([201, 409]);

    const refused = responses.find((response) => response.status === 409);
    expect(refused?.body.error.code).toBe('AVAILABILITY_EXCEPTION_CONFLICT');

    const rows = await harness.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count FROM therapist_availability_exception
      `;
    expect(Number(rows[0]?.count ?? 0)).toBe(1);
  }, 30000);
});
