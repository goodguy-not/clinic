import {
  promiseListResponseSchema,
  promiseResponseSchema,
  rescheduledPromiseResponseSchema,
  PROMISE_STATUSES,
  type PaymentPromise,
  type PromiseListResponse,
} from '@clinic/contracts';
import { signIn } from './appointments-support';
import { uuidv7 } from '../src/common/uuid';
import { createHarness, resetDatabase, type Harness } from './harness';
import {
  cancelPromiseOverHttp,
  clinicDay,
  createPromiseOverHttp,
  familyPromises,
  fulfilPromiseOverHttp,
  recordPaymentOverHttp,
  reschedulePromiseOverHttp,
  seedAnotherFamily,
  seedPayingFamily,
  voidPaymentOverHttp,
  type PaymentFixture,
} from './payment-support';

/**
 * A family's promises, and what became of each — checkpoint A6.
 *
 * EVERYTHING HERE IS SYNTHETIC.
 *
 * THE CLAIM UNDER TEST is that the FIVE WIRE STATUSES PARTITION a family's
 * promises: every promise reads as exactly one of them, `OPEN` excludes the
 * overdue ones, `MISSED` is derived from stored `OPEN` plus the clinic's calendar
 * day rather than looked up as a stored value, and filtering by each in turn
 * returns exactly the whole. A filter that returned an overdue promise under both
 * `OPEN` and `MISSED` would make "how many are still on time?" unanswerable,
 * which is the question the pair exists to answer.
 *
 * THE SECOND CLAIM is that TERMINAL HISTORY STAYS VISIBLE and stays truthful: a
 * rescheduled predecessor keeps its own dates and points at its successor, and a
 * fulfilled promise whose payment was later voided still reads `FULFILLED` while
 * its nested payment reads `VOIDED`. There is deliberately no second boolean
 * saying so — one fact, one field.
 *
 * READING RECORDS NOTHING. `audit_log` is append-only and permanent, and a
 * financial read copied into it would build an undeletable store of what a family
 * promised, growing with every screen refresh.
 */
describe('promise history (real PostgreSQL)', () => {
  let harness: Harness;
  let fixture: PaymentFixture;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
    fixture = await seedPayingFamily(harness);
  });

  async function make(
    amountToman: string,
    dueOffsetDays: number,
    familyId = fixture.familyId,
  ): Promise<PaymentPromise> {
    const response = await createPromiseOverHttp(harness, fixture.managerToken, familyId, {
      amountToman,
      dueOn: await clinicDay(harness, dueOffsetDays),
    }).expect(200);

    return promiseResponseSchema.parse(response.body).promise;
  }

  /** Reads the list and parses it against the FINAL frozen contract. */
  async function list(
    query: Record<string, string | number> = {},
    token = fixture.managerToken,
    familyId = fixture.familyId,
  ): Promise<PromiseListResponse> {
    const response = await familyPromises(harness, token, familyId, query).expect(200);
    return promiseListResponseSchema.parse(response.body);
  }

  /**
   * One family carrying every state a promise can be in, so the partition can be
   * asserted over a whole rather than over five separate fixtures.
   *
   * Built entirely over HTTP through the A6 routes: the statuses under test are
   * the ones the runtime actually produces, not ones a fixture asserted into
   * place.
   */
  async function everyStatus(): Promise<{
    open: PaymentPromise;
    missed: PaymentPromise;
    fulfilled: PaymentPromise;
    rescheduled: PaymentPromise;
    successor: PaymentPromise;
    cancelled: PaymentPromise;
  }> {
    const open = await make('100000', 6);
    const missed = await make('200000', -4);

    const toFulfil = await make('300000', 3);
    const paymentResponse = await recordPaymentOverHttp(
      harness,
      fixture.managerToken,
      fixture.familyId,
      { amountToman: '300000', method: 'CARD', receivedOn: await clinicDay(harness) },
    ).expect(200);
    const paymentId = paymentResponse.body.payment.id as string;
    const fulfilled = promiseResponseSchema.parse(
      (
        await fulfilPromiseOverHttp(harness, fixture.managerToken, toFulfil.id, {
          paymentId,
        }).expect(200)
      ).body,
    ).promise;

    const toReschedule = await make('400000', 1);
    const { promise: rescheduled, successor } = rescheduledPromiseResponseSchema.parse(
      (
        await reschedulePromiseOverHttp(harness, fixture.managerToken, toReschedule.id, {
          dueOn: await clinicDay(harness, 40),
          reason: 'تعویق',
        }).expect(200)
      ).body,
    );

    const toCancel = await make('500000', 2);
    const cancelled = promiseResponseSchema.parse(
      (
        await cancelPromiseOverHttp(harness, fixture.managerToken, toCancel.id, {
          reason: 'انصراف',
        }).expect(200)
      ).body,
    ).promise;

    return { open, missed, fulfilled, rescheduled, successor, cancelled };
  }

  describe('the whole list', () => {
    it('echoes the family and returns an empty page for a family with no promises', async () => {
      const body = await list();

      expect(body.familyId).toBe(fixture.familyId);
      expect(body.promises).toEqual([]);
      expect(body.page).toEqual({ page: 1, pageSize: 25, total: 0, hasMore: false });
    });

    it('is family-scoped and never leaks another family', async () => {
      const otherFamilyId = await seedAnotherFamily(harness, fixture);
      await make('100000', 1);
      await make('200000', 2, otherFamilyId);

      const mine = await list();
      expect(mine.promises).toHaveLength(1);
      expect(mine.promises.every((one) => one.familyId === fixture.familyId)).toBe(true);

      const theirs = await list({}, fixture.managerToken, otherFamilyId);
      expect(theirs.promises).toHaveLength(1);
      expect(theirs.familyId).toBe(otherFamilyId);
    });

    it('refuses an unknown family with 404 rather than an empty history', async () => {
      const response = await familyPromises(harness, fixture.managerToken, uuidv7());

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('FAMILY_NOT_FOUND');
    });

    it('keeps terminal promises visible with no flag to ask for them', async () => {
      const states = await everyStatus();
      const body = await list();

      expect(body.page.total).toBe(6);
      expect(body.promises.map((one) => one.id).sort()).toEqual(
        [
          states.open.id,
          states.missed.id,
          states.fulfilled.id,
          states.rescheduled.id,
          states.successor.id,
          states.cancelled.id,
        ].sort(),
      );
    });

    /**
     * Unresolved promises first, soonest due date first — which puts the most
     * overdue at the very top, because that is the one somebody has to act on.
     */
    it('orders the unresolved promises soonest first, ahead of the history', async () => {
      const states = await everyStatus();
      const body = await list();

      const unresolved = body.promises.slice(0, 3).map((one) => one.id);
      expect(unresolved).toEqual([states.missed.id, states.open.id, states.successor.id]);

      const terminal = body.promises.slice(3);
      expect(terminal.every((one) => one.resolvedAt !== null)).toBe(true);
    });
  });

  describe('the five wire statuses', () => {
    it('reads each promise as exactly one of them', async () => {
      const states = await everyStatus();
      const byId = new Map((await list()).promises.map((one) => [one.id, one.status]));

      expect(byId.get(states.open.id)).toBe('OPEN');
      expect(byId.get(states.missed.id)).toBe('MISSED');
      expect(byId.get(states.fulfilled.id)).toBe('FULFILLED');
      expect(byId.get(states.rescheduled.id)).toBe('RESCHEDULED');
      expect(byId.get(states.successor.id)).toBe('OPEN');
      expect(byId.get(states.cancelled.id)).toBe('CANCELLED');
    });

    it('partitions the family: the five filters sum to the whole and never overlap', async () => {
      await everyStatus();

      const whole = await list();
      const seen: string[] = [];

      for (const status of PROMISE_STATUSES) {
        const page = await list({ status });

        expect(page.page.total).toBe(page.promises.length);
        expect(page.promises.every((one) => one.status === status)).toBe(true);

        seen.push(...page.promises.map((one) => one.id));
      }

      expect(seen).toHaveLength(whole.page.total);
      expect(new Set(seen).size).toBe(whole.page.total);
      expect(seen.sort()).toEqual(whole.promises.map((one) => one.id).sort());
    });

    /**
     * `MISSED` has no stored value to look up: PostgreSQL's enum has four. The
     * filter is "stored `OPEN`, due before today at the clinic", and `OPEN` is the
     * complement of exactly that.
     */
    it('derives MISSED from stored OPEN and the clinic day, and excludes it from OPEN', async () => {
      const overdue = await make('200000', -1);
      const today = await make('200000', 0);
      const future = await make('200000', 1);

      const missed = await list({ status: 'MISSED' });
      expect(missed.promises.map((one) => one.id)).toEqual([overdue.id]);

      const open = await list({ status: 'OPEN' });
      expect(open.promises.map((one) => one.id).sort()).toEqual([today.id, future.id].sort());
      expect(open.promises.map((one) => one.id)).not.toContain(overdue.id);

      // Every row involved is stored OPEN; only the wire word differs.
      const stored = await harness.prisma.paymentPromise.findMany({
        where: { id: { in: [overdue.id, today.id, future.id] } },
        select: { status: true },
      });
      expect(stored.map((one) => one.status)).toEqual(['OPEN', 'OPEN', 'OPEN']);
    });

    it('refuses a status the wire does not have', async () => {
      const response = await familyPromises(harness, fixture.managerToken, fixture.familyId, {
        status: 'PENDING',
      });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('the history each promise carries', () => {
    it('states the resolution actor, instant and reason on a cancelled promise', async () => {
      const states = await everyStatus();
      const cancelled = (await list({ status: 'CANCELLED' })).promises[0];

      expect(cancelled?.id).toBe(states.cancelled.id);
      expect(cancelled?.resolvedByUserId).toBe(fixture.managerId);
      expect(cancelled?.resolvedAt).not.toBeNull();
      expect(cancelled?.resolutionReason).toBe('انصراف');
    });

    it('reads the reschedule chain in both directions from the list', async () => {
      const states = await everyStatus();
      const byId = new Map((await list()).promises.map((one) => [one.id, one]));

      expect(byId.get(states.rescheduled.id)?.rescheduledToPromiseId).toBe(states.successor.id);
      expect(byId.get(states.rescheduled.id)?.rescheduledFromPromiseId).toBeNull();

      // The backward link is the server's derivation of the same relation, and it
      // is an id rather than a nested promise: five reschedules would otherwise
      // nest five deep.
      expect(byId.get(states.successor.id)?.rescheduledFromPromiseId).toBe(states.rescheduled.id);
      expect(byId.get(states.successor.id)?.rescheduledToPromiseId).toBeNull();

      // The predecessor keeps its own due date; the successor has the new one.
      expect(byId.get(states.rescheduled.id)?.dueOn).not.toBe(byId.get(states.successor.id)?.dueOn);
    });

    it('carries the fulfilling payment as a summary, and only where there is one', async () => {
      const states = await everyStatus();
      const byId = new Map((await list()).promises.map((one) => [one.id, one]));

      const fulfilled = byId.get(states.fulfilled.id);
      expect(fulfilled?.fulfillingPayment).toEqual({
        id: states.fulfilled.fulfillingPayment?.id,
        amountToman: '300000',
        method: 'CARD',
        receivedOn: await clinicDay(harness),
        status: 'CONFIRMED',
      });

      for (const id of [
        states.open.id,
        states.missed.id,
        states.rescheduled.id,
        states.cancelled.id,
      ]) {
        expect(byId.get(id)?.fulfillingPayment).toBeNull();
      }
    });

    /**
     * A promise is NOT re-opened by a later void: a human judgement recorded at
     * the time is not un-made by a correction to the money. The summary's own
     * `status` is where a reader learns the evidence no longer stands.
     */
    it('keeps a promise FULFILLED and reports its voided payment as VOIDED', async () => {
      const toFulfil = await make('300000', 3);
      const paymentId = (
        await recordPaymentOverHttp(harness, fixture.managerToken, fixture.familyId, {
          amountToman: '300000',
          method: 'TRANSFER',
          receivedOn: await clinicDay(harness),
        }).expect(200)
      ).body.payment.id as string;

      await fulfilPromiseOverHttp(harness, fixture.managerToken, toFulfil.id, {
        paymentId,
      }).expect(200);

      await voidPaymentOverHttp(harness, fixture.managerToken, paymentId, {
        reason: 'ثبت اشتباه',
      }).expect(200);

      const [promise] = (await list({ status: 'FULFILLED' })).promises;

      expect(promise?.status).toBe('FULFILLED');
      expect(promise?.fulfillingPayment?.id).toBe(paymentId);
      expect(promise?.fulfillingPayment?.status).toBe('VOIDED');

      // One fact, one field: there is deliberately no separate boolean.
      expect(Object.keys(promise?.fulfillingPayment ?? {}).sort()).toEqual([
        'amountToman',
        'id',
        'method',
        'receivedOn',
        'status',
      ]);
    });
  });

  describe('paging', () => {
    it('walks every promise exactly once, with no row on two pages or neither', async () => {
      for (let index = 0; index < 7; index += 1) {
        await make(String((index + 1) * 10000), index - 3);
      }

      const seen: string[] = [];
      let page = 1;

      for (;;) {
        const body = await list({ page, pageSize: 2 });

        expect(body.page.pageSize).toBe(2);
        expect(body.page.total).toBe(7);
        seen.push(...body.promises.map((one) => one.id));

        if (!body.page.hasMore) break;
        page += 1;
      }

      expect(seen).toHaveLength(7);
      expect(new Set(seen).size).toBe(7);
      expect(page).toBe(4);
    });

    it('is deterministic: the same page twice returns the same rows in the same order', async () => {
      for (let index = 0; index < 5; index += 1) await make('100000', 2);

      const first = await list({ page: 1, pageSize: 3 });
      const again = await list({ page: 1, pageSize: 3 });

      expect(again.promises.map((one) => one.id)).toEqual(first.promises.map((one) => one.id));
    });

    it('counts what the filter matches, not what the page returns', async () => {
      await make('100000', -1);
      await make('100000', -2);
      await make('100000', 5);

      const missed = await list({ status: 'MISSED', pageSize: 1 });
      expect(missed.promises).toHaveLength(1);
      expect(missed.page.total).toBe(2);
      expect(missed.page.hasMore).toBe(true);
    });

    it('refuses an invented filter and an out-of-range page size', async () => {
      const queries: Record<string, string | number>[] = [
        { childId: uuidv7() },
        { includeVoided: 'true' },
        { pageSize: 101 },
      ];

      for (const query of queries) {
        const response = await familyPromises(
          harness,
          fixture.managerToken,
          fixture.familyId,
          query,
        );

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      }
    });
  });

  describe('permission and audit', () => {
    it('lets a receptionist read the history', async () => {
      const receptionist = await signIn(harness, 'RECEPTIONIST');
      await make('100000', 1);

      const body = await list({}, receptionist.token);
      expect(body.promises).toHaveLength(1);
    });

    it('writes no audit row for a read', async () => {
      await everyStatus();

      const before = await harness.prisma.auditLog.count();
      await list();
      await list({ status: 'MISSED' });
      await list({ page: 1, pageSize: 2 });

      expect(await harness.prisma.auditLog.count()).toBe(before);
    });
  });
});
