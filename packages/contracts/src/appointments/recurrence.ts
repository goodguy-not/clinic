import { z } from 'zod';
import { durationMinutesSchema } from '../catalog/common';
import { isoDateSchema } from '../dates';
import type { ErrorCode } from '../errors';
import { appointmentSeriesSchema } from './appointments';
import { appointmentDetailSchema, createAppointmentRequestSchema } from './booking';
import {
  appointmentNoteSchema,
  appointmentReasonSchema,
  clockTimeSchema,
  recurrenceEndSchema,
  weekdaySchema,
} from './common';
import { cancellationPartySchema } from './lifecycle';
import { appointmentConflictSchema, availabilityRefusalReasonSchema } from './refusals';

/**
 * Weekly recurrence: previewing a pattern, creating the series it describes, and
 * changing or calling off the rest of it from one occurrence onwards.
 *
 * THE APPROVED MODEL IS DELIBERATELY SMALL. One weekday, one placement, one
 * time of day, repeated every week or every n-th week until a stated bound. A
 * child seen twice a week is TWO SERIES, and that is not a limitation being
 * worked around — it is what keeps "this and all future occurrences" a
 * question with one answer. Nothing here expresses a multi-weekday rule, a
 * monthly rule, a per-occurrence override or an exception list.
 *
 * THE SERIES IS AN IDENTITY AND A TERMINATION RULE, NOT A TEMPLATE. Every
 * occurrence it generates is an ordinary appointment row with its own id, its
 * own status, its own audit history and its own seat, and stays independently
 * movable, cancellable and completable through the existing lifecycle
 * (PROJECT_SPEC.md 6). `seriesId` records which pattern produced it; it does not
 * make it a slave of one. Changing a single occurrence is `PATCH
 * /appointments/:id`, and there is no second lifecycle here.
 *
 * NOTHING FINANCIAL. A series creates no price snapshot, no charge and no
 * amount, exactly as a single booking creates none. Pricing is Milestone 5's.
 */

/**
 * TWO BOUNDS, AND A SERIES MUST SATISFY BOTH.
 *
 * A year of weekly sessions, and no session further out than a year. They are
 * not the same limit and neither implies the other: fifty-two fortnightly
 * sessions run for two years, and a session every twelfth week for a year is
 * only five sessions. A rule that breaks either is refused with
 * `RECURRENCE_RULE_INVALID` rather than silently truncated — a receptionist who
 * asked for two years and was given one would find out when a family arrived.
 *
 * They are modelled limits rather than performance ones. The clinic plans a
 * term at a time, hours and tariffs change, and a booking made three years
 * ahead is a booking nobody will honour. `appointment_series_occurrence_count_chk`
 * permits up to 260 and is deliberately looser: it is the database's guard
 * against a mistyped run of digits, not a statement of policy.
 *
 * BOTH APPLY TO BOTH END MODES, and to the preview as much as to the create —
 * a preview that showed eighty weeks the create would refuse would be worse
 * than no preview.
 */
export const RECURRENCE_OCCURRENCES_MAX = 52;

/** Measured from the FIRST occurrence's clinic date, not from today. */
export const RECURRENCE_HORIZON_MONTHS = 12;

/**
 * 1 is every week, 2 every second week. Matches
 * `appointment_series_interval_chk`; nothing beyond a weekly rhythm is approved.
 */
export const recurrenceIntervalSchema = z.number().int().min(1).max(12);

/**
 * How the series stops, as a shape that cannot state two bounds or none.
 *
 * A discriminated union rather than two nullable fields, because
 * `appointment_series_end_chk` requires exactly the column the mode names and a
 * request that could carry both would be a request that can contradict itself.
 * `RECURRENCE_RULE_INVALID` is left for what a shape cannot decide: a last date
 * earlier than the first session, and either approved bound broken — more than
 * `RECURRENCE_OCCURRENCES_MAX` sessions, or a session beyond
 * `RECURRENCE_HORIZON_MONTHS`. Neither is decidable here, because both depend on
 * the first occurrence's clinic date, which is an instant this shape never sees.
 */
export const recurrenceRuleSchema = z.discriminatedUnion('endMode', [
  z.strictObject({
    endMode: z.literal('OCCURRENCE_COUNT'),
    intervalWeeks: recurrenceIntervalSchema,
    occurrenceCount: z.number().int().min(1).max(RECURRENCE_OCCURRENCES_MAX),
  }),
  z.strictObject({
    endMode: z.literal('END_DATE'),
    intervalWeeks: recurrenceIntervalSchema,
    /** Inclusive: an occurrence falling exactly on this clinic date is generated. */
    endsOn: isoDateSchema,
  }),
]);

export type RecurrenceRule = z.infer<typeof recurrenceRuleSchema>;

/**
 * A series is requested as a first booking plus a rule.
 *
 * THE FIRST OCCURRENCE IS THE PATTERN. Its clinic weekday and its wall-clock
 * time are what every later occurrence repeats, and they are read from
 * `startsAt` rather than submitted separately — two fields stating the same fact
 * are two fields that can disagree, and the disagreement would decide which day
 * a family is expected on.
 *
 * EVERY FIELD A SINGLE BOOKING TAKES, AND ONE MORE. The request extends
 * `createAppointmentRequestSchema` rather than restating it, so a series is
 * validated as the booking it is: the same service, therapist, room, child,
 * note and — for the occurrences that need it — the same one recorded
 * availability override.
 *
 * `availabilityOverrideReason` covers the WHOLE series and is recorded on
 * exactly the occurrences that actually fall outside the therapist's hours. A
 * series inside working hours records nothing, and a dated closure part-way
 * through a term is the ordinary reason a single occurrence carries the reason
 * and its siblings do not.
 */
export const createAppointmentSeriesRequestSchema = createAppointmentRequestSchema.extend({
  recurrence: recurrenceRuleSchema,
});

export type CreateAppointmentSeriesRequest = z.infer<typeof createAppointmentSeriesRequestSchema>;

/**
 * Why one previewed occurrence could not be booked as submitted.
 *
 * A SUBSET OF THE ERROR CODES THE BOOKING ITSELF RAISES, never a second
 * vocabulary: the interface already translates these, and a preview that
 * invented its own names would say something different from the refusal the
 * same request produces a moment later.
 *
 * Ordered by the precedence the booking applies them in — availability is
 * decided before the child, and the child before the two resource constraints —
 * so a preview reports the same reason the create would fail with rather than
 * whichever rule this list happens to check first.
 */
export const RECURRENCE_BLOCK_CODES = [
  // Only a this-and-future preview reports this one: an occurrence that has not
  // started yet would be moved to an instant that has already passed.
  'RECURRENCE_OCCURRENCE_IN_PAST',
  'APPOINTMENT_OUTSIDE_AVAILABILITY',
  'APPOINTMENT_CHILD_CONFLICT',
  'APPOINTMENT_THERAPIST_CONFLICT',
  'APPOINTMENT_ROOM_CONFLICT',
] as const satisfies readonly ErrorCode[];

export type RecurrenceBlockCode = (typeof RECURRENCE_BLOCK_CODES)[number];

export const recurrenceBlockCodeSchema = z.enum(RECURRENCE_BLOCK_CODES);

/**
 * One occurrence the rule would generate, and what the diary says about it
 * right now.
 *
 * `outsideAvailability` and `blockedBy` are separate facts. A session outside
 * the therapist's hours that the submitted override covers is NOT blocked — it
 * is booked, with the reason recorded — and the interface still has to show
 * which weeks that applies to, because "three of these twelve are outside her
 * hours" is what the receptionist rings the therapist about.
 *
 * `index` is the occurrence's position in the rule, from 0. It is not stored
 * anywhere: an occurrence is identified by its own appointment id once created,
 * and a position that shifted when one week was cancelled would be a second,
 * wrong, identity.
 */
export const recurrencePreviewOccurrenceSchema = z.strictObject({
  index: z.number().int().nonnegative(),
  date: isoDateSchema,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  outsideAvailability: z.boolean(),
  /** Why the week is outside the therapist's availability (M10-A10, T-025); null when inside. */
  outsideAvailabilityReason: availabilityRefusalReasonSchema.nullable(),
  /**
   * Every session in the way, per dimension, in the order child, therapist,
   * room (M10-A10, T-024) — the same list the booking's refusal would carry.
   */
  conflicts: z.array(appointmentConflictSchema),
  blockedBy: recurrenceBlockCodeSchema.nullable(),
});

export type RecurrencePreviewOccurrence = z.infer<typeof recurrencePreviewOccurrenceSchema>;

/** The pattern the first booking and the rule work out to, echoed back. */
export const recurrencePatternSchema = z.strictObject({
  /** Saturday-first, as everywhere else in this product. */
  weekday: weekdaySchema,
  startTime: clockTimeSchema,
  endTime: clockTimeSchema,
  durationMinutes: durationMinutesSchema,
  intervalWeeks: recurrenceIntervalSchema,
  endMode: recurrenceEndSchema,
  occurrenceCount: z.number().int().positive().max(RECURRENCE_OCCURRENCES_MAX).nullable(),
  endsOn: isoDateSchema.nullable(),
});

export type RecurrencePattern = z.infer<typeof recurrencePatternSchema>;

/**
 * A DRY RUN THAT WRITES NOTHING.
 *
 * It exists because series creation is all-or-nothing: a receptionist entering
 * a term of twelve sessions is told which weeks are already taken BEFORE the
 * request that would refuse the lot, and can move the hour once instead of
 * discovering the clash twelve times.
 *
 * IT IS ADVISORY, AND THE CREATE IS AUTHORITATIVE. Everything here is read
 * outside the transaction that would write, so a slot free at preview may be
 * taken by the time create runs. `bookable` therefore means "nothing was in the
 * way a moment ago", never "this will succeed" — which is exactly why the
 * create re-decides every rule under its own locks and constraints rather than
 * trusting a token from here.
 */
export const recurrencePreviewResponseSchema = z.strictObject({
  pattern: recurrencePatternSchema,
  occurrences: z.array(recurrencePreviewOccurrenceSchema),
  blockedCount: z.number().int().nonnegative(),
  /** True when no occurrence is blocked. Advisory, for the reason above. */
  bookable: z.boolean(),
});

export type RecurrencePreviewResponse = z.infer<typeof recurrencePreviewResponseSchema>;

/**
 * A series and every occurrence that belongs to it, in start order.
 *
 * THE WHOLE SERIES, WHATEVER HAPPENED TO EACH WEEK. A completed session, a
 * cancelled one and a scheduled one all stay in this list: membership is a
 * permanent fact about the appointment, and a view that hid the cancelled weeks
 * would make "what happened to this arrangement?" unanswerable.
 */
export const appointmentSeriesDetailSchema = z.strictObject({
  series: appointmentSeriesSchema,
  occurrences: z.array(appointmentDetailSchema),
});

export type AppointmentSeriesDetail = z.infer<typeof appointmentSeriesDetailSchema>;

export const appointmentSeriesResponseSchema = appointmentSeriesDetailSchema;

export type AppointmentSeriesResponse = z.infer<typeof appointmentSeriesResponseSchema>;

/**
 * The same series, plus exactly which occurrences a this-and-future operation
 * changed.
 *
 * Stated by the server rather than diffed by the caller: "eight sessions were
 * cancelled, two were left alone because they had already happened" is the
 * sentence the receptionist needs, and a browser recomputing it would have to
 * decide for itself what "eligible" meant.
 */
export const appointmentSeriesOperationResponseSchema = appointmentSeriesDetailSchema.extend({
  changedAppointmentIds: z.array(z.uuid()),
});

export type AppointmentSeriesOperationResponse = z.infer<
  typeof appointmentSeriesOperationResponseSchema
>;

/**
 * Calling off the rest of a series.
 *
 * FROM ONE OCCURRENCE ONWARDS, NAMED BY ITS APPOINTMENT ID rather than by a
 * date or a position. The pivot is a row the caller is looking at, and an index
 * would move the moment a week was cancelled.
 *
 * IT TOUCHES ONLY ELIGIBLE FUTURE WEEKS. Occurrences already completed or
 * already cancelled are left exactly as they are — history is not rewritten by
 * a decision about the future — and each week that IS cancelled is cancelled as
 * itself, with its own audit row, carrying the same party and reason a single
 * cancellation requires.
 */
export const cancelAppointmentSeriesFromRequestSchema = z.strictObject({
  fromAppointmentId: z.uuid(),
  cancelledBy: cancellationPartySchema,
  reason: appointmentReasonSchema,
});

export type CancelAppointmentSeriesFromRequest = z.infer<
  typeof cancelAppointmentSeriesFromRequestSchema
>;

/**
 * Re-placing the rest of a series: a new therapist, room, length or hour, from
 * one occurrence onwards.
 *
 * THE HOUR MOVES, AND SO MAY THE WEEKDAY (M10-A10, T-023). `startTime` is a
 * wall-clock time applied to each remaining occurrence's clinic date. With
 * `weekday` null or absent that date is the occurrence's OWN, so "Saturdays at
 * ten becomes Saturdays at eleven" leaves every date alone. With `weekday` set,
 * each remaining occurrence moves to that weekday INSIDE ITS OWN Saturday-first
 * clinic week — "Saturdays at ten becomes Mondays at four" — so the rhythm, the
 * number of sessions and the week each one belongs to are kept, nothing is
 * cancelled, and earlier occurrences are untouched. Every new placement is
 * decided exactly as a booking is, and `update-from/preview` shows the same
 * findings first. An occurrence that has not started yet is never moved to an
 * instant that has already passed (`RECURRENCE_OCCURRENCE_IN_PAST`).
 *
 * THE SERVICE AND THE CHILD ARE NOT HERE, exactly as they are absent from a
 * single move: changing either makes it a different booking wearing the same id.
 * Nor is the recurrence rule — extending a series is not an approved operation,
 * and shortening one is `cancel-from`.
 *
 * ALL OR NOTHING. If any remaining occurrence cannot be placed under the
 * approved rules the whole operation is refused and the series is left exactly
 * as it was; a term half-moved to a new room is worse than one that did not
 * move.
 */
export const updateAppointmentSeriesFromRequestSchema = z.strictObject({
  fromAppointmentId: z.uuid(),
  durationMinutes: durationMinutesSchema,
  therapistId: z.uuid(),
  roomId: z.uuid(),
  /** Saturday-first. Null or absent keeps each occurrence on its own date. */
  weekday: weekdaySchema.nullable().optional(),
  startTime: clockTimeSchema,
  note: appointmentNoteSchema.nullable(),
  availabilityOverrideReason: appointmentReasonSchema.nullable(),
});

export type UpdateAppointmentSeriesFromRequest = z.infer<
  typeof updateAppointmentSeriesFromRequestSchema
>;

/**
 * One remaining occurrence a this-and-future change would re-place, and what
 * the diary says about its new placement right now (M10-A10, T-023).
 *
 * Advisory exactly as the creation preview is: the update re-decides every rule
 * under its own locks. `unchanged` occurrences are already where the change
 * would put them and would be skipped.
 */
export const seriesUpdatePreviewOccurrenceSchema = z.strictObject({
  appointmentId: z.uuid(),
  currentStartsAt: z.iso.datetime(),
  date: isoDateSchema,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  unchanged: z.boolean(),
  outsideAvailability: z.boolean(),
  outsideAvailabilityReason: availabilityRefusalReasonSchema.nullable(),
  conflicts: z.array(appointmentConflictSchema),
  blockedBy: recurrenceBlockCodeSchema.nullable(),
});

export type SeriesUpdatePreviewOccurrence = z.infer<typeof seriesUpdatePreviewOccurrenceSchema>;

/**
 * The dry run of `update-from`: the same request, nothing written.
 * `applicable` is true when no occurrence is blocked — advisory, as `bookable`.
 */
export const seriesUpdatePreviewResponseSchema = z.strictObject({
  occurrences: z.array(seriesUpdatePreviewOccurrenceSchema),
  blockedCount: z.number().int().nonnegative(),
  applicable: z.boolean(),
});

export type SeriesUpdatePreviewResponse = z.infer<typeof seriesUpdatePreviewResponseSchema>;
