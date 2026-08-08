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
  occurrenceCount: z.number().int().positive().max(260).nullable(),
  endsOn: isoDateSchema.nullable(),
  createdAt: z.iso.datetime(),
});

export type AppointmentSeries = z.infer<typeof appointmentSeriesSchema>;

/**
 * A therapist's recurring working window on one weekday.
 *
 * Effective-dated, because hours change and an appointment booked last month was
 * legitimate against last month's hours. A null `effectiveTo` is open-ended,
 * exactly as on a tariff.
 */
export const therapistAvailabilitySchema = z.strictObject({
  id: z.uuid(),
  therapistId: z.uuid(),
  weekday: weekdaySchema,
  startTime: clockTimeSchema,
  endTime: clockTimeSchema,
  effectiveFrom: isoDateSchema,
  effectiveTo: isoDateSchema.nullable(),
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
