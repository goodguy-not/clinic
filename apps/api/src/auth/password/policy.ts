import { PASSWORD_MAX_CODE_POINTS, PASSWORD_MIN_CODE_POINTS } from '../auth-policy';
import {
  containsBlockedTerm,
  containsUsername,
  isCommonPassword,
  isKeyboardWalk,
  isShortRepeatedUnit,
} from './blocklist';
import { countCodePoints, normalizePassword } from './normalize';

/**
 * The single entry point for password policy.
 *
 * Nothing outside this module implements a length rule, and `apps/web`
 * implements no password policy at all — the server is authoritative.
 * `scripts/check-web-boundary.mjs` enforces both mechanically.
 *
 * Deliberately absent, per NIST SP 800-63B and the approved policy: composition
 * requirements ("must contain an uppercase letter") and periodic expiry. Both
 * are known to push people towards predictable transformations.
 */

export type PasswordPolicyViolation =
  | 'ILL_FORMED_UNICODE'
  | 'TOO_MANY_BYTES'
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'COMMON_PASSWORD'
  | 'CONTAINS_USERNAME'
  | 'CONTAINS_BLOCKED_TERM'
  | 'REPEATED_UNIT'
  | 'KEYBOARD_WALK';

export type PasswordContext = {
  /** The account the password is being set for, when one exists. */
  username?: string;
  /** Owner-supplied clinic terms; see `parseBlockedTerms`. */
  blockedTerms?: readonly string[];
};

export type PasswordValidation =
  { ok: true; normalized: string } | { ok: false; violations: readonly PasswordPolicyViolation[] };

/**
 * Runs the approved check order. Steps 1 to 4 live in `normalizePassword`;
 * this adds the code-point range and the blocklist checks.
 *
 * All applicable violations are collected rather than returning the first, so a
 * caller can explain everything wrong at once. The caller maps the result to
 * `PASSWORD_POLICY_VIOLATION`; the individual reasons are developer-facing and
 * are never used to build a Persian message that would echo the password back.
 */
export function validatePassword(input: string, context: PasswordContext = {}): PasswordValidation {
  const normalization = normalizePassword(input);

  if (!normalization.ok) {
    return { ok: false, violations: [normalization.reason] };
  }

  const { normalized } = normalization;
  const folded = normalized.toLowerCase();
  const violations: PasswordPolicyViolation[] = [];

  const codePoints = countCodePoints(normalized);
  if (codePoints < PASSWORD_MIN_CODE_POINTS) violations.push('TOO_SHORT');
  if (codePoints > PASSWORD_MAX_CODE_POINTS) violations.push('TOO_LONG');

  if (isCommonPassword(folded)) violations.push('COMMON_PASSWORD');

  if (context.username !== undefined && containsUsername(folded, context.username)) {
    violations.push('CONTAINS_USERNAME');
  }

  if (context.blockedTerms !== undefined && containsBlockedTerm(folded, context.blockedTerms)) {
    violations.push('CONTAINS_BLOCKED_TERM');
  }

  if (isShortRepeatedUnit(folded)) violations.push('REPEATED_UNIT');
  if (isKeyboardWalk(folded)) violations.push('KEYBOARD_WALK');

  if (violations.length > 0) {
    return { ok: false, violations };
  }

  return { ok: true, normalized };
}
