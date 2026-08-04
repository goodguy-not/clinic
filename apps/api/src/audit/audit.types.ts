import type { AuditAction, AuditEntityType } from './audit-actions';

/** JSON that may be stored in a `before`, `after` or `metadata` column. */
export type AuditJsonValue =
  string | number | boolean | null | AuditJsonValue[] | { [key: string]: AuditJsonValue };

export type AuditJsonObject = { [key: string]: AuditJsonValue };

/**
 * Who acted.
 *
 * The database enforces `(actor_type = 'USER') = (actor_user_id IS NOT NULL)`,
 * so this union mirrors a constraint rather than a convention: a USER actor
 * always names the user, and SYSTEM or ANONYMOUS never does.
 *
 * `sessionId` is recorded as a historical value. `audit_log` has no foreign key
 * to `user_session`, so the reference survives a future session purge.
 */
export type AuditActor =
  | { readonly type: 'USER'; readonly userId: string; readonly sessionId: string | null }
  | { readonly type: 'SYSTEM' }
  | { readonly type: 'ANONYMOUS' };

export type AuditContext = {
  readonly actor: AuditActor;
  readonly requestId: string;
  readonly clientIp?: string | null;
  readonly userAgent?: string | null;
};

/**
 * One audited fact.
 *
 * `before`, `after` and `metadata` are built by hand at each call site. There
 * is no automatic diffing: it would capture `password_hash` and `token_hash`,
 * and it would fill diffs with `last_seen_at` and `failed_login_count` churn
 * that buries the change a reviewer is actually looking for.
 */
export type AuditEntry = {
  readonly action: AuditAction;
  readonly entityType: AuditEntityType;
  readonly entityId?: string | null;
  readonly before?: AuditJsonObject | null;
  readonly after?: AuditJsonObject | null;
  readonly metadata?: AuditJsonObject | null;
};
