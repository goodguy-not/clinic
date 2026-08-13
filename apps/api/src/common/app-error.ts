import { ERROR_CODES, type ErrorCode } from '@clinic/contracts';

/**
 * The single error type every handler throws.
 *
 * Carrying the stable contract code on the error is what lets one exception
 * filter build the envelope, rather than each handler shaping its own response.
 * Messages here are short English for developers; Persian belongs to Next
 * (CLAUDE.md, Architecture boundary — NestJS never returns Persian text).
 */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly details?: unknown,
    message?: string,
  ) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'AppError';
  }
}

/**
 * HTTP status per code. Kept in one table so a status can never drift between
 * two handlers that raise the same code.
 */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  AUTH_INVALID_CREDENTIALS: 401,
  AUTH_SESSION_INVALID: 401,
  AUTH_SESSION_EXPIRED: 401,
  AUTH_PASSWORD_CHANGE_REQUIRED: 403,
  AUTH_FORBIDDEN: 403,
  AUTH_INTERNAL_KEY_INVALID: 401,
  AUTH_CSRF_INVALID: 403,
  AUTH_ORIGIN_REJECTED: 403,
  VALIDATION_FAILED: 400,
  PASSWORD_POLICY_VIOLATION: 400,
  USER_NOT_FOUND: 404,
  USER_USERNAME_TAKEN: 409,
  USER_SELF_MODIFICATION_FORBIDDEN: 403,
  USER_LAST_MANAGER: 409,

  THERAPIST_NOT_FOUND: 404,
  SERVICE_NOT_FOUND: 404,
  ROOM_NOT_FOUND: 404,
  TARIFF_NOT_FOUND: 404,
  SERVICE_NAME_TAKEN: 409,
  ROOM_NAME_TAKEN: 409,
  // 422 rather than 409: the request is well formed and conflicts with no other
  // request, it just asks for something the referenced data does not permit.
  TARIFF_DURATION_NOT_ALLOWED: 422,
  SERVICE_DURATION_IN_USE: 409,
  TARIFF_OVERLAP: 409,
  TARIFF_ALREADY_VOIDED: 409,
  TARIFF_SCOPE_MISMATCH: 422,
  SERVICE_INACTIVE: 422,
  THERAPIST_INACTIVE: 422,
  // 404: the caller asked what a session costs and there is no answer to give.
  // Not a 200 with an empty body — a missing tariff is a visible error, and a
  // caller that treats "no tariff" as "no charge" would be silently wrong.
  TARIFF_MISSING: 404,

  FAMILY_NOT_FOUND: 404,
  CHILD_NOT_FOUND: 404,
  // 409: the request is well formed and the caller may legitimately want it,
  // but it conflicts with a record that already exists. The body carries the
  // candidates and a draft token so the caller can look and decide.
  FAMILY_POSSIBLE_DUPLICATE: 409,
  CHILD_POSSIBLE_DUPLICATE: 409,
  CHILD_NATIONAL_ID_TAKEN: 409,
  CHILD_LEGACY_FILE_NUMBER_TAKEN: 409,
  // 422 rather than 409: nothing conflicts, the submitted shape is just not one
  // the domain permits.
  FAMILY_PRIMARY_GUARDIAN_INVALID: 422,
  FAMILY_INACTIVE: 422,
  CHILD_BIRTH_DATE_IN_FUTURE: 422,
  // 404 for missing, expired, consumed, wrong user, wrong session and wrong
  // purpose alike. A draft token is a bearer credential; distinguishing those
  // would tell its holder which condition they tripped.
  DRAFT_NOT_FOUND: 404,

  APPOINTMENT_NOT_FOUND: 404,
  APPOINTMENT_SERIES_NOT_FOUND: 404,
  APPOINTMENT_PARTICIPANT_NOT_FOUND: 404,
  // 409: the request is well formed and the caller may legitimately want it, but
  // the slot is taken. The resource that is busy is named by the code, so the
  // caller knows which field to change.
  APPOINTMENT_THERAPIST_CONFLICT: 409,
  APPOINTMENT_ROOM_CONFLICT: 409,
  APPOINTMENT_CHILD_CONFLICT: 409,
  // 422: nothing conflicts, the submitted shape is just not one the domain
  // permits.
  APPOINTMENT_TIME_INVALID: 422,
  APPOINTMENT_DURATION_NOT_ALLOWED: 422,
  // 409: the row is in a state that does not allow this transition, which a
  // retry against a re-read row may well resolve.
  APPOINTMENT_TRANSITION_INVALID: 409,
  APPOINTMENT_OUTSIDE_AVAILABILITY: 422,
  RECURRENCE_RULE_INVALID: 422,
  AVAILABILITY_WINDOW_INVALID: 422,
  // 409: the submission is well formed and conflicts with availability that is
  // already recorded, which a corrected window or a removed exception resolves.
  AVAILABILITY_WINDOW_OVERLAP: 409,
  AVAILABILITY_EXCEPTION_CONFLICT: 409,
  AVAILABILITY_EXCEPTION_NOT_FOUND: 404,
  ROOM_INACTIVE: 422,
  CHILD_INACTIVE: 422,
  // 422 for both: nothing conflicts and nothing is missing, the combination is
  // simply one the recorded configuration does not permit.
  APPOINTMENT_THERAPIST_SERVICE_NOT_SUPPORTED: 422,
  APPOINTMENT_ROOM_SERVICE_NOT_ALLOWED: 422,

  CHARGE_NOT_FOUND: 404,
  // 409 for all three "the record is not in the state this act needs": the
  // submission is well formed and something else already happened to the row,
  // which a refreshed screen explains. Exactly `TARIFF_ALREADY_VOIDED`'s
  // reasoning.
  CHARGE_ALREADY_VOIDED: 409,
  CHARGE_VOIDED: 409,
  CHARGE_EXISTS_FOR_PARTICIPANT: 409,
  // 422 rather than 409: nothing conflicts and nothing is missing. The session
  // simply is not one that may be charged — not completed, or not attended by
  // this child.
  CHARGE_NOT_ELIGIBLE: 422,
  ADJUSTMENT_NOT_FOUND: 404,
  ADJUSTMENT_ALREADY_VOIDED: 409,
  // 422: the amount is a valid amount and conflicts with no other request; it
  // is larger than the charge it is offered against, which is a property of the
  // referenced data rather than a race.
  ADJUSTMENT_EXCEEDS_CHARGE: 422,

  INTERNAL_ERROR: 500,
};

/**
 * `AUTH_INVALID_CREDENTIALS` is deliberately vague. Unknown username, wrong
 * password, locked account and disabled account all produce this exact message,
 * so the response distinguishes none of them.
 */
const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  AUTH_INVALID_CREDENTIALS: 'Invalid credentials',
  AUTH_SESSION_INVALID: 'Session is invalid',
  AUTH_SESSION_EXPIRED: 'Session has expired',
  AUTH_PASSWORD_CHANGE_REQUIRED: 'Password change is required before continuing',
  AUTH_FORBIDDEN: 'Forbidden',
  AUTH_INTERNAL_KEY_INVALID: 'Internal key is missing or invalid',
  AUTH_CSRF_INVALID: 'CSRF token is missing or invalid',
  AUTH_ORIGIN_REJECTED: 'Origin is missing or not allowed',
  VALIDATION_FAILED: 'Request validation failed',
  PASSWORD_POLICY_VIOLATION: 'Password does not satisfy policy',
  USER_NOT_FOUND: 'User not found',
  USER_USERNAME_TAKEN: 'Username is already taken',
  USER_SELF_MODIFICATION_FORBIDDEN: 'A user may not perform this action on their own account',
  USER_LAST_MANAGER: 'The last active manager may not be demoted or disabled',

  THERAPIST_NOT_FOUND: 'Therapist not found',
  SERVICE_NOT_FOUND: 'Service not found',
  ROOM_NOT_FOUND: 'Room not found',
  TARIFF_NOT_FOUND: 'Tariff not found',
  SERVICE_NAME_TAKEN: 'A service with this name already exists',
  ROOM_NAME_TAKEN: 'A room with this name already exists',
  TARIFF_DURATION_NOT_ALLOWED: 'The service does not offer this duration',
  SERVICE_DURATION_IN_USE: 'A tariff still prices this duration, so it may not be removed',
  TARIFF_OVERLAP: 'Another tariff already covers part of this date range',
  TARIFF_ALREADY_VOIDED: 'This tariff has already been voided',
  TARIFF_SCOPE_MISMATCH:
    'A replacement tariff must price the same service, duration and therapist scope',
  SERVICE_INACTIVE: 'The service is inactive',
  THERAPIST_INACTIVE: 'The therapist is inactive',
  TARIFF_MISSING: 'No tariff applies to this service, duration and date',

  FAMILY_NOT_FOUND: 'Family not found',
  CHILD_NOT_FOUND: 'Child not found',
  FAMILY_POSSIBLE_DUPLICATE: 'A similar family already exists and has not been acknowledged',
  CHILD_POSSIBLE_DUPLICATE: 'A similar child already exists and has not been acknowledged',
  CHILD_NATIONAL_ID_TAKEN: 'Another child already has this national identifier',
  CHILD_LEGACY_FILE_NUMBER_TAKEN: 'Another child already has this paper file number',
  FAMILY_PRIMARY_GUARDIAN_INVALID:
    'Exactly one guardian must be the primary contact, with a mobile or a landline',
  FAMILY_INACTIVE: 'The family is inactive',
  CHILD_BIRTH_DATE_IN_FUTURE: 'The birth date is after the current date at the clinic',
  DRAFT_NOT_FOUND: 'Registration draft not found or no longer valid',

  APPOINTMENT_NOT_FOUND: 'Appointment not found',
  APPOINTMENT_SERIES_NOT_FOUND: 'Appointment series not found',
  APPOINTMENT_PARTICIPANT_NOT_FOUND: 'This child is not a participant in the appointment',
  APPOINTMENT_THERAPIST_CONFLICT: 'The therapist already has an appointment in this time range',
  APPOINTMENT_ROOM_CONFLICT: 'The room is already booked for this time range',
  APPOINTMENT_CHILD_CONFLICT: 'The child already has an appointment in this time range',
  APPOINTMENT_TIME_INVALID: 'The appointment start, end or duration is not a valid window',
  APPOINTMENT_DURATION_NOT_ALLOWED: 'The service does not offer this session length',
  APPOINTMENT_TRANSITION_INVALID:
    'The current status of the appointment does not allow this change',
  APPOINTMENT_OUTSIDE_AVAILABILITY: 'The therapist is not available in this time range',
  RECURRENCE_RULE_INVALID: 'A series must state either an occurrence count or an end date',
  AVAILABILITY_WINDOW_INVALID: 'The availability window is not a valid time range',
  AVAILABILITY_WINDOW_OVERLAP: 'Another working window already covers these hours on this weekday',
  AVAILABILITY_EXCEPTION_CONFLICT: 'Another exception already covers this date',
  AVAILABILITY_EXCEPTION_NOT_FOUND: 'Availability exception not found for this therapist',
  ROOM_INACTIVE: 'The room is inactive',
  CHILD_INACTIVE: 'The child is inactive',
  APPOINTMENT_THERAPIST_SERVICE_NOT_SUPPORTED: 'The therapist does not provide this service',
  APPOINTMENT_ROOM_SERVICE_NOT_ALLOWED: 'The room is not allowed to host this service',

  CHARGE_NOT_FOUND: 'Session charge not found',
  CHARGE_ALREADY_VOIDED: 'This session charge has already been voided',
  CHARGE_VOIDED: 'This session charge has been voided and may not be changed',
  CHARGE_EXISTS_FOR_PARTICIPANT: 'A valid session charge already exists for this participant',
  CHARGE_NOT_ELIGIBLE:
    'Only an attended participant of a completed appointment may be charged for a session',
  ADJUSTMENT_NOT_FOUND: 'Charge adjustment not found',
  ADJUSTMENT_ALREADY_VOIDED: 'This charge adjustment has already been voided',
  ADJUSTMENT_EXCEEDS_CHARGE:
    'The adjustments on this charge may not exceed the amount that was charged',

  INTERNAL_ERROR: 'Internal error',
};

/** Every contract code must have a status and a message; missing one is a type error. */
export const KNOWN_ERROR_CODES: readonly ErrorCode[] = ERROR_CODES;
