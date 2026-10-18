import { z } from 'zod';
import { durationMinutesSchema } from '../catalog/common';
import { appointmentNoteSchema, appointmentReasonSchema, attendanceOutcomeSchema } from './common';
import { appointmentViewSchema } from './day';

/**
 * What may happen to a booking after it is made.
 *
 * FIVE REQUESTS, AND NOTHING THAT INVENTS A SIXTH STATE. A move is an in-place
 * edit of a `SCHEDULED` appointment, a cancellation says who cancelled and why,
 * a completion says the session happened, an attendance says what one child
 * did, and a reopen reverses a completion entered by mistake. The lifecycle
 * stays the four approved statuses and the attendance stays the three approved
 * outcomes: there is no `RESCHEDULED`, no `VOIDED`, and no request here that
 * could produce one.
 *
 * NOTHING FINANCIAL IS ACCEPTED OR RETURNED BY ANY OF THEM. Completing a
 * session is what will create the primary session charge (PROJECT_SPEC.md 6),
 * and that is Milestone 5's: no price, no tariff reference and no charge
 * appears in this file. A cancellation and a no-show deliberately create
 * nothing at all (CLAUDE.md, non-negotiable rules).
 */

/**
 * The new placement of a `SCHEDULED` appointment, stated in full.
 *
 * A COMPLETE PLACEMENT RATHER THAN A PATCH. Every field that decides where the
 * session sits is submitted together, so the server never has to merge a
 * partial request with a stored row to find out what the caller meant — and two
 * receptionists moving the same booking cannot combine into a placement neither
 * of them asked for.
 *
 * THE SERVICE AND THE CHILD ARE NOT HERE, and deliberately. Changing what was
 * booked, or who it was booked for, is a different booking rather than a move;
 * the seat's `child_id` is immutable in the database for exactly that reason.
 * A move that would change either is a cancellation and a new appointment, and
 * both facts stay visible.
 *
 * `availabilityOverrideReason` behaves exactly as it does on a booking: null
 * means "apply the rule", and a reason is accepted only from a caller holding
 * `appointment.override_availability` and only when the new placement actually
 * falls outside the therapist's hours. It describes THIS placement — a move
 * back inside working hours clears the override that the previous placement
 * carried, because there is then nothing left to explain.
 */
export const moveAppointmentRequestSchema = z.strictObject({
  durationMinutes: durationMinutesSchema,
  therapistId: z.uuid(),
  roomId: z.uuid(),
  startsAt: z.iso.datetime(),
  note: appointmentNoteSchema.nullable(),
  availabilityOverrideReason: appointmentReasonSchema.nullable(),
});

export type MoveAppointmentRequest = z.infer<typeof moveAppointmentRequestSchema>;

/**
 * Who cancelled, as a party rather than as a status name.
 *
 * The two cancellation statuses are one decision with two answers, and the
 * clinic counts them separately: "how often do we cancel on families?" is a
 * question PROJECT_SPEC.md 10 puts on the dashboard. Naming the party rather
 * than making the caller spell `CANCELLED_BY_FAMILY` keeps the request from
 * being a place where a status is chosen — the status is derived from this.
 */
export const CANCELLATION_PARTIES = ['FAMILY', 'CLINIC'] as const;

export type CancellationParty = (typeof CANCELLATION_PARTIES)[number];

export const cancellationPartySchema = z.enum(CANCELLATION_PARTIES);

/**
 * A cancellation always says why.
 *
 * The reason is required, not optional: `appointment_cancellation_consistency_chk`
 * requires it in the database as well, and a cancellation nobody can explain is
 * exactly what PROJECT_SPEC.md 9 exists to prevent.
 */
export const cancelAppointmentRequestSchema = z.strictObject({
  cancelledBy: cancellationPartySchema,
  reason: appointmentReasonSchema,
});

export type CancelAppointmentRequest = z.infer<typeof cancelAppointmentRequestSchema>;

/**
 * Completion carries nothing.
 *
 * "This session happened" is the whole fact. The actor and the instant are the
 * request's own, the attendance of the child is a separate fact recorded
 * separately, and a price is Milestone 5's. An empty strict object is stated
 * rather than omitting the body, so a caller that sends a field — a status, an
 * amount, an attendance — is told it is not accepted instead of having it
 * silently dropped.
 */
export const completeAppointmentRequestSchema = z.strictObject({});

export type CompleteAppointmentRequest = z.infer<typeof completeAppointmentRequestSchema>;

/**
 * Reversing a completion entered by mistake.
 *
 * MANAGER-ONLY AND ALWAYS EXPLAINED. `appointment.reopen` is held by no
 * receptionist (PROJECT_SPEC.md 4), and the reason is required because this is
 * the correction of a recorded outcome — the case CLAUDE.md requires to
 * preserve actor, time and reason.
 */
export const reopenAppointmentRequestSchema = z.strictObject({
  reason: appointmentReasonSchema,
});

export type ReopenAppointmentRequest = z.infer<typeof reopenAppointmentRequestSchema>;

/**
 * What a child actually did with their seat.
 *
 * `PENDING` is deliberately not accepted. It is the recorded state of an
 * outcome nobody has entered yet, and "un-recording" one would erase a fact a
 * person entered rather than correct it; a wrong entry is corrected by
 * recording the other outcome, which is audited as the correction it is.
 */
export const recordAttendanceRequestSchema = z.strictObject({
  attendance: attendanceOutcomeSchema.exclude(['PENDING']),
});

export type RecordAttendanceRequest = z.infer<typeof recordAttendanceRequestSchema>;

/**
 * "What happened?" — the one-click outcome of an individual session (M10.5
 * phase 1, T-028).
 *
 *   POST /appointments/:id/outcome   this -> `recordAppointmentOutcomeResponseSchema`
 *
 * ONE REQUEST, ONE TRANSACTION, ONE OF FOUR ANSWERS, replacing the separate
 * "arrived", "did not come" and "session done" presses a receptionist could
 * forget one of:
 *
 *   * `ATTENDED` — marks the child present, completes the session and posts the
 *     session charge (`appointment.complete`).
 *   * `NO_SHOW` — marks the child absent and completes the session; no charge,
 *     and the seat appears in the manager's "No-shows to decide"
 *     (`appointment.complete`).
 *   * `CANCELLED_BY_FAMILY` / `CANCELLED_BY_CLINIC` — cancels with the short
 *     reason, which is REQUIRED (R1-3); no charge. Any arrival recorded earlier
 *     is cleared, audited: a cancelled session has no attendance
 *     (`appointment.cancel`).
 *
 * The first two are accepted only from the session's start on its own clinic
 * date (T-020, `APPOINTMENT_OUTCOME_BEFORE_START` /
 * `APPOINTMENT_OUTCOME_DATE_IN_FUTURE` with the view's `outcomeOpensAt`);
 * cancelling is never time-limited. The same answer pressed twice changes
 * nothing; a different answer once the session is closed or cancelled is
 * `APPOINTMENT_OUTCOME_ALREADY_RECORDED` — a correction uses the existing paths.
 */
export const recordAppointmentOutcomeRequestSchema = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('ATTENDED') }),
  z.strictObject({ outcome: z.literal('NO_SHOW') }),
  z.strictObject({ outcome: z.literal('CANCELLED_BY_FAMILY'), reason: appointmentReasonSchema }),
  z.strictObject({ outcome: z.literal('CANCELLED_BY_CLINIC'), reason: appointmentReasonSchema }),
]);

export type RecordAppointmentOutcomeRequest = z.infer<typeof recordAppointmentOutcomeRequestSchema>;

/**
 * `RECORDED` when the answer changed something, `UNCHANGED` for a repeat press
 * (nothing written, nothing audited). `appointment` is the session as it now
 * reads, so the page re-renders from one response.
 */
export const APPOINTMENT_OUTCOME_RESULTS = ['RECORDED', 'UNCHANGED'] as const;

export const recordAppointmentOutcomeResponseSchema = z.strictObject({
  result: z.enum(APPOINTMENT_OUTCOME_RESULTS),
  appointment: appointmentViewSchema,
});

export type RecordAppointmentOutcomeResponse = z.infer<
  typeof recordAppointmentOutcomeResponseSchema
>;
