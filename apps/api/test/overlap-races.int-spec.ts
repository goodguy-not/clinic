import request from 'supertest';
import { createHarness, resetDatabase, type Harness } from './harness';
import {
  asUser,
  book,
  bookingPayload,
  makeFamilyWithChild,
  makeService,
  makeTherapist,
  seedClinic,
  signIn,
} from './appointments-support';

/**
 * Simultaneous overlapping writes never answer 500 (M10-A10: the tariff race
 * from M10-A9, and every other exclusion-constrained write).
 *
 * WHY THIS COULD FAIL. An exclusion constraint is checked after the row's index
 * entry is written, so two transactions inserting conflicting rows at the same
 * instant can each wait for the other; PostgreSQL's deadlock detector then
 * aborts one with 40P01, which no translation recognised, and the caller saw
 * `INTERNAL_ERROR`. The fix serialises the writers of one scope on an advisory
 * lock taken just before the write (`lockScope`).
 *
 * HOW THE RACE IS MADE REAL. Requests sent "together" over HTTP rarely reach
 * the INSERT in the same instant, so a suite that only fires them in parallel
 * passes by luck. Each round here holds a BARRIER: the row every writer first
 * locks `FOR SHARE` is held `FOR UPDATE` by the test until every writer is
 * queued behind it, then released — and all of them reach their write at once.
 * Without the scope lock this reproduced the deadlock in most rounds.
 *
 * Everything is synthetic.
 */
describe('overlapping writes under concurrency (real PostgreSQL)', () => {
  let harness: Harness;
  let manager: { id: string; token: string };

  const ROUNDS = 12;
  const WRITERS = 3;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    manager = await signIn(harness, 'MANAGER');
  });

  const server = () => harness.app.getHttpServer();

  /** Returns once `count` backends are waiting on a lock. */
  async function waitUntilQueued(count: number): Promise<void> {
    for (let attempt = 0; attempt < 2000; attempt += 1) {
      const rows = await harness.prisma.$queryRaw<{ queued: bigint }[]>`
        SELECT count(*) AS queued FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND state = 'active' AND query ILIKE '%FOR SHARE%'
      `;
      if (Number(rows[0]?.queued ?? 0) >= count) return;
      await new Promise((resolve) => setImmediate(resolve));
    }
    throw new Error(`Fewer than ${count} writers ever queued behind the barrier`);
  }

  /**
   * Sends every writer while `table`'s row `id` is held, waits until all of
   * them are queued behind it, then lets them go at once.
   */
  async function released(
    table: 'service' | 'therapist',
    id: string,
    writers: request.Test[],
  ): Promise<request.Response[]> {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    let held!: () => void;
    const holding = new Promise<void>((resolve) => (held = resolve));

    const barrier = harness.prisma.$transaction(
      async (tx) => {
        await tx.$queryRawUnsafe(`SELECT id FROM ${table} WHERE id = $1::uuid FOR UPDATE`, id);
        held();
        await gate;
      },
      { timeout: 60_000 },
    );

    await holding;
    const responses = Promise.all(writers);
    await waitUntilQueued(writers.length);
    open();
    await barrier;
    return responses;
  }

  /** Exactly one writer wins each round; every other one is refused with `code`. */
  function expectOneWinner(responses: request.Response[], code: string): void {
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, ...Array<number>(responses.length - 1).fill(409)]);
    for (const response of responses.filter((each) => each.status !== 201)) {
      expect(response.body.error.code).toBe(code);
    }
  }

  const tariff = (serviceId: string, therapistId: string | null, year: number, index: number) =>
    request(server())
      .post('/catalog/tariffs')
      .set(asUser(manager.token))
      .send({
        serviceId,
        durationMinutes: 45,
        therapistId,
        priceMode: 'PAID',
        priceToman: String(100000 + index * 1000),
        effectiveStart: `${year}-01-01`,
        effectiveEnd: `${year}-12-31`,
      });

  it('tariffs: one general tariff per scope, the rest TARIFF_OVERLAP, every round', async () => {
    const serviceId = await makeService(harness, manager.token);

    for (let round = 0; round < ROUNDS; round += 1) {
      const writers = Array.from({ length: WRITERS }, (_, index) =>
        tariff(serviceId, null, 2001 + round, index),
      );
      expectOneWinner(await released('service', serviceId, writers), 'TARIFF_OVERLAP');
    }

    expect(await harness.prisma.tariff.count()).toBe(ROUNDS);
  }, 180_000);

  it('tariffs: the same for a therapist-specific scope', async () => {
    const serviceId = await makeService(harness, manager.token);
    const therapistId = await makeTherapist(harness, manager.token, [serviceId]);

    for (let round = 0; round < ROUNDS; round += 1) {
      const writers = Array.from({ length: WRITERS }, (_, index) =>
        tariff(serviceId, therapistId, 2001 + round, index),
      );
      expectOneWinner(await released('service', serviceId, writers), 'TARIFF_OVERLAP');
    }
  }, 180_000);

  it('share rules: one live rule per therapist and range, the rest SHARE_RULE_OVERLAP', async () => {
    const serviceId = await makeService(harness, manager.token);
    const therapistId = await makeTherapist(harness, manager.token, [serviceId]);

    for (let round = 0; round < ROUNDS; round += 1) {
      const year = 2001 + round;
      const writers = Array.from({ length: WRITERS }, (_, index) =>
        request(server())
          .post('/settlement/share-rules')
          .set(asUser(manager.token))
          .send({
            therapistId,
            shareBasisPoints: 4000 + index * 100,
            effectiveStart: `${year}-01-01`,
            effectiveEnd: `${year}-12-31`,
          }),
      );
      expectOneWinner(await released('therapist', therapistId, writers), 'SHARE_RULE_OVERLAP');
    }
  }, 180_000);

  it('appointments: one booking per therapist and room hour, whoever the children are', async () => {
    const clinic = await seedClinic(harness, manager.token);
    const children = [clinic.childId];
    for (let index = 1; index < WRITERS; index += 1) {
      children.push((await makeFamilyWithChild(harness, manager.token)).childId);
    }

    for (let round = 0; round < ROUNDS; round += 1) {
      // A Saturday each round, inside the seeded 09:00–13:00 window.
      const startsAt = new Date(
        Date.parse('2026-09-05T06:30:00.000Z') + round * 7 * 86_400_000,
      ).toISOString();
      const writers = children.map((childId) =>
        book(harness, manager.token, bookingPayload(clinic, { childId, startsAt })),
      );
      const responses = await released('service', clinic.serviceId, writers);

      expectOneWinner(responses, 'APPOINTMENT_THERAPIST_CONFLICT');
      for (const loser of responses.filter((each) => each.status === 409)) {
        expect(
          loser.body.error.details.conflicts.map((c: { resource: string }) => c.resource),
        ).toEqual(['THERAPIST', 'ROOM']);
      }
    }
  }, 180_000);
});
