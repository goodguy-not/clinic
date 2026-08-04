import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { UserRole, UserStatus } from '@clinic/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { uuidv7 } from '../common/uuid';
import type { ResolvedSession } from '../common/request-context';
import { permissionsForRole } from './permissions';
import {
  COOKIE_MAX_AGE_SAFETY_MARGIN_SECONDS,
  SESSION_ABSOLUTE_MINUTES,
  SESSION_IDLE_MINUTES,
  SESSION_TOKEN_BYTES,
  SESSION_TOUCH_MINUTES,
} from './auth-policy';

/**
 * Server-side sessions.
 *
 * Every timestamp and every expiry comparison here is computed by PostgreSQL —
 * `transaction_timestamp()` for facts that must agree with their audit row,
 * `clock_timestamp()` for liveness. The Node clock is never consulted for a
 * security decision, so there is no second clock to drift.
 *
 * The browser holds a 32-byte random token; this table stores only its SHA-256
 * hash. A leaked backup, query log, or SQL-injection read in some later module
 * therefore yields nothing that can be replayed. Plain SHA-256 rather than a
 * peppered HMAC is deliberate: the input is 256 bits of CSPRNG output, so there
 * is no guessable space for a pepper to protect, and a pepper would add a
 * key-rotation problem that invalidates live sessions.
 */

export type SessionIssue = {
  sessionId: string;
  token: string;
  cookieMaxAgeSeconds: number;
};

export type SessionRevokeReason =
  'LOGOUT' | 'PASSWORD_CHANGED' | 'USER_DISABLED' | 'MANAGER_REVOKED' | 'SUPERSEDED';

type SessionLookupRow = {
  session_id: string;
  user_id: string;
  username: string;
  display_name: string;
  role: UserRole;
  status: UserStatus;
  must_change_password: boolean;
  is_valid: boolean;
  is_stale: boolean;
};

type CookieMaxAgeRow = { cookie_max_age_seconds: number };

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  /** 32 random bytes, base64url. Generated here because NestJS owns sessions. */
  generateToken(): string {
    return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
  }

  hashToken(token: string): Buffer {
    return createHash('sha256').update(token, 'utf8').digest();
  }

  /**
   * Creates a session inside the caller's transaction, so the row and its audit
   * entry commit together.
   *
   * `cookieMaxAgeSeconds` is computed in SQL from
   * `absolute_expires_at - clock_timestamp()` minus the safety margin, and
   * returned for Next to use verbatim. Next must never derive this from its own
   * clock: the subtraction is a security calculation, and a fast web-tier clock
   * would mint a cookie outliving the absolute cap.
   */
  async createSession(tx: Prisma.TransactionClient, userId: string): Promise<SessionIssue> {
    const token = this.generateToken();
    const sessionId = uuidv7();

    const rows = await tx.$queryRaw<CookieMaxAgeRow[]>`
      INSERT INTO user_session (
        id, token_hash, user_id,
        created_at, last_seen_at, idle_expires_at, absolute_expires_at
      )
      VALUES (
        ${sessionId}::uuid,
        ${this.hashToken(token)},
        ${userId}::uuid,
        transaction_timestamp(),
        transaction_timestamp(),
        transaction_timestamp() + make_interval(mins => ${SESSION_IDLE_MINUTES}::int),
        transaction_timestamp() + make_interval(mins => ${SESSION_ABSOLUTE_MINUTES}::int)
      )
      RETURNING GREATEST(
        0,
        FLOOR(EXTRACT(EPOCH FROM (absolute_expires_at - clock_timestamp())))::int
          - ${COOKIE_MAX_AGE_SAFETY_MARGIN_SECONDS}
      )::int AS cookie_max_age_seconds
    `;

    const cookieMaxAgeSeconds = rows[0]?.cookie_max_age_seconds ?? 0;

    return { sessionId, token, cookieMaxAgeSeconds };
  }

  /**
   * Validates a presented token and, when the session is stale, renews it.
   *
   * Returns null for every invalid case — unknown token, revoked, idle-expired,
   * absolute-expired, or a user who is no longer ACTIVE. The caller turns that
   * into one generic response.
   */
  async resolve(token: string): Promise<ResolvedSession | null> {
    const tokenHash = this.hashToken(token);

    const first = await this.lookup(tokenHash);
    if (first === null) return null;

    if (!first.is_valid || first.status !== 'ACTIVE') return null;

    if (!first.is_stale) {
      return toResolvedSession(first);
    }

    const touched = await this.touch(first.session_id);

    if (touched === 0) {
      // Zero-row rule. The renewal was attempted because the session was stale,
      // so nothing should have blocked it. Zero rows means the row changed
      // underneath us: either a concurrent request renewed it first (benign) or
      // it was revoked, disabled or expired between the two statements (not
      // benign). The earlier snapshot must not be used to decide either way, so
      // re-read once and trust only the fresh answer.
      const second = await this.lookup(tokenHash);
      if (second === null || !second.is_valid || second.status !== 'ACTIVE') return null;
      return toResolvedSession(second);
    }

    return toResolvedSession(first);
  }

  private async lookup(tokenHash: Buffer): Promise<SessionLookupRow | null> {
    const rows = await this.prisma.$queryRaw<SessionLookupRow[]>`
      SELECT
        s.id            AS session_id,
        s.user_id       AS user_id,
        u.username      AS username,
        u.display_name  AS display_name,
        u.role::text    AS role,
        u.status::text  AS status,
        u.must_change_password,
        (
          s.revoked_at IS NULL
          AND clock_timestamp() < s.idle_expires_at
          AND clock_timestamp() < s.absolute_expires_at
        ) AS is_valid,
        (
          s.last_seen_at < clock_timestamp() - make_interval(mins => ${SESSION_TOUCH_MINUTES}::int)
        ) AS is_stale
      FROM user_session s
      JOIN app_user u ON u.id = s.user_id
      WHERE s.token_hash = ${tokenHash}
    `;

    return rows[0] ?? null;
  }

  /**
   * Renews only when genuinely stale, and re-states the full validity predicate
   * so a session invalidated between the read and this write is not resurrected.
   * `LEAST(..., absolute_expires_at)` is what keeps the
   * `idle_expires_at <= absolute_expires_at` CHECK satisfiable.
   */
  private touch(sessionId: string): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE user_session
      SET last_seen_at    = clock_timestamp(),
          idle_expires_at = LEAST(
            clock_timestamp() + make_interval(mins => ${SESSION_IDLE_MINUTES}::int),
            absolute_expires_at
          )
      WHERE id = ${sessionId}::uuid
        AND revoked_at IS NULL
        AND clock_timestamp() < idle_expires_at
        AND clock_timestamp() < absolute_expires_at
        AND last_seen_at < clock_timestamp() - make_interval(mins => ${SESSION_TOUCH_MINUTES}::int)
    `;
  }

  /** Idempotent: revoking an already-revoked session affects no rows. */
  revokeSession(
    tx: Prisma.TransactionClient,
    sessionId: string,
    reason: SessionRevokeReason,
  ): Promise<number> {
    return tx.$executeRaw`
      UPDATE user_session
      SET revoked_at = transaction_timestamp(),
          revoked_reason = ${reason}::session_revoke_reason
      WHERE id = ${sessionId}::uuid
        AND revoked_at IS NULL
    `;
  }

  /** Used by password change and, later, by disable and manager revoke-all. */
  revokeAllForUser(
    tx: Prisma.TransactionClient,
    userId: string,
    reason: SessionRevokeReason,
    exceptSessionId?: string,
  ): Promise<number> {
    const except = exceptSessionId ?? '00000000-0000-0000-0000-000000000000';

    return tx.$executeRaw`
      UPDATE user_session
      SET revoked_at = transaction_timestamp(),
          revoked_reason = ${reason}::session_revoke_reason
      WHERE user_id = ${userId}::uuid
        AND revoked_at IS NULL
        AND id <> ${except}::uuid
    `;
  }
}

function toResolvedSession(row: SessionLookupRow): ResolvedSession {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    mustChangePassword: row.must_change_password,
    permissions: permissionsForRole(row.role),
  };
}
