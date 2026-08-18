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
 * `appliedShareBasisPoints` IS THE SNAPSHOT AND `appliedShareRuleId` IS ONLY
 * PROVENANCE. The percentage that was applied lives on this row as a number; the
 * rule id says where it came from and is null on an `EXPLICIT` rating, which had
 * no rule behind it. Nothing may re-resolve the number from the rule, including
 * when the rule is later voided — which is exactly when a re-resolution would
 * silently change a closed month.
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
 * Applying the agreed percentage explains itself; overriding it does not.
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
  appliedShareRuleId: z.uuid().nullable(),
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
 * Rating a session: the two ways it can happen, as two shapes rather than one
 * shape with optional fields.
 *
 * A DISCRIMINATED UNION MAKES THE INVALID COMBINATIONS UNREPRESENTABLE.
 * "Automatic, but here is a percentage" and "explicit, but no percentage and no
 * reason" are both refused by the type rather than by a refinement somebody has
 * to remember to read. It is the same device `createTariffRequestSchema` uses
 * for `PAID` and `FREE`, and for the same reason: two genuinely different acts
 * that happen to write to one table.
 *
 * THE AUTOMATIC MEMBER CARRIES NOTHING AT ALL, and states that rather than
 * omitting the body. The session is named by the path, the actor and the
 * instant are the request's own, and the percentage is resolved by the server
 * from the therapist's effective-dated rule covering the session date. A caller
 * that sends a percentage anyway is refused by `strictObject` rather than
 * having it silently dropped — which is what would turn an override into an
 * unrecorded one.
 *
 * THE EXPLICIT MEMBER REQUIRES BOTH THE NUMBER AND THE REASON. CLAUDE.md
 * requires every manual override to be explicit, reasoned and auditable, so a
 * reason is not optional and not defaulted.
 *
 * NO BASE AMOUNT IS SUBMITTABLE IN EITHER MEMBER. The basis is the posted
 * charge, read by the server from the charge itself; a caller that could state
 * it could state a different one.
 */
const automaticRatingFields = z.strictObject({
  ratedVia: z.literal('AUTOMATIC'),
});

const explicitRatingFields = z.strictObject({
  ratedVia: z.literal('EXPLICIT'),
  shareBasisPoints: shareBasisPointsSchema,
  reason: settlementReasonSchema,
});

export const rateSessionRequestSchema = z.discriminatedUnion('ratedVia', [
  automaticRatingFields,
  explicitRatingFields,
]);

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
    replacement: z.discriminatedUnion('ratedVia', [
      automaticRatingFields.extend({ sessionChargeId: z.uuid() }),
      explicitRatingFields.extend({ sessionChargeId: z.uuid() }),
    ]),
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
