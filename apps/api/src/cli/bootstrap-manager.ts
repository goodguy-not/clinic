import type { INestApplicationContext } from '@nestjs/common';
import { displayNameSchema, usernameSchema } from '@clinic/contracts';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { generateTemporaryPassword } from '../auth/password/temporary-password';
import { parseBlockedTerms } from '../auth/password/blocklist';
import { validatePassword } from '../auth/password/policy';
import { PrismaService } from '../prisma/prisma.service';
import { API_ENV } from '../config/config.module';
import type { ApiEnv } from '../config/env';
import { uuidv7 } from '../common/uuid';
import type { CliIo } from './cli-io';

/**
 * Creates the very first manager.
 *
 * A CLI rather than an environment variable or a seed. An environment-driven
 * bootstrap puts a plaintext password in the process list and the deploy
 * manifest and is almost impossible to make genuinely one-time; a migration or
 * seed carrying a hash commits a permanent, shared, world-readable credential.
 * Requiring shell access on the server is the point: whoever can run this can
 * already read the database.
 */

/**
 * Serialises concurrent bootstrap attempts.
 *
 * "Refuse if any user exists" is a read-then-write, so two processes starting
 * together would both see an empty table and both insert. The advisory lock is
 * transaction-scoped and released on commit or rollback; the loser then sees
 * the winner's row and refuses.
 */
const BOOTSTRAP_LOCK_KEY = 4919002n;

export type BootstrapOptions = {
  username: string;
  displayName: string;
  passwordFromStdin: boolean;
};

export async function bootstrapManager(
  app: INestApplicationContext,
  options: BootstrapOptions,
  io: CliIo,
): Promise<number> {
  const prisma = app.get(PrismaService);
  const passwords = app.get(PasswordService);
  const audit = app.get(AuditService);
  const env = app.get<ApiEnv>(API_ENV);

  const username = usernameSchema.safeParse(options.username);
  if (!username.success) {
    io.err(`Invalid --username: ${username.error.issues[0]?.message ?? 'invalid'}`);
    return 2;
  }

  const displayName = displayNameSchema.safeParse(options.displayName);
  if (!displayName.success) {
    io.err(`Invalid --display-name: ${displayName.error.issues[0]?.message ?? 'invalid'}`);
    return 2;
  }

  const blockedTerms = parseBlockedTerms(env.PASSWORD_BLOCKED_TERMS);
  let password: string;
  let generated: boolean;

  if (options.passwordFromStdin) {
    password = (await io.readStdin()).replace(/\r?\n$/, '');
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
  const id = uuidv7();
  const requestId = uuidv7();

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY}::bigint)`;

      const existing = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) AS count FROM app_user
      `;

      if (Number(existing[0]?.count ?? 0n) > 0) {
        throw new BootstrapRefused();
      }

      await tx.$executeRaw`
        INSERT INTO app_user (
          id, username, display_name, role, status, password_hash,
          password_updated_at, must_change_password, created_at, created_by_user_id
        ) VALUES (
          ${id}::uuid, ${username.data}, ${displayName.data},
          'MANAGER', 'ACTIVE', ${passwordHash},
          transaction_timestamp(), true, transaction_timestamp(), NULL
        )
      `;

      // SYSTEM actor with no user id: nobody was authenticated, and the database
      // CHECK enforces that pairing. Even the first account has a traceable
      // origin.
      await audit.record(
        tx,
        { actor: { type: 'SYSTEM' }, requestId },
        {
          action: 'user.created',
          entityType: 'app_user',
          entityId: id,
          after: {
            username: username.data,
            displayName: displayName.data,
            role: 'MANAGER',
            status: 'ACTIVE',
            mustChangePassword: true,
          },
          metadata: { mechanism: 'bootstrap_cli' },
        },
      );
    });
  } catch (error) {
    if (error instanceof BootstrapRefused) {
      io.err('Refusing to bootstrap: app_user already contains at least one row.');
      io.err('Use reset-password for recovery, or the manager surface to add staff.');
      return 1;
    }
    throw error;
  }

  io.out(`Created manager: ${username.data}`);

  if (generated) {
    io.out('');
    io.out('Temporary password (shown once, not stored in plain text anywhere):');
    io.out(`  ${password}`);
    io.out('');
    io.out('A password change is required at first sign-in.');
  } else {
    io.out('Password read from stdin. A password change is required at first sign-in.');
  }

  return 0;
}

class BootstrapRefused extends Error {}
