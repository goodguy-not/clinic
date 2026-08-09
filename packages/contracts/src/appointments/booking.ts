import { z } from 'zod';
import { durationMinutesSchema } from '../catalog/common';
import { appointmentNoteSchema, appointmentReasonSchema } from './common';
import { appointmentParticipantSchema, appointmentSchema } from './appointments';

/**
 * Booking one appointment.
 *
 * ONE CHILD, ONE BOOKING. An individual appointment has exactly one participant
 * (CLAUDE.md, non-negotiable rules), so the child is a field on the request
 * rather than an array. A group booking is a different shape with a different
 * set of rules — a shared duration, a per-child charge, a maximum size — and
 * inventing an array here would be a guess at all three before any of them is
 * approved. When group booking arrives it adds a request, it does not reinterpret
 * this one.
 *
 * NO PRICE, AND NO FIELD THAT COULD BECOME ONE. What a session costs the family
 * is Milestone 5's: no tariff reference, no price snapshot, no discount and no
 * charge appears in this file or in anything it returns.
 *
 * NO RECURRENCE. `seriesId` is not accepted. An occurrence belongs to the series
 * that generated it, and letting a caller attach a booking to an arbitrary
 * series would make "every occurrence of this series matches its pattern" a
 * property nothing enforces.
 *
 * NO STATUS. A new booking is `SCHEDULED`. Completion and cancellation are
 * transitions with their own permissions, their own audit actions and — in the
 * case of completion — a financial consequence; accepting a status here would
 * let a create request reach a state a transition is supposed to guard.
 */

/**
 * `startsAt` is an INSTANT, not a calendar value, and is submitted as UTC.
 *
 * The clinic reads it in Asia/Tehran and the web tier converts to and from
 * Jalali at its own edge (DECISION_LOG, 2026-08-06). A local time with no offset
 * would be ambiguous in exactly the way an appointment cannot afford.
 *
 * `endsAt` is deliberately absent: it is `startsAt + durationMinutes`, the
 * database CHECK says so, and accepting both would let a caller submit two facts
 * that disagree. Seconds must be zero — enforced by the service, which answers
 * `APPOINTMENT_TIME_INVALID` rather than a generic validation failure, because a
 * clinic's diary is not measured in seconds and a value carrying them is a
 * client bug worth naming.
 */
export const createAppointmentRequestSchema = z.strictObject({
  serviceId: z.uuid(),
  durationMinutes: durationMinutesSchema,
  therapistId: z.uuid(),
  roomId: z.uuid(),
  childId: z.uuid(),
  startsAt: z.iso.datetime(),
  note: appointmentNoteSchema.nullable(),
  /**
   * The one override this product has, and the only way to book outside a
   * therapist's working hours.
   *
   * Null is the ordinary case and means "apply the rule": a booking outside
   * availability is then refused with `APPOINTMENT_OUTSIDE_AVAILABILITY`.
   * A reason means "I know, and here is why" — accepted only from a caller
   * holding `appointment.override_availability`, recorded on the appointment and
   * audited as its own action.
   *
   * There is no equivalent field for a therapist, room or child conflict, and
   * there must not be: a double-booked room is not a policy the clinic may
   * choose to set aside, it is two sessions that cannot both happen.
   */
  availabilityOverrideReason: appointmentReasonSchema.nullable(),
});

export type CreateAppointmentRequest = z.infer<typeof createAppointmentRequestSchema>;

/**
 * A booking and the seats in it.
 *
 * The participants travel with the appointment rather than behind a second call:
 * a booking without its seats is not a thing the clinic ever wants to look at,
 * and one round trip cannot show a booking from one moment beside a seat from
 * another.
 */
export const appointmentDetailSchema = z.strictObject({
  appointment: appointmentSchema,
  participants: z.array(appointmentParticipantSchema),
});

export type AppointmentDetail = z.infer<typeof appointmentDetailSchema>;

export const appointmentResponseSchema = appointmentDetailSchema;

export type AppointmentResponse = z.infer<typeof appointmentResponseSchema>;
