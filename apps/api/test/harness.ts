import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, PrismaClient } from '@prisma/client';
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
const PROTECTED_TABLES = ['audit_log', 'app_user', 'therapist', 'service', 'room', 'tariff'];

/**
 * Truncated in one statement so foreign keys between them never dictate an
 * order. The join tables cascade from their parents and the reference-data
 * tables all cascade from `app_user`, but naming them explicitly keeps the
 * intent visible rather than relying on the cascade to reach everything.
 */
const TRUNCATED_TABLES = [
  'audit_log',
  'user_session',
  'tariff',
  'therapist_service',
  'room_service',
  'service_duration',
  'therapist',
  'room',
  'service',
  'app_user',
];

export async function resetDatabase(prisma: PrismaClient | PrismaService): Promise<void> {
  for (const table of PROTECTED_TABLES) {
    await prisma.$executeRawUnsafe(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
  }

  try {
    await prisma.$executeRawUnsafe(`TRUNCATE ${TRUNCATED_TABLES.join(', ')} CASCADE`);
  } finally {
    for (const table of [...PROTECTED_TABLES].reverse()) {
      await prisma.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
    }
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

/**
 * Creates a synthetic account with a real Argon2 hash.
 *
 * Written with raw SQL so every timestamp comes from `transaction_timestamp()`
 * — the same clock production writes with — rather than from Node.
 *
 * This is not a style preference. Prisma fills `@default(now())` in the query
 * engine, on the client, while `UsersService` and `AuthService` write
 * `password_updated_at` with `transaction_timestamp()` in PostgreSQL. A fixture
 * seeded through the client and then compared against a value written by the
 * server is comparing two clocks, and any skew between the Node host and the
 * database — which a Docker suspend and resume reliably produces — makes an
 * assertion like "the reset moved the timestamp forward" fail for a reason that
 * has nothing to do with the code under test.
 *
 * One clock, and it is the database's. Nothing about production expiry or
 * session semantics changes here; the authority was always PostgreSQL, and this
 * makes the test setup agree with it.
 */
export async function seedUser(
  harness: Harness,
  options: SeedUserOptions = {},
): Promise<SeededUser> {
  const username = options.username ?? `synthetic${Math.floor(Math.random() * 1e9)}`;
  const password = options.password ?? TEST_PASSWORD;
  const passwordHash = await harness.passwords.hash(password);
  const id = uuidv7();
  const status = options.status ?? 'ACTIVE';

  await harness.prisma.$executeRaw`
    INSERT INTO app_user (
      id, username, display_name, role, status, password_hash,
      password_updated_at, must_change_password, disabled_at, created_at
    ) VALUES (
      ${id}::uuid,
      ${username},
      ${options.displayName ?? 'Synthetic Tester'},
      ${options.role ?? 'RECEPTIONIST'}::user_role,
      ${status}::user_status,
      ${passwordHash},
      transaction_timestamp(),
      ${options.mustChangePassword ?? false},
      ${status === 'DISABLED' ? Prisma.sql`transaction_timestamp()` : Prisma.sql`NULL`},
      transaction_timestamp()
    )
  `;

  return { id, username, password };
}

export function internalHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { 'x-internal-key': TEST_INTERNAL_KEY, ...extra };
}
