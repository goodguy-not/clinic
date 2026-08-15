import {
  maskedLandlineSchema,
  maskedMobileSchema,
  maskedNationalIdSchema,
} from '@clinic/contracts';
import type { AuditJsonValue } from './audit.types';

/**
 * Rejects audit payloads that carry secret material.
 *
 * This throws rather than silently redacting. A redacting guard hides mistakes:
 * the row still gets written, the reviewer sees `"***"`, and nobody learns that
 * a call site is handing secrets to the audit trail. Throwing turns the same
 * mistake into a failing test.
 *
 * It runs inside `AuditService.record`, so no call site can bypass it, and the
 * database `audit_log_no_secret_material_chk` constraint catches anything that
 * somehow gets past it.
 */
export class AuditPayloadError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(message);
    this.name = 'AuditPayloadError';
  }
}

/**
 * Substrings, not exact names, so `passwordHash`, `password_hash`,
 * `newPassword` and `hashedPassword` are all caught by one entry. Keys are
 * compared with separators stripped, so snake_case and camelCase collapse to
 * the same form.
 */
const FORBIDDEN_KEY_SUBSTRINGS = [
  'password',
  'passwd',
  'secret',
  'token',
  'cookie',
  'authorization',
  'internalkey',
  'apikey',
  'privatekey',
  'credential',
  'salt',
] as const;

/**
 * Keys that contain a forbidden substring but carry no secret, permitted only
 * when their value is a boolean.
 *
 * `mustChangePassword` is a flag about a password, not a password. Auditing a
 * role or account change without it would lose information a reviewer wants,
 * and renaming the field to dodge the substring check would be worse — the
 * database column is `must_change_password`, and an audit payload that calls it
 * something else is harder to trust, not easier.
 *
 * The boolean requirement is what keeps this narrow: the exemption cannot be
 * used to smuggle a string through, because a string under this key is still
 * rejected.
 */
const BOOLEAN_ONLY_ALLOWED_KEYS = new Set(['mustchangepassword']);

/**
 * THERE IS DELIBERATELY NO GLOBAL `reference` RULE HERE. A payment's bank
 * reference must never reach a permanent audit payload (DECISION_LOG,
 * 2026-08-15), and that guarantee is enforced where the fact lives — see
 * `assertPaymentAuditSafe` in `payment-audit.ts`, which every payment and
 * promise audit write passes through. A substring rule at this level would
 * refuse `referenceDate`, `tariffReferenceId` and every other unrelated key a
 * later domain might legitimately name, which is a policy change for domains
 * nobody has decided anything about. The rules in this file stay what they have
 * always been: secret material, and identifiers that must be masked.
 */

/**
 * Keys whose value must be `null` or an exactly masked identifier.
 *
 * `audit_log` is append-only and permanent, so a national identifier or a phone
 * number copied into it becomes a second, undeletable store of that identifier
 * — kept to answer a question that never needed the value itself. The last four
 * digits are enough to confirm which number a row is about.
 *
 * The shapes are exact rather than "begins with an asterisk". Six asterisks and
 * four digits cannot be produced by a ten-digit identifier, so a full value is
 * structurally incapable of passing; a prefix rule would have let
 * `*1234567890` through.
 *
 * Matched as substrings, like `FORBIDDEN_KEY_SUBSTRINGS` above and for the same
 * reason: `mobile`, `primaryMobile`, `guardian_mobile` and `mobileNumber` are
 * one rule, not four, and a call site cannot escape the check by renaming a
 * field. `draftToken` needs no entry here — it is already refused outright by
 * the `token` substring above, which is the correct treatment for a bearer
 * credential.
 *
 * Order matters only in that the first match decides the expected shape; the
 * four do not overlap in any way that changes the outcome.
 */
const MASKED_IDENTIFIER_KEYS = [
  { needle: 'nationalid', schema: maskedNationalIdSchema, shape: '6 asterisks and 4 digits' },
  { needle: 'mobile', schema: maskedMobileSchema, shape: '7 asterisks and 4 digits' },
  { needle: 'landline', schema: maskedLandlineSchema, shape: '6 or 7 asterisks and 4 digits' },
  { needle: 'phone', schema: maskedLandlineSchema, shape: '6 or 7 asterisks and 4 digits' },
] as const;

/** Any Argon2 hash, whole or fragmentary, in any string value. */
const ARGON2_MARKER = /\$argon2/i;

/**
 * A bound on recursion depth. An audit payload is a hand-built summary of a
 * change; anything deeply nested is a sign that an object graph was passed
 * wholesale, which is exactly the automatic-diffing failure mode this design
 * exists to prevent.
 */
const MAX_DEPTH = 8;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function checkValue(value: AuditJsonValue, path: string, depth: number): void {
  if (depth > MAX_DEPTH) {
    throw new AuditPayloadError(
      `Audit payload nests deeper than ${MAX_DEPTH} levels; build an explicit summary instead of passing an object graph`,
      path,
    );
  }

  if (typeof value === 'string') {
    if (ARGON2_MARKER.test(value)) {
      throw new AuditPayloadError('Audit payload contains an Argon2 hash', path);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      checkValue(item, `${path}[${index}]`, depth + 1);
    });
    return;
  }

  if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      const normalized = normalizeKey(key);
      const exempt = BOOLEAN_ONLY_ALLOWED_KEYS.has(normalized) && typeof nested === 'boolean';
      const forbidden = exempt
        ? undefined
        : FORBIDDEN_KEY_SUBSTRINGS.find((needle) => normalized.includes(needle));

      const keyPath = path === '' ? key : `${path}.${key}`;

      if (forbidden !== undefined) {
        throw new AuditPayloadError(
          `Audit payload key "${key}" looks like secret material ("${forbidden}")`,
          keyPath,
        );
      }

      assertIdentifierMasked(key, normalized, nested, keyPath);

      checkValue(nested, keyPath, depth + 1);
    }
  }
}

/**
 * `null` or the exact masked shape, and nothing else.
 *
 * A number under one of these keys is rejected along with everything else. It
 * is either a bug or an identifier that lost its leading zero on the way to
 * becoming one, and neither should reach a permanent record.
 */
function assertIdentifierMasked(
  key: string,
  normalized: string,
  value: AuditJsonValue,
  keyPath: string,
): void {
  const guarded = MASKED_IDENTIFIER_KEYS.find((entry) => normalized.includes(entry.needle));
  if (guarded === undefined) return;

  if (value === null) return;

  if (typeof value !== 'string' || !guarded.schema.safeParse(value).success) {
    throw new AuditPayloadError(
      `Audit payload key "${key}" must be null or a masked identifier (${guarded.shape}); ` +
        'build it with the mapper in src/families/audit-safe.ts',
      keyPath,
    );
  }
}

export function assertAuditPayloadSafe(payload: {
  before?: AuditJsonValue | null;
  after?: AuditJsonValue | null;
  metadata?: AuditJsonValue | null;
}): void {
  for (const [name, value] of Object.entries(payload)) {
    if (value === undefined || value === null) continue;
    checkValue(value, name, 0);
  }
}
