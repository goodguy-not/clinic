import { z } from 'zod';
import { durationMinutesSchema } from '../catalog/common';
import { tariffPriceModeSchema } from '../catalog/tariffs';
import { isoDateSchema } from '../dates';
import { tomanAmountSchema } from '../money';
import {
  adjustmentAmountTomanSchema,
  ledgerReasonSchema,
  therapistDiscountPortionTomanSchema,
} from './common';

/**
 * The financial records of Milestone 5, as the wire carries them.
 *
 * TWO RECORDS AND NOTHING ELSE: a primary session charge, and an append-only
 * reduction of one. There is no payment, no credit, no promise, no allocation
 * and no balance in this file — those are Milestone 6 — and no share, no
 * percentage and no settlement — those are Milestone 8. A field that would let
 * a caller state any of them is a rule stored before it is approved.
 *
 * EVERY AMOUNT IS AN UNSIGNED CANONICAL DECIMAL STRING (`tomanAmountSchema`).
 * There is deliberately no signed money type: nothing in this milestone can
 * produce a negative family-facing amount. A charge is positive or zero, an
 * adjustment is positive and may not take the charge below zero, and the
 * negative clinic net that CLAUDE.md requires to be visible becomes computable
 * only when Milestone 8 has a therapist share to subtract. Introducing a signed
 * type now would mean choosing its spelling before anything can carry it.
 *
 * NO RAW BIGINT CROSSES THE BOUNDARY. `BigInt` has no JSON representation and a
 * `number` loses precision above 2^53, so the digits themselves are the wire
 * format (see `money.ts`).
 */

/**
 * One append-only reduction of a session charge.
 *
 * BOTH HALVES OF THE ALLOCATION ARE REPORTED, AND ONLY THE THERAPIST'S IS
 * SUBMITTABLE. They appear on the read because they are recorded facts on the
 * row and because CLAUDE.md requires who bore a concession to be visible in
 * reports; the clinic's is the server's exact residual, so it is reported and
 * never accepted.
 *
 * THE SHAPE WAS RIGHT BEFORE THE NUMBERS COULD VARY, WHICH WAS THE POINT.
 * Through Milestone 5 `therapistDiscountToman` was always `'0'` and
 * `clinicDiscountToman` always equalled `amountToman`, pinned by
 * `charge_adjustment_clinic_borne_chk` (DECISION_LOG, 2026-08-14). Milestone 8
 * checkpoint C4 dropped that CHECK and made a genuine split recordable, and no
 * read that families and managers already use had to be reshaped: the numbers
 * changed, the shape did not.
 *
 * `voidedAt` and the two fields that travel with it are the whole of "this
 * concession was withdrawn". A voided adjustment is never removed from a
 * response — voided financial history stays representable, which is what makes
 * "the reason it was granted and the reason it was taken back" both readable.
 */
export const chargeAdjustmentSchema = z.strictObject({
  id: z.uuid(),
  sessionChargeId: z.uuid(),
  amountToman: tomanAmountSchema,
  therapistDiscountToman: tomanAmountSchema,
  clinicDiscountToman: tomanAmountSchema,
  reason: z.string(),
  createdAt: z.iso.datetime(),
  createdByUserId: z.uuid(),
  voidedAt: z.iso.datetime().nullable(),
  voidedByUserId: z.uuid().nullable(),
  voidReason: z.string().nullable(),
});

export type ChargeAdjustment = z.infer<typeof chargeAdjustmentSchema>;

/**
 * A primary session charge: what one child owed for one session that happened.
 *
 * EVERY FIELD ABOVE `createdAt` IS A SNAPSHOT, not a pointer to current truth.
 * The service, therapist, length, date, tariff and amount are what was applied
 * when the session was priced, and they stay exactly that when the tariff
 * changes, the therapist leaves, or the reopened booking is later moved
 * (CLAUDE.md: tariff changes never rewrite historical charges; DECISION_LOG,
 * 2026-08-14 — financial history records what happened and never constrains
 * what happens next).
 *
 * `familyId` AND `childId` BOTH APPEAR, and neither is redundant. Balance is
 * family-level and the charge identifies the child (CLAUDE.md, non-negotiable
 * rules); the database keys them as a pair so the charged child provably
 * belongs to the charged family.
 *
 * `priceMode` IS THE FREE/PAID DISTINCTION AND IS NEVER INFERRED FROM THE
 * AMOUNT. A `FREE` charge came from a genuinely complimentary programme and is
 * zero at source; a `PAID` charge wholly waived stays `PAID` and carries an
 * adjustment that says who waived it and why. The two are different facts that
 * both display as zero, and `session_charge_price_mode_chk` makes neither
 * reachable from the other.
 *
 * A CORRECTION IS VOID-AND-RE-POST, NEVER AN EDIT. There is no update request
 * for this record anywhere in this package.
 */
export const sessionChargeSchema = z.strictObject({
  id: z.uuid(),
  familyId: z.uuid(),
  childId: z.uuid(),
  appointmentId: z.uuid(),
  appointmentParticipantId: z.uuid(),
  serviceId: z.uuid(),
  therapistId: z.uuid(),
  durationMinutes: durationMinutesSchema,
  /** The clinic calendar day in Asia/Tehran, with no time and no offset. */
  serviceDate: isoDateSchema,
  tariffId: z.uuid(),
  priceMode: tariffPriceModeSchema,
  amountToman: tomanAmountSchema,
  createdAt: z.iso.datetime(),
  createdByUserId: z.uuid(),
  voidedAt: z.iso.datetime().nullable(),
  voidedByUserId: z.uuid().nullable(),
  voidReason: z.string().nullable(),
});

export type SessionCharge = z.infer<typeof sessionChargeSchema>;

/**
 * A charge with the adjustments against it and the two sums nobody should be
 * computing twice.
 *
 * FLAT, NOT NESTED. The detail extends the row rather than wrapping it, so
 * `amountToman` and `effectiveAmountToman` sit side by side on one object and no
 * consumer has to write `charge.charge.amountToman`.
 *
 * THE SERVER COMPUTES THE ARITHMETIC. "What does this family owe for this
 * session" is charge minus the adjustments still active against it, and
 * CLAUDE.md forbids Next.js from calculating charges at all. Both totals are
 * therefore stated, not derived in a browser from the array beneath them.
 *
 * `adjustments` CARRIES THE VOIDED ONES TOO, which is why the totals cannot be
 * recomputed by summing the array naively and why they are given: a withdrawn
 * concession stays visible as history and stops reducing the amount.
 *
 * `effectiveAmountToman` is `amountToman` less `activeAdjustmentTotalToman` and
 * is never negative — the database refuses an adjustment that would take it
 * there. On a VOIDED charge it is still computed and still reported, and it is
 * simply not counted: a voided charge is excluded from every account total,
 * whatever its arithmetic says.
 *
 * The refinement mirrors the database rather than restating a preference: a
 * `FREE` charge is zero at source and `charge_adjustment_amount_bounds_chk`
 * plus the cumulative floor make it unadjustable, so a `FREE` charge carrying an
 * active adjustment is a response that could not have come from the ledger.
 */
export const sessionChargeDetailSchema = sessionChargeSchema
  .extend({
    adjustments: z.array(chargeAdjustmentSchema),
    activeAdjustmentTotalToman: tomanAmountSchema,
    effectiveAmountToman: tomanAmountSchema,
  })
  .refine(
    (value) =>
      value.priceMode !== 'FREE' || value.adjustments.every((one) => one.voidedAt !== null),
    'a free session charge cannot carry an active adjustment',
  );

export type SessionChargeDetail = z.infer<typeof sessionChargeDetailSchema>;

/**
 * Posting the primary charge for one attended participant of one completed
 * appointment.
 *
 * THE BODY IS EMPTY, AND STATED RATHER THAN OMITTED. The participant is named
 * by the path, the actor and the instant are the request's own, and every
 * financial value — which tariff, which price, which mode — is resolved by the
 * server from the session as recorded. A caller that sends an amount is told it
 * is not accepted rather than having it silently dropped, exactly as
 * `completeAppointmentRequestSchema` does.
 *
 * THIS IS THE EXPLICIT RE-POST. It is the request a manager makes after voiding
 * a charge that was wrong, and the request that raises a charge for a session
 * that never got one. It is idempotent by the rule in CLAUDE.md: a retry
 * against a participant that already has a valid charge returns that charge as
 * `ALREADY_POSTED` rather than raising a second one.
 */
export const postSessionChargeRequestSchema = z.strictObject({});

export type PostSessionChargeRequest = z.infer<typeof postSessionChargeRequestSchema>;

/**
 * What happened when a charge was posted.
 *
 * TWO OUTCOMES, AND EVERY OTHER ANSWER IS AN ERROR. A first post is `POSTED`; a
 * retry that found a valid charge already there is `ALREADY_POSTED` and carries
 * that same charge. Nothing was refused in either case, so neither is an error
 * envelope — and the interface still has to say "recorded" in one case and
 * "already recorded" in the other, which a bare 200 could not distinguish.
 *
 * There is deliberately no `NOT_ELIGIBLE` or `TARIFF_MISSING` member. A session
 * that was not completed, a child who did not attend, and a date no tariff
 * covers are refusals of the request, and they carry
 * `CHARGE_NOT_ELIGIBLE`/`TARIFF_MISSING` with an HTTP status that says so. A
 * union member for them would let a caller treat a failure as a success shape
 * and quietly show nothing.
 */
export const CHARGE_POST_OUTCOMES = ['POSTED', 'ALREADY_POSTED'] as const;

export type ChargePostOutcome = (typeof CHARGE_POST_OUTCOMES)[number];

export const chargePostResultSchema = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('POSTED'), charge: sessionChargeDetailSchema }),
  z.strictObject({ outcome: z.literal('ALREADY_POSTED'), charge: sessionChargeDetailSchema }),
]);

export type ChargePostResult = z.infer<typeof chargePostResultSchema>;

export const postSessionChargeResponseSchema = chargePostResultSchema;

export type PostSessionChargeResponse = z.infer<typeof postSessionChargeResponseSchema>;

/**
 * Withdrawing a charge that should not have been raised.
 *
 * MANAGER-ONLY (`charge.void`) AND ALWAYS EXPLAINED. Final financial records are
 * voided, never deleted (CLAUDE.md), and the void is one-way: there is no
 * un-void request here, because the database permits exactly one active →
 * voided transition and refuses every other update.
 */
export const voidSessionChargeRequestSchema = z.strictObject({
  reason: ledgerReasonSchema,
});

export type VoidSessionChargeRequest = z.infer<typeof voidSessionChargeRequestSchema>;

/**
 * Granting a concession on a priced session: a discount, a waiver, or freeing a
 * session that was priced.
 *
 * TWO FIELDS, AND THE SECOND ONE IS MANDATORY. A concession nobody can explain
 * is what CLAUDE.md forbids outright, so `reason` is not optional and not
 * defaulted.
 *
 * THE THERAPIST PORTION IS OPTIONAL, AND CLINIC-BORNE IS STILL THE DEFAULT
 * (Milestone 8, checkpoint C1). Through Milestone 5 this request had no
 * therapist portion at all: every concession was genuinely clinic-borne,
 * because a therapist could only be said to bear part of one once settlement
 * and an effective-dated share existed to bear it against, and a field
 * accepting one before then would have recorded an unfunded liability as a fact
 * (DECISION_LOG, 2026-08-14). Milestone 8 approves exactly that share, so the
 * field arrives — OPTIONAL, never defaulted to anything but zero, and never
 * required. A caller that omits it is stating the same clinic-borne concession
 * this request has always meant, and the overwhelming majority of concessions
 * stay that way: CLAUDE.md requires a therapist who does not participate in
 * discounts to bear nothing, with the clinic taking all of it even when that
 * makes the clinic net negative.
 *
 * THE CLINIC PORTION REMAINS UNSUBMITTABLE, WHICH IS WHAT KEEPS AN INVALID
 * SPLIT UNREPRESENTABLE. The two portions must sum to the total (CLAUDE.md), so
 * the request carries the TOTAL and the THERAPIST'S SHARE OF IT and the server
 * writes the clinic's as the exact residual. There is no pair of numbers a
 * caller can send that fails to add up, and `strictObject` refuses a
 * `clinicDiscountToman` outright rather than ignoring it. The one relationship
 * this schema does check is that the portion is not larger than the concession
 * it is a portion of; `ADJUSTMENT_SPLIT_INVALID` covers what only the server can
 * know — that the session has a rating to bear the portion against, and that
 * bearing it leaves the therapist net at or above zero.
 *
 * C1 FROZE THIS SHAPE AND C4 MADE IT REAL. Between the two, a request carrying
 * a non-zero portion was refused by the server rather than silently written;
 * the database CHECK that pinned every concession to clinic-borne is now
 * dropped, and the two conditions above are what refuse a portion instead. What
 * never changed, and is the reason the intermediate refusal existed at all, is
 * that a submitted portion is either recorded as submitted or refused with a
 * reason — never reinterpreted.
 *
 * A `FREE` charge cannot be adjusted at all. There is no concession to record on
 * a session that was never priced, and the attempt is refused as
 * `ADJUSTMENT_EXCEEDS_CHARGE` — any positive amount exceeds a zero charge.
 */
export const createChargeAdjustmentRequestSchema = z
  .strictObject({
    amountToman: adjustmentAmountTomanSchema,
    reason: ledgerReasonSchema,
    therapistDiscountToman: therapistDiscountPortionTomanSchema.optional(),
  })
  // The digit shape is re-tested before each conversion, because Zod runs
  // remaining checks after a failed one and `BigInt('')` throws.
  .refine(
    (value) =>
      value.therapistDiscountToman == null ||
      !/^\d+$/.test(value.therapistDiscountToman) ||
      !/^\d+$/.test(value.amountToman) ||
      BigInt(value.therapistDiscountToman) <= BigInt(value.amountToman),
    'the therapist portion must not exceed the concession it is part of',
  );

export type CreateChargeAdjustmentRequest = z.infer<typeof createChargeAdjustmentRequestSchema>;

/**
 * Withdrawing a concession, which restores the amount it had removed.
 *
 * The same shape and the same one-way rule as voiding a charge, and a separate
 * request because it is a separate record: voiding the concession leaves the
 * charge standing, and voiding the charge leaves the concession attached to it.
 */
export const voidChargeAdjustmentRequestSchema = z.strictObject({
  reason: ledgerReasonSchema,
});

export type VoidChargeAdjustmentRequest = z.infer<typeof voidChargeAdjustmentRequestSchema>;

/**
 * ONE RESPONSE SHAPE FOR EVERY WRITE THAT TOUCHES A CHARGE.
 *
 * Voiding a charge, granting a concession and withdrawing one all return the
 * charge as it now stands, with its adjustments and its recomputed totals.
 * Returning the adjustment alone would leave the caller holding a row whose
 * effect on the family's amount it would have to work out for itself — which is
 * the arithmetic CLAUDE.md keeps out of the web tier — and would need a second
 * request to render the screen the user is looking at.
 */
export const sessionChargeResponseSchema = z.strictObject({
  charge: sessionChargeDetailSchema,
});

export type SessionChargeResponse = z.infer<typeof sessionChargeResponseSchema>;
