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
  INTERNAL_ERROR: 'Internal error',
};

/** Every contract code must have a status and a message; missing one is a type error. */
export const KNOWN_ERROR_CODES: readonly ErrorCode[] = ERROR_CODES;
