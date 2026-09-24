import { PrismaClient } from '@prisma/client';
import { createHarness, resetDatabase, testDatabaseUrl, type Harness } from './harness';
import { sqlStateOf } from './ledger-support';
import {
  clinicDay,
  fulfilPromise,
  insertPayment,
  insertPromise,
  reschedulePromise,
  seedPayingFamily,
  voidPayment,
  type PaymentFixture,
} from './payment-support';

/**
 * What happens when two writers touch a promise and a payment at once.
 *
 * THE ORDER UNDER TEST is the approved one: `payment_promise -> payment`, taken
 * by the only operation that needs both rows. Fulfilment is an UPDATE on the
 * promise — which takes that row lock first — and its trigger then takes
 * `FOR SHARE` on the payment. NOTHING GOES THE OTHER WAY: voiding a payment
 * touches no promise at all, which is what makes a deadlock between the two
 * operations structurally impossible rather than merely unobserved.
 *
 * The writers here are SEPARATE PRISMA CLIENTS, so each has its own connection
 * and the two really do run concurrently against PostgreSQL. Synchronisation is
 * on an observable database condition, never on a timer, exactly as
 * `ledger-concurrency.int-spec.ts` established.
 *
 * All of this is enforced by the database and none of it by a service, because
 * in checkpoint A1 there is no service. That is the point.
 */
describe('payment concurrency (real PostgreSQL)', () => {
  let harness: Harness;
  let writerA: PrismaClient;
  let writerB: PrismaClient;

  beforeAll(async () => {
    harness = await createHarness();

    const datasources = { db: { url: testDatabaseUrl() } };
    writerA = new PrismaClient({ datasources });
    writerB = new PrismaClient({ datasources });
    await Promise.all([writerA.$connect(), writerB.$connect()]);
  });

  afterAll(async () => {
    await Promise.all([writerA.$disconnect(), writerB.$disconnect()]);
    await harness.close();
  });

  let fixture: PaymentFixture;

  beforeEach(async () => {
    await resetDatabase();
    fixture = await seedPayingFamily(harness);
  });

  /**
   * Returns once at least one backend is waiting on a lock for a query matching
   * `pattern`.
   *
   * A condition, not a duration: it returns the instant the state is reached and
   * fails loudly if it never is.
   */
  async function waitUntilBlocked(pattern: string): Promise<void> {
    for (let attempt = 0; attempt < 2000; attempt += 1) {
      const rows = await harness.prisma.$queryRaw<{ blocked: bigint }[]>`
        SELECT count(*) AS blocked
        FROM pg_stat_activity
        WHERE wait_event_type = 'Lock'
          AND state = 'active'
          AND query ILIKE ${pattern}
      `;

      if (Number(rows[0]?.blocked ?? 0) >= 1) return;

      await new Promise((resolve) => setImmediate(resolve));
    }

    throw new Error(`No statement ever blocked on a lock matching ${pattern}`);
  }

  function fulfilOn(client: PrismaClient, promiseId: string, paymentId: string): Promise<number> {
    return client.$executeRaw`
      UPDATE payment_promise
         SET status = 'FULFILLED',
             fulfilling_payment_id = ${paymentId}::uuid,
             resolved_at = transaction_timestamp(),
             resolved_by_user_id = ${fixture.managerId}::uuid
       WHERE id = ${promiseId}::uuid
    `;
  }

  function voidOn(client: PrismaClient, paymentId: string): Promise<number> {
    return client.$executeRaw`
      UPDATE payment
         SET voided_at = transaction_timestamp(),
             voided_by_user_id = ${fixture.managerId}::uuid,
             void_reason = 'ابطال همزمان'
       WHERE id = ${paymentId}::uuid
    `;
  }

  it('never lets a voided payment end up recorded as a fulfilment', async () => {
    const paymentId = await insertPayment(harness, fixture, { amountToman: '250000' });
    const promiseId = await insertPromise(harness, fixture, { amountToman: '250000' });

    // Fired with no coordination at all, on two connections. Either order is
    // legitimate; the invariant is what must hold in both.
    await Promise.allSettled([fulfilOn(writerA, promiseId, paymentId), voidOn(writerB, paymentId)]);

    const promise = await harness.prisma.paymentPromise.findUniqueOrThrow({
      where: { id: promiseId },
    });
    const payment = await harness.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });

    // If the fulfilment won, the payment was live when it was checked and the
    // void came afterwards — a separate, later fact. If the void won, the
    // fulfilment must have been REFUSED: what may never exist is a promise that
    // became FULFILLED against a payment already voided when it was checked.
    if (promise.status === 'FULFILLED') {
      expect(promise.fulfillingPaymentId).toBe(paymentId);
    } else {
      expect(promise.status).toBe('OPEN');
      expect(payment.voidedAt).not.toBeNull();
    }
  }, 30000);

  it('makes a void wait for an in-flight fulfilment rather than slipping past its check', async () => {
    const paymentId = await insertPayment(harness, fixture, { amountToman: '250000' });
    const promiseId = await insertPromise(harness, fixture, { amountToman: '250000' });

    let racingVoid!: Promise<unknown>;

    await writerA.$transaction(async (tx) => {
      // The fulfilment takes the promise row lock, then FOR SHARE on the
      // payment, and holds both until this transaction commits.
      await tx.$executeRaw`
        UPDATE payment_promise
           SET status = 'FULFILLED',
               fulfilling_payment_id = ${paymentId}::uuid,
               resolved_at = transaction_timestamp(),
               resolved_by_user_id = ${fixture.managerId}::uuid
         WHERE id = ${promiseId}::uuid
      `;

      racingVoid = voidOn(writerB, paymentId).catch((error: unknown) => error);

      // Prove the void really is waiting on the payment row — the LAST lock in
      // the approved order — before committing, so the ordering under test is a
      // fact rather than an assumption.
      await waitUntilBlocked('%payment%');
    });

    // The share lock is released and the void proceeds. It was never refused:
    // voiding a payment is always available, which is exactly why the fulfilment
    // check is not re-run here.
    await racingVoid;

    expect(
      (await harness.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).voidedAt,
    ).not.toBeNull();
    expect(
      (await harness.prisma.paymentPromise.findUniqueOrThrow({ where: { id: promiseId } })).status,
    ).toBe('FULFILLED');
  }, 30000);

  it('lets exactly one of two promises claim the same payment', async () => {
    const paymentId = await insertPayment(harness, fixture, { amountToman: '400000' });
    const first = await insertPromise(harness, fixture, { amountToman: '250000' });
    const second = await insertPromise(harness, fixture, { amountToman: '250000' });

    const results = await Promise.allSettled([
      fulfilOn(writerA, first, paymentId),
      fulfilOn(writerB, second, paymentId),
    ]);

    // The unique index decides it, correctly, without either writer holding a
    // lock the other has to wait on for the check itself.
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);

    expect(await harness.prisma.paymentPromise.count({ where: { status: 'FULFILLED' } })).toBe(1);
  }, 30000);

  it('never deadlocks when a fulfilment and a reschedule run against each other', async () => {
    // The two operations that take more than one row: fulfilment takes
    // `payment_promise -> payment`, rescheduling takes predecessor -> successor
    // within `payment_promise`. Run head-on, repeatedly, in both directions.
    for (let round = 0; round < 5; round += 1) {
      await resetDatabase();
      fixture = await seedPayingFamily(harness);

      const paymentId = await insertPayment(harness, fixture, { amountToman: '400000' });
      const promiseA = await insertPromise(harness, fixture, { amountToman: '250000' });
      const promiseB = await insertPromise(harness, fixture, { amountToman: '250000' });
      const successor = await insertPromise(harness, fixture, {
        dueOn: await clinicDay(harness, 14),
      });

      const results = await Promise.allSettled([
        fulfilOn(writerA, promiseA, paymentId),
        writerB.$executeRaw`
          UPDATE payment_promise
             SET status = 'RESCHEDULED',
                 rescheduled_to_promise_id = ${successor}::uuid,
                 resolved_at = transaction_timestamp(),
                 resolved_by_user_id = ${fixture.managerId}::uuid,
                 resolution_reason = 'تغییر زمان همزمان'
           WHERE id = ${promiseB}::uuid
        `,
      ]);

      // 40P01 is `deadlock_detected`. Neither writer may ever see it: they
      // contend on nothing, because no path takes `payment -> payment_promise`.
      for (const result of results) {
        expect(result.status).toBe('fulfilled');
      }
    }
  }, 60000);

  it('keeps refusing a fulfilment whose payment was voided before it started', async () => {
    // The sequential statement of the same invariant, so the concurrent cases
    // above are read against a known baseline.
    const paymentId = await insertPayment(harness, fixture, { amountToman: '250000' });
    const promiseId = await insertPromise(harness, fixture, { amountToman: '250000' });

    await voidPayment(harness, fixture, paymentId);

    expect(await sqlStateOf(fulfilPromise(harness, fixture, promiseId, paymentId))).toBe('23001');
  }, 30000);

  it('lets two reschedules of different promises proceed together', async () => {
    const promiseA = await insertPromise(harness, fixture, { dueOn: await clinicDay(harness, -3) });
    const promiseB = await insertPromise(harness, fixture, { dueOn: await clinicDay(harness, -3) });
    const successorA = await insertPromise(harness, fixture, {
      dueOn: await clinicDay(harness, 14),
    });
    const successorB = await insertPromise(harness, fixture, {
      dueOn: await clinicDay(harness, 21),
    });

    const results = await Promise.allSettled([
      reschedulePromise(harness, fixture, promiseA, successorA),
      reschedulePromise(harness, fixture, promiseB, successorB),
    ]);

    // Serialising the ones that conflict must not mean refusing the ones that
    // do not.
    for (const result of results) expect(result.status).toBe('fulfilled');
    expect(await harness.prisma.paymentPromise.count({ where: { status: 'RESCHEDULED' } })).toBe(2);
  }, 30000);
});
