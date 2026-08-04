import type { INestApplicationContext } from '@nestjs/common';
import { usernameSchema } from '@clinic/contracts';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { SessionService } from '../auth/session.service';
import { generateTemporaryPassword } from '../auth/password/temporary-password';
import { parseBlockedTerms } from '../auth/password/blocklist';
import { validatePassword } from '../auth/password/policy';
import { PrismaService } from '../prisma/prisma.service';
import { API_ENV } from '../config/config.module';
import type { ApiEnv } from '../config/env';
import { uuidv7 } from '../common/uuid';
import type { CliIo } from './cli-io';

/**
 * Out-of-band recovery.
 *
 * There is no email or SMS channel by design, so a manager who forgets their
 * password would otherwise be an unrecoverable dead end — the manager surface
 * can reset anyone, but only while someone can still sign in. This is the
 * escape hatch, and it requires shell access on the server.
 */
export type ResetPasswordOptions = {
  username: string;
  passwordFromStdin: boolean;
};

export async function resetPassword(
  app: INestApplicationContext,
  options: ResetPasswordOptions,
  io: CliIo,
): Promise<number> {
  const prisma = app.get(PrismaService);
  const passwords = app.get(PasswordService);
  const sessions = app.get(SessionService);
  const audit = app.get(AuditService);
  const env = app.get<ApiEnv>(API_ENV);

  const username = usernameSchema.safeParse(options.username);
  if (!username.success) {
    io.err(`Invalid --username: ${username.error.issues[0]?.message ?? 'invalid'}`);
    return 2;
  }

  const found = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM app_user WHERE username = ${username.data}
  `;
  const target = found[0];

  if (target === undefined) {
    io.err(`No account with username: ${username.data}`);
    return 1;
  }

  const blockedTerms = parseBlockedTerms(env.PASSWORD_BLOCKED_TERMS);
  let password: string;
  let generated: boolean;

  if (options.passwordFromStdin) {
    password = (await io.readStdin()).replace(/\r?\n$/, '');
    // The same policy the application enforces. A recovery path that skipped it
    // would be the easiest way to install a weak credential.
    const policy = validatePassword(password, { username: username.data, blockedTerms });

    if (!policy.ok) {
      io.err(`Password rejected by policy: ${policy.violations.join(', ')}`);
      return 2;
    }

    generated = false;
  } else {
    password = generateTemporaryPassword({ username: username.data, blockedTerms });
    generated = true;
  }

  const passwordHash = await passwords.hash(password);
  const requestId = uuidv7();

  const revokedSessions = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT id FROM app_user WHERE id = ${target.id}::uuid FOR UPDATE
    `;

    await tx.$executeRaw`
      UPDATE app_user
      SET password_hash = ${passwordHash},
          password_updated_at = transaction_timestamp(),
          must_change_password = true,
          failed_login_count = 0,
          failed_login_window_started_at = NULL,
          locked_until = NULL
      WHERE id = ${target.id}::uuid
    `;

    const revoked = await sessions.revokeAllForUser(tx, target.id, 'PASSWORD_CHANGED');

    await audit.record(
      tx,
      { actor: { type: 'SYSTEM' }, requestId },
      {
        action: 'auth.password.reset',
        entityType: 'app_user',
        entityId: target.id,
        // No password, no hash. The audit payload guard throws on either.
        metadata: { mechanism: 'cli', revokedSessions: revoked, forcedChange: true },
      },
    );

    return revoked;
  });

  io.out(`Password reset for: ${username.data}`);
  io.out(`Revoked sessions: ${String(revokedSessions)}`);

  if (generated) {
    io.out('');
    io.out('Temporary password (shown once, not stored in plain text anywhere):');
    io.out(`  ${password}`);
    io.out('');
  }

  io.out('A password change is required at next sign-in.');

  return 0;
}
