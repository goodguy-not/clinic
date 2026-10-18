import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AuthenticatedUser,
  ChangePasswordRequest,
  LoginRequest,
  LoginResponse,
  UserRole,
  UserStatus,
} from '@clinic/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import { logSecurityRejection } from '../common/security-log';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { API_ENV } from '../config/config.module';
import type { ApiEnv } from '../config/env';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { permissionsForRole } from './permissions';
import { LOCKOUT_DURATION_MINUTES, LOCKOUT_THRESHOLD, LOCKOUT_WINDOW_MINUTES } from './auth-policy';
import { normalizePassword } from './password/normalize';
import { validatePassword } from './password/policy';
import { parseBlockedTerms } from './password/blocklist';

/**
 * Authentication decisions. NestJS owns all of them.
 *
 * Two properties shape this file more than anything else:
 *
 *  1. Every failure looks identical from outside. Unknown username, wrong
 *     password, locked account and disabled account all produce
 *     `AUTH_INVALID_CREDENTIALS` with the same message, and every attempt with
 *     well-formed input costs exactly one Argon2 verification. The real reason
 *     is recorded server-side only.
 *
 *  2. The account state that authorises a login is read under a row lock AFTER
 *     the password is verified, never before. Argon2 deliberately takes tens of
 *     milliseconds, which is more than enough time for a manager to disable an
 *     account mid-verification.
 */

type UserLookupRow = {
  id: string;
  password_hash: string;
};

type LockedUserRow = {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  status: UserStatus;
  password_hash: string;
  must_change_password: boolean;
  failed_login_count: number;
  is_locked: boolean;
  window_expired: boolean;
};

type LoginOutcome =
  | { kind: 'success'; response: LoginResponse }
  | { kind: 'rejected'; reason: 'BAD_PASSWORD' | 'ACCOUNT_LOCKED' | 'ACCOUNT_DISABLED' };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async login(input: LoginRequest, context: RequestContext): Promise<LoginResponse> {
    // Input guard first. An ill-formed or over-long password is rejected before
    // Argon2 runs: the approved rule covers well-formed, byte-bounded
    // credentials, and this branch depends only on attacker-supplied input, so
    // it reveals nothing about any account.
    const normalized = normalizePassword(input.password);

    if (!normalized.ok) {
      throw this.loginRejection(context, 'MALFORMED_PASSWORD_INPUT');
    }

    const user = await this.prisma.$queryRaw<UserLookupRow[]>`
      SELECT id, password_hash FROM app_user WHERE username = ${input.username}
    `;

    const candidate = user[0] ?? null;

    // Exactly one verification, on every path. An unknown username is checked
    // against a dummy hash built at startup from random bytes, so it costs the
    // same as a real account and can never match.
    const verified =
      candidate === null
        ? await this.passwords.verifyAgainstDummy(input.password)
        : await this.passwords.verify(candidate.password_hash, input.password);

    if (candidate === null) {
      // No account changed state, so nothing is audited: `audit_log` is
      // append-only and unprunable, and an unauthenticated caller must not be
      // able to grow it without bound.
      throw this.loginRejection(context, 'UNKNOWN_USERNAME');
    }

    const outcome = await this.prisma.$transaction((tx) =>
      this.completeLogin(tx, candidate.id, verified, input.password, context),
    );

    if (outcome.kind === 'rejected') {
      // Thrown after the transaction commits, so a failure counter and its
      // audit row survive the failed request.
      throw this.loginRejection(context, outcome.reason);
    }

    return outcome.response;
  }

  /**
   * Everything from here runs under `SELECT ... FOR UPDATE`.
   *
   * The row read before Argon2 is treated as a candidate only. Status, lock
   * state and counters are re-read here and are the sole basis for the
   * decision, so a disable or lock that landed during verification is honoured
   * and no session is ever created from the pre-Argon2 snapshot.
   */
  private async completeLogin(
    tx: Prisma.TransactionClient,
    userId: string,
    verified: boolean,
    rawPassword: string,
    context: RequestContext,
  ): Promise<LoginOutcome> {
    const rows = await tx.$queryRaw<LockedUserRow[]>`
      SELECT
        id, username, display_name,
        role::text   AS role,
        status::text AS status,
        password_hash, must_change_password, failed_login_count,
        (locked_until IS NOT NULL AND locked_until > clock_timestamp()) AS is_locked,
        (
          failed_login_window_started_at IS NULL
          OR failed_login_window_started_at
               < clock_timestamp() - make_interval(mins => ${LOCKOUT_WINDOW_MINUTES}::int)
        ) AS window_expired
      FROM app_user
      WHERE id = ${userId}::uuid
      FOR UPDATE
    `;

    const current = rows[0];
    if (current === undefined) return { kind: 'rejected', reason: 'BAD_PASSWORD' };

    // A disabled or locked account changes no state and writes no audit row,
    // whether or not the password was correct.
    if (current.status !== 'ACTIVE') return { kind: 'rejected', reason: 'ACCOUNT_DISABLED' };
    if (current.is_locked) return { kind: 'rejected', reason: 'ACCOUNT_LOCKED' };

    if (!verified) {
      await this.recordFailure(tx, current, context);
      return { kind: 'rejected', reason: 'BAD_PASSWORD' };
    }

    return {
      kind: 'success',
      response: await this.recordSuccess(tx, current, rawPassword, context),
    };
  }

  private async recordFailure(
    tx: Prisma.TransactionClient,
    user: LockedUserRow,
    context: RequestContext,
  ): Promise<void> {
    const nextCount = user.window_expired ? 1 : user.failed_login_count + 1;
    const locking = nextCount >= LOCKOUT_THRESHOLD;

    if (locking) {
      // Reaching the threshold starts the lock and clears the window, so the
      // next window begins clean rather than locking again on one more failure.
      await tx.$executeRaw`
        UPDATE app_user
        SET failed_login_count = 0,
            failed_login_window_started_at = NULL,
            locked_until = transaction_timestamp()
                           + make_interval(mins => ${LOCKOUT_DURATION_MINUTES}::int)
        WHERE id = ${user.id}::uuid
      `;
    } else if (user.window_expired) {
      await tx.$executeRaw`
        UPDATE app_user
        SET failed_login_count = 1,
            failed_login_window_started_at = transaction_timestamp()
        WHERE id = ${user.id}::uuid
      `;
    } else {
      await tx.$executeRaw`
        UPDATE app_user
        SET failed_login_count = failed_login_count + 1
        WHERE id = ${user.id}::uuid
      `;
    }

    // The actor is ANONYMOUS: nobody authenticated. The account is the entity
    // acted upon, which is what makes this row worth keeping.
    await this.audit.record(
      tx,
      { actor: { type: 'ANONYMOUS' }, ...this.auditContext(context) },
      {
        action: 'auth.login.failed',
        entityType: 'app_user',
        entityId: user.id,
        metadata: { reason: 'BAD_PASSWORD', failedLoginCount: nextCount },
      },
    );

    if (locking) {
      await this.audit.record(
        tx,
        { actor: { type: 'ANONYMOUS' }, ...this.auditContext(context) },
        {
          action: 'auth.login.locked',
          entityType: 'app_user',
          entityId: user.id,
          metadata: {
            threshold: LOCKOUT_THRESHOLD,
            windowMinutes: LOCKOUT_WINDOW_MINUTES,
            lockDurationMinutes: LOCKOUT_DURATION_MINUTES,
          },
        },
      );
    }
  }

  private async recordSuccess(
    tx: Prisma.TransactionClient,
    user: LockedUserRow,
    rawPassword: string,
    context: RequestContext,
  ): Promise<LoginResponse> {
    const rehashed = this.passwords.needsRehash(user.password_hash);

    if (rehashed) {
      // Cost parameters changed since this hash was written. Re-hashing inside
      // the same transaction as the successful login stops legacy settings from
      // becoming permanent. `password_updated_at` is deliberately NOT touched:
      // the password did not change, only its encoding, and moving that column
      // would misreport a credential change in the audit history.
      const fresh = await this.passwords.hash(rawPassword);

      await tx.$executeRaw`
        UPDATE app_user SET password_hash = ${fresh} WHERE id = ${user.id}::uuid
      `;
    }

    await tx.$executeRaw`
      UPDATE app_user
      SET failed_login_count = 0,
          failed_login_window_started_at = NULL,
          locked_until = NULL,
          last_login_at = transaction_timestamp()
      WHERE id = ${user.id}::uuid
    `;

    const issued = await this.sessions.createSession(tx, user.id);

    await this.audit.record(
      tx,
      {
        actor: { type: 'USER', userId: user.id, sessionId: issued.sessionId },
        ...this.auditContext(context),
      },
      {
        action: 'auth.login.succeeded',
        entityType: 'user_session',
        entityId: issued.sessionId,
        metadata: { rehashed },
      },
    );

    return {
      sessionToken: issued.token,
      session: { cookieMaxAgeSeconds: issued.cookieMaxAgeSeconds },
      user: toAuthenticatedUser(user),
    };
  }

  async logout(session: ResolvedSession, context: RequestContext): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const revoked = await this.sessions.revokeSession(tx, session.sessionId, 'LOGOUT');

      // Idempotent: an already-revoked session writes no audit row, so repeated
      // logout calls cannot pad the trail.
      if (revoked > 0) {
        await this.audit.record(
          tx,
          {
            actor: { type: 'USER', userId: session.userId, sessionId: session.sessionId },
            ...this.auditContext(context),
          },
          {
            action: 'auth.logout',
            entityType: 'user_session',
            entityId: session.sessionId,
          },
        );
      }
    });
  }

  currentSession(session: ResolvedSession): AuthenticatedUser {
    return {
      id: session.userId,
      username: session.username,
      displayName: session.displayName,
      role: session.role,
      mustChangePassword: session.mustChangePassword,
      permissions: [...session.permissions],
    };
  }

  /**
   * Changing a password rotates the session: every existing session for the
   * user is revoked and a new token is issued, so a stolen token cannot survive
   * the change that was meant to lock the thief out.
   */
  async changePassword(
    input: ChangePasswordRequest,
    session: ResolvedSession,
    context: RequestContext,
  ): Promise<LoginResponse> {
    const policy = validatePassword(input.newPassword, {
      username: session.username,
      blockedTerms: parseBlockedTerms(this.env.PASSWORD_BLOCKED_TERMS),
    });

    if (!policy.ok) {
      throw new AppError('PASSWORD_POLICY_VIOLATION', { violations: policy.violations });
    }

    const stored = await this.prisma.$queryRaw<UserLookupRow[]>`
      SELECT id, password_hash FROM app_user WHERE id = ${session.userId}::uuid
    `;

    const row = stored[0];
    if (row === undefined) throw new AppError('AUTH_SESSION_INVALID');

    const verified = await this.passwords.verify(row.password_hash, input.currentPassword);
    if (!verified) throw new AppError('AUTH_INVALID_CREDENTIALS');

    const newHash = await this.passwords.hash(input.newPassword);

    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<LockedUserRow[]>`
        SELECT
          id, username, display_name,
          role::text   AS role,
          status::text AS status,
          password_hash, must_change_password, failed_login_count,
          false AS is_locked, false AS window_expired
        FROM app_user
        WHERE id = ${session.userId}::uuid
        FOR UPDATE
      `;

      const current = locked[0];
      if (current === undefined || current.status !== 'ACTIVE') {
        throw new AppError('AUTH_SESSION_INVALID');
      }

      await tx.$executeRaw`
        UPDATE app_user
        SET password_hash = ${newHash},
            password_updated_at = transaction_timestamp(),
            must_change_password = false,
            failed_login_count = 0,
            failed_login_window_started_at = NULL,
            locked_until = NULL
        WHERE id = ${current.id}::uuid
      `;

      await this.sessions.revokeAllForUser(tx, current.id, 'PASSWORD_CHANGED');
      const issued = await this.sessions.createSession(tx, current.id);

      const actor = {
        actor: { type: 'USER' as const, userId: current.id, sessionId: issued.sessionId },
        ...this.auditContext(context),
      };

      await this.audit.record(tx, actor, {
        action: 'auth.password.changed',
        entityType: 'app_user',
        entityId: current.id,
        metadata: { forced: current.must_change_password },
      });

      await this.audit.record(tx, actor, {
        action: 'auth.session.rotated',
        entityType: 'user_session',
        entityId: issued.sessionId,
        metadata: { previousSessionId: session.sessionId },
      });

      return {
        sessionToken: issued.token,
        session: { cookieMaxAgeSeconds: issued.cookieMaxAgeSeconds },
        user: { ...toAuthenticatedUser(current), mustChangePassword: false },
      };
    });
  }

  private auditContext(context: RequestContext): {
    requestId: string;
    clientIp: string | null;
    userAgent: string | null;
  } {
    return {
      requestId: context.requestId,
      clientIp: context.clientIp,
      userAgent: context.userAgent,
    };
  }

  /**
   * Records the real reason server-side and returns the single generic error
   * every failure branch throws. Returning the error rather than throwing it
   * keeps control flow obvious at each call site.
   */
  private loginRejection(
    context: RequestContext,
    reason:
      | 'UNKNOWN_USERNAME'
      | 'MALFORMED_PASSWORD_INPUT'
      | 'BAD_PASSWORD'
      | 'ACCOUNT_LOCKED'
      | 'ACCOUNT_DISABLED',
  ): AppError {
    logSecurityRejection({
      event: 'auth.login.rejected',
      reason,
      requestId: context.requestId,
    });

    return new AppError('AUTH_INVALID_CREDENTIALS');
  }
}

function toAuthenticatedUser(user: LockedUserRow): AuthenticatedUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    mustChangePassword: user.must_change_password,
    permissions: [...permissionsForRole(user.role)],
  };
}
