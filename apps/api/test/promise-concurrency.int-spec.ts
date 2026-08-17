import { promiseResponseSchema, type PaymentPromise } from '@clinic/contracts';
import { createHarness, resetDatabase, type Harness } from './harness';
import {
  cancelPromiseOverHttp,
  clinicDay,
  createPromiseOverHttp,
  fulfilPromiseOverHttp,
  promiseAuditRows,
  recordPaymentOverHttp,
  reschedulePromiseOverHttp,
  seedPayingFamily,
  voidPaymentOverHttp,
  type PaymentFixture,
} from './payment-support';

/**
 * What happens when two promise writers meet — checkpoint A6.
 *
 * EVERYTHING HERE IS SYNTHETIC.
 *
 * THREE FAILURES THIS SUITE EXISTS TO EXCLUDE:
 *
 *   * A MIXED OR DOUBLED TERMINAL STATE. A promise resolves exactly once, and
 *     financial history may not be rewritten afterwards — so two fulfilments, or
 *     a fulfilment racing a cancel, must leave one transition and one audit row,
 *     never a promise that is both.
 *   * ONE PAYMENT SPENT TWICE AS EVIDENCE. `fulfilling_payment_id` is unique, and
 *     the service must produce the frozen NAME for that race rather than a
 *     translated constraint violation or an unexplained 500.
 *   * A DEADLOCK. The approved order is `payment_promise -> payment`. Fulfilment
 *     takes the promise row and then the payment; a void takes the payment alone
 *     and never reaches for a promise; a reschedule stays inside
 *     `payment_promise`, predecessor then successor. No transaction ever holds a
 *     payment lock while waiting for a promise lock, so no cycle exists — which
 *     the rounds below assert rather than assume, by pinning that `40P01` never
 *     appears and that no race is answered with a 500.
 *
 * EVERY WRITER IS THE REAL HTTP ROUTE. Unlike the A4 suite, which had to raise
 * fulfilments in raw SQL because the promise runtime did not exist, this races
 * the runtime against itself — which is the whole point of proving the locking
 * design "under actual runtime callers".
 *
 * NOTHING IS SYNCHRONISED ON A TIMER, and there is no retry loop anywhere on
 * either side: a race that a retry papered over would prove nothing.
 */
describe('promise concurrency (real PostgreSQL)', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  // THERE IS NO SECOND PRISMA CLIENT HERE, unlike the A4 void suite. That one
  // needed a raw connection to raise a fulfilment because the promise runtime did
  // not exist; every writer below is an HTTP request against the real routes, and
  // Nest opens its own connection per transaction.

  let fixture: PaymentFixture;

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
    fixture = await seedPayingFamily(harness);
  });

  async function promise(amountToman = '250000', dueOffsetDays = 7): Promise<PaymentPromise> {
    const response = await createPromiseOverHttp(harness, fixture.managerToken, fixture.familyId, {
      amountToman,
      dueOn: await clinicDay(harness, dueOffsetDays),
    }).expect(200);

    return promiseResponseSchema.parse(response.body).promise;
  }

  async function payment(amountToman = '250000'): Promise<string> {
    const response = await recordPaymentOverHttp(harness, fixture.managerToken, fixture.familyId, {
      amountToman,
      method: 'CASH',
      receivedOn: await clinicDay(harness),
    }).expect(200);

    return response.body.payment.id as string;
  }

  async function storedPromise(promiseId: string) {
    return harness.prisma.paymentPromise.findUniqueOrThrow({ where: { id: promiseId } });
  }

  /** No race may be answered with an unexplained 500 — a deadlock would surface as one. */
  const noInternalErrors = (...responses: { status: number }[]): void => {
    for (const response of responses) expect(response.status).not.toBe(500);
  };

  /** Every transition audit row for one promise: the creation is excluded. */
  async function transitionAudits(promiseId: string): Promise<string[]> {
    const rows = await promiseAuditRows(harness, promiseId);
    return rows.map((row) => row.action).filter((action) => action !== 'payment_promise.created');
  }

  describe('two fulfilments of one promise', () => {
    it('lets exactly one win, with exactly one transition and one audit row', async () => {
      const open = await promise('250000');
      const first = await payment('250000');
      const second = await payment('250000');

      const [a, b] = await Promise.all([
        fulfilPromiseOverHttp(harness, fixture.managerToken, open.id, { paymentId: first }),
        fulfilPromiseOverHttp(harness, fixture.managerToken, open.id, { paymentId: second }),
      ]);

      noInternalErrors(a, b);
      expect([a.status, b.status].sort((x, y) => x - y)).toEqual([200, 409]);

      const refused = a.status === 409 ? a : b;
      expect(refused.body.error.code).toBe('PROMISE_NOT_OPEN');

      // ONE terminal transition, and the winner's payment stands untouched: the
      // loser serialised on the promise row lock, re-read `status` after the
      // winner committed, and wrote nothing.
      const winner = a.status === 200 ? a : b;
      const stored = await storedPromise(open.id);
      expect(stored.status).toBe('FULFILLED');
      expect(stored.fulfillingPaymentId).toBe(
        promiseResponseSchema.parse(winner.body).promise.fulfillingPayment?.id,
      );

      expect(await transitionAudits(open.id)).toEqual(['payment_promise.fulfilled']);
    });

    it('keeps that true across repeated rounds', async () => {
      for (let round = 0; round < 5; round += 1) {
        await resetDatabase(harness.prisma);
        fixture = await seedPayingFamily(harness);

        const open = await promise('250000');
        const payments = [await payment(), await payment(), await payment()];

        const responses = await Promise.all(
          payments.map((paymentId) =>
            fulfilPromiseOverHttp(harness, fixture.managerToken, open.id, { paymentId }),
          ),
        );

        noInternalErrors(...responses);
        expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
        expect(responses.filter((response) => response.status === 409)).toHaveLength(2);
        expect(await transitionAudits(open.id)).toEqual(['payment_promise.fulfilled']);
      }
    }, 90000);
  });

  describe('two promises claiming one payment', () => {
    it('lets exactly one claim it and names the refusal', async () => {
      const paymentId = await payment('900000');
      const first = await promise('250000');
      const second = await promise('250000');

      const [a, b] = await Promise.all([
        fulfilPromiseOverHttp(harness, fixture.managerToken, first.id, { paymentId }),
        fulfilPromiseOverHttp(harness, fixture.managerToken, second.id, { paymentId }),
      ]);

      noInternalErrors(a, b);
      expect([a.status, b.status].sort((x, y) => x - y)).toEqual([200, 409]);

      const refused = a.status === 409 ? a : b;
      expect(refused.body.error.code).toBe('PAYMENT_ALREADY_FULFILS_PROMISE');

      // Exactly one promise holds the evidence; the other is untouched and still
      // resolvable.
      const stored = await Promise.all([storedPromise(first.id), storedPromise(second.id)]);
      const fulfilled = stored.filter((one) => one.status === 'FULFILLED');
      expect(fulfilled).toHaveLength(1);
      expect(fulfilled[0]?.fulfillingPaymentId).toBe(paymentId);
      expect(stored.filter((one) => one.status === 'OPEN')).toHaveLength(1);
    });

    it('never deadlocks, across repeated rounds', async () => {
      for (let round = 0; round < 5; round += 1) {
        await resetDatabase(harness.prisma);
        fixture = await seedPayingFamily(harness);

        const paymentId = await payment('900000');
        const promises = [await promise(), await promise(), await promise()];

        const responses = await Promise.all(
          promises.map((one) =>
            fulfilPromiseOverHttp(harness, fixture.managerToken, one.id, { paymentId }),
          ),
        );

        noInternalErrors(...responses);
        expect(responses.filter((response) => response.status === 200)).toHaveLength(1);

        for (const refused of responses.filter((response) => response.status !== 200)) {
          expect(refused.body.error.code).toBe('PAYMENT_ALREADY_FULFILS_PROMISE');
        }

        // The unique index holds regardless of which transaction got there first.
        const claimed = await harness.prisma.paymentPromise.count({
          where: { fulfillingPaymentId: paymentId },
        });
        expect(claimed).toBe(1);
      }
    }, 90000);
  });

  /**
   * The A4 behaviour, preserved now that the fulfilment side is the real service
   * rather than raw SQL. Voiding a payment is ALWAYS available — that is the whole
   * reason the fulfilment check is not re-run on the payment side — so the void
   * wins in both branches and the fulfilment is what varies.
   */
  describe('a fulfilment racing a payment void', () => {
    it('refuses the fulfilment when the void got there first', async () => {
      const open = await promise('250000');
      const paymentId = await payment('250000');

      await voidPaymentOverHttp(harness, fixture.managerToken, paymentId).expect(200);

      const response = await fulfilPromiseOverHttp(harness, fixture.managerToken, open.id, {
        paymentId,
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('PAYMENT_VOIDED');
      expect((await storedPromise(open.id)).status).toBe('OPEN');
    });

    it('lets the void proceed when the fulfilment got there first, and keeps the promise FULFILLED', async () => {
      const open = await promise('250000');
      const paymentId = await payment('250000');

      await fulfilPromiseOverHttp(harness, fixture.managerToken, open.id, { paymentId }).expect(
        200,
      );

      const voided = await voidPaymentOverHttp(harness, fixture.managerToken, paymentId, {
        reason: 'واریز تکراری',
      });
      expect(voided.status).toBe(200);

      const stored = await storedPromise(open.id);
      expect(stored.status).toBe('FULFILLED');
      expect(stored.fulfillingPaymentId).toBe(paymentId);
      expect(await transitionAudits(open.id)).toEqual(['payment_promise.fulfilled']);
    });

    it('lands on one of the two coherent outcomes when the two run head-on', async () => {
      // Repeated, because a race that lands the same way every time proves only
      // one of the two branches.
      for (let round = 0; round < 6; round += 1) {
        await resetDatabase(harness.prisma);
        fixture = await seedPayingFamily(harness);

        const open = await promise('250000');
        const paymentId = await payment('250000');

        const [fulfilment, voided] = await Promise.all([
          fulfilPromiseOverHttp(harness, fixture.managerToken, open.id, { paymentId }),
          voidPaymentOverHttp(harness, fixture.managerToken, paymentId, { reason: 'ابطال همزمان' }),
        ]);

        // 40P01 is `deadlock_detected`, and a deadlock on either side would
        // surface as a 500. Nothing takes `payment -> payment_promise`, so no
        // cycle exists to detect.
        noInternalErrors(fulfilment, voided);
        expect(voided.status).toBe(200);

        const stored = await storedPromise(open.id);

        if (fulfilment.status === 200) {
          // The fulfilment committed first: the payment was live when it was
          // checked, and the promise stays terminal afterwards.
          expect(stored.status).toBe('FULFILLED');
          expect(stored.fulfillingPaymentId).toBe(paymentId);
          expect(await transitionAudits(open.id)).toEqual(['payment_promise.fulfilled']);
        } else {
          // The void committed first: the fulfilment was refused rather than
          // recorded against voided money, and the promise is exactly as it was.
          expect(fulfilment.status).toBe(409);
          expect(fulfilment.body.error.code).toBe('PAYMENT_VOIDED');
          expect(stored.status).toBe('OPEN');
          expect(stored.fulfillingPaymentId).toBeNull();
          expect(await transitionAudits(open.id)).toEqual([]);
        }
      }
    }, 90000);
  });

  describe('two different terminal verbs on one promise', () => {
    /** Every unordered pair of the three resolutions, raced head-on. */
    const pairs = [
      ['fulfil', 'cancel'],
      ['fulfil', 'reschedule'],
      ['reschedule', 'cancel'],
    ] as const;

    it.each(pairs)(
      'lets exactly one of %s and %s win',
      async (left, right) => {
        for (let round = 0; round < 3; round += 1) {
          await resetDatabase(harness.prisma);
          fixture = await seedPayingFamily(harness);

          const open = await promise('250000');
          const paymentId = await payment('250000');
          const dueOn = await clinicDay(harness, 21);

          const run = (verb: (typeof pairs)[number][number]) => {
            if (verb === 'fulfil') {
              return fulfilPromiseOverHttp(harness, fixture.managerToken, open.id, { paymentId });
            }
            if (verb === 'reschedule') {
              return reschedulePromiseOverHttp(harness, fixture.managerToken, open.id, {
                dueOn,
                reason: 'تعویق همزمان',
              });
            }
            return cancelPromiseOverHttp(harness, fixture.managerToken, open.id, {
              reason: 'انصراف همزمان',
            });
          };

          const [a, b] = await Promise.all([run(left), run(right)]);

          noInternalErrors(a, b);
          expect([a.status, b.status].sort((x, y) => x - y)).toEqual([200, 409]);

          const refused = a.status === 409 ? a : b;
          expect(refused.body.error.code).toBe('PROMISE_NOT_OPEN');

          // NO MIXED TERMINAL STATE, and no duplicate transition: one row, one
          // status, one audit fact.
          const stored = await storedPromise(open.id);
          expect(['FULFILLED', 'RESCHEDULED', 'CANCELLED']).toContain(stored.status);
          expect(await transitionAudits(open.id)).toHaveLength(1);

          // A losing reschedule leaves no orphan successor behind: it locks the
          // predecessor before it inserts anything.
          const total = await harness.prisma.paymentPromise.count();
          expect(total).toBe(stored.status === 'RESCHEDULED' ? 2 : 1);
        }
      },
      90000,
    );
  });

  describe('two reschedules of one promise', () => {
    it('produces exactly one successor chain and preserves the original history', async () => {
      const original = await promise('250000', 2);
      const first = await clinicDay(harness, 10);
      const second = await clinicDay(harness, 20);

      const [a, b] = await Promise.all([
        reschedulePromiseOverHttp(harness, fixture.managerToken, original.id, {
          dueOn: first,
          reason: 'دلیل الف',
        }),
        reschedulePromiseOverHttp(harness, fixture.managerToken, original.id, {
          dueOn: second,
          reason: 'دلیل ب',
        }),
      ]);

      noInternalErrors(a, b);
      expect([a.status, b.status].sort((x, y) => x - y)).toEqual([200, 409]);
      expect((a.status === 409 ? a : b).body.error.code).toBe('PROMISE_NOT_OPEN');

      // ONE successor. The loser never inserted one, so the table holds exactly
      // the predecessor and the winner's successor.
      expect(await harness.prisma.paymentPromise.count()).toBe(2);

      const stored = await storedPromise(original.id);
      expect(stored.status).toBe('RESCHEDULED');
      expect(stored.rescheduledToPromiseId).not.toBeNull();

      // The old due date, amount, note, creation actor and creation instant are
      // exactly as they were, and the winner's reason is the one recorded.
      expect(stored.dueOn.toISOString().slice(0, 10)).toBe(original.dueOn);
      expect(stored.amountToman.toString()).toBe('250000');
      expect(stored.createdAt.toISOString()).toBe(original.createdAt);
      expect(stored.createdByUserId).toBe(fixture.managerId);
      expect(['دلیل الف', 'دلیل ب']).toContain(stored.resolutionReason);

      expect(await transitionAudits(original.id)).toEqual(['payment_promise.rescheduled']);
    });

    it('keeps that true across repeated rounds, with no deadlock', async () => {
      for (let round = 0; round < 5; round += 1) {
        await resetDatabase(harness.prisma);
        fixture = await seedPayingFamily(harness);

        const original = await promise('250000', 1);
        const dueOn = await clinicDay(harness, 30);

        const responses = await Promise.all(
          ['الف', 'ب', 'ج'].map((reason) =>
            reschedulePromiseOverHttp(harness, fixture.managerToken, original.id, {
              dueOn,
              reason,
            }),
          ),
        );

        noInternalErrors(...responses);
        expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
        expect(responses.filter((response) => response.status === 409)).toHaveLength(2);

        // One predecessor, one successor, and nothing else.
        expect(await harness.prisma.paymentPromise.count()).toBe(2);
        expect(await transitionAudits(original.id)).toEqual(['payment_promise.rescheduled']);
      }
    }, 90000);
  });
});
