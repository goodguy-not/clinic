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
      const forbidden = FORBIDDEN_KEY_SUBSTRINGS.find((needle) => normalized.includes(needle));

      if (forbidden !== undefined) {
        throw new AuditPayloadError(
          `Audit payload key "${key}" looks like secret material ("${forbidden}")`,
          path === '' ? key : `${path}.${key}`,
        );
      }

      checkValue(nested, path === '' ? key : `${path}.${key}`, depth + 1);
    }
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
