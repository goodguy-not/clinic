import { promiseSchema } from '@clinic/contracts';
import {
  assertPromiseOpen,
  toPromise,
  type PromiseLockRow,
  type PromiseRow,
} from './promise-detail';

/**
 * The mapping this module owns, and the one thing about it a unit test can prove
 * that an integration test cannot say as sharply.
 *
 * `MISSED` IS DERIVED IN SQL, so it is not re-derived here and there is nothing
 * to unit-test about it: `wire_status` arrives already decided by
 * `clinic_date()`, which is the point — a second derivation in TypeScript is
 * exactly what this file must NOT contain, and `promise-history.int-spec.ts`
 * proves the SQL one against a real clock.
 *
 * WHAT IS PROVED HERE is that the mapping carries every column onto the frozen
 * shape without inventing or dropping one, and that the three refinements
 * `promiseSchema` carries actually bite — a `FULFILLED` with no payment, a
 * `RESCHEDULED` with no successor, and an open promise carrying a resolution are
 * each what a drifting mapping would eventually produce.
 *
 * IT ALSO PINS THAT A MISSED PROMISE IS RESOLVABLE. `assertPromiseOpen` tests the
 * STORED status, so a promise that reads `MISSED` is refused by nothing — which
 * is the whole reason `MISSED` is derived rather than stored.
 */

const OPEN_ROW: PromiseRow = {
  id: '0199a000-0000-7000-8000-000000000001',
  family_id: '0199a000-0000-7000-8000-000000000002',
  amount_toman: 250_000n,
  due_on: '2026-08-20',
  note: 'یادداشت آزمایشی',
  stored_status: 'OPEN',
  wire_status: 'OPEN',
  resolved_at: null,
  resolved_by_user_id: null,
  resolution_reason: null,
  rescheduled_to_promise_id: null,
  rescheduled_from_promise_id: null,
  created_at: new Date('2026-08-16T09:30:00.000Z'),
  created_by_user_id: '0199a000-0000-7000-8000-000000000003',
  payment_id: null,
  payment_amount_toman: null,
  payment_method: null,
  payment_received_on: null,
  payment_voided_at: null,
};

describe('promise detail mapping', () => {
  it('maps every column onto the frozen promise shape', () => {
    const promise = promiseSchema.parse(toPromise(OPEN_ROW));

    expect(promise).toEqual({
      id: OPEN_ROW.id,
      familyId: OPEN_ROW.family_id,
      // A string, never a number: an amount above 2^53 is storable in BIGINT and
      // is not representable as a JavaScript number.
      amountToman: '250000',
      // The digits as PostgreSQL spelled them — never a Date that a timezone
      // conversion could move by one day.
      dueOn: '2026-08-20',
      note: 'یادداشت آزمایشی',
      status: 'OPEN',
      createdAt: '2026-08-16T09:30:00.000Z',
      createdByUserId: OPEN_ROW.created_by_user_id,
      resolvedAt: null,
      resolvedByUserId: null,
      resolutionReason: null,
      fulfillingPayment: null,
      rescheduledToPromiseId: null,
      rescheduledFromPromiseId: null,
    });
  });

  it('states the derived word the database handed it, without re-deciding it', () => {
    const missed = promiseSchema.parse(toPromise({ ...OPEN_ROW, wire_status: 'MISSED' }));

    expect(missed.status).toBe('MISSED');
    // Still unresolved: MISSED is a reading of the clock, not an ending.
    expect(missed.resolvedAt).toBeNull();
  });

  /**
   * The summary has to be able to say `VOIDED`: a promise stays `FULFILLED` when
   * the payment behind it is later voided, and that word is where a reader learns
   * the evidence no longer stands. One fact, one field — there is deliberately no
   * separate boolean.
   */
  it('carries the fulfilling payment and derives its status the one way payments are derived', () => {
    const fulfilledRow: PromiseRow = {
      ...OPEN_ROW,
      stored_status: 'FULFILLED',
      wire_status: 'FULFILLED',
      resolved_at: new Date('2026-08-18T06:00:00.000Z'),
      resolved_by_user_id: '0199a000-0000-7000-8000-000000000004',
      payment_id: '0199a000-0000-7000-8000-000000000005',
      payment_amount_toman: 800_000n,
      payment_method: 'TRANSFER',
      payment_received_on: '2026-08-18',
      payment_voided_at: null,
    };

    const confirmed = promiseSchema.parse(toPromise(fulfilledRow));
    expect(confirmed.fulfillingPayment).toEqual({
      id: fulfilledRow.payment_id,
      // Larger than the promise, which fulfils it entirely; the surplus is
      // derived credit and is recorded against this promise nowhere.
      amountToman: '800000',
      method: 'TRANSFER',
      receivedOn: '2026-08-18',
      status: 'CONFIRMED',
    });

    const stale = promiseSchema.parse(
      toPromise({ ...fulfilledRow, payment_voided_at: new Date('2026-08-19T06:00:00.000Z') }),
    );
    expect(stale.status).toBe('FULFILLED');
    expect(stale.fulfillingPayment?.status).toBe('VOIDED');
  });

  it('carries both directions of the reschedule chain as ids', () => {
    const promise = promiseSchema.parse(
      toPromise({
        ...OPEN_ROW,
        stored_status: 'RESCHEDULED',
        wire_status: 'RESCHEDULED',
        resolved_at: new Date('2026-08-18T06:00:00.000Z'),
        resolved_by_user_id: '0199a000-0000-7000-8000-000000000004',
        resolution_reason: 'تعویق',
        rescheduled_to_promise_id: '0199a000-0000-7000-8000-000000000006',
        rescheduled_from_promise_id: '0199a000-0000-7000-8000-000000000007',
      }),
    );

    expect(promise.rescheduledToPromiseId).toBe('0199a000-0000-7000-8000-000000000006');
    expect(promise.rescheduledFromPromiseId).toBe('0199a000-0000-7000-8000-000000000007');
  });

  it('refuses a mapping whose status and history disagree', () => {
    const open = toPromise(OPEN_ROW);

    // FULFILLED with no payment: a fulfilment nobody can check.
    expect(() => promiseSchema.parse({ ...open, status: 'FULFILLED' })).toThrow();

    // RESCHEDULED with no successor.
    expect(() => promiseSchema.parse({ ...open, status: 'RESCHEDULED' })).toThrow();

    // Open, and yet resolved.
    expect(() =>
      promiseSchema.parse({
        ...open,
        resolvedAt: '2026-08-18T06:00:00.000Z',
        resolvedByUserId: OPEN_ROW.created_by_user_id,
      }),
    ).toThrow();
  });
});

describe('the one refusal every resolution shares', () => {
  const lockRow = (status: PromiseLockRow['status']): PromiseLockRow => ({
    id: OPEN_ROW.id,
    family_id: OPEN_ROW.family_id,
    amount_toman: OPEN_ROW.amount_toman,
    due_on: OPEN_ROW.due_on,
    note: OPEN_ROW.note,
    status,
  });

  it('permits a stored OPEN promise, however overdue it reads', () => {
    expect(() => assertPromiseOpen(lockRow('OPEN'))).not.toThrow();
  });

  it('refuses each terminal state with PROMISE_NOT_OPEN', () => {
    for (const status of ['FULFILLED', 'RESCHEDULED', 'CANCELLED'] as const) {
      expect(() => assertPromiseOpen(lockRow(status))).toThrow(
        expect.objectContaining({ code: 'PROMISE_NOT_OPEN' }),
      );
    }
  });
});
