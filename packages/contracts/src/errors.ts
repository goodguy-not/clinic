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
