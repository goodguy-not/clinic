import type { Appointment, AppointmentParticipant } from '@clinic/contracts';

/**
 * The decisions in booking that are pure functions, kept out of the service so
 * they can be tested without a database.
 *
 * Everything here works on values the database produced — the clinic's own
 * calendar day and wall-clock time for an instant, and the resolved availability
 * windows for that day. Nothing here converts a timezone or reads a clock:
 * `clinic_date` and `clinic_clock_time` do that, in PostgreSQL, where
 * `Asia/Tehran` is written exactly once.
 */

/** One session, as the clinic's own calendar reads it. */
export type ClinicSpan = {
  readonly startDate: string;
  readonly startTime: string;
  readonly endDate: string;
  readonly endTime: string;
};

export type AvailabilityWindow = { readonly startTime: string; readonly endTime: string };

/**
 * Is the whole session inside one working window?
 *
 * THE WHOLE SESSION, AND ONE WINDOW. A booking that starts inside a window and
 * runs past its end is outside availability: the therapist is not there for the
 * part that overhangs, and treating it as covered would make the rule mean
 * "starts while working" rather than "happens while working". The resolved
 * windows arrive already sorted and merged, so two touching windows are already
 * one and a session spanning them is correctly inside it.
 *
 * String comparison is exact: `HH:MM` is fixed-width, so lexicographic order is
 * chronological order. The same property `availabilityWindowInputSchema` relies
 * on.
 *
 * A SESSION THAT CROSSES MIDNIGHT IS NEVER INSIDE A WINDOW, including one ending
 * at exactly 00:00 — a working window is a weekday and two wall-clock times, and
 * the latest end it can state is 23:59.
 *
 * The service refuses such a booking as `APPOINTMENT_TIME_INVALID` before this
 * function is reached, so that it cannot be authorized by the availability
 * override: an overnight appointment is a shape the approved model does not have,
 * not an hour a therapist may agree to work. This branch is the second statement
 * of the same fact, kept so the function is total over the spans it accepts.
 */
export function isWithinAvailability(
  span: ClinicSpan,
  windows: readonly AvailabilityWindow[],
): boolean {
  if (span.startDate !== span.endDate) return false;

  return windows.some(
    (window) => window.startTime <= span.startTime && span.endTime <= window.endTime,
  );
}

/**
 * True when the instant falls on an exact minute.
 *
 * A clinic's diary is entered, read and printed in minutes. A start carrying
 * seconds produces an end carrying them, makes two appointments at "the same
 * time" unequal, and puts 09:00:30 in a column every interface renders as 09:00.
 *
 * Measured on the epoch value rather than on the string, so it holds however the
 * caller spelled the instant.
 */
export function isWholeMinute(instant: string): boolean {
  const milliseconds = Date.parse(instant);

  return Number.isFinite(milliseconds) && milliseconds % 60_000 === 0;
}

export type AppointmentRow = {
  id: string;
  service_id: string;
  duration_minutes: number;
  therapist_id: string;
  room_id: string;
  starts_at: Date;
  ends_at: Date;
  status: string;
  series_id: string | null;
  note: string | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
  availability_override_reason: string | null;
  created_at: Date;
};

export type ParticipantRow = {
  id: string;
  appointment_id: string;
  child_id: string;
  attendance: string;
  attendance_recorded_at: Date | null;
};

/**
 * The override's actor and instant are deliberately absent from the response.
 *
 * An interface has to show that a booking was an exception and on what grounds;
 * who authorized it and when is an audit question, and `audit_log` answers it
 * with the request id, the session and the client alongside.
 */
export function toAppointment(row: AppointmentRow): Appointment {
  return {
    id: row.id,
    serviceId: row.service_id,
    durationMinutes: row.duration_minutes,
    therapistId: row.therapist_id,
    roomId: row.room_id,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    status: row.status as Appointment['status'],
    seriesId: row.series_id,
    note: row.note,
    completedAt: row.completed_at?.toISOString() ?? null,
    cancelledAt: row.cancelled_at?.toISOString() ?? null,
    cancellationReason: row.cancellation_reason,
    availabilityOverrideReason: row.availability_override_reason,
    createdAt: row.created_at.toISOString(),
  };
}

export function toParticipant(row: ParticipantRow): AppointmentParticipant {
  return {
    id: row.id,
    appointmentId: row.appointment_id,
    childId: row.child_id,
    attendance: row.attendance as AppointmentParticipant['attendance'],
    attendanceRecordedAt: row.attendance_recorded_at?.toISOString() ?? null,
  };
}
