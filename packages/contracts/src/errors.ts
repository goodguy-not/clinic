import { z } from 'zod';

/**
 * Stable error codes shared by NestJS and Next.js.
 *
 * These strings are the contract. NestJS returns a code and a short English
 * developer message; Next.js maps the code to Persian for the browser
 * (CLAUDE.md, Architecture boundary: NestJS never returns Persian text).
 *
 * A code is never renamed or reused for a different meaning — Next's Persian
 * map is keyed by it, and a test iterates this list so a new code without a
 * translation fails the build.
 */
export const ERROR_CODES = [
  'AUTH_INVALID_CREDENTIALS',
  'AUTH_SESSION_INVALID',
  'AUTH_SESSION_EXPIRED',
  'AUTH_PASSWORD_CHANGE_REQUIRED',
  'AUTH_FORBIDDEN',
  'AUTH_INTERNAL_KEY_INVALID',
  'AUTH_CSRF_INVALID',
  'AUTH_ORIGIN_REJECTED',
  'VALIDATION_FAILED',
  'PASSWORD_POLICY_VIOLATION',
  'USER_NOT_FOUND',
  'USER_USERNAME_TAKEN',
  'USER_SELF_MODIFICATION_FORBIDDEN',
  'USER_LAST_MANAGER',

  // Clinic reference data.
  'THERAPIST_NOT_FOUND',
  'SERVICE_NOT_FOUND',
  'ROOM_NOT_FOUND',
  'TARIFF_NOT_FOUND',
  'SERVICE_NAME_TAKEN',
  'ROOM_NAME_TAKEN',
  // A tariff may only price a duration its service actually offers, and a
  // duration may not be withdrawn while a tariff still prices it. Both are the
  // same foreign key seen from opposite ends, and they are separate codes
  // because they are separate mistakes with separate fixes.
  'TARIFF_DURATION_NOT_ALLOWED',
  'SERVICE_DURATION_IN_USE',
  'TARIFF_OVERLAP',
  'TARIFF_ALREADY_VOIDED',
  'TARIFF_SCOPE_MISMATCH',
  // Pricing something the clinic no longer offers is almost always a mistake.
  // Resolution of a past date is unaffected: history does not stop being true
  // when a service is retired.
  'SERVICE_INACTIVE',
  'THERAPIST_INACTIVE',
  // No tariff covers the requested service date. A visible error rather than a
  // silent zero (PROJECT_SPEC.md 5).
  'TARIFF_MISSING',

  // Families and children.
  'FAMILY_NOT_FOUND',
  'CHILD_NOT_FOUND',
  // A likely duplicate was found and has not been acknowledged. The details
  // carry the candidates the user must look at and a draft token; the write did
  // not happen. Names alone never produce this — only a shared guardian mobile,
  // or the same name and birth date inside one family.
  'FAMILY_POSSIBLE_DUPLICATE',
  'CHILD_POSSIBLE_DUPLICATE',
  // Hard uniqueness, with no override: a national identifier names exactly one
  // person, and one paper file belongs to one child.
  'CHILD_NATIONAL_ID_TAKEN',
  'CHILD_LEGACY_FILE_NUMBER_TAKEN',
  // Exactly one primary guardian, and that one reachable on a mobile or a
  // landline.
  'FAMILY_PRIMARY_GUARDIAN_INVALID',
  'FAMILY_INACTIVE',
  // Measured against the clinic's own calendar day in Asia/Tehran, never the
  // server's.
  'CHILD_BIRTH_DATE_IN_FUTURE',
  // One code for missing, expired, already consumed, wrong user, wrong session
  // and wrong purpose. A draft token is a bearer credential, and distinguishing
  // those conditions would tell its holder which one they tripped — the same
  // reasoning that makes AUTH_INVALID_CREDENTIALS cover four login failures.
  'DRAFT_NOT_FOUND',

  // Appointments. Every code below is raised by an endpoint as of Milestone 4.
  'APPOINTMENT_NOT_FOUND',
  'APPOINTMENT_SERIES_NOT_FOUND',
  'APPOINTMENT_PARTICIPANT_NOT_FOUND',
  // Three separate conflicts, never one `APPOINTMENT_CONFLICT`. Each names a
  // different resource, each is resolved by changing a different field, and the
  // interface has to say which one is busy for the receptionist to fix it
  // without guessing. They are raised from three named PostgreSQL exclusion
  // constraints, so the code is decided by which constraint fired rather than
  // by a re-read that could disagree with it.
  'APPOINTMENT_THERAPIST_CONFLICT',
  'APPOINTMENT_ROOM_CONFLICT',
  'APPOINTMENT_CHILD_CONFLICT',
  // The start, end and duration do not describe one coherent window.
  'APPOINTMENT_TIME_INVALID',
  // The service does not offer this session length. Distinct from
  // `TARIFF_DURATION_NOT_ALLOWED`, which is the same foreign key seen while
  // pricing rather than while booking: different mistake, different fix.
  'APPOINTMENT_DURATION_NOT_ALLOWED',
  // The requested status change is not a permitted transition from the current
  // one — completing a cancelled appointment, cancelling a completed one.
  'APPOINTMENT_TRANSITION_INVALID',
  // Booked outside the therapist's recurring windows, or on a day a dated
  // exception closes. PROJECT_SPEC.md 5 requires this to be prevented or
  // explicitly authorized: it is refused unless the caller holds
  // `appointment.override_availability` AND states a reason, which is then
  // recorded on the appointment and in the audit row of the change that carried
  // it. It is the ONLY overridable scheduling rule.
  'APPOINTMENT_OUTSIDE_AVAILABILITY',
  // The weekly rule the clinic will not accept: a last date earlier than the
  // first session, more than `RECURRENCE_OCCURRENCES_MAX` sessions, or a session
  // beyond `RECURRENCE_HORIZON_MONTHS` (PROJECT_SPEC.md 6). One code, because
  // the fix is the same in all three cases: change the bound.
  'RECURRENCE_RULE_INVALID',
  // A working window whose end is not after its start, or an exception that
  // closes a day and carries times anyway.
  'AVAILABILITY_WINDOW_INVALID',
  // Two recurring windows describe the same weekday and overlapping hours.
  // Refused rather than merged: a recurring window is current configuration and
  // carries no dates, so a therapist's week has exactly one reading and two rows
  // covering one hour would make "is she working then?" a question with two
  // answers.
  'AVAILABILITY_WINDOW_OVERLAP',
  // Two dated exceptions collide on one date — two extra windows over the same
  // hours, two closed days, or a closed day and an extra window on the same
  // date, which is a contradiction rather than a refinement.
  'AVAILABILITY_EXCEPTION_CONFLICT',
  // The exception named does not exist, or belongs to a different therapist.
  'AVAILABILITY_EXCEPTION_NOT_FOUND',
  // Booking something the clinic no longer offers. `SERVICE_INACTIVE` and
  // `THERAPIST_INACTIVE` already exist for the other two.
  'ROOM_INACTIVE',
  'CHILD_INACTIVE',
  // The two catalog compatibility rules, separate because they are separate
  // mistakes with separate fixes: one is corrected by choosing another
  // therapist, the other by choosing another room. Each is an allow-list that
  // is enforced only when the clinic has recorded one — an empty list is
  // "unrestricted", not "supports nothing".
  'APPOINTMENT_THERAPIST_SERVICE_NOT_SUPPORTED',
  'APPOINTMENT_ROOM_SERVICE_NOT_ALLOWED',

  // The ledger. Eight codes, and `TARIFF_MISSING` is reused rather than
  // duplicated as a charge-shaped variant: a session whose date no tariff covers
  // is the same fact whether it is met while pricing or while charging, and one
  // code keeps one Persian message and one fix — record the tariff.
  'CHARGE_NOT_FOUND',
  // Voiding a charge that is already void. Separate from `CHARGE_VOIDED`
  // because they are separate mistakes: this one means the correction has
  // already happened, and the caller is looking at a stale screen.
  'CHARGE_ALREADY_VOIDED',
  // Acting on a voided charge — adjusting it, or adjusting an adjustment of it.
  // The charge no longer stands, so there is nothing to reduce, and the fix is
  // to re-post rather than to retry.
  'CHARGE_VOIDED',
  // A valid primary charge already exists for this participant. It is raised
  // where a SECOND charge would otherwise be created — notably by reopening a
  // completed session whose charge still stands, which must be voided first. An
  // explicit re-post does NOT raise it: a retry is idempotent by rule
  // (CLAUDE.md) and returns the existing charge as `ALREADY_POSTED`.
  'CHARGE_EXISTS_FOR_PARTICIPANT',
  // The session cannot be charged: it is not completed, or this child did not
  // attend it. Only an attended participant of a completed appointment may be
  // charged (CLAUDE.md), and a cancellation and a no-show deliberately create
  // nothing.
  'CHARGE_NOT_ELIGIBLE',
  'ADJUSTMENT_NOT_FOUND',
  'ADJUSTMENT_ALREADY_VOIDED',
  // The concession would take the family's effective amount for the session
  // below zero, counting the adjustments already active against the charge.
  // Also what a `FREE` charge produces: any positive amount exceeds a zero
  // charge, and there is no concession to record on a session never priced.
  'ADJUSTMENT_EXCEEDS_CHARGE',
  // There is deliberately no `ADJUSTMENT_SPLIT_INVALID`. The Milestone 5
  // adjustment request carries no therapist portion and no split to validate:
  // every discount is clinic-borne, the server writes both allocation columns
  // itself, and a strict request schema refuses a caller that tries to state
  // one (DECISION_LOG, 2026-08-14).

  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const errorCodeSchema = z.enum(ERROR_CODES);

/**
 * The single error shape every NestJS endpoint returns.
 *
 * `requestId` is always present so a user can quote it to support and an
 * operator can correlate the browser response with the audit row and the
 * server log line that share it.
 */
export const errorEnvelopeSchema = z.strictObject({
  error: z.strictObject({
    code: errorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.uuid(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
