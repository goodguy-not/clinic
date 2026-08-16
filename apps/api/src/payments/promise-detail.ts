import { Prisma } from '@prisma/client';
import type {
  PaymentMethod,
  PaymentPromise,
  PromiseStatus,
  PromiseStoredStatus,
} from '@clinic/contracts';
import { AppError } from '../common/app-error';
import { paymentStatus, type PaymentClient } from './payment-detail';

/**
 * Reading a promise back as the wire carries it.
 *
 * ONE MAPPING FOR EVERY ROUTE THAT ANSWERS WITH A PROMISE, exactly as
 * `payment-detail.ts` is the one mapping for a payment. Creating, fulfilling,
 * rescheduling, cancelling and the history page all read through the fragments
 * below, so `MISSED` can never be derived one way on one route and another way
 * on the next.
 *
 * `status` IS DERIVED IN SQL AND `MISSED` IS STORED NOWHERE (frozen F1;
 * DECISION_LOG, 2026-08-15 — A promise is a calendar fact). The database enum
 * has four values and the wire has five: a missed promise is a stored `OPEN`
 * one whose due day is earlier than today AT THE CLINIC. The comparison is made
 * by PostgreSQL against `clinic_date()` — the same function the payment date
 * rule asks and the same one the family position counts against — because
 * Tehran rolls over at 20:30 UTC and the Node clock, the session timezone and
 * UTC each disagree with the clinic for three and a half hours of every day. A
 * derivation in TypeScript would be a second answer that can disagree with the
 * only authoritative one, and a derivation in the browser would be that answer
 * computed in the wrong timezone.
 *
 * IT IS DERIVED ON READ AND NEVER PERSISTED. There is no `MISSED` column, no
 * nightly job and no `payment_promise.missed` audit action: a row whose truth
 * depended on a job having run would read wrongly until it did.
 *
 * BOTH DIRECTIONS OF THE RESCHEDULE CHAIN COME OUT OF ONE STATEMENT.
 * `rescheduledToPromiseId` is the column A1 stores; `rescheduledFromPromiseId`
 * is the same relation read backwards, joined here rather than fetched per row —
 * `payment_promise_rescheduled_to_promise_id_key` is unique, so the join returns
 * at most one predecessor and needs no aggregation. The same is true of the
 * fulfilling payment: one `LEFT JOIN` on a primary key. A page of promises is
 * therefore two statements — the count and the page — whatever it contains, and
 * never one per row.
 *
 * `due_on` and `received_on` are read as `::text`, for the reason `service_date`
 * is: Prisma maps a PostgreSQL `DATE` onto a JavaScript `Date` at UTC midnight,
 * and every conversion back through a local timezone is a chance for the clinic
 * day to move by one. The digits are the value.
 *
 * NO BALANCE, NO CREDIT, NO TOTAL AND NO AMOUNT DUE. A promise moves no money in
 * any state (CLAUDE.md), so nothing here computes one — the family position is
 * where those live, and it counts promises rather than summing them for exactly
 * that reason.
 */

/**
 * The tables a promise is read from: the promise, the payment that fulfilled it,
 * and the promise it succeeded.
 *
 * Both joins are `LEFT` because both are absent on most rows, and both are
 * keyed on a unique column, so neither can multiply the result.
 */
export const PROMISE_FROM = Prisma.sql`
  FROM payment_promise p
  LEFT JOIN payment pay ON pay.id = p.fulfilling_payment_id
  LEFT JOIN payment_promise pred ON pred.rescheduled_to_promise_id = p.id
`;

/**
 * Every field the frozen `promiseSchema` carries, plus the two the derivations
 * are read off.
 *
 * `stored_status` IS SELECTED BESIDE `wire_status` AND IS NOT ON THE WIRE. The
 * wire word is what a reader sees; the stored word is what a WRITE has to test,
 * because a `MISSED` promise is stored `OPEN` and may be fulfilled, rescheduled
 * or cancelled normally. Keeping both in one row is what stops a caller reaching
 * for the wire word to make that decision.
 */
export const PROMISE_COLUMNS = Prisma.sql`
  p.id,
  p.family_id,
  p.amount_toman,
  p.due_on::text AS due_on,
  p.note,
  p.status::text AS stored_status,
  CASE
    WHEN p.status = 'OPEN' AND p.due_on < clinic_date() THEN 'MISSED'
    ELSE p.status::text
  END AS wire_status,
  p.resolved_at,
  p.resolved_by_user_id,
  p.resolution_reason,
  p.rescheduled_to_promise_id,
  pred.id AS rescheduled_from_promise_id,
  p.created_at,
  p.created_by_user_id,
  pay.id AS payment_id,
  pay.amount_toman AS payment_amount_toman,
  pay.method::text AS payment_method,
  pay.received_on::text AS payment_received_on,
  pay.voided_at AS payment_voided_at
`;

export type PromiseRow = {
  id: string;
  family_id: string;
  amount_toman: bigint;
  due_on: string;
  note: string | null;
  stored_status: PromiseStoredStatus;
  wire_status: PromiseStatus;
  resolved_at: Date | null;
  resolved_by_user_id: string | null;
  resolution_reason: string | null;
  rescheduled_to_promise_id: string | null;
  rescheduled_from_promise_id: string | null;
  created_at: Date;
  created_by_user_id: string;
  payment_id: string | null;
  payment_amount_toman: bigint | null;
  payment_method: PaymentMethod | null;
  payment_received_on: string | null;
  payment_voided_at: Date | null;
};

/**
 * THE ONE ORDER EVERY PROMISE READ USES, and it is total.
 *
 * TWO SEGMENTS, BECAUSE A PROMISE LIST IS TWO LISTS. The unresolved promises come
 * first, soonest due date first (frozen `promiseListResponse`) — which puts the
 * most overdue promise at the very top, since that is the one somebody has to act
 * on. The terminal ones follow, most recently ended first, because history reads
 * backwards while a worklist reads forwards.
 *
 * THE SEGMENT KEY IS THE STORED STATUS, NOT THE WIRE ONE. `OPEN` and `MISSED` are
 * the same stored state and belong to the same segment; splitting them here would
 * bury the overdue promises below the ones that are not due yet.
 *
 * IT IS TOTAL TO THE LAST TIE-BREAK. `resolved_at` is null for every row of the
 * first segment and the `CASE` is null for every row of the second, so each key
 * discriminates within exactly one segment and `created_at`/`id` settle the rest.
 * Any looser order would let a promise appear on two pages of the history or on
 * neither.
 */
export const PROMISE_ORDER = Prisma.sql`
  (p.status = 'OPEN') DESC,
  CASE WHEN p.status = 'OPEN' THEN p.due_on END ASC,
  p.resolved_at DESC,
  p.created_at DESC,
  p.id DESC
`;

/** The promise as the frozen `promiseResponse` carries it. */
export async function readPromiseDetail(
  client: PaymentClient,
  promiseId: string,
): Promise<PaymentPromise> {
  const rows = await client.$queryRaw<PromiseRow[]>`
    SELECT ${PROMISE_COLUMNS} ${PROMISE_FROM} WHERE p.id = ${promiseId}::uuid
  `;

  const row = rows[0];
  if (row === undefined) throw new AppError('PROMISE_NOT_FOUND');
  return toPromise(row);
}

/**
 * The row, mapped. Exported so the history page maps a whole page with the same
 * function the writes answer with, rather than with a second copy of it.
 */
export function toPromise(row: PromiseRow): PaymentPromise {
  return {
    id: row.id,
    familyId: row.family_id,
    amountToman: row.amount_toman.toString(),
    dueOn: row.due_on,
    note: row.note,
    status: row.wire_status,
    createdAt: row.created_at.toISOString(),
    createdByUserId: row.created_by_user_id,
    resolvedAt: row.resolved_at?.toISOString() ?? null,
    resolvedByUserId: row.resolved_by_user_id,
    resolutionReason: row.resolution_reason,
    // PRESENT EXACTLY WHEN THE PROMISE IS FULFILLED, and its own `status` is
    // where a reader learns the evidence no longer stands: a promise whose
    // payment was later voided stays `FULFILLED` and reports `VOIDED` here
    // (frozen `paymentSummary`). The word is derived by `paymentStatus` — the
    // one derivation every payment read in this system uses — so it cannot say
    // one thing here and another on the payment history. There is deliberately
    // no second boolean saying the same thing.
    fulfillingPayment:
      row.payment_id === null ||
      row.payment_amount_toman === null ||
      row.payment_method === null ||
      row.payment_received_on === null
        ? null
        : {
            id: row.payment_id,
            amountToman: row.payment_amount_toman.toString(),
            method: row.payment_method,
            receivedOn: row.payment_received_on,
            status: paymentStatus({ voided_at: row.payment_voided_at }),
          },
    rescheduledToPromiseId: row.rescheduled_to_promise_id,
    rescheduledFromPromiseId: row.rescheduled_from_promise_id,
  };
}

/**
 * The columns a WRITE needs, held `FOR UPDATE`.
 *
 * THE FIRST LOCK EVERY PROMISE WRITE TAKES, and the first of the two rows in the
 * approved Milestone 6 order (`payment_promise -> payment`). Two resolutions of
 * one promise serialise on it, and the loser re-reads `status` after the winner
 * commits — which is what makes exactly one terminal transition and exactly one
 * audit row, without a retry loop and without an advisory lock.
 *
 * NO JOIN. `FOR UPDATE` may not be applied to the nullable side of an outer
 * join, and a write has no use for the fulfilling payment or the predecessor
 * anyway: it needs the family, the amount, the due day and the stored status.
 * The response is read afterwards, through `readPromiseDetail`, which is the
 * same statement every other route answers with.
 *
 * IT SELECTS THE STORED STATUS AND NOT THE DERIVED ONE. A `MISSED` promise is
 * stored `OPEN` and may be fulfilled, rescheduled or cancelled normally; a write
 * that tested the wire word would refuse exactly the promises the clinic most
 * needs to resolve.
 */
export type PromiseLockRow = {
  id: string;
  family_id: string;
  amount_toman: bigint;
  due_on: string;
  note: string | null;
  status: PromiseStoredStatus;
};

export async function lockPromiseRow(
  tx: Prisma.TransactionClient,
  promiseId: string,
): Promise<PromiseLockRow> {
  const rows = await tx.$queryRaw<PromiseLockRow[]>`
    SELECT id, family_id, amount_toman, due_on::text AS due_on, note, status::text AS status
    FROM payment_promise
    WHERE id = ${promiseId}::uuid
    FOR UPDATE
  `;

  const row = rows[0];
  if (row === undefined) throw new AppError('PROMISE_NOT_FOUND');
  return row;
}

/**
 * A promise may be resolved exactly once, out of stored `OPEN`.
 *
 * ONE REFUSAL FOR ALL THREE RESOLUTIONS, so fulfilling, rescheduling and
 * cancelling a promise that has already ended answer identically. It is stated
 * against the STORED status: `MISSED` is a reading of the clock, never a reason
 * to refuse, and a missed promise is the ordinary case for all three.
 *
 * `enforce_payment_promise_transition` remains the backstop and is not weakened
 * by this check — a caller reaching the table another way still cannot
 * transition a terminal row. What this adds is `PROMISE_NOT_OPEN` instead of a
 * `restrict_violation` an operator cannot act on.
 */
export function assertPromiseOpen(row: PromiseLockRow): void {
  if (row.status !== 'OPEN') throw new AppError('PROMISE_NOT_OPEN');
}
