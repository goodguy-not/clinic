import request from 'supertest';
import { loginResponseSchema } from '@clinic/contracts';
import { LOCKOUT_THRESHOLD } from '../src/auth/auth-policy';
import {
  createHarness,
  internalHeaders,
  resetDatabase,
  seedUser,
  TEST_PASSWORD,
  type Harness,
} from './harness';

describe('login (real PostgreSQL)', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    jest.restoreAllMocks();
  });

  const post = (body: { username: string; password: string }) =>
    request(harness.app.getHttpServer()).post('/auth/login').set(internalHeaders()).send(body);

  const withoutRequestId = (body: Record<string, unknown>): unknown => {
    const error = { ...(body['error'] as Record<string, unknown>) };
    delete error['requestId'];
    return { error };
  };

  describe('success', () => {
    it('issues a session and a PostgreSQL-computed cookie lifetime', async () => {
      const user = await seedUser(harness, { role: 'MANAGER' });

      const response = await post({ username: user.username, password: TEST_PASSWORD });

      expect(response.status).toBe(200);

      // The real response must satisfy the strict contract schema, which is what
      // proves no extra field — a serialised passwordHash above all — leaked.
      const parsed = loginResponseSchema.parse(response.body);

      expect(parsed.user.username).toBe(user.username);
      expect(parsed.user.role).toBe('MANAGER');
      expect(parsed.user.permissions).toContain('user.create');
      expect(parsed.sessionToken.length).toBeGreaterThan(30);

      // 12h absolute cap minus the 5s margin, allowing for execution time.
      expect(parsed.session.cookieMaxAgeSeconds).toBeGreaterThan(12 * 3600 - 60);
      expect(parsed.session.cookieMaxAgeSeconds).toBeLessThanOrEqual(12 * 3600 - 5);
    });

    it('stores only the SHA-256 hash of the token, never the token', async () => {
      const user = await seedUser(harness);

      const response = await post({ username: user.username, password: TEST_PASSWORD });
      const token = loginResponseSchema.parse(response.body).sessionToken;

      const rows = await harness.prisma.userSession.findMany();
      expect(rows).toHaveLength(1);

      // Prisma 6 returns `Bytes` as a Uint8Array, not a Buffer.
      const stored = Buffer.from(rows[0]?.tokenHash as Uint8Array);

      expect(stored).toHaveLength(32);
      expect(stored.toString('utf8')).not.toContain(token);
      expect(stored.equals(harness.sessions.hashToken(token))).toBe(true);
    });

    it('clears the failure counter', async () => {
      const user = await seedUser(harness);
      await post({ username: user.username, password: 'wrong passphrase entirely' });
      await post({ username: user.username, password: TEST_PASSWORD });

      const row = await harness.prisma.appUser.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.failedLoginCount).toBe(0);
      expect(row.lockedUntil).toBeNull();
      expect(row.lastLoginAt).not.toBeNull();
    });
  });

  describe('every failure looks identical', () => {
    it('returns the same status and body for unknown, wrong, locked and disabled', async () => {
      const active = await seedUser(harness, { username: 'activeuser' });
      const disabled = await seedUser(harness, { username: 'disableduser', status: 'DISABLED' });
      const locked = await seedUser(harness, { username: 'lockeduser' });

      await harness.prisma.$executeRaw`
        UPDATE app_user SET locked_until = now() + interval '15 minutes'
        WHERE id = ${locked.id}::uuid
      `;

      const responses = await Promise.all([
        post({ username: 'nosuchaccount', password: TEST_PASSWORD }),
        post({ username: active.username, password: 'wrong passphrase entirely' }),
        post({ username: locked.username, password: TEST_PASSWORD }),
        post({ username: disabled.username, password: TEST_PASSWORD }),
      ]);

      for (const response of responses) {
        expect(response.status).toBe(401);
        expect(response.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
      }

      const shapes = responses.map((r) => JSON.stringify(withoutRequestId(r.body)));
      expect(new Set(shapes).size).toBe(1);
    });

    it('performs exactly one Argon2 verification on every branch', async () => {
      const active = await seedUser(harness, { username: 'countactive' });
      const disabled = await seedUser(harness, { username: 'countdisabled', status: 'DISABLED' });

      const verify = jest.spyOn(harness.passwords, 'verify');
      const dummy = jest.spyOn(harness.passwords, 'verifyAgainstDummy');

      const branches: Array<[string, string]> = [
        ['nosuchaccount', TEST_PASSWORD],
        [active.username, 'wrong passphrase entirely'],
        [disabled.username, TEST_PASSWORD],
        [active.username, TEST_PASSWORD],
      ];

      for (const [username, password] of branches) {
        verify.mockClear();
        dummy.mockClear();

        await post({ username, password });

        // Exactly one, whichever branch was taken. A correct password against a
        // disabled account still costs a verification, so the branches are not
        // distinguishable by work done.
        expect(verify.mock.calls.length + dummy.mock.calls.length).toBe(1);
      }
    });

    it('rejects a correct password on a disabled account and creates no session', async () => {
      const user = await seedUser(harness, { status: 'DISABLED' });

      const response = await post({ username: user.username, password: TEST_PASSWORD });

      expect(response.status).toBe(401);
      expect(await harness.prisma.userSession.count()).toBe(0);
    });
  });

  describe('audit is written only for state changes on an active account', () => {
    it('writes nothing for unknown, disabled or already-locked attempts', async () => {
      const disabled = await seedUser(harness, { username: 'auditdisabled', status: 'DISABLED' });
      const locked = await seedUser(harness, { username: 'auditlocked' });
      await harness.prisma.$executeRaw`
        UPDATE app_user SET locked_until = now() + interval '15 minutes'
        WHERE id = ${locked.id}::uuid
      `;

      for (let attempt = 0; attempt < 10; attempt += 1) {
        await post({ username: 'nosuchaccount', password: TEST_PASSWORD });
        await post({ username: disabled.username, password: TEST_PASSWORD });
        await post({ username: locked.username, password: TEST_PASSWORD });
      }

      // 30 unauthenticated attempts, zero permanent rows. audit_log is
      // append-only and unprunable, so this bound is the whole point.
      expect(await harness.prisma.auditLog.count()).toBe(0);
    });

    it('writes one failed row per counter change and one locked row at the threshold', async () => {
      const user = await seedUser(harness);

      for (let attempt = 0; attempt < LOCKOUT_THRESHOLD; attempt += 1) {
        await post({ username: user.username, password: 'wrong passphrase entirely' });
      }

      const actions = (await harness.prisma.auditLog.findMany({ orderBy: { id: 'asc' } })).map(
        (row) => row.action,
      );

      expect(actions.filter((a) => a === 'auth.login.failed')).toHaveLength(LOCKOUT_THRESHOLD);
      expect(actions.filter((a) => a === 'auth.login.locked')).toHaveLength(1);

      // Further attempts change nothing and are not audited.
      await post({ username: user.username, password: 'wrong passphrase entirely' });
      expect(await harness.prisma.auditLog.count()).toBe(LOCKOUT_THRESHOLD + 1);
    });

    it('records a failure and its counter even though the request fails', async () => {
      const user = await seedUser(harness);

      await post({ username: user.username, password: 'wrong passphrase entirely' });

      const row = await harness.prisma.appUser.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.failedLoginCount).toBe(1);
      expect(await harness.prisma.auditLog.count()).toBe(1);
    });

    it('never stores an Argon2 hash in any audit payload', async () => {
      const user = await seedUser(harness);
      await post({ username: user.username, password: 'wrong passphrase entirely' });
      await post({ username: user.username, password: TEST_PASSWORD });

      const rows = await harness.prisma.auditLog.findMany();
      const serialised = JSON.stringify(rows);

      expect(rows.length).toBeGreaterThan(0);
      expect(serialised).not.toContain('$argon2');
    });
  });

  describe('lockout', () => {
    it('locks after the threshold and rejects a correct password while locked', async () => {
      const user = await seedUser(harness);

      for (let attempt = 0; attempt < LOCKOUT_THRESHOLD; attempt += 1) {
        await post({ username: user.username, password: 'wrong passphrase entirely' });
      }

      const row = await harness.prisma.appUser.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.lockedUntil).not.toBeNull();
      // The window is cleared so the next window starts fresh rather than
      // re-locking on a single further failure.
      expect(row.failedLoginCount).toBe(0);

      const correct = await post({ username: user.username, password: TEST_PASSWORD });
      expect(correct.status).toBe(401);
      expect(await harness.prisma.userSession.count()).toBe(0);
    });

    it('does not lock when failures fall outside the observation window', async () => {
      const user = await seedUser(harness);

      for (let attempt = 0; attempt < LOCKOUT_THRESHOLD - 1; attempt += 1) {
        await post({ username: user.username, password: 'wrong passphrase entirely' });
      }

      // Age the window past its expiry; the next failure starts a new one.
      await harness.prisma.$executeRaw`
        UPDATE app_user
        SET failed_login_window_started_at = now() - interval '16 minutes'
        WHERE id = ${user.id}::uuid
      `;

      await post({ username: user.username, password: 'wrong passphrase entirely' });

      const row = await harness.prisma.appUser.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.lockedUntil).toBeNull();
      expect(row.failedLoginCount).toBe(1);
    });
  });

  describe('account state changing during Argon2 verification', () => {
    it('honours a disable that lands while the password is being verified', async () => {
      const user = await seedUser(harness);
      const original = harness.passwords.verify.bind(harness.passwords);

      jest
        .spyOn(harness.passwords, 'verify')
        .mockImplementation(async (hash: string, password: string) => {
          const result = await original(hash, password);
          // The manager disables the account while Argon2 is still running.
          await harness.prisma.$executeRaw`
            UPDATE app_user SET status = 'DISABLED', disabled_at = now()
            WHERE id = ${user.id}::uuid
          `;
          return result;
        });

      const response = await post({ username: user.username, password: TEST_PASSWORD });

      // The pre-Argon2 snapshot said ACTIVE. The FOR UPDATE re-read says
      // DISABLED, and that is the only snapshot allowed to authorise a session.
      expect(response.status).toBe(401);
      expect(await harness.prisma.userSession.count()).toBe(0);
      expect(await harness.prisma.auditLog.count()).toBe(0);
    });

    it('honours a lock that lands while the password is being verified', async () => {
      const user = await seedUser(harness);
      const original = harness.passwords.verify.bind(harness.passwords);

      jest
        .spyOn(harness.passwords, 'verify')
        .mockImplementation(async (hash: string, password: string) => {
          const result = await original(hash, password);
          await harness.prisma.$executeRaw`
            UPDATE app_user SET locked_until = now() + interval '15 minutes'
            WHERE id = ${user.id}::uuid
          `;
          return result;
        });

      const response = await post({ username: user.username, password: TEST_PASSWORD });

      expect(response.status).toBe(401);
      expect(await harness.prisma.userSession.count()).toBe(0);
    });
  });
});
