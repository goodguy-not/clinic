import { z } from 'zod';
import { isoDateSchema } from '../dates';
import { signedTomanAmountSchema, tomanAmountSchema } from '../money';
import { reportTherapistSummarySchema } from '../reports/common';
import { tariffPriceModeSchema } from '../catalog/tariffs';
import { ratedViaSchema, settlementLineTypeSchema, shareBasisPointsSchema } from './common';

/**
 * CLOSING A SETTLEMENT PERIOD: drawing a line under one therapist's earnings
 * for one explicit range, after which those figures never move again.
 *
 * ONE THERAPIST AT A TIME, AND THE RANGE IS ALWAYS STATED. There is no
 * "close the month" that sweeps the whole clinic: closing is an act a manager
 * performs having looked at one person's statement, and a request that closed
 * everybody would close periods nobody had read — including the ones with
 * unrated sessions in them, silently and permanently.
 *
 * A CLOSED PERIOD IS IMMUTABLE AND IS NEVER REOPENED. There is no un-close
 * request in this package, and there deliberately never will be one: a figure
 * that can be reopened is a figure that was never agreed. What happens instead
 * when something inside a closed period turns out to be wrong is a CORRECTION —
 * withdrawal and re-rating in one act (`correctSessionRatingRequestSchema`),
 * whose delta is carried into the first period still open as a `CORRECTION`
 * line. CLAUDE.md forbids a correction from rewriting historical sessions; this
 * is the shape of not rewriting them.
 *
 * A CLOSE MAY SUCCEED WITH UNRATED SESSIONS IN THE RANGE, AND SAYS SO. It does
 * not fail merely because somebody has not rated everything: a clinic that
 * cannot close a month until every last session is decided is a clinic that
 * stops paying people over one forgotten appointment. What it must never do is
 * pretend the range was complete, so the count of what was left out is recorded
 * ON THE PERIOD, permanently, and returned by every read of it.
 *
 * NOTHING HERE PAYS ANYBODY. Closing records that a period's earnings are
 * final; it does not record money leaving the clinic, and no field in this file
 * is named `paid`, `payable`, `owed`, `due` or `balance` (the frozen Milestone 8
 * terminology decision). Actual therapist payout is outside Milestone 8
 * entirely.
 */

/**
 * Closing one therapist's period.
 *
 * BOTH ENDS ARE EXPLICIT AND INCLUSIVE, and there is no calendar-month
 * shorthand. "Close Mordad" reads well and is the wrong request: a period whose
 * boundaries are computed by whoever asks is a period two callers can disagree
 * about, and the disagreement surfaces as a session settled twice or not at all.
 * The dates are `SESSION_DATE`, the same basis the statement is read on.
 *
 * NO REASON FIELD, DELIBERATELY. A close is an ordinary, expected act performed
 * at the end of a period, not a correction or an override; the acts that need
 * explaining in this milestone are the ones that change a figure somebody has
 * already seen, and every one of them carries a mandatory reason. Requiring one
 * here would train managers to type a word to get past a box.
 */
export const closeSettlementPeriodRequestSchema = z
  .strictObject({
    therapistId: z.uuid(),
    from: isoDateSchema,
    to: isoDateSchema,
  })
  .refine((value) => value.from <= value.to, 'the range must not end before it starts');

export type CloseSettlementPeriodRequest = z.infer<typeof closeSettlementPeriodRequestSchema>;

/**
 * A closed period, as every read of one returns it.
 *
 * `excludedUnratedSessionCount` IS THE FIELD THIS SHAPE EXISTS FOR. It is the
 * number of completed, attended, charged sessions inside the range that carried
 * no rating at the moment of closing, and it is stored on the period rather than
 * recomputed on read. Recomputing it would give a different answer the moment
 * one of those sessions was rated afterwards — and the answer that matters is
 * the one that was true when the manager closed, because that is the number that
 * says what the closed figure did NOT include. A period that lost that count
 * would be a total nobody could ever reconcile against the diary.
 *
 * `settledSessionCount` AND `carriedInCorrectionCount` ARE SEPARATE, because a
 * correction carried in from an earlier closed period is not work done in this
 * one. Reading them as one number would make a therapist's session count wander
 * away from the number of appointments they actually attended.
 *
 * `settledToman` IS SIGNED, and it is the net settlement the close made final:
 * this period's own lines plus any corrections carried into it. A period whose
 * carried-in corrections outweigh its primaries is genuinely negative, and
 * clamping it to zero would state a figure the clinic does not mean. The
 * per-session rule that a therapist net is never negative is untouched — it is a
 * rule about a session, not about a period that includes a withdrawal of an
 * earlier one.
 *
 * `carriedInCorrectionToman` IS SIGNED FOR THE SAME REASON, and is stated
 * separately so the difference between "this period's work" and "last period's
 * correction" is readable on the closed record itself.
 *
 * THERE IS NO STATUS FIELD. A `settlement_period` row exists only because a
 * close happened, so every one of them is closed; an `OPEN` state would be a row
 * describing the absence of an act, and the open period is simply the range no
 * closed period covers.
 */
export const settlementPeriodSchema = z.strictObject({
  id: z.uuid(),
  therapistId: z.uuid(),
  from: isoDateSchema,
  to: isoDateSchema,
  settledSessionCount: z.number().int().nonnegative(),
  carriedInCorrectionCount: z.number().int().nonnegative(),
  excludedUnratedSessionCount: z.number().int().nonnegative(),
  therapistGrossToman: tomanAmountSchema,
  therapistDiscountToman: tomanAmountSchema,
  carriedInCorrectionToman: signedTomanAmountSchema,
  settledToman: signedTomanAmountSchema,
  closedAt: z.iso.datetime(),
  closedByUserId: z.uuid(),
});

export type SettlementPeriod = z.infer<typeof settlementPeriodSchema>;

/**
 * What happened when a period was closed.
 *
 * TWO OUTCOMES, AND EVERY OTHER ANSWER IS AN ERROR — the shape
 * `chargePostResultSchema` already uses, for the same reason. A first close is
 * `CLOSED`; a retry that found the identical period already closed is
 * `ALREADY_CLOSED` and carries that same period. Nothing was refused in either
 * case, so neither is an error envelope, and the interface still has to say
 * "closed" in one case and "already closed" in the other, which a bare 200 could
 * not distinguish.
 *
 * `ALREADY_CLOSED` IS IDEMPOTENCE, NOT OVERLAP. It is the answer to repeating
 * the SAME request — same therapist, same two dates — which is what a
 * double-submitted form produces. A range that PARTIALLY overlaps an existing
 * closed period is a different request with a different meaning and is refused
 * as `SETTLEMENT_PERIOD_OVERLAP`: it would settle some sessions twice, and
 * silently succeeding is how somebody gets paid for the same session in two
 * months.
 *
 * THERE IS NO `NOTHING_TO_CLOSE` MEMBER. A range in which the therapist did no
 * work closes normally, with zero counts and zero amounts — it is a true and
 * useful fact that the period was reviewed and contained nothing, and refusing
 * it would leave a gap in the record indistinguishable from a month nobody got
 * round to.
 */
export const SETTLEMENT_CLOSE_OUTCOMES = ['CLOSED', 'ALREADY_CLOSED'] as const;

export type SettlementCloseOutcome = (typeof SETTLEMENT_CLOSE_OUTCOMES)[number];

export const closeSettlementPeriodResultSchema = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('CLOSED'), period: settlementPeriodSchema }),
  z.strictObject({ outcome: z.literal('ALREADY_CLOSED'), period: settlementPeriodSchema }),
]);

export type CloseSettlementPeriodResult = z.infer<typeof closeSettlementPeriodResultSchema>;

export const closeSettlementPeriodResponseSchema = closeSettlementPeriodResultSchema;

export type CloseSettlementPeriodResponse = z.infer<typeof closeSettlementPeriodResponseSchema>;

/**
 * Reading the closed periods of one therapist.
 *
 * `therapistId` IS REQUIRED, as it is on the statement: a closed period belongs
 * to one person, and a clinic-wide listing is a different report nobody has
 * approved.
 *
 * THE RANGE IS OPTIONAL HERE, unlike everywhere else in the reporting
 * contracts, and the difference is deliberate: "which periods has this therapist
 * had closed?" is a question about a short list of records rather than about a
 * span of clinic activity, and the whole list is the useful answer. When both
 * ends are given, they select periods that INTERSECT the range — a period is
 * either closed or it is not, and one that straddles the boundary is still a
 * fact about the range.
 */
export const settlementPeriodListQuerySchema = z
  .strictObject({
    therapistId: z.uuid(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .refine(
    (value) => value.from == null || value.to == null || value.from <= value.to,
    'the range must not end before it starts',
  );

export type SettlementPeriodListQuery = z.infer<typeof settlementPeriodListQuerySchema>;

/**
 * Every closed period the filter matched, newest first, with the therapist
 * named once rather than repeated on each row.
 *
 * NOT PAGED. A therapist accumulates twelve closed periods a year at a monthly
 * cadence; a page two would be a control nobody ever clicks.
 */
export const settlementPeriodListResponseSchema = z.strictObject({
  therapist: reportTherapistSummarySchema,
  periods: z.array(settlementPeriodSchema),
});

export type SettlementPeriodListResponse = z.infer<typeof settlementPeriodListResponseSchema>;

/**
 * ONE MATERIALISED SETTLEMENT LINE OF A CLOSED PERIOD, READ BACK AS IT WAS
 * WRITTEN.
 *
 * WHY A SECOND READ EXISTS AT ALL. `settlementPeriodSchema` states what a period
 * came to; it does not state what it was made of, and a manager asked to stand
 * behind a figure has to be able to see the sessions under it. This is that
 * list, and it is A READ OF STORED ROWS AND NOTHING ELSE: every amount below is
 * the number `settlement_line` already holds, selected, not recomputed. No share
 * rule is consulted, no concession is re-totalled and no current figure is
 * derived — which is the whole point, because a detail view that recomputed
 * would eventually disagree with the period it claims to explain.
 *
 * `lineType` IS THE FACT, NOT AN INFERENCE FROM THE SIGN. A `PRIMARY` line is
 * what a session was first settled at; a `CORRECTION` line is a later signed
 * MOVEMENT on a session an EARLIER period already settled, and `baseAmountToman`
 * and every other amount on it MAY BE NEGATIVE for exactly that reason. This is
 * why the amounts here are signed where the statement's are not: the statement
 * shows what a session is worth, and this shows what a period moved.
 *
 * `correctsSettlementLineId` IS THE TRACE BACK. It is null on every `PRIMARY`
 * and names the earlier line on every `CORRECTION`, so a reader can follow a
 * signed delta to the historical fact it reconciles rather than guessing from
 * the charge. `sessionChargeId` is the other half of that: every line of one
 * session shares it, across every period the session ever appeared in.
 *
 * `carriedIn` DISTINGUISHES HISTORY FROM THE PERIOD'S OWN WORK. It is true when
 * the line's `serviceDate` falls OUTSIDE the period's own range — a session done
 * earlier that this close is the first to settle, or a correction to one — and
 * false for work done inside it. A closed line keeps its ORIGINAL clinic day and
 * is never restated as work done in the period that settled it, so without this
 * flag a reader would have to compare dates by hand to tell a September session
 * settled in October apart from October's own.
 *
 * `priceMode` IS PRESENT FOR THE SAME REASON IT IS ON THE STATEMENT: a `FREE`
 * session materialises a line worth zero, and zero is not evidence of anything
 * on its own.
 */
export const settlementPeriodLineSchema = z.strictObject({
  id: z.uuid(),
  settlementPeriodId: z.uuid(),
  lineType: settlementLineTypeSchema,
  correctsSettlementLineId: z.uuid().nullable(),
  sessionChargeId: z.uuid(),
  sessionSettlementId: z.uuid(),
  appointmentParticipantId: z.uuid(),
  therapistId: z.uuid(),
  serviceDate: isoDateSchema,
  carriedIn: z.boolean(),
  serviceId: z.uuid(),
  serviceName: z.string(),
  durationMinutes: z.number().int().positive(),
  priceMode: tariffPriceModeSchema,
  appliedShareBasisPoints: shareBasisPointsSchema,
  ratedVia: ratedViaSchema,
  baseAmountToman: signedTomanAmountSchema,
  therapistGrossToman: signedTomanAmountSchema,
  therapistDiscountToman: signedTomanAmountSchema,
  therapistNetToman: signedTomanAmountSchema,
  clinicGrossToman: signedTomanAmountSchema,
  clinicDiscountToman: signedTomanAmountSchema,
  clinicNetToman: signedTomanAmountSchema,
  createdAt: z.iso.datetime(),
});

export type SettlementPeriodLine = z.infer<typeof settlementPeriodLineSchema>;

/**
 * One closed period and every line under it.
 *
 * THE PERIOD IS REPEATED HERE rather than left to the caller to have fetched,
 * because the aggregate and the detail have to be read as one consistent pair:
 * a totals row from one request and lines from another is how a screen shows a
 * sum that does not add up.
 *
 * NOT PAGED, for the reason the period list is not: a month of one therapist's
 * sessions is tens of rows.
 */
export const settlementPeriodDetailResponseSchema = z.strictObject({
  therapist: reportTherapistSummarySchema,
  period: settlementPeriodSchema,
  lines: z.array(settlementPeriodLineSchema),
});

export type SettlementPeriodDetailResponse = z.infer<typeof settlementPeriodDetailResponseSchema>;
