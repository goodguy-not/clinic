import { z } from 'zod';
import { isoDateSchema } from '../dates';
import { TARIFF_MAX_PRICE_TOMAN, tomanAmountSchema } from '../money';

/**
 * The vocabulary money-in is spoken in: what a payment may be, what a promise
 * may be, and the three shapes of free text either of them carries.
 *
 * NOTHING HERE IS AN ALLOCATION. Milestone 6 records that money arrived and
 * that a family said it would pay; it never records which charge a payment
 * settled (DECISION_LOG, 2026-08-15 — A payment is a family fact). No field in
 * this directory names a charge, a session, a child, a therapist share or a
 * settlement, and a caller that sends one is refused rather than ignored,
 * because every request schema is strict.
 */

/**
 * A payment's lifecycle, as the wire says it.
 *
 * TWO WORDS, AND `PENDING` IS NOT ONE OF THEM (DECISION_LOG, 2026-08-15 — A
 * payment is confirmed or voided). Money is recorded when the receptionist is
 * holding it or has seen it land, so there is no third party whose confirmation
 * a pending state would be waiting for, and a balance that quietly excludes
 * pending money is a balance nobody can explain.
 *
 * IT IS DERIVED, NOT STORED. `payment` has no status column: a payment is
 * confirmed exactly while `voidedAt` is null, which is the same two-state shape
 * `session_charge` carries and is spelled the same way. The server states the
 * word on the wire so no consumer has to infer it from a null — and
 * `paymentSchema` refuses a response where the two disagree.
 *
 * PROJECT_SPEC.md 8 lists `PENDING` among the statuses. That was reviewed and
 * declined; the trade-off and the revisit trigger are recorded in DECISION_LOG.
 */
export const PAYMENT_STATUSES = ['CONFIRMED', 'VOIDED'] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const paymentStatusSchema = z.enum(PAYMENT_STATUSES);

/**
 * How the money reached the clinic. Exactly three values, and must stay
 * identical to the `payment_method` PostgreSQL enum.
 *
 * NO `CHEQUE` AND NO `OTHER` (DECISION_LOG, 2026-08-15). A cheque has a
 * lifecycle — presentation, clearing, dishonour — that nothing in this milestone
 * models, and recording one as received money that may never arrive is worse
 * than having nowhere to record it. `OTHER` is the value that absorbs every
 * unforeseen case and that no report can then say anything about.
 */
export const PAYMENT_METHODS = ['CASH', 'CARD', 'TRANSFER'] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const paymentMethodSchema = z.enum(PAYMENT_METHODS);

/**
 * A promise's lifecycle as a READER sees it: the four stored states, plus the
 * one that is a fact about the clock.
 *
 * `MISSED` IS DERIVED AND IS NEVER STORED (DECISION_LOG, 2026-08-15 — A promise
 * is a calendar fact). It is an `OPEN` promise whose due date is earlier than
 * today at the clinic. Storing it would mean a row whose truth depends on a
 * nightly job having run and which reads wrongly until it does, so the database
 * enum has four values and the wire has five.
 *
 * THE FIVE PARTITION A FAMILY'S PROMISES. A promise reads as exactly one of
 * them: `OPEN` is open and not yet overdue, `MISSED` is open and overdue, and
 * the other three are terminal. `OPEN` therefore does NOT include the missed
 * ones — a status filter that returned overdue promises under both words would
 * make "how many are still on time?" unanswerable.
 */
export const PROMISE_STATUSES = [
  'OPEN',
  'MISSED',
  'FULFILLED',
  'RESCHEDULED',
  'CANCELLED',
] as const;

export type PromiseStatus = (typeof PROMISE_STATUSES)[number];

export const promiseStatusSchema = z.enum(PROMISE_STATUSES);

/**
 * The subset PostgreSQL actually stores, stated separately so the distinction
 * survives review.
 *
 * A test pins that this is `PROMISE_STATUSES` less `MISSED`, and an integration
 * suite pins it against the `payment_promise_status` enum. Nothing in a request
 * accepts these: a status is never submitted, it is the result of an act.
 */
export const PROMISE_STORED_STATUSES = [
  'OPEN',
  'FULFILLED',
  'RESCHEDULED',
  'CANCELLED',
] as const satisfies readonly PromiseStatus[];

export type PromiseStoredStatus = (typeof PROMISE_STORED_STATUSES)[number];

export const promiseStoredStatusSchema = z.enum(PROMISE_STORED_STATUSES);

/**
 * An amount of money one payment or one promise carries.
 *
 * STRICTLY ABOVE ZERO AND UNDER THE ONE GLOBAL CEILING, which is exactly what
 * `payment_amount_bounds_chk` and `payment_promise_amount_bounds_chk` enforce.
 * A payment of nothing is not a payment and a promise of nothing is not a
 * promise; the ceiling is the same fat-finger guard the ledger already reuses
 * rather than a second number that could drift from it.
 *
 * A PARTIAL PAYMENT IS AN ORDINARY PAYMENT AND AN OVERPAYMENT IS TOO
 * (PROJECT_SPEC.md 8; DECISION_LOG, 2026-08-15 — Credit is derived). Nothing
 * here bounds an amount by what the family owes: the debt is not a property of
 * the request, and a browser that knew it would be doing the arithmetic
 * CLAUDE.md keeps out of the web tier.
 *
 * The digit shape is re-tested before each conversion, because Zod runs
 * remaining checks after a failed one and `BigInt('')` throws.
 */
export const paymentAmountTomanSchema = tomanAmountSchema
  .refine((value) => /^\d+$/.test(value) && BigInt(value) > 0n, 'must be more than zero')
  .refine(
    (value) => /^\d+$/.test(value) && BigInt(value) <= BigInt(TARIFF_MAX_PRICE_TOMAN),
    'exceeds the maximum amount this system accepts',
  );

/**
 * A recorded reason on a payment or a promise.
 *
 * Required wherever it appears — voiding a payment, rescheduling a promise,
 * cancelling one. CLAUDE.md requires every correction to preserve actor, time
 * and reason, and the database bounds it at 500 characters in
 * `payment_void_consistency_chk` and `payment_promise_resolution_reason_chk`.
 *
 * The same shape as `ledgerReasonSchema`, restated here rather than imported for
 * the reason that one restates the catalog's: a change to how a charge explains
 * itself must not silently change how money-in does.
 */
export const paymentReasonSchema = z.string().trim().min(1).max(500);

/**
 * A non-clinical note on a payment or a promise.
 *
 * `.trim()` runs before the length check so the value that reaches PostgreSQL is
 * already canonical, which is what makes `note = btrim(note)` — asserted by a
 * CHECK — hold.
 *
 * A NOTE IS WRITTEN INTO AUDIT IN FULL, unlike the reference below, because the
 * note IS the fact being recorded (DECISION_LOG, 2026-08-15).
 */
export const paymentNoteSchema = z.string().trim().min(1).max(2000);

/**
 * A bank or terminal reference: a transfer id, a card terminal trace, a receipt
 * number.
 *
 * BOUNDED AT 40 CHARACTERS, mirroring `payment_reference_chk`. It is free text
 * on purpose — the clinic's banks do not agree on a format, and matching the
 * wrong one is how a limit becomes arbitrary.
 *
 * IT IS NEVER COPIED INTO AN AUDIT PAYLOAD (DECISION_LOG, 2026-08-15 — Payment
 * and promise audit carries no bank reference). It lives on the payment row,
 * which is where an operator looks it up; `audit_log` is append-only and
 * permanent, so a value written there is a second undeletable store of a banking
 * identifier kept to answer a question the payment id already answers. Audit
 * records only whether one exists.
 */
export const paymentReferenceSchema = z.string().trim().min(1).max(40);

/**
 * The clinic business day money arrived.
 *
 * A calendar day with no time and no offset, exactly as `serviceDate` is: the
 * day is the fact, and `createdAt` records when it was entered, so a back-dated
 * payment is always visible as one.
 *
 * BACK-DATING IS UNBOUNDED AND POST-DATING IS REFUSED (DECISION_LOG, 2026-08-15
 * — A payment may be back-dated but never post-dated). The future-date refusal
 * is NOT expressed here: "today" is the clinic's calendar day in Asia/Tehran,
 * which a browser must not decide, so the server refuses it as
 * `PAYMENT_DATE_IN_FUTURE` and a trigger enforces it against `clinic_date()`.
 * A bound stated in this schema would be a second answer that can disagree with
 * the only authoritative one.
 */
export const paymentReceivedOnSchema = isoDateSchema;

/**
 * The day a family said it would pay.
 *
 * The same calendar-day shape, and the same silence about which day is today.
 * A promise MAY be created with a past due date and reads immediately as derived
 * `MISSED`; a rescheduled successor may NOT, and the server refuses that as
 * `PROMISE_DUE_DATE_IN_PAST` (DECISION_LOG, 2026-08-15 — A promise may be born
 * late, but may not be rescheduled into the past).
 */
export const promiseDueOnSchema = isoDateSchema;

/**
 * A payment as everything else refers to it: the promise it fulfilled, the
 * family position's last payment.
 *
 * FIVE FIELDS, AND `status` IS ONE OF THEM. A promise stays `FULFILLED` when the
 * payment behind it is later voided — voiding money does not retroactively make
 * a human judgement un-made, and forcing a promise mutation would rewrite
 * history to keep an invariant tidy. The summary therefore has to be able to say
 * `VOIDED`, and that word is where a reader learns the evidence no longer
 * stands.
 *
 * NO REFERENCE AND NO NOTE. A summary is what a list prints; the detail read is
 * where those live.
 */
export const paymentSummarySchema = z.strictObject({
  id: z.uuid(),
  amountToman: tomanAmountSchema,
  method: paymentMethodSchema,
  receivedOn: isoDateSchema,
  status: paymentStatusSchema,
});

export type PaymentSummary = z.infer<typeof paymentSummarySchema>;
