import { Logger } from '@nestjs/common';
import { redactSecrets } from './redact';

/**
 * Operational security logging for rejections that change no account state.
 *
 * This is explicitly NOT part of the audit trail and is never read back into
 * one. `audit_log` is append-only and unprunable, so it may only receive rows
 * that accompany a state transition on an existing active account. Unknown
 * usernames, malformed identifiers, already-locked and disabled accounts, and
 * forged session cookies change nothing — an attacker could otherwise drive
 * unbounded, permanent growth of a table nobody can clean up.
 *
 * Those attempts land here instead, in a rotatable, prunable artefact.
 *
 * There is deliberately no in-process aggregation feeding `audit_log`: process
 * memory is not durable, not transactional, and not bounded across instances,
 * so a summary flushed from it would give the audit trail entries whose
 * provenance is a lossy counter.
 */

export type SecurityRejectionReason =
  | 'UNKNOWN_USERNAME'
  | 'MALFORMED_USERNAME'
  | 'MALFORMED_PASSWORD_INPUT'
  | 'BAD_PASSWORD'
  | 'ACCOUNT_LOCKED'
  | 'ACCOUNT_DISABLED'
  | 'SESSION_INVALID'
  | 'INTERNAL_KEY_INVALID'
  // Milestone 9, checkpoint A3. The public request form's throttle, refused
  // here rather than audited for the reason a forged cookie is: an anonymous
  // caller who could write to an append-only, unprunable table simply by asking
  // is a caller who can grow it without bound.
  | 'SUBMISSION_RATE_EXCEEDED';

export type SecurityRejection = {
  event:
    | 'auth.login.rejected'
    | 'auth.session.rejected'
    | 'auth.internal_key.rejected'
    | 'website.request.throttled';
  reason: SecurityRejectionReason;
  requestId: string;
  clientIp?: string | null;
  /** Truncated and redacted. Never a password, hash, token or cookie. */
  usernameAttempted?: string | null;
};

const MAX_LOGGED_USERNAME_LENGTH = 64;

const logger = new Logger('SecurityLog');

/**
 * Fields are assembled from an allowlist rather than spread from a request, so
 * no caller can widen what reaches the log. The attempted username is
 * truncated — it is attacker-controlled and would otherwise be a way to write
 * arbitrary volume into the log — and passed through `redactSecrets` in case
 * someone types a credential into the username box.
 */
export function logSecurityRejection(rejection: SecurityRejection): void {
  const parts = [
    `event=${rejection.event}`,
    `reason=${rejection.reason}`,
    `requestId=${rejection.requestId}`,
  ];

  if (rejection.clientIp != null && rejection.clientIp !== '') {
    parts.push(`ip=${rejection.clientIp}`);
  }

  if (rejection.usernameAttempted != null && rejection.usernameAttempted !== '') {
    const truncated = rejection.usernameAttempted.slice(0, MAX_LOGGED_USERNAME_LENGTH);
    parts.push(`usernameAttempted=${redactSecrets(truncated)}`);
  }

  logger.warn(parts.join(' '));
}
