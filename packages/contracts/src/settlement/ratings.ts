import { z } from 'zod';
import { isoDateSchema } from '../dates';
import { tomanAmountSchema } from '../money';
import { ratedViaSchema, settlementReasonSchema, shareBasisPointsSchema } from './common';

/**
 * THE SETTLEMENT FACT: what one therapist earned from one session, frozen at
 * the moment somebody rated it.
 *
 * ROUTES AND TABLE ARE NOT FROZEN HERE. Checkpoint C1 freezes the WORDS. There
 * is no `session_settlement` table, no migration, no service and no controller
 * behind any of this yet; what this file guarantees is that when C3 writes
 * them, the shape the web tier was built against is the shape it gets.
 *
 * EVERY AMOUNT FIELD IS A SNAPSHOT, exactly as `sessionChargeSchema`'s are, and
 * for the same reason: financial history records what happened and is never
 * recomputed from current configuration (CLAUDE.md — historical sessions must
 * preserve the applied percentage as a snapshot; tariff changes never rewrite
 * historical charges). Re-deriving `therapistGrossToman` from today's share
 * rule would make last month's earnings a function of this month's agreement,
 * which is the single failure mode this whole milestone is arranged to prevent.
 *
 * A RATING IS VOIDED, NEVER EDITED AND NEVER DELETED. There is no update
 * request for this record anywhere in this package. A wrong percentage is
 * corrected by withdrawing the rating and writing a new one, so both the figure
 * that was applied and the figure that replaced it stay readable, with an actor
 * and a reason on each (CLAUDE.md — final financial records are voided or
 * adjusted, never physically deleted).
 */

/**
 * One rated session.
 *
 * `baseAmountToman` IS THE PRE-DISCOUNT CHARGE AMOUNT, AND SAYING SO IS THE
 * POINT OF THE NAME. It is `session_charge.amountToman` as posted — not the
 * family's effective amount after concessions, not what the family paid, and
 * not a figure this row is free to disagree with. Therapist settlement is based
 * on completed-session value regardless of whether or when the family pays
 * (CLAUDE.md), and a concession is allocated separately, on the adjustment that
 * granted it, rather than by quietly shrinking the basis here.
 *
 * `appliedShareBasisPoints` IS THE SNAPSHOT AND `appliedShareRuleId` IS ITS
 * PROVENANCE. The percentage that was applied lives on this row as a number; the
 * rule id says which agreement it was copied from. Nothing may re-resolve the
 * number from the rule, including when the rule is later voided — which is
 * exactly when a re-resolution would silently change a closed month.
 *
 * THE RULE ID IS NEVER NULL, ON EITHER KIND OF RATING. A share rule is the only
 * source of settlement policy in this product: `ratedVia` says whether the
 * server rated the session while charging it or a manager rated it afterwards,
 * and BOTH resolve their percentage from the therapist's effective-dated rule
 * covering the SERVICE DATE. There is no per-session override rate, so there is
 * no rating that came from nowhere and no shape here that can express one.
 *
 * `therapistGrossToman` AND `clinicGrossToman` ARE BOTH STORED, EVEN THOUGH
 * EITHER COULD BE DERIVED FROM THE OTHER. The residual rule (`SHARE_ROUNDING`)
 * is what makes them sum exactly to the base, and storing both is what keeps
 * that guarantee readable years later without re-running the rounding rule of
 * the day. Both are UNSIGNED: a gross share is a split of a non-negative
 * amount, so neither half can be negative before discounts are allocated. The
 * NET figures — where a clinic net may legitimately go below zero — are stated
 * on the statement, not here, because they depend on concessions that arrive
 * after the rating.
 *
 * `reason` IS NULL ON AN `AUTOMATIC` RATING AND REQUIRED ON AN `EXPLICIT` ONE.
 * A rating written by the posting path explains itself — the charge was raised,
 * a rule covered it, the percentage was applied. A manager reaching back to a
 * session that was left unrated is making a decision about somebody's earnings
 * after the fact, and CLAUDE.md requires every such act to be explicit, reasoned
 * and auditable.
 *
 * `supersedesSessionSettlementId` NAMES THE RATING THIS ONE REPLACED, exactly as
 * `supersedesTariffId` names the price a correction replaced. Null for a first
 * rating.
 *
 * THERE IS NO `unrated` FLAG AND NO ZERO-VALUED PLACEHOLDER ROW. An unrated
 * session is a session with NO ROW HERE — the state is the absence — and it is
 * reported as an exception count on the statement. A placeholder would be a
 * settlement fact asserting that somebody earned nothing, which is a different
 * claim from nobody having decided yet, and the difference is a therapist's
 * money.
 */
export const sessionSettlementSchema = z.strictObject({
  id: z.uuid(),
  sessionChargeId: z.uuid(),
  appointmentParticipantId: z.uuid(),
  therapistId: z.uuid(),
  /** The clinic calendar day in Asia/Tehran, snapshotted from the charge. */
  serviceDate: isoDateSchema,
  appliedShareBasisPoints: shareBasisPointsSchema,
  /** Always present: every rating is resolved from a rule. */
  appliedShareRuleId: z.uuid(),
  ratedVia: ratedViaSchema,
  baseAmountToman: tomanAmountSchema,
  therapistGrossToman: tomanAmountSchema,
  clinicGrossToman: tomanAmountSchema,
  reason: z.string().nullable(),
  supersedesSessionSettlementId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  createdByUserId: z.uuid(),
  voidedAt: z.iso.datetime().nullable(),
  voidedByUserId: z.uuid().nullable(),
  voidReason: z.string().nullable(),
});

export type SessionSettlement = z.infer<typeof sessionSettlementSchema>;

/**
 * RATING A SESSION BY HAND: A REASON, AND NOTHING ELSE.
 *
 * NO PERCENTAGE IS SUBMITTABLE, AND THAT IS THE WHOLE SHAPE OF THIS REQUEST.
 * The applied share is resolved by the server from the therapist's
 * effective-dated share rule covering the CHARGE's service date — the same
 * resolution the posting path performs, against the same rule, by the same
 * statement. A caller who could type a percentage onto one session would be
 * stating settlement policy in a place that has no effective date, no
 * supersession history and no void trail, and next month's figure for the same
 * therapist would depend on which screen somebody happened to use. The share
 * rule is the only source of settlement policy in this product, and correcting
 * a rule is how a percentage changes (`share-rules.ts`).
 *
 * A WRONG PERCENTAGE IS THEREFORE FIXED IN TWO STEPS, BOTH ALREADY AUDITED:
 * correct the share rule (which voids it and writes a replacement naming it),
 * then correct the rating (`correctSessionRatingRequestSchema` below), which
 * re-resolves against the corrected rule. Neither step rewrites history and both
 * say who and why.
 *
 * NO `ratedVia` IS SUBMITTABLE EITHER. It records how the act happened, and the
 * server knows: this request is a manager rating a session by hand, so it always
 * writes `EXPLICIT`. A caller that could send `AUTOMATIC` could claim a rating
 * was raised with the charge when it was not, which is the one thing the field
 * exists to answer honestly.
 *
 * NO BASE AMOUNT IS SUBMITTABLE. The basis is the posted charge, read by the
 * server from the charge itself; a caller that could state it could state a
 * different one.
 *
 * `reason` IS REQUIRED AND IS THE ONLY FIELD. Reaching back to a session nobody
 * rated is a decision about somebody's earnings taken after the fact, and
 * CLAUDE.md requires every such act to be explicit, reasoned and auditable.
 * A `strictObject` refuses everything else — including a percentage — rather
 * than silently dropping it, which is what would turn a refused override into an
 * unrecorded one.
 */
export const rateSessionRequestSchema = z.strictObject({
  reason: settlementReasonSchema,
});

export type RateSessionRequest = z.infer<typeof rateSessionRequestSchema>;

/**
 * Withdrawing a rating that should not have been applied.
 *
 * The same shape and the same one-way rule as voiding a charge: manager-only
 * (`settlement.void_rating`), always explained, and never reversed.
 *
 * IT IS THE PLAIN PATH, AND IT IS REFUSED ONCE A CLOSED PERIOD DEPENDS ON THE
 * RATING. A rating that has already been settled inside a closed period cannot
 * simply be withdrawn — that would leave the closed figure standing with
 * nothing behind it, and a closed period is immutable. The server answers
 * `RATING_REPLACEMENT_REQUIRED`, and the caller uses
 * `correctSessionRatingRequestSchema` below, which withdraws and re-rates as one
 * act. That is the whole reason the two requests are different shapes.
 */
export const voidSessionRatingRequestSchema = z.strictObject({
  reason: settlementReasonSchema,
});

export type VoidSessionRatingRequest = z.infer<typeof voidSessionRatingRequestSchema>;

/**
 * CORRECTING A RATING THAT A CLOSED PERIOD ALREADY DEPENDS ON: withdrawal and
 * replacement as ONE REQUEST, because they have to be one transaction.
 *
 * THE ATOMICITY IS THE CONTRACT, NOT AN IMPLEMENTATION DETAIL. Two separate
 * calls have a moment between them in which the session is unrated, and that
 * moment is observable: a statement read there reports the session as an
 * unrated exception, and a close performed there excludes it silently and
 * permanently — a closed period is never reopened. One request means the
 * settled figure moves from one explained value to another explained value with
 * no state in between where a therapist's session has simply vanished.
 *
 * BOTH PERMISSIONS ARE REQUIRED, AND, NOT OR:
 * `SETTLEMENT_RATING_CORRECTION_PERMISSIONS` is `settlement.void_rating` AND
 * `settlement.rate`. The act genuinely does both things, so it names both
 * authorities; a caller who may withdraw but not re-rate must not reach a
 * request that re-rates, and a caller who may rate but not withdraw must not
 * reach one that withdraws.
 *
 * THE SCOPE IS ONE SESSION AND ONE CHARGE, STATED TWICE ON PURPOSE. The
 * replacement names the same `sessionChargeId` as the withdrawal, and the
 * refinement below refuses a request where they differ. Correcting one
 * therapist's month by re-rating a different session is the mistake this
 * prevents, and it is the sort of mistake that is only ever noticed by whoever
 * ends up short. The server checks the same thing again against the rating it
 * actually loads, and answers `RATING_SCOPE_MISMATCH`.
 *
 * THE REPLACEMENT IS REQUIRED, NOT OPTIONAL. A correction with no replacement is
 * a bare withdrawal, and there is already a request for that; making it optional
 * here would give one endpoint two behaviours with very different consequences
 * for a closed period.
 *
 * THE REPLACEMENT CARRIES NO PERCENTAGE, for the reason
 * `rateSessionRequestSchema` carries none: it is RE-RESOLVED from the
 * therapist's share rule covering the charge's service date. That is exactly
 * what makes this the second half of correcting a wrong percentage — the manager
 * corrects the RULE, which voids it and writes a replacement, and then corrects
 * the rating, which picks the corrected agreement up. A percentage typed here
 * would settle one session against a figure no rule ever recorded.
 *
 * IT CARRIES NO `ratedVia` EITHER, and the replacement is always `EXPLICIT`: a
 * manager performed it, by hand, after the fact. Claiming `AUTOMATIC` would
 * assert that the charge posting raised it, which is the one thing that field
 * exists to answer honestly.
 *
 * THE CORRECTION DOES NOT REWRITE THE CLOSED PERIOD. The withdrawn and the
 * replacement ratings are both facts, and the DIFFERENCE between them appears as
 * a `CORRECTION` line in the first period still open (see
 * `settlementLineTypeSchema`). CLAUDE.md forbids a correction from rewriting
 * historical sessions, and the frozen Milestone 8 rule forbids reopening a
 * closed period; carrying the delta forward is what satisfies both.
 */
export const correctSessionRatingRequestSchema = z
  .strictObject({
    sessionChargeId: z.uuid(),
    sessionSettlementId: z.uuid(),
    withdrawReason: settlementReasonSchema,
    replacement: rateSessionRequestSchema.extend({ sessionChargeId: z.uuid() }),
  })
  .refine(
    (value) => value.replacement.sessionChargeId === value.sessionChargeId,
    'the replacement rating must be for the same session charge as the rating being withdrawn',
  );

export type CorrectSessionRatingRequest = z.infer<typeof correctSessionRatingRequestSchema>;

/**
 * ONE RESPONSE SHAPE FOR EVERY WRITE THAT TOUCHES A RATING.
 *
 * Rating a session, withdrawing a rating and correcting one all return the
 * rating that now stands, for the reason `sessionChargeResponseSchema` returns
 * the charge: the caller is looking at a screen that has to show what is true
 * now, and a second request to find out would be a second answer that can
 * disagree with the first.
 *
 * On a correction it is the REPLACEMENT that is returned — the rating that
 * stands — with `supersedesSessionSettlementId` naming the one that was
 * withdrawn, so the whole correction is reachable from the response.
 */
export const sessionSettlementResponseSchema = z.strictObject({
  settlement: sessionSettlementSchema,
});

export type SessionSettlementResponse = z.infer<typeof sessionSettlementResponseSchema>;
