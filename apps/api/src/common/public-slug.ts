import { AppError } from './app-error';
import { isRestrictViolation } from './pg-error';

/**
 * The A1 slug-stability invariant, seen from the write paths that have to obey
 * it.
 *
 * Milestone 9, checkpoint A2. `enforce_public_slug_stability()` in the database
 * is the AUTHORITY: once `public_first_published_at` is set, the slug may not
 * change and may not be cleared, on `service`, on `therapist` and on
 * `public_article` alike (DECISION_LOG, 2026-08-21). Nothing here weakens that.
 *
 * WHY THERE IS A SERVICE-LAYER CHECK AT ALL, GIVEN A TRIGGER THAT CANNOT BE
 * BYPASSED. The trigger raises SQLSTATE 23001 with a message about a column,
 * which reaches a manager as a 500 and reads as a defect. This turns the same
 * refusal into `PUBLIC_SLUG_IMMUTABLE` — a code with a Persian sentence behind
 * it that says what happened and what the alternative is. The check runs inside
 * the transaction, against a row locked FOR UPDATE, so it cannot race the write
 * it is about to make.
 *
 * AND THE TRIGGER IS STILL CAUGHT, BELOW. Two tiers stating one rule is how the
 * rule survives one of them being edited: `isPublicSlugImmutabilityViolation`
 * maps the database's own refusal onto the same code, so a path that forgets to
 * call `assertPublicSlugStable` fails with the right answer rather than the
 * wrong one.
 */
export type PublishedSlugState = {
  readonly publicSlug: string | null;
  readonly firstPublishedAt: Date | null;
};

/**
 * Refuses a slug change on a row that has been publicly reachable.
 *
 * `undefined` means the caller did not ask to change the slug at all, which is
 * always allowed — including on a published row, which is the ordinary case of
 * a manager editing a description on a live page.
 */
export function assertPublicSlugStable(
  current: PublishedSlugState,
  requested: string | null | undefined,
): void {
  if (requested === undefined) return;
  if (current.firstPublishedAt === null) return;
  if (requested === current.publicSlug) return;

  throw new AppError('PUBLIC_SLUG_IMMUTABLE');
}

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
