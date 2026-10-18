import { z } from 'zod';

/**
 * The lifecycle of an appointment as a booking.
 *
 * Level one of the two-level model: this describes the SHARED BOOKING — one
 * therapist, one room, one service, one time range (DECISION_LOG, 2026-08-02) —
 * and says nothing about what any individual child did. That is the
 * participant's `attendance`, which is a separate fact recorded separately.
 *
 * FOUR VALUES, AND NO MORE. A no-show is not a state of the booking: the room
 * was held and the therapist waited, and the fact that somebody did not arrive
 * belongs to the seat that was empty. It is `AttendanceOutcome.NO_SHOW`.
 *
 * `SCHEDULED` and `COMPLETED` occupy the therapist and the room; both
 * cancellations release them, which is what makes a slot re-bookable and what
 * the two exclusion constraints are conditional on.
 *
 * Must stay identical to the `appointment_status` PostgreSQL enum; an
 * integration test asserts the two lists match, in order.
 */
export const APPOINTMENT_STATUSES = [
  'SCHEDULED',
  'COMPLETED',
  'CANCELLED_BY_FAMILY',
  'CANCELLED_BY_CLINIC',
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const appointmentStatusSchema = z.enum(APPOINTMENT_STATUSES);

/**
 * What one child did with their seat.
 *
 * Level two of the two-level model, and a separate fact from the booking's own
 * lifecycle: a child may fail to arrive for a session that took place, and the
 * two are recorded independently.
 *
 * `PENDING` is the recorded state of an outcome nobody has entered yet — a real
 * value, not a missing one, exactly as `ChildSex.UNSPECIFIED` is. The
 * receptionist dashboard's "unresolved outcomes" list (PROJECT_SPEC.md 10) is
 * this value.
 *
 * `NO_SHOW` lives here rather than on the booking, because it is a fact about
 * one child and not about the room, the therapist or the hour. It creates no
 * charge by itself; the manager decides "no penalty" or a percentage of the
 * session price afterwards (M10.5 phase 1, owner decisions A2–A5).
 *
 * Must stay identical to the `attendance_outcome` PostgreSQL enum.
 */
export const ATTENDANCE_OUTCOMES = ['PENDING', 'ATTENDED', 'NO_SHOW'] as const;

export type AttendanceOutcome = (typeof ATTENDANCE_OUTCOMES)[number];

export const attendanceOutcomeSchema = z.enum(ATTENDANCE_OUTCOMES);

/**
 * WHAT HAPPENED TO AN INDIVIDUAL SESSION, AS ONE WORD (M10.5 phase 1, T-028).
 *
 * Derived by the server from the booking's status and the one seat's
 * attendance, never stored: `COMPLETED` + `ATTENDED` is `ATTENDED`,
 * `COMPLETED` + `NO_SHOW` is `NO_SHOW`, a cancellation is its own status, and
 * everything else — a scheduled session, an early arrival not yet confirmed, a
 * completed session whose attendance nobody entered — is `PENDING`, the state
 * in which the "What happened?" block still asks its question.
 *
 * The same four answers are what `recordAppointmentOutcomeRequestSchema`
 * accepts; `PENDING` is only ever read.
 */
export const INDIVIDUAL_OUTCOMES = [
  'PENDING',
  'ATTENDED',
  'NO_SHOW',
  'CANCELLED_BY_FAMILY',
  'CANCELLED_BY_CLINIC',
] as const;

export type IndividualOutcome = (typeof INDIVIDUAL_OUTCOMES)[number];

export const individualOutcomeSchema = z.enum(INDIVIDUAL_OUTCOMES);

/**
 * How a recurring series is bounded.
 *
 * PROJECT_SPEC.md 6 offers exactly two ways to bound a weekly pattern — a number
 * of occurrences or a last date — and a series states one of them. A CHECK
 * requires exactly the matching field to be present.
 *
 * Must stay identical to the `recurrence_end` PostgreSQL enum.
 */
export const RECURRENCE_ENDS = ['OCCURRENCE_COUNT', 'END_DATE'] as const;

export type RecurrenceEnd = (typeof RECURRENCE_ENDS)[number];

export const recurrenceEndSchema = z.enum(RECURRENCE_ENDS);

/**
 * A non-clinical note on an appointment.
 *
 * Clinical records are excluded from the product entirely (PROJECT_SPEC.md 2),
 * and the interface labels this field accordingly. `.trim()` runs before the
 * length check so the value that reaches the database is already canonical,
 * which is what makes `note = btrim(note)` — asserted by a CHECK — hold.
 */
export const appointmentNoteSchema = z.string().trim().min(1).max(2000);

/**
 * A recorded reason, required wherever a cancellation is recorded, so "why" is
 * never an empty string sitting in an audit trail (PROJECT_SPEC.md 9).
 */
export const appointmentReasonSchema = z.string().trim().min(1).max(500);

/**
 * A weekday in the clinic's own numbering: **0 is Saturday**, 6 is Friday.
 *
 * The Iranian week begins on Saturday, so this is the order a schedule is read,
 * entered and printed in. It is the product contract, shared by every tier and
 * by every consumer of this package, and it is deliberately NOT PostgreSQL's
 * `EXTRACT(DOW)` numbering, which begins on Sunday.
 *
 * Native DOW is translated at the database boundary and never exposed:
 *
 * ```sql
 * (EXTRACT(DOW FROM ts AT TIME ZONE 'Asia/Tehran')::int + 1) % 7
 * ```
 *
 * Saturday is DOW 6, and `(6 + 1) % 7 = 0`; Friday is DOW 5, and
 * `(5 + 1) % 7 = 6`. Anything reading `therapist_availability.weekday` applies
 * that expression to the instant it is comparing, rather than storing a second
 * numbering that could drift from this one.
 */
export const weekdaySchema = z.number().int().min(0).max(6);

/**
 * A wall-clock time of day in the clinic's timezone, as `HH:MM`.
 *
 * Not an instant. "Saturdays, 09:00 to 13:00" is the fact being recorded, and it
 * does not move when a particular date does. Seconds are not accepted: a
 * clinic's working hours are not measured in them, and one spelling per time
 * means two equal times are also equal strings.
 */
export const clockTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM');
