import { isIP } from 'node:net';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { uuidv7 } from '../common/uuid';
import { assertAuditPayloadSafe } from './audit-payload';
import type { AuditContext, AuditEntry, AuditJsonObject } from './audit.types';

/**
 * The transaction client every audited write must supply.
 *
 * Typed as Prisma's interactive transaction client. TypeScript alone cannot
 * stop someone passing the base `PrismaClient` — it is structurally assignable
 * because it has strictly more members — so `record` also checks at runtime,
 * below.
 */
export type AuditTransaction = Prisma.TransactionClient;

/**
 * Writes the audit trail.
 *
 * The signature is the design. `record` takes a transaction client as its first
 * required argument, so "the audit row is written in the same transaction as
 * the state change" is something a caller has to go out of their way to break,
 * rather than something a reviewer has to remember to check.
 *
 * There is deliberately no Prisma middleware and no generic entity diffing.
 * Automatic auditing would capture `password_hash` and `token_hash`, would
 * produce diffs dominated by `last_seen_at` and `failed_login_count` churn, and
 * could not know which writes the domain considers sensitive. Every call site
 * builds an explicit, minimal payload instead.
 */
@Injectable()
export class AuditService {
  async record(tx: AuditTransaction, context: AuditContext, entry: AuditEntry): Promise<void> {
    assertTransactionClient(tx);

    assertAuditPayloadSafe({
      before: entry.before ?? null,
      after: entry.after ?? null,
      metadata: entry.metadata ?? null,
    });

    const actor = context.actor;
    const actorUserId = actor.type === 'USER' ? actor.userId : null;
    const sessionId = actor.type === 'USER' ? actor.sessionId : null;

    // Written with raw SQL rather than `tx.auditLog.create` so that
    // `occurred_at` comes from the column default.
    //
    // Prisma's `@default(now())` is filled by the query engine per statement,
    // not by PostgreSQL, so two audit rows written inside one transaction would
    // carry timestamps milliseconds apart — and an audit trail that reports a
    // state change and its own record as happening at different instants is
    // quietly lying about atomicity. `transaction_timestamp()` gives every row
    // in the transaction the same instant, which is the property the design
    // depends on. An integration test pins it.
    await tx.$executeRaw`
      INSERT INTO audit_log (
        id, occurred_at, action, actor_type, actor_user_id, session_id,
        request_id, entity_type, entity_id, before, after, metadata, ip, user_agent
      ) VALUES (
        ${uuidv7()}::uuid,
        transaction_timestamp(),
        ${entry.action},
        ${actor.type}::audit_actor_type,
        ${actorUserId}::uuid,
        ${sessionId}::uuid,
        ${context.requestId}::uuid,
        ${entry.entityType},
        ${entry.entityId ?? null}::uuid,
        ${toJsonText(entry.before)}::jsonb,
        ${toJsonText(entry.after)}::jsonb,
        ${toJsonText(entry.metadata)}::jsonb,
        ${normalizeIp(context.clientIp)}::inet,
        ${context.userAgent ?? null}
      )
    `;
  }
}

/**
 * An interactive transaction client has no `$transaction` method; the base
 * client does. That difference is what makes this check possible, and it turns
 * "you must pass a transaction" from a comment into a runtime guarantee.
 */
function assertTransactionClient(tx: AuditTransaction): void {
  const candidate = tx as { $transaction?: unknown };

  if (typeof candidate.$transaction === 'function') {
    throw new Error(
      'AuditService.record requires an interactive transaction client, not the base PrismaClient. ' +
        'An audit row must be written in the same transaction as the state change it records.',
    );
  }
}

/**
 * The `ip` column is `inet`; PostgreSQL rejects anything that is not an
 * address. The value arrives from the web tier and is only as trustworthy as
 * its proxy configuration, so an unparseable one is stored as NULL rather than
 * failing the whole transaction — losing a forensic hint is better than losing
 * the state change and its audit row.
 */
function normalizeIp(value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  return isIP(value) === 0 ? null : value;
}

function toJsonText(value: AuditJsonObject | null | undefined): string | null {
  return value == null ? null : JSON.stringify(value);
}
