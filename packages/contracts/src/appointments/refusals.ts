import { z } from 'zod';
import { isoDateSchema } from '../dates';
import { clockTimeSchema } from './common';

/**
 * What a scheduling refusal says about itself (M10-A10, T-020, T-024, T-025).
 *
 * The code still names the problem; these are the `details` of the error
 * envelope that let the interface explain it in the receptionist's words —
 * which child, therapist or room is busy and with what, why the hour is outside
 * the therapist's availability, and from when an outcome may be recorded.
 *
 * Details are additive: a caller that reads only the code keeps working.
 */

/**
 * The three things a session occupies. Every conflicting dimension is reported,
 * not only the first one a check happened to reach, so the receptionist can fix
 * all of them in one pass.
 */
export const APPOINTMENT_CONFLICT_RESOURCES = ['CHILD', 'THERAPIST', 'ROOM'] as const;

export type AppointmentConflictResource = (typeof APPOINTMENT_CONFLICT_RESOURCES)[number];

export const appointmentConflictResourceSchema = z.enum(APPOINTMENT_CONFLICT_RESOURCES);

/**
 * One existing session that is in the way.
 *
 * `resourceId` is the child, therapist or room the caller submitted, so the
 * interface names it from its own form. The blocking session is identified and
 * placed so it can be named too ("already with … from 10:00 to 11:00") without a
 * second request. Staff-only: these refusals are raised on internal routes.
 */
export const appointmentConflictSchema = z.strictObject({
  resource: appointmentConflictResourceSchema,
  resourceId: z.uuid(),
  appointmentId: z.uuid(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
});

export type AppointmentConflict = z.infer<typeof appointmentConflictSchema>;

/**
 * The `details` of `APPOINTMENT_CHILD_CONFLICT`, `APPOINTMENT_THERAPIST_CONFLICT`
 * and `APPOINTMENT_ROOM_CONFLICT`.
 *
 * The code is the first dimension in the order child, therapist, room; the list
 * holds every dimension that conflicts, in that order, each with every session
 * in the way. It is never empty.
 */
export const appointmentConflictDetailsSchema = z.strictObject({
  conflicts: z.array(appointmentConflictSchema).min(1),
});

export type AppointmentConflictDetails = z.infer<typeof appointmentConflictDetailsSchema>;

/**
 * Why a session falls outside the therapist's availability.
 *
 * - `CLOSED_DAY` — the whole date is closed for the therapist.
 * - `PARTIAL_CLOSURE` — part of the session falls in a closed range of the day.
 * - `OUTSIDE_WORKING_HOURS` — no window of the day covers the whole session
 *   (including a day with no working hours at all).
 */
export const AVAILABILITY_REFUSAL_REASONS = [
  'OUTSIDE_WORKING_HOURS',
  'CLOSED_DAY',
  'PARTIAL_CLOSURE',
] as const;

export type AvailabilityRefusalReason = (typeof AVAILABILITY_REFUSAL_REASONS)[number];

export const availabilityRefusalReasonSchema = z.enum(AVAILABILITY_REFUSAL_REASONS);

const clockRangeSchema = z.strictObject({
  startTime: clockTimeSchema,
  endTime: clockTimeSchema,
});

/**
 * The `details` of `APPOINTMENT_OUTSIDE_AVAILABILITY`.
 *
 * The session as the clinic's clock reads it, the therapist's resolved windows
 * and closed ranges for that date, and whether THIS caller may override with a
 * reason — so the interface can point to the override field, or say that only
 * someone holding the permission can.
 */
export const availabilityRefusalDetailsSchema = z.strictObject({
  reason: availabilityRefusalReasonSchema,
  date: isoDateSchema,
  startTime: clockTimeSchema,
  endTime: clockTimeSchema,
  availableWindows: z.array(clockRangeSchema),
  closedRanges: z.array(clockRangeSchema),
  overridable: z.boolean(),
});

export type AvailabilityRefusalDetails = z.infer<typeof availabilityRefusalDetailsSchema>;

/** Which outcome the refused request tried to record. */
export const APPOINTMENT_OUTCOME_KINDS = ['COMPLETED', 'ATTENDED', 'NO_SHOW'] as const;

export type AppointmentOutcomeKind = (typeof APPOINTMENT_OUTCOME_KINDS)[number];

export const appointmentOutcomeKindSchema = z.enum(APPOINTMENT_OUTCOME_KINDS);

/**
 * The `details` of `APPOINTMENT_OUTCOME_DATE_IN_FUTURE` and
 * `APPOINTMENT_OUTCOME_BEFORE_START`.
 *
 * `today` is the clinic's date at the moment of refusal, by the database clock
 * in Asia/Tehran; `startTime` is when the session starts on its own date, which
 * is when completion and no-show become possible.
 */
export const appointmentOutcomeTimingDetailsSchema = z.strictObject({
  outcome: appointmentOutcomeKindSchema,
  sessionDate: isoDateSchema,
  startTime: clockTimeSchema,
  startsAt: z.iso.datetime(),
  today: isoDateSchema,
});

export type AppointmentOutcomeTimingDetails = z.infer<typeof appointmentOutcomeTimingDetailsSchema>;
