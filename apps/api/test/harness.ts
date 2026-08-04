import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { API_ENV } from '../src/config/config.module';
import { PasswordService } from '../src/auth/password.service';
import { SessionService } from '../src/auth/session.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { UsersService } from '../src/users/users.service';
import type { RequestContext, ResolvedSession } from '../src/common/request-context';
import { uuidv7 } from '../src/common/uuid';

/**
 * Integration harness.
 *
 * Everything here is synthetic. No real clinic user, name, password or
 * credential appears in any fixture.
 */

/** Synthetic, test-only. Long enough to satisfy the environment schema. */
export const TEST_INTERNAL_KEY = 'test_only_internal_key_0123456789abcdef';

/** Satisfies the 15-code-point minimum and trips no blocklist rule. */
export const TEST_PASSWORD = 'quiet harbour lantern drift';

/**
 * Database names these tests are allowed to touch.
 *
 * An allowlist rather than a blocklist. Excluding `clinic_dev` by name would
 * protect exactly one database and nothing else — a stray `DATABASE_URL`
 * pointing at a pilot or production instance would sail straight through. These
 * tests truncate every table and temporarily disable the audit triggers, so the
 * question worth asking is "is this database disposable?", and only a name that
 * says so counts as an answer.
 */
const DISPOSABLE_DATABASE = /_(?:test|ci)$/;

export function testDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'];

  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL must be set for integration tests');
  }

  let databaseName: string;

  try {
    databaseName = new URL(url).pathname.replace(/^\//, '');
  } catch {
    throw new Error('DATABASE_URL is not a valid connection string');
  }

  if (!DISPOSABLE_DATABASE.test(databaseName)) {
    throw new Error(
      `Refusing to run integration tests against "${databaseName}": these tests truncate every ` +
        'table and disable audit triggers, so the database name must end in _test or _ci. ' +
        'Use clinic_test locally.',
    );
  }

  return url;
}

export type Harness = {
  app: INestApplication;
  prisma: PrismaService;
  passwords: PasswordService;
  sessions: SessionService;
  users: UsersService;
  close: () => Promise<void>;
};

/**
 * A resolved session for driving services directly, past the guard chain.
 *
 * Used only where an invariant cannot be reached over HTTP — the last-manager
 * rule, whose caller must be an active manager and therefore can never be the
 * final one. Everything reachable through a request is tested through one.
 */
export function actorSession(userId: string, sessionId = uuidv7()): ResolvedSession {
  return {
    sessionId,
    userId,
    username: 'synthetic_actor',
    displayName: 'Synthetic Actor',
    role: 'MANAGER',
    mustChangePassword: false,
    permissions: [],
  };
}

export function auditContext(): RequestContext {
  return { requestId: uuidv7(), clientIp: null, userAgent: null, session: null };
}

export async function createHarness(): Promise<Harness> {
  const url = testDatabaseUrl();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(API_ENV)
    .useValue({
      NODE_ENV: 'test',
      API_PORT: 3001,
      DATABASE_URL: url,
      INTERNAL_API_KEY: TEST_INTERNAL_KEY,
      PASSWORD_BLOCKED_TERMS: undefined,
    })
    .compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  return {
    app,
    prisma: app.get(PrismaService),
    passwords: app.get(PasswordService),
    sessions: app.get(SessionService),
    users: app.get(UsersService),
    close: () => app.close(),
  };
}

/**
 * Truncates between tests.
 *
 * `audit_log` and `app_user` carry BEFORE DELETE and BEFORE TRUNCATE triggers,
 * so ordinary teardown is refused — which is exactly the guarantee those
 * triggers exist to provide. Disabling them here is possible only because the
 * test connects as the table owner, and that is precisely the gap a production
 * deployment closes with a separate, non-owner runtime role. Tests that prove
 * the triggers work run WITHOUT this helper.
 */
export async function resetDatabase(prisma: PrismaClient | PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe('ALTER TABLE audit_log DISABLE TRIGGER USER');
  await prisma.$executeRawUnsafe('ALTER TABLE app_user DISABLE TRIGGER USER');

  try {
    await prisma.$executeRawUnsafe('TRUNCATE audit_log, user_session, app_user CASCADE');
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE app_user ENABLE TRIGGER USER');
    await prisma.$executeRawUnsafe('ALTER TABLE audit_log ENABLE TRIGGER USER');
  }
}

export type SeedUserOptions = {
  username?: string;
  displayName?: string;
  role?: 'MANAGER' | 'RECEPTIONIST';
  status?: 'ACTIVE' | 'DISABLED';
  password?: string;
  mustChangePassword?: boolean;
};

export type SeededUser = { id: string; username: string; password: string };

/** Creates a synthetic account with a real Argon2 hash. */
export async function seedUser(
  harness: Harness,
  options: SeedUserOptions = {},
): Promise<SeededUser> {
  const username = options.username ?? `synthetic${Math.floor(Math.random() * 1e9)}`;
  const password = options.password ?? TEST_PASSWORD;
  const passwordHash = await harness.passwords.hash(password);
  const id = uuidv7();

  await harness.prisma.appUser.create({
    data: {
      id,
      username,
      displayName: options.displayName ?? 'Synthetic Tester',
      role: options.role ?? 'RECEPTIONIST',
      status: options.status ?? 'ACTIVE',
      passwordHash,
      mustChangePassword: options.mustChangePassword ?? false,
      ...(options.status === 'DISABLED' ? { disabledAt: new Date() } : {}),
    },
  });

  return { id, username, password };
}

export function internalHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { 'x-internal-key': TEST_INTERNAL_KEY, ...extra };
}
