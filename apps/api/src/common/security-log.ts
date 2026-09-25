import { Logger } from '@nestjs/common';

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
};

const logger = new Logger('SecurityLog');

/**
 * THREE FIELDS, ALL OURS. Milestone 10, checkpoint A3 took the attempted
 * username and the client address out of this line: production logs carry no
 * personal data, a username is a colleague's identifier (and is sometimes a
 * password typed into the wrong box, which no redaction can recognise), and an
 * address is personal data. What remains is enough to count and classify
 * rejections, and the request id joins a line to everything else about that
 * request — including, for an existing account, its audit row, which records
 * the address under the audit trail's own rules.
 *
 * The type has no field for either, so no caller can put one back without a
 * change here; `security-log.spec.ts` pins the exact shape of the line.
 */
export function logSecurityRejection(rejection: SecurityRejection): void {
  logger.warn(
    `event=${rejection.event} reason=${rejection.reason} requestId=${rejection.requestId}`,
  );
}
