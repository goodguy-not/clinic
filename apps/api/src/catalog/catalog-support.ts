import type { AuditContext } from '../audit/audit.types';
import type { RequestContext, ResolvedSession } from '../common/request-context';

/**
 * Shared helpers for the catalog module.
 *
 * Deliberately small: two functions that every catalog service needs and that
 * would otherwise be copied per entity. Anything genuinely specific to
 * therapists, services, rooms or tariffs belongs in that entity's own service.
 */

/**
 * Canonical form for a stored name or label: outer whitespace removed.
 *
 * The shared Zod contracts already trim, so this is the second of two passes
 * rather than the only one — but it is the pass that runs closest to the
 * INSERT, and it makes the guarantee hold for any future caller that reaches
 * the service directly. The database has the final say: every one of these
 * columns carries a `= btrim(...)` CHECK, so an untrimmed value cannot be
 * stored even if both application passes were removed.
 *
 * Outer whitespace only. Persian yeh/kaf folding, internal-whitespace
 * collapsing and fuzzy matching are all deliberately absent: each silently
 * rewrites what a user typed, and near-duplicate detection is a separate
 * feature that has not been approved.
 */
export function canonicalText(value: string): string {
  return value.trim();
}

/** Same rule, for an optional field where absence and emptiness are distinct. */
export function canonicalOptionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Builds the audit actor from the resolved session and request context. */
export function actorContext(actor: ResolvedSession, context: RequestContext): AuditContext {
  return {
    actor: { type: 'USER' as const, userId: actor.userId, sessionId: actor.sessionId },
    requestId: context.requestId,
    clientIp: context.clientIp,
    userAgent: context.userAgent,
  };
}
