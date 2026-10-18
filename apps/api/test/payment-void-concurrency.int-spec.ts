import { PrismaClient } from '@prisma/client';
import { paymentResponseSchema, type Payment } from '@clinic/contracts';
import { createHarness, resetDatabase, testDatabaseUrl, type Harness } from './harness';
import { sqlStateOf } from './ledger-support';
import {
  clinicDay,
  fulfilPromise,
  insertPromise,
  recordPaymentOverHttp,
  seedPayingFamily,
  voidPaymentOverHttp,
  voidedPaymentAuditRows,
  type PaymentFixture,
} from './payment-support';

/**
 * What happens when a payment void meets another writer — checkpoint A4.
 *
 * EVERYTHING HERE IS SYNTHETIC.
 *
 * TWO FAILURES THIS SUITE EXISTS TO EXCLUDE. The first is a DUPLICATE FINANCIAL
 * CORRECTION: two voids of one payment, or one void with two audit rows, or a
 * second manager's reason quietly overwriting the first — none of them
 * recoverable afterwards, because financial history may not be rewritten. The
 * second is a DEADLOCK between a void and a promise fulfilment, which is what
 * would happen if the void path ever reached for a promise row.
 *
 * THE APPROVED LOCK ORDER IS `payment_promise -> payment`, and A4 keeps it by
 * never taking the second edge: the void takes `FOR UPDATE` on the payment and
 * nothing else, and its promise lookup is a plain unlocked `SELECT`. Fulfilment
 * takes the promise row and then `FOR SHARE` on the payment. No transaction ever
 * holds a payment lock while waiting for a promise lock, so no cycle can form —
 * which is the property the head-on rounds below assert rather than assume.
 *
 * THE FULFILMENT SIDE IS RAW SQL, deliberately: the promise runtime is A6 and
 * does not exist. The statement is the one the schema suites already established
 * as the fulfilment shape, so this races the void against the real trigger.
 *
 * Nothing is synchronised on a timer, as in every other concurrency suite here.
 */
describe('payment void concurrency (real PostgreSQL)', () => {
  let harness: Harness;
  let writer: PrismaClient;

  beforeAll(async () => {
    harness = await createHarness();
    writer = new PrismaClient({ datasources: { db: { url: testDatabaseUrl() } } });
    await writer.$connect();
  });

  afterAll(async () => {
    await writer.$disconnect();
    await harness.close();
  });

  let fixture: PaymentFixture;

  beforeEach(async () => {
    await resetDatabase();
    fixture = await seedPayingFamily(harness);
  });

  async function record(amountToman = '250000'): Promise<Payment> {
    const response = await recordPaymentOverHttp(harness, fixture.managerToken, fixture.familyId, {
      amountToman,
      method: 'CASH',
      receivedOn: await clinicDay(harness),
    }).expect(200);

    return paymentResponseSchema.parse(response.body).payment;
  }

  async function paymentVoidState(
    paymentId: string,
  ): Promise<{ voided_at: Date | null; void_reason: string | null }> {
    const rows = await harness.prisma.$queryRaw<
      { voided_at: Date | null; void_reason: string | null }[]
    >`
      SELECT voided_at, void_reason FROM payment WHERE id = ${paymentId}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new Error(`payment ${paymentId} is missing`);
    return row;
  }

  /**
   * Returns once at least one backend is waiting on a lock for a query matching
   * `pattern`.
   *
   * A condition, not a duration: it returns the instant the state is reached and
   * fails loudly if it never is, exactly as the A1 concurrency suite established.
   */
  async function waitUntilBlocked(pattern: string): Promise<void> {
    for (let attempt = 0; attempt < 4000; attempt += 1) {
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

  /** No race may be answered with an unexplained 500 — a deadlock would surface as one. */
  const noInternalErrors = (...responses: { status: number }[]): void => {
    for (const response of responses) expect(response.status).not.toBe(500);
  };

  describe('two voids of the same payment', () => {
    it('lets exactly one win, with exactly one audit row', async () => {
      const payment = await record();

      const [first, second] = await Promise.all([
        voidPaymentOverHttp(harness, fixture.managerToken, payment.id, { reason: 'دلیل الف' }),
        voidPaymentOverHttp(harness, fixture.managerToken, payment.id, { reason: 'دلیل ب' }),
      ]);

      noInternalErrors(first, second);

      const statuses = [first.status, second.status].sort((a, b) => a - b);
      expect(statuses).toEqual([200, 409]);

      const refused = first.status === 409 ? first : second;
      expect(refused.body.error.code).toBe('PAYMENT_ALREADY_VOIDED');

      // ONE financial transition, and the winner's reason stands untouched: the
      // loser serialised on the row lock, re-read `voided_at` after the winner
      // committed, and wrote nothing.
      const winner = first.status === 200 ? first : second;
      const state = await paymentVoidState(payment.id);
      expect(state.voided_at).not.toBeNull();
      expect(state.void_reason).toBe(paymentResponseSchema.parse(winner.body).payment.voidReason);
      expect(['دلیل الف', 'دلیل ب']).toContain(state.void_reason);

      // ONE audit fact. Two would be two recorded corrections of one payment.
      expect(await voidedPaymentAuditRows(harness, payment.id)).toHaveLength(1);
    }, 30000);

    it('keeps that true across repeated rounds', async () => {
      for (let round = 0; round < 5; round += 1) {
        await resetDatabase();
        fixture = await seedPayingFamily(harness);

        const payment = await record();

        const responses = await Promise.all([
          voidPaymentOverHttp(harness, fixture.managerToken, payment.id, { reason: 'دلیل الف' }),
          voidPaymentOverHttp(harness, fixture.managerToken, payment.id, { reason: 'دلیل ب' }),
          voidPaymentOverHttp(harness, fixture.managerToken, payment.id, { reason: 'دلیل ج' }),
        ]);

        noInternalErrors(...responses);

        expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
        expect(responses.filter((response) => response.status === 409)).toHaveLength(2);
        expect(await voidedPaymentAuditRows(harness, payment.id)).toHaveLength(1);
      }
    }, 60000);
  });

  describe('a void racing a promise fulfilment', () => {
    /** The fulfilment statement A6 will make: promise row first, payment `FOR SHARE` second. */
    const fulfilOn = (client: PrismaClient, promiseId: string, paymentId: string) =>
      client.$executeRaw`
        UPDATE payment_promise
           SET status = 'FULFILLED',
               fulfilling_payment_id = ${paymentId}::uuid,
               resolved_at = transaction_timestamp(),
               resolved_by_user_id = ${fixture.managerId}::uuid
         WHERE id = ${promiseId}::uuid
      `;

    it('refuses a fulfilment whose payment the void already took', async () => {
      const payment = await record();
      const promiseId = await insertPromise(harness, fixture, { amountToman: '250000' });

      await voidPaymentOverHttp(harness, fixture.managerToken, payment.id).expect(200);

      // 23001 is `restrict_violation`: the trigger reads the payment `FOR SHARE`
      // and finds it voided. The promise is untouched.
      expect(await sqlStateOf(fulfilOn(writer, promiseId, payment.id))).toBe('23001');

      const promise = await harness.prisma.paymentPromise.findUniqueOrThrow({
        where: { id: promiseId },
      });
      expect(promise.status).toBe('OPEN');
      expect(promise.fulfillingPaymentId).toBeNull();
    }, 30000);

    it('lets the void proceed when the fulfilment got there first, and records the link', async () => {
      const payment = await record();
      const promiseId = await insertPromise(harness, fixture, { amountToman: '250000' });

      await fulfilPromise(harness, fixture, promiseId, payment.id);

      const response = await voidPaymentOverHttp(harness, fixture.managerToken, payment.id, {
        reason: 'واریز تکراری خانواده',
      });
      expect(response.status).toBe(200);
      expect(paymentResponseSchema.parse(response.body).payment.status).toBe('VOIDED');

      // The promise stays terminal — nothing un-fulfils it — and the void audit
      // is the only place the consequence is written down.
      const promise = await harness.prisma.paymentPromise.findUniqueOrThrow({
        where: { id: promiseId },
      });
      expect(promise.status).toBe('FULFILLED');
      expect(promise.fulfillingPaymentId).toBe(payment.id);

      const [audit] = await voidedPaymentAuditRows(harness, payment.id);
      expect((audit?.metadata as Record<string, unknown>)['fulfilledPromiseId']).toBe(promiseId);
    }, 30000);

    it('waits for an in-flight fulfilment rather than slipping past its check', async () => {
      const payment = await record();
      const promiseId = await insertPromise(harness, fixture, { amountToman: '250000' });

      let racingVoid!: Promise<{ status: number; body: { payment?: unknown } }>;

      await writer.$transaction(async (tx) => {
        // Takes the promise row lock, then `FOR SHARE` on the payment, and holds
        // both until this transaction commits.
        await tx.$executeRaw`
          UPDATE payment_promise
             SET status = 'FULFILLED',
                 fulfilling_payment_id = ${payment.id}::uuid,
                 resolved_at = transaction_timestamp(),
                 resolved_by_user_id = ${fixture.managerId}::uuid
           WHERE id = ${promiseId}::uuid
        `;

        racingVoid = voidPaymentOverHttp(harness, fixture.managerToken, payment.id, {
          reason: 'ابطال همزمان',
        }).then((response) => response);

        // Prove the void really is waiting, and waiting on the statement that
        // takes its ONE lock: `lockPaymentRow`'s `SELECT ... FOR UPDATE`, which
        // conflicts with the fulfilment's `FOR SHARE` on the same row. The last
        // lock in the approved order, and the only one this path takes — so the
        // ordering under test is a fact rather than an assumption.
        await waitUntilBlocked('%FROM payment WHERE id%FOR UPDATE%');
      });

      // The share lock is released and the void proceeds. It was never refused:
      // voiding a payment is always available, which is exactly why the
      // fulfilment check is not re-run on this side.
      const response = await racingVoid;
      expect(response.status).toBe(200);

      // Having waited, it sees the committed fulfilment and names it — which is
      // what makes the unlocked promise lookup correct rather than merely cheap.
      const [audit] = await voidedPaymentAuditRows(harness, payment.id);
      expect((audit?.metadata as Record<string, unknown>)['fulfilledPromiseId']).toBe(promiseId);
    }, 30000);

    it('lands on one of the two coherent outcomes when the two run head-on', async () => {
      // Repeated, because a race that lands the same way every time proves only
      // one of the two branches.
      for (let round = 0; round < 6; round += 1) {
        await resetDatabase();
        fixture = await seedPayingFamily(harness);

        const payment = await record();
        const promiseId = await insertPromise(harness, fixture, { amountToman: '250000' });

        const [fulfilment, voided] = await Promise.all([
          fulfilOn(writer, promiseId, payment.id).then(
            () => null,
            (error: unknown) => error as { meta?: { code?: string }; code?: string },
          ),
          voidPaymentOverHttp(harness, fixture.managerToken, payment.id, {
            reason: 'ابطال همزمان',
          }),
        ]);

        noInternalErrors(voided);

        // 40P01 is `deadlock_detected`. Neither writer may ever see it: nothing
        // takes `payment -> payment_promise`, so no cycle exists to detect.
        const state = fulfilment?.meta?.code ?? fulfilment?.code;
        expect(state).not.toBe('40P01');

        // Voiding a payment is ALWAYS available — that is the whole reason the
        // fulfilment check is not re-run on the payment side — so the void wins
        // in both branches, and the fulfilment is what varies.
        expect(voided.status).toBe(200);
        expect((await paymentVoidState(payment.id)).voided_at).not.toBeNull();

        const promise = await harness.prisma.paymentPromise.findUniqueOrThrow({
          where: { id: promiseId },
        });
        const [audit] = await voidedPaymentAuditRows(harness, payment.id);
        const named = (audit?.metadata as Record<string, unknown>)['fulfilledPromiseId'];

        if (fulfilment === null) {
          // The fulfilment committed first: the payment was live when its
          // trigger checked it, the promise is terminal, and the void audit
          // names it so the stale evidence is traceable.
          expect(promise.status).toBe('FULFILLED');
          expect(promise.fulfillingPaymentId).toBe(payment.id);
          expect(named).toBe(promiseId);
        } else {
          // The void committed first: the fulfilment was REFUSED by the trigger
          // rather than recorded against voided money, and the promise is
          // exactly as it was.
          expect(state).toBe('23001');
          expect(promise.status).toBe('OPEN');
          expect(promise.fulfillingPaymentId).toBeNull();
          expect(named).toBeNull();
        }

        // ONE audit row either way.
        expect(await voidedPaymentAuditRows(harness, payment.id)).toHaveLength(1);
      }
    }, 90000);
  });
});
