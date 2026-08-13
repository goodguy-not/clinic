import { z } from 'zod';
import { durationMinutesSchema } from '../catalog/common';
import { isoDateSchema } from '../dates';
import {
  appointmentStatusSchema,
  attendanceOutcomeSchema,
  clockTimeSchema,
  recurrenceEndSchema,
  weekdaySchema,
} from './common';

/**
 * A booking: one therapist, one room, one service, one time range.
 *
 * These shapes mirror the five Milestone 4 tables and nothing more. There are
 * deliberately no request schemas: booking, rescheduling, outcome entry,
 * recurrence and availability each decide their own input in the checkpoint
 * that builds them, and a request shape invented before the endpoint that uses
 * it is a guess.
 *
 * NO PRICE APPEARS ANYWHERE IN THIS FILE. What a session costs the family is
 * Milestone 5's; the read-only tariff suggestion a booking screen shows is a
 * lookup against the existing tariff contract, not a field on an appointment.
 *
 * `startsAt` and `endsAt` are instants, not calendar values. An appointment
 * happens at a moment in time; the clinic reads that moment in Asia/Tehran and
 * the web tier converts to Jalali at its own edge (DECISION_LOG, 2026-08-06).
 * `endsAt` is not independent data — the database requires it to equal
 * `startsAt + durationMinutes` — so it is a convenience for the reader rather
 * than a second fact that can disagree with the first.
 *
 * Each outcome timestamp is paired with exactly one status by a CHECK, so this
 * shape cannot describe an appointment that is `SCHEDULED` and carries a
 * cancellation. There is no no-show timestamp here: a no-show is one child's
 * outcome, on the seat, not a state of the booking.
 */
export const appointmentSchema = z.strictObject({
  id: z.uuid(),
  serviceId: z.uuid(),
  durationMinutes: durationMinutesSchema,
  therapistId: z.uuid(),
  roomId: z.uuid(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  status: appointmentStatusSchema,
  /** Null for a one-off appointment; every occurrence stays traceable on its own. */
  seriesId: z.uuid().nullable(),
  note: z.string().nullable(),
  completedAt: z.iso.datetime().nullable(),
  cancelledAt: z.iso.datetime().nullable(),
  cancellationReason: z.string().nullable(),
  /**
   * Why this booking was allowed to sit outside the therapist's availability,
   * or null for the ordinary case.
   *
   * Not a flag: PROJECT_SPEC.md 5 permits an out-of-availability booking only
   * as an authorized, RECORDED override, and a boolean would record that one
   * happened without recording why. The actor and the instant are stored
   * alongside it and are deliberately not exposed here — an interface needs to
   * show that the rule was overridden and on what grounds; who did it is an
   * audit question, answered by `audit_log`.
   */
  availabilityOverrideReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export type Appointment = z.infer<typeof appointmentSchema>;

/**
 * One child's seat in a booking, with its own attendance outcome.
 *
 * The family is reached through the child and is deliberately not repeated
 * here: a child belongs permanently to one family — `child.family_id` is
 * immutable in the database — so a second copy could only ever be a way for the
 * two to disagree about who was treated.
 *
 * `attendance` is a separate fact from the booking's `status`. Neither is
 * derived from the other, and `NO_SHOW` lives here rather than on the booking:
 * the room was held and the therapist waited, so the fact that one child did
 * not arrive belongs to the seat that was empty.
 */
export const appointmentParticipantSchema = z.strictObject({
  id: z.uuid(),
  appointmentId: z.uuid(),
  childId: z.uuid(),
  attendance: attendanceOutcomeSchema,
  attendanceRecordedAt: z.iso.datetime().nullable(),
});

export type AppointmentParticipant = z.infer<typeof appointmentParticipantSchema>;

/**
 * A weekly recurring series: an identity and a termination rule.
 *
 * The pattern — therapist, room, service, duration, time of day — lives on the
 * occurrences, because each must stay independently traceable and editable
 * (PROJECT_SPEC.md 6). Storing it twice would let a series describe something
 * none of its occurrences match.
 *
 * Exactly one of `occurrenceCount` and `endsOn` is present, decided by
 * `endMode`.
 */
export const appointmentSeriesSchema = z.strictObject({
  id: z.uuid(),
  /** 1 is every week, 2 every second week. Weekly patterns only. */
  intervalWeeks: z.number().int().min(1).max(12),
  startsOn: isoDateSchema,
  endMode: recurrenceEndSchema,
  /**
   * The ceiling here mirrors `appointment_series_occurrence_count_chk`, which is
   * the database's guard against a mistyped run of digits. It is NOT the policy:
   * what a series may actually be created with is `RECURRENCE_OCCURRENCES_MAX`,
   * which is stricter and paired with a horizon in months. A read shape states
   * what the column permits; the request shape states what the clinic allows.
   */
  occurrenceCount: z.number().int().positive().max(260).nullable(),
  endsOn: isoDateSchema.nullable(),
  createdAt: z.iso.datetime(),
});

export type AppointmentSeries = z.infer<typeof appointmentSeriesSchema>;

/**
 * A therapist's recurring working window on one weekday.
 *
 * CURRENT CONFIGURATION, WITH NO EFFECTIVE DATING. A weekday and two wall-clock
 * times, and the window applies whenever it is asked about. Hours change by
 * editing the set, and what the set said before is history in `audit_log`.
 *
 * There is deliberately no `effectiveFrom` or `effectiveTo`. The columns existed
 * on the table this shape mirrors and the availability migration drops them:
 * effective-dated availability is not approved for this milestone, and a field
 * kept for a capability that does not exist is one a caller will eventually try
 * to use.
 */
export const therapistAvailabilitySchema = z.strictObject({
  id: z.uuid(),
  therapistId: z.uuid(),
  weekday: weekdaySchema,
  startTime: clockTimeSchema,
  endTime: clockTimeSchema,
  createdAt: z.iso.datetime(),
});

export type TherapistAvailability = z.infer<typeof therapistAvailabilitySchema>;

/**
 * A dated exception: one day off, or one extra window.
 *
 * `isAvailable = false` closes the day and carries no times; `true` adds a
 * window and requires them. A CHECK pairs the two, so an exception cannot be
 * half-stated.
 */
export const therapistAvailabilityExceptionSchema = z.strictObject({
  id: z.uuid(),
  therapistId: z.uuid(),
  exceptionDate: isoDateSchema,
  isAvailable: z.boolean(),
  startTime: clockTimeSchema.nullable(),
  endTime: clockTimeSchema.nullable(),
  reason: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export type TherapistAvailabilityException = z.infer<typeof therapistAvailabilityExceptionSchema>;
