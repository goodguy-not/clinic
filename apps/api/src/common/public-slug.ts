import { isRestrictViolation } from './pg-error';

/**
 * The slug-stability invariant, seen from the API.
 *
 * `enforce_public_slug_stability()` in the database is the AUTHORITY, on
 * `service`, `therapist` and `public_article` alike (DECISION_LOG, 2026-08-21;
 * tightened in M10-A10): an address, once assigned, is never changed or
 * cleared, and since M10-A10 the database assigns it (T-010). No request can
 * name an address any more, so the only thing left for the API is to report
 * the trigger's 23001 — should any write ever reach it — as
 * `PUBLIC_SLUG_IMMUTABLE` rather than as a 500.
 */
/**
 * True when the database itself refused the write for slug immutability.
 *
 * Narrower than `isRestrictViolation` alone, which every no-delete and
 * immutability trigger in this schema raises: the message is matched too, so a
 * different 23001 — an attempt to delete an audit row, say — is not reported to
 * a manager as a slug problem.
 */
export function isPublicSlugImmutabilityViolation(error: unknown): boolean {
  if (!isRestrictViolation(error)) return false;
  return error instanceof Error && /public_(slug|first_published_at) is/.test(error.message);
}
