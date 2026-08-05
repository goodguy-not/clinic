import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CreateUserRequest,
  CreateUserResponse,
  PasswordResetResponse,
  RevokeSessionsResponse,
  StaffUser,
  UserResponse,
  UserRole,
  UserStatus,
} from '@clinic/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import { isUniqueViolation } from '../common/pg-error';
import { uuidv7 } from '../common/uuid';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { PasswordService } from '../auth/password.service';
import { SessionService } from '../auth/session.service';
import { generateTemporaryPassword } from '../auth/password/temporary-password';
import { parseBlockedTerms } from '../auth/password/blocklist';
import { API_ENV } from '../config/config.module';
import type { ApiEnv } from '../config/env';
import { Inject } from '@nestjs/common';

/**
 * Staff account administration. Manager-only; there is no self-registration.
 *
 * Two invariants shape every method here:
 *
 *  1. A user row is never deleted. Deactivation is `status = DISABLED`, and the
 *     database refuses a DELETE outright.
 *  2. Every state change and its audit row share one transaction, so the trail
 *     cannot record something that did not commit — or miss something that did.
 */

/**
 * Advisory lock key for operations that can change the number of active
 * managers.
 *
 * Counting managers and then acting on the count is a read-modify-write across
 * two rows: `SELECT ... FOR UPDATE` on the target locks only the target, so two
 * concurrent requests demoting two different managers would each see two
 * managers and each succeed, leaving zero. A transaction-level advisory lock
 * serialises the whole class of operation, and PostgreSQL releases it at commit
 * or rollback with nothing to clean up.
 *
 * The value is arbitrary but must stay stable; changing it would silently stop
 * new code from excluding old code during a rolling deploy.
 */
const ACTIVE_MANAGER_LOCK_KEY = 4919001n;

type StaffUserRow = {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  status: UserStatus;
  must_change_password: boolean;
  locked_until: Date | null;
  last_login_at: Date | null;
  created_at: Date;
  failed_login_count: number;
  failed_login_window_started_at: Date | null;
};

/**
 * The projection every response is built from.
 *
 * `password_hash` is not selected. Not selected rather than selected and
 * dropped: a field that never enters the process cannot be serialised by
 * accident, and the strict response contracts fail the build if one ever is.
 */
const STAFF_USER_COLUMNS = Prisma.sql`
  id, username, display_name,
  role::text   AS role,
  status::text AS status,
  must_change_password, locked_until, last_login_at, created_at,
  failed_login_count, failed_login_window_started_at
`;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async list(): Promise<StaffUser[]> {
    const rows = await this.prisma.$queryRaw<StaffUserRow[]>`
      SELECT ${STAFF_USER_COLUMNS} FROM app_user ORDER BY username ASC
    `;

    return rows.map(toStaffUser);
  }

  async create(
    input: CreateUserRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<CreateUserResponse> {
    // Generated, never manager-chosen: a manager-picked temporary password tends
    // to be weak, reused across staff, and would have to travel through the web
    // tier's request handling.
    const temporaryPassword = generateTemporaryPassword({
      username: input.username,
      blockedTerms: parseBlockedTerms(this.env.PASSWORD_BLOCKED_TERMS),
    });

    const passwordHash = await this.passwords.hash(temporaryPassword);
    const id = uuidv7();

    const user = await this.prisma.$transaction(async (tx) => {
      const inserted = await this.insertUser(tx, {
        id,
        username: input.username,
        displayName: input.displayName,
        role: input.role,
        passwordHash,
        createdByUserId: actor.userId,
      });

      await this.audit.record(tx, this.actorContext(actor, context), {
        action: 'user.created',
        entityType: 'app_user',
        entityId: id,
        after: {
          username: inserted.username,
          displayName: inserted.display_name,
          role: inserted.role,
          status: inserted.status,
          mustChangePassword: inserted.must_change_password,
        },
      });

      return inserted;
    });

    // Returned exactly once, here. It is never logged, never audited, and only
    // its Argon2 hash is persisted.
    return { user: toStaffUser(user), temporaryPassword };
  }

  async changeRole(
    targetId: string,
    role: UserRole,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<UserResponse> {
    if (targetId === actor.userId) {
      // Covers self-demotion. Any self role change is refused: a manager who
      // could edit their own role could strand the clinic with no manager, and
      // the direction of travel is not worth inspecting.
      throw new AppError('USER_SELF_MODIFICATION_FORBIDDEN');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockActiveManagerCount(tx);
      const before = await this.lockTarget(tx, targetId);

      if (before.role === 'MANAGER' && role !== 'MANAGER') {
        await this.assertNotLastActiveManager(tx, before);
      }

      await tx.$executeRaw`
        UPDATE app_user SET role = ${role}::user_role WHERE id = ${targetId}::uuid
      `;

      const after = await this.readTarget(tx, targetId);

      await this.audit.record(tx, this.actorContext(actor, context), {
        action: 'user.role_changed',
        entityType: 'app_user',
        entityId: targetId,
        before: { role: before.role },
        after: { role: after.role },
      });

      return after;
    });

    // No session revocation. Role is resolved from the database on every
    // request, so the change is already in force for the target's next call.
    return { user: toStaffUser(updated) };
  }

  async changeStatus(
    targetId: string,
    status: UserStatus,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<UserResponse> {
    if (targetId === actor.userId) {
      throw new AppError('USER_SELF_MODIFICATION_FORBIDDEN');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockActiveManagerCount(tx);
      const before = await this.lockTarget(tx, targetId);

      if (status === 'DISABLED' && before.role === 'MANAGER' && before.status === 'ACTIVE') {
        await this.assertNotLastActiveManager(tx, before);
      }

      let revokedSessions = 0;

      if (status === 'DISABLED') {
        await tx.$executeRaw`
          UPDATE app_user
          SET status = 'DISABLED', disabled_at = transaction_timestamp()
          WHERE id = ${targetId}::uuid
        `;
        // Same transaction: the account cannot be disabled without its sessions
        // dying with it. The session guard would reject them anyway on the next
        // request, but leaving live rows behind would misreport the state.
        revokedSessions = await this.sessions.revokeAllForUser(tx, targetId, 'USER_DISABLED');
      } else {
        await tx.$executeRaw`
          UPDATE app_user
          SET status = 'ACTIVE', disabled_at = NULL
          WHERE id = ${targetId}::uuid
        `;
      }

      const after = await this.readTarget(tx, targetId);

      await this.audit.record(tx, this.actorContext(actor, context), {
        action: 'user.status_changed',
        entityType: 'app_user',
        entityId: targetId,
        before: { status: before.status },
        after: { status: after.status },
        metadata: { revokedSessions },
      });

      return after;
    });

    return { user: toStaffUser(updated) };
  }

  async resetPassword(
    targetId: string,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<PasswordResetResponse> {
    const target = await this.readTarget(this.prisma, targetId);

    const temporaryPassword = generateTemporaryPassword({
      username: target.username,
      blockedTerms: parseBlockedTerms(this.env.PASSWORD_BLOCKED_TERMS),
    });
    const passwordHash = await this.passwords.hash(temporaryPassword);

    await this.prisma.$transaction(async (tx) => {
      await this.lockTarget(tx, targetId);

      // Lockout state is cleared alongside the new credential. Leaving a lock in
      // place would mean the password the manager just issued does not work.
      await tx.$executeRaw`
        UPDATE app_user
        SET password_hash = ${passwordHash},
            password_updated_at = transaction_timestamp(),
            must_change_password = true,
            failed_login_count = 0,
            failed_login_window_started_at = NULL,
            locked_until = NULL
        WHERE id = ${targetId}::uuid
      `;

      const revokedSessions = await this.sessions.revokeAllForUser(
        tx,
        targetId,
        'PASSWORD_CHANGED',
      );

      await this.audit.record(tx, this.actorContext(actor, context), {
        action: 'auth.password.reset',
        entityType: 'app_user',
        entityId: targetId,
        // Neither the temporary password nor its hash appears here. The audit
        // payload guard would throw on either.
        metadata: { revokedSessions, forcedChange: true },
      });
    });

    return { temporaryPassword };
  }

  async unlock(
    targetId: string,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<UserResponse> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await this.lockTarget(tx, targetId);

      await tx.$executeRaw`
        UPDATE app_user
        SET locked_until = NULL,
            failed_login_count = 0,
            failed_login_window_started_at = NULL
        WHERE id = ${targetId}::uuid
      `;

      const after = await this.readTarget(tx, targetId);

      await this.audit.record(tx, this.actorContext(actor, context), {
        action: 'user.unlocked',
        entityType: 'app_user',
        entityId: targetId,
        before: {
          lockedUntil: before.locked_until === null ? null : before.locked_until.toISOString(),
          failedLoginCount: before.failed_login_count,
          failedLoginWindowStartedAt:
            before.failed_login_window_started_at === null
              ? null
              : before.failed_login_window_started_at.toISOString(),
        },
        after: { lockedUntil: null, failedLoginCount: 0, failedLoginWindowStartedAt: null },
      });

      return after;
    });

    return { user: toStaffUser(updated) };
  }

  async revokeSessions(
    targetId: string,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<RevokeSessionsResponse> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockTarget(tx, targetId);

      // Marked revoked, never deleted: the row is the evidence that a session
      // existed and when it ended.
      const revokedCount = await this.sessions.revokeAllForUser(tx, targetId, 'MANAGER_REVOKED');

      await this.audit.record(tx, this.actorContext(actor, context), {
        action: 'auth.session.revoked',
        entityType: 'app_user',
        entityId: targetId,
        metadata: { revokedCount, reason: 'MANAGER_REVOKED' },
      });

      return { revokedCount };
    });
  }

  // --- internals ------------------------------------------------------------

  private async insertUser(
    tx: Prisma.TransactionClient,
    user: {
      id: string;
      username: string;
      displayName: string;
      role: UserRole;
      passwordHash: string;
      createdByUserId: string | null;
    },
  ): Promise<StaffUserRow> {
    try {
      const rows = await tx.$queryRaw<StaffUserRow[]>`
        INSERT INTO app_user (
          id, username, display_name, role, status, password_hash,
          password_updated_at, must_change_password, created_at, created_by_user_id
        ) VALUES (
          ${user.id}::uuid, ${user.username}, ${user.displayName},
          ${user.role}::user_role, 'ACTIVE', ${user.passwordHash},
          transaction_timestamp(), true, transaction_timestamp(),
          ${user.createdByUserId}::uuid
        )
        RETURNING ${STAFF_USER_COLUMNS}
      `;

      const inserted = rows[0];
      if (inserted === undefined) throw new AppError('INTERNAL_ERROR');
      return inserted;
    } catch (error) {
      // Caught rather than pre-checked: a SELECT-then-INSERT would let two
      // concurrent creations both pass the check. The unique index is the
      // authority.
      if (isUniqueViolation(error)) throw new AppError('USER_USERNAME_TAKEN');
      throw error;
    }
  }

  private async lockActiveManagerCount(tx: Prisma.TransactionClient): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ACTIVE_MANAGER_LOCK_KEY}::bigint)`;
  }

  private async assertNotLastActiveManager(
    tx: Prisma.TransactionClient,
    target: StaffUserRow,
  ): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM app_user
      WHERE role = 'MANAGER' AND status = 'ACTIVE' AND id <> ${target.id}::uuid
    `;

    const remaining = Number(rows[0]?.count ?? 0n);

    if (remaining === 0) {
      throw new AppError('USER_LAST_MANAGER');
    }
  }

  private async lockTarget(tx: Prisma.TransactionClient, targetId: string): Promise<StaffUserRow> {
    const rows = await tx.$queryRaw<StaffUserRow[]>`
      SELECT ${STAFF_USER_COLUMNS} FROM app_user WHERE id = ${targetId}::uuid FOR UPDATE
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('USER_NOT_FOUND');
    return row;
  }

  private async readTarget(
    client: Prisma.TransactionClient | PrismaService,
    targetId: string,
  ): Promise<StaffUserRow> {
    const rows = await client.$queryRaw<StaffUserRow[]>`
      SELECT ${STAFF_USER_COLUMNS} FROM app_user WHERE id = ${targetId}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('USER_NOT_FOUND');
    return row;
  }

  private actorContext(actor: ResolvedSession, context: RequestContext) {
    return {
      actor: { type: 'USER' as const, userId: actor.userId, sessionId: actor.sessionId },
      requestId: context.requestId,
      clientIp: context.clientIp,
      userAgent: context.userAgent,
    };
  }
}

export function toStaffUser(row: StaffUserRow): StaffUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    mustChangePassword: row.must_change_password,
    lockedUntil: row.locked_until === null ? null : row.locked_until.toISOString(),
    lastLoginAt: row.last_login_at === null ? null : row.last_login_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}
