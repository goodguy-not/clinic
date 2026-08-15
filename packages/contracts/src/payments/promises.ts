import { z } from 'zod';
import { ledgerPageQuerySchema, pageInfoSchema } from '../ledger/common';
import { tomanAmountSchema } from '../money';
import {
  paymentAmountTomanSchema,
  paymentNoteSchema,
  paymentReasonSchema,
  paymentSummarySchema,
  promiseDueOnSchema,
  promiseStatusSchema,
} from './common';

/**
 * A family's stated intention to pay: an amount, a day, and nothing that moves
 * money.
 *
 * ROUTES FROZEN HERE (Milestone 6, checkpoint A2). No controller implements them
 * yet.
 *
 *   POST /families/:familyId/promises    `createPromiseRequestSchema`     -> `promiseResponseSchema`
 *   GET  /families/:familyId/promises    `promiseListQuerySchema`         -> `promiseListResponseSchema`
 *   POST /promises/:promiseId/fulfill    `fulfillPromiseRequestSchema`    -> `promiseResponseSchema`
 *   POST /promises/:promiseId/reschedule `reschedulePromiseRequestSchema` -> `rescheduledPromiseResponseSchema`
 *   POST /promises/:promiseId/cancel     `cancelPromiseRequestSchema`     -> `promiseResponseSchema`
 *
 * A PROMISE NEVER CHANGES THE FAMILY'S FINANCIAL POSITION, IN ANY STATE
 * (CLAUDE.md; PROJECT_SPEC.md 8). Nothing in this file reduces a balance, and
 * the family position counts promises rather than amounts for exactly that
 * reason. The only money a promise can point at is one confirmed payment that
 * stands on its own.
 *
 * THERE IS NO `followUpDate` (DECISION_LOG, 2026-08-15). Its semantics were
 * never approved, and a date with no workflow behind it is a field people fill
 * in and nobody reads. PROJECT_SPEC.md 8 lists it; that was reviewed and
 * declined, and Milestone 7 may add it with defined semantics.
 */

/**
 * One promise, whole, including everything a reader needs to follow what became
 * of it.
 *
 * `status` MAY READ `MISSED`, WHICH POSTGRESQL DOES NOT STORE. The server
 * compares `dueOn` against the clinic's calendar day in Asia/Tehran and states
 * the word; the browser never computes it, because it would be computing it in
 * the wrong timezone (DECISION_LOG, 2026-08-15 — A promise is a calendar fact).
 *
 * THE RESOLUTION IS ON THE PROMISE, NOT ONLY IN THE AUDIT TRAIL. Who ended it,
 * when, and — where the ending was a decision rather than an outcome — why. The
 * reason is mandatory on `RESCHEDULED` and `CANCELLED`, optional on `FULFILLED`,
 * and absent while the promise is open, which is what
 * `payment_promise_resolution_chk` enforces.
 *
 * `fulfillingPayment` IS THE WHOLE ANSWER TO "WAS IT KEPT, AND DOES THE EVIDENCE
 * STILL STAND?" It is present exactly when the promise is `FULFILLED`, and its
 * own `status` is where a reader learns the payment was later voided. A promise
 * is NOT re-opened by that void: a human judgement recorded at the time is not
 * un-made by a later correction, and rewriting the promise to keep an invariant
 * tidy would destroy the history the record exists for. There is deliberately no
 * separate `fulfillingPaymentVoided` boolean — one fact, one field.
 *
 * THE RESCHEDULE CHAIN IS READABLE IN BOTH DIRECTIONS.
 * `rescheduledToPromiseId` is the successor this promise was replaced by, which
 * is the link A1 stores; `rescheduledFromPromiseId` is the predecessor, derived
 * by the server from the same relation read backwards. Both are ids rather than
 * nested promises: a chain of five reschedules would otherwise nest five deep,
 * and a list read would carry each promise twice.
 */
export const promiseSchema = z
  .strictObject({
    id: z.uuid(),
    familyId: z.uuid(),
    amountToman: tomanAmountSchema,
    /** The day the family said it would pay, with no time and no offset. */
    dueOn: promiseDueOnSchema,
    note: z.string().nullable(),
    status: promiseStatusSchema,
    createdAt: z.iso.datetime(),
    createdByUserId: z.uuid(),
    resolvedAt: z.iso.datetime().nullable(),
    resolvedByUserId: z.uuid().nullable(),
    resolutionReason: z.string().nullable(),
    fulfillingPayment: paymentSummarySchema.nullable(),
    rescheduledToPromiseId: z.uuid().nullable(),
    rescheduledFromPromiseId: z.uuid().nullable(),
  })
  .refine(
    (value) => (value.status === 'FULFILLED') === (value.fulfillingPayment !== null),
    'a promise is fulfilled exactly when it names the payment that fulfilled it',
  )
  .refine(
    (value) => (value.status === 'RESCHEDULED') === (value.rescheduledToPromiseId !== null),
    'a promise is rescheduled exactly when it names its successor',
  )
  .refine(
    (value) =>
      (value.status === 'OPEN' || value.status === 'MISSED') ===
      (value.resolvedAt === null && value.resolvedByUserId === null),
    'a promise carries a resolution exactly when it is no longer open',
  );

export type PaymentPromise = z.infer<typeof promiseSchema>;

/**
 * Recording that a family said it would pay.
 *
 * THREE FIELDS. The family is the path, the actor and the entry instant are the
 * server's, and the status is always `OPEN` — it is the result of an act, never
 * something a caller states.
 *
 * A PAST `dueOn` IS ACCEPTED (DECISION_LOG, 2026-08-15 — A promise may be born
 * late). A promise agreed last week and entered today is a real fact, and
 * refusing it would push the clinic to enter a false date; such a promise is
 * `OPEN` and reads immediately as derived `MISSED`. There is no age limit,
 * because any limit would be an invented number.
 *
 * NO LINKED PAYMENT HERE. A promise is created as an intention; the payment that
 * settles it is linked later, explicitly, through the fulfil route.
 */
export const createPromiseRequestSchema = z.strictObject({
  amountToman: paymentAmountTomanSchema,
  dueOn: promiseDueOnSchema,
  note: paymentNoteSchema.optional(),
});

export type CreatePromiseRequest = z.infer<typeof createPromiseRequestSchema>;

/**
 * Marking a promise kept, by naming the payment that kept it.
 *
 * THE PAYMENT IS EXPLICIT AND MANDATORY (DECISION_LOG, 2026-08-15). It is never
 * inferred from a payment landing near the due date: "was this promise kept?" is
 * a recorded human judgement, not a proximity match. The server requires that
 * payment to belong to the same family, to be `CONFIRMED`, to be at least the
 * promised amount, and to have fulfilled no other promise — refusals that arrive
 * as `PAYMENT_FAMILY_MISMATCH`, `PAYMENT_VOIDED`,
 * `PROMISE_PAYMENT_TOO_SMALL` and `PAYMENT_ALREADY_FULFILS_PROMISE`, and
 * that PostgreSQL also enforces.
 *
 * NO AMOUNT AND NO PARTIAL FULFILMENT. One payment fulfils at most one promise,
 * in full; a family paying a promised amount in two instalments cancels or
 * reschedules instead. A payment larger than the promise fulfils it entirely and
 * the surplus shows as credit on the family position — there is no field here to
 * record a portion, because there is no allocation record to hold one.
 *
 * NO REASON. A kept promise needs no explanation, and demanding prose for one
 * produces prose nobody means; `payment_promise_resolution_chk` makes the reason
 * optional on `FULFILLED` alone.
 */
export const fulfillPromiseRequestSchema = z.strictObject({
  paymentId: z.uuid(),
});

export type FulfillPromiseRequest = z.infer<typeof fulfillPromiseRequestSchema>;

/**
 * Agreeing a new date instead of the one that was promised.
 *
 * TWO FIELDS, AND THE REASON IS MANDATORY. Rescheduling is a decision somebody
 * made about money that was promised and did not arrive as agreed, so the reason
 * is part of the promise's own history rather than a side note in the trail.
 *
 * THE SUCCESSOR MAY NOT BE DUE IN THE PAST (DECISION_LOG, 2026-08-15). An
 * intention already overdue at the moment it is agreed records nothing; the
 * server refuses it as `PROMISE_DUE_DATE_IN_PAST`, measured against the clinic's
 * calendar day. This is the one place the two due-date rules differ: creation
 * accepts a past date, rescheduling does not.
 *
 * NEITHER THE AMOUNT NOR THE NOTE MAY CHANGE. A rescheduled promise preserves
 * the original and creates a successor for the same amount; a different amount
 * is a different intention, which is a cancel and a new promise.
 */
export const reschedulePromiseRequestSchema = z.strictObject({
  dueOn: promiseDueOnSchema,
  reason: paymentReasonSchema,
});

export type ReschedulePromiseRequest = z.infer<typeof reschedulePromiseRequestSchema>;

/**
 * Abandoning a promise.
 *
 * ONE FIELD, AND IT IS MANDATORY, for the reason a void's is: a promise
 * abandoned with no explanation is exactly what CLAUDE.md forbids of a
 * correction. Cancelling moves no money and reverses nothing — a promise never
 * changed the balance in the first place.
 */
export const cancelPromiseRequestSchema = z.strictObject({
  reason: paymentReasonSchema,
});

export type CancelPromiseRequest = z.infer<typeof cancelPromiseRequestSchema>;

/**
 * ONE RESPONSE SHAPE FOR EVERY WRITE THAT RESOLVES ONE PROMISE.
 *
 * Creating, fulfilling and cancelling all return the promise as it now stands.
 */
export const promiseResponseSchema = z.strictObject({
  promise: promiseSchema,
});

export type PromiseResponse = z.infer<typeof promiseResponseSchema>;

/**
 * Rescheduling, which is the one act that leaves TWO promises changed.
 *
 * BOTH ARE RETURNED, NAMED. The old promise is now `RESCHEDULED` and points at
 * its successor; the successor is `OPEN` with the new date. Returning only one
 * of them would leave the caller re-reading the list to find out what it just
 * created, and returning an unlabelled pair would make the reader work out which
 * is which from the statuses.
 */
export const rescheduledPromiseResponseSchema = z.strictObject({
  promise: promiseSchema,
  successor: promiseSchema,
});

export type RescheduledPromiseResponse = z.infer<typeof rescheduledPromiseResponseSchema>;

/**
 * Which slice of a family's promises to read.
 *
 * SEPARATELY PAGINATED FROM PAYMENTS AND FROM CHARGES, for the reason stated on
 * the payment list.
 *
 * `status` FILTERS ON THE DERIVED WORD, NOT ON THE STORED COLUMN. `MISSED` is
 * accepted here even though PostgreSQL has no such value: the server translates
 * it into "stored `OPEN`, and `dueOn` earlier than today at the clinic", and
 * `OPEN` into the complement of that. The five statuses therefore partition a
 * family's promises — asking for `OPEN` returns the ones still on time, and the
 * two counts on the family position are exactly these two filters.
 *
 * The alternative — one `includeOverdue` flag, or letting `OPEN` mean both —
 * would make "how many promises are still on time?" a question the interface
 * had to answer by subtracting, which is arithmetic over money-adjacent facts
 * that CLAUDE.md keeps on the server.
 */
export const promiseListQuerySchema = ledgerPageQuerySchema.extend({
  status: promiseStatusSchema.optional(),
});

export type PromiseListQuery = z.infer<typeof promiseListQuerySchema>;

/**
 * A family's promises, soonest due date first among the open ones.
 *
 * `familyId` is echoed for the reason every other family-scoped response echoes
 * it: a cached or shared response can never be read against the wrong family.
 */
export const promiseListResponseSchema = z.strictObject({
  familyId: z.uuid(),
  promises: z.array(promiseSchema),
  page: pageInfoSchema,
});

export type PromiseListResponse = z.infer<typeof promiseListResponseSchema>;
