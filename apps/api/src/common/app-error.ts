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

  INTERNAL_ERROR: 'Internal error',
};

/** Every contract code must have a status and a message; missing one is a type error. */
export const KNOWN_ERROR_CODES: readonly ErrorCode[] = ERROR_CODES;
