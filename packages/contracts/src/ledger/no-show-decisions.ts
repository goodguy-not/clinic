import { z } from 'zod';
import { appointmentStatusSchema, attendanceOutcomeSchema } from '../appointments/common';
import { appointmentTariffSuggestionSchema } from '../appointments/day';
import { isoDateSchema } from '../dates';
import { tomanAmountSchema } from '../money';
import { reportFamilySummarySchema } from '../reports/common';
import { sessionChargeDetailSchema } from './charges';
import {
  chargeChildSummarySchema,
  ledgerPageQuerySchema,
  ledgerReasonSchema,
  pageInfoSchema,
  penaltyPercentSchema,
} from './common';

/**
 * No-show decisions and penalties (M10.5 phase 1, T-022; owner decisions A1–A5).
 *
 *   GET  /no-show-decisions/pending                                         list
 *   POST /appointments/:id/participants/:pid/no-show-decision/preview       amount, writes nothing
 *   POST /appointments/:id/participants/:pid/no-show-decision               decide
 *   POST /no-show-decisions/:id/withdraw                                    withdraw (voids its penalty)
 *
 * A "did not come" creates no charge. It puts the seat in the manager's list,
 * and the manager decides "no penalty" or a whole percentage of the session
 * price, with a reason; the decision is kept for ever, "no penalty" included.
 *
 * A PENALTY IS A SESSION CHARGE OF KIND `NO_SHOW_PENALTY` (D1) on the absent
 * seat: it reaches the family account, payments, reports, rating, statement
 * and period close through the paths that already exist. Its amounts are fixed
 * by the SESSION DATE — the tariff and the therapist's share valid on that day,
 * whenever the manager decides — and it is split with the therapist in the
 * session's share ratio (A5) by the existing rating.
 *
 * MANAGER-ONLY. Deciding is `charge.adjust`; withdrawing is `charge.adjust` and
 * `charge.void` (`NO_SHOW_DECISION_WITHDRAW_PERMISSIONS`); the list is readable
 * by both roles (`NO_SHOW_DECISION_PENDING_READ_PERMISSIONS`).
 */

export const NO_SHOW_DECISION_OUTCOMES = ['NO_PENALTY', 'PENALTY'] as const;

export type NoShowDecisionOutcome = (typeof NO_SHOW_DECISION_OUTCOMES)[number];

export const noShowDecisionOutcomeSchema = z.enum(NO_SHOW_DECISION_OUTCOMES);

/**
 * One recorded decision, as stored. Immutable except for the one-way
 * withdrawal, which carries its own actor, instant and reason (D3).
 *
 * `penaltyPercent` and `sessionChargeId` are present exactly when the outcome is
 * `PENALTY`; `sessionChargeId` names the penalty charge, which stays named after
 * the decision is withdrawn (the charge is voided, never erased).
 */
export const noShowDecisionSchema = z
  .strictObject({
    id: z.uuid(),
    appointmentId: z.uuid(),
    appointmentParticipantId: z.uuid(),
    outcome: noShowDecisionOutcomeSchema,
    penaltyPercent: penaltyPercentSchema.nullable(),
    sessionChargeId: z.uuid().nullable(),
    reason: z.string(),
    createdAt: z.iso.datetime(),
    createdByUserId: z.uuid(),
    voidedAt: z.iso.datetime().nullable(),
    voidedByUserId: z.uuid().nullable(),
    voidReason: z.string().nullable(),
  })
  .refine(
    (value) =>
      value.outcome === 'PENALTY'
        ? value.penaltyPercent !== null && value.sessionChargeId !== null
        : value.penaltyPercent === null && value.sessionChargeId === null,
    'a penalty carries its percent and charge; "no penalty" carries neither',
  );

export type NoShowDecision = z.infer<typeof noShowDecisionSchema>;

/**
 * Deciding one absent seat. The reason is required for both answers: "no
 * penalty" is a decision about money as much as a penalty is.
 */
export const recordNoShowDecisionRequestSchema = z.discriminatedUnion('outcome', [
  z.strictObject({
    outcome: z.literal('NO_PENALTY'),
    reason: ledgerReasonSchema,
  }),
  z.strictObject({
    outcome: z.literal('PENALTY'),
    penaltyPercent: penaltyPercentSchema,
    reason: ledgerReasonSchema,
  }),
]);

export type RecordNoShowDecisionRequest = z.infer<typeof recordNoShowDecisionRequestSchema>;

/**
 * `RECORDED` for a new decision; `ALREADY_RECORDED` when the same answer (and
 * percentage) already stands — a double submit, which writes nothing and
 * returns the standing decision. A DIFFERENT answer while one stands is
 * `NO_SHOW_DECISION_EXISTS`. `charge` is the penalty charge, or null for "no
 * penalty".
 */
export const NO_SHOW_DECISION_RECORD_OUTCOMES = ['RECORDED', 'ALREADY_RECORDED'] as const;

export const recordNoShowDecisionResponseSchema = z.strictObject({
  outcome: z.enum(NO_SHOW_DECISION_RECORD_OUTCOMES),
  decision: noShowDecisionSchema,
  charge: sessionChargeDetailSchema.nullable(),
});

export type RecordNoShowDecisionResponse = z.infer<typeof recordNoShowDecisionResponseSchema>;

/**
 * The amount a penalty WOULD be, computed by the API so the Web never
 * multiplies (R1-5): "= 720,000 toman of 1,200,000". Writes nothing.
 */
export const previewNoShowPenaltyRequestSchema = z.strictObject({
  penaltyPercent: penaltyPercentSchema,
});

export type PreviewNoShowPenaltyRequest = z.infer<typeof previewNoShowPenaltyRequestSchema>;

/**
 * `sessionPriceToman` is the tariff valid on the SESSION DATE (`serviceDate`),
 * never today's; `penaltyAmountToman` is round-half-up(price × percent / 100).
 */
export const previewNoShowPenaltyResponseSchema = z.strictObject({
  penaltyPercent: penaltyPercentSchema,
  serviceDate: isoDateSchema,
  tariffId: z.uuid(),
  sessionPriceToman: tomanAmountSchema,
  penaltyAmountToman: tomanAmountSchema,
});

export type PreviewNoShowPenaltyResponse = z.infer<typeof previewNoShowPenaltyResponseSchema>;

/** Withdrawing a decision always says why; a penalty it raised is voided with that reason. */
export const withdrawNoShowDecisionRequestSchema = z.strictObject({
  reason: ledgerReasonSchema,
});

export type WithdrawNoShowDecisionRequest = z.infer<typeof withdrawNoShowDecisionRequestSchema>;

/** The withdrawn decision, and its penalty charge as it now stands (voided), or null. */
export const withdrawNoShowDecisionResponseSchema = z.strictObject({
  decision: noShowDecisionSchema,
  charge: sessionChargeDetailSchema.nullable(),
});

export type WithdrawNoShowDecisionResponse = z.infer<typeof withdrawNoShowDecisionResponseSchema>;

/**
 * "No-shows to decide": every absent seat of a completed session with no
 * standing decision, oldest session first. Clinic-wide and not scoped to a day
 * — an absence from three weeks ago that nobody decided is exactly what the list
 * is for. The optional bounds are clinic dates compared with the session date.
 */
export const noShowPendingQuerySchema = ledgerPageQuerySchema
  .extend({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    therapistId: z.uuid().optional(),
  })
  .refine(
    (value) => value.from === undefined || value.to === undefined || value.from <= value.to,
    'the range must not end before it starts',
  );

export type NoShowPendingQuery = z.infer<typeof noShowPendingQuerySchema>;

/**
 * One waiting item. `sessionPrice` is the tariff valid on the session date, as
 * the API resolves it (`MISSING` blocks a penalty, not "no penalty");
 * `daysWaiting` counts clinic days since the absence was recorded.
 */
export const noShowPendingItemSchema = z.strictObject({
  appointmentId: z.uuid(),
  participantId: z.uuid(),
  startsAt: z.iso.datetime(),
  serviceDate: isoDateSchema,
  durationMinutes: z.number().int().positive(),
  family: reportFamilySummarySchema,
  child: chargeChildSummarySchema,
  service: z.strictObject({ id: z.uuid(), name: z.string() }),
  therapist: z.strictObject({ id: z.uuid(), fullName: z.string() }),
  sessionPrice: appointmentTariffSuggestionSchema,
  absenceRecordedAt: z.iso.datetime().nullable(),
  daysWaiting: z.number().int().nonnegative(),
});

export type NoShowPendingItem = z.infer<typeof noShowPendingItemSchema>;

export const noShowPendingResponseSchema = z.strictObject({
  items: z.array(noShowPendingItemSchema),
  page: pageInfoSchema,
});

export type NoShowPendingResponse = z.infer<typeof noShowPendingResponseSchema>;

/**
 * The `details` of `NO_SHOW_DECISION_EXISTS`: the standing decision, so the
 * screen can say what was decided and offer to withdraw it. Raised by a
 * different second decision, by correcting the absence to present, and by
 * reopening the session.
 */
export const noShowDecisionExistsDetailsSchema = z.strictObject({
  noShowDecisionId: z.uuid(),
  outcome: noShowDecisionOutcomeSchema,
  penaltyPercent: penaltyPercentSchema.nullable(),
});

export type NoShowDecisionExistsDetails = z.infer<typeof noShowDecisionExistsDetailsSchema>;

/**
 * The `details` of `NO_SHOW_NOT_DECIDABLE`: only an absent seat (`NO_SHOW`) of
 * a completed session can be decided, and this says what the seat is instead.
 */
export const noShowNotDecidableDetailsSchema = z.strictObject({
  appointmentStatus: appointmentStatusSchema,
  attendance: attendanceOutcomeSchema,
});

export type NoShowNotDecidableDetails = z.infer<typeof noShowNotDecidableDetailsSchema>;
