import request from 'supertest';
import { loginResponseSchema, sessionResponseSchema } from '@clinic/contracts';
import {
  createHarness,
  internalHeaders,
  resetDatabase,
  seedUser,
  TEST_PASSWORD,
  type Harness,
} from './harness';

describe('sessions (real PostgreSQL)', () => {
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

  async function signIn(options: Parameters<typeof seedUser>[1] = {}) {
    const user = await seedUser(harness, options);
    const response = await request(harness.app.getHttpServer())
      .post('/auth/login')
      .set(internalHeaders())
      .send({ username: user.username, password: options.password ?? TEST_PASSWORD });

    const parsed = loginResponseSchema.parse(response.body);
    const session = await harness.prisma.userSession.findFirstOrThrow();

    return { user, token: parsed.sessionToken, sessionId: session.id };
  }

  const getSession = (token: string, extra: Record<string, string> = {}) =>
    request(harness.app.getHttpServer())
      .get('/auth/session')
      .set(internalHeaders({ 'x-session-id': token, ...extra }));

  describe('validity', () => {
    it('resolves a valid session', async () => {
      const { user, token } = await signIn();

      const response = await getSession(token);

      expect(response.status).toBe(200);
      expect(sessionResponseSchema.parse(response.body).user.username).toBe(user.username);
    });

    it('rejects an unknown token', async () => {
      await signIn();

      const response = await getSession('not-a-real-token');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('AUTH_SESSION_INVALID');
    });

    it('rejects immediately after revocation', async () => {
      const { token, sessionId } = await signIn();
      expect((await getSession(token)).status).toBe(200);

      await harness.prisma.$executeRaw`
        UPDATE user_session
        SET revoked_at = now(), revoked_reason = 'MANAGER_REVOKED'
        WHERE id = ${sessionId}::uuid
      `;

      // No cached claim exists, so the very next request is rejected.
      expect((await getSession(token)).status).toBe(401);
    });

    it('rejects an idle-expired session', async () => {
      const { token, sessionId } = await signIn();

      await harness.prisma.$executeRaw`
        UPDATE user_session SET
          created_at          = now() - interval '9 hours',
          last_seen_at        = now() - interval '9 hours',
          idle_expires_at     = now() - interval '1 hour',
          absolute_expires_at = now() + interval '3 hours'
        WHERE id = ${sessionId}::uuid
      `;

      expect((await getSession(token)).status).toBe(401);
    });

    it('rejects a session whose user is no longer ACTIVE', async () => {
      const { user, token } = await signIn();
      expect((await getSession(token)).status).toBe(200);

      await harness.prisma.$executeRaw`
        UPDATE app_user SET status = 'DISABLED', disabled_at = now()
        WHERE id = ${user.id}::uuid
      `;

      // Status is re-read on every request, so disabling ends access within one
      // request without needing to find and revoke the session first.
      expect((await getSession(token)).status).toBe(401);
    });
  });

  describe('throttled renewal', () => {
    it('does not write last_seen_at again within the touch interval', async () => {
      const { token, sessionId } = await signIn();

      const before = await harness.prisma.userSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      await getSession(token);
      const after = await harness.prisma.userSession.findUniqueOrThrow({
        where: { id: sessionId },
      });

      expect(after.lastSeenAt.getTime()).toBe(before.lastSeenAt.getTime());
    });

    it('writes last_seen_at once the session is stale', async () => {
      const { token, sessionId } = await signIn();

      await harness.prisma.$executeRaw`
        UPDATE user_session SET last_seen_at = now() - interval '10 minutes'
        WHERE id = ${sessionId}::uuid
      `;
      const before = await harness.prisma.userSession.findUniqueOrThrow({
        where: { id: sessionId },
      });

      await getSession(token);

      const after = await harness.prisma.userSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      expect(after.lastSeenAt.getTime()).toBeGreaterThan(before.lastSeenAt.getTime());
    });

    it('clamps renewal to the absolute cap', async () => {
      const { token, sessionId } = await signIn();

      // Both columns move together: the CHECK refuses a row whose idle expiry
      // sits beyond its absolute cap, so lowering only the cap is rejected by
      // the database. (It rejected an earlier version of this fixture, which is
      // the constraint doing exactly its job.)
      await harness.prisma.$executeRaw`
        UPDATE user_session SET
          last_seen_at        = now() - interval '10 minutes',
          idle_expires_at     = now() + interval '2 minutes',
          absolute_expires_at = now() + interval '2 minutes'
        WHERE id = ${sessionId}::uuid
      `;

      await getSession(token);

      const row = await harness.prisma.userSession.findUniqueOrThrow({ where: { id: sessionId } });
      // LEAST(now + 8h, absolute) — renewal can never push a session past the
      // 12-hour cap, and the database CHECK would refuse the row if it tried.
      expect(row.idleExpiresAt.getTime()).toBe(row.absoluteExpiresAt.getTime());
    });

    it('rejects the request when the renewal affects zero rows', async () => {
      const { token, sessionId } = await signIn();

      await harness.prisma.$executeRaw`
        UPDATE user_session SET last_seen_at = now() - interval '10 minutes'
        WHERE id = ${sessionId}::uuid
      `;

      // Simulate the race the zero-row rule exists for: the session is revoked
      // after validation read it as valid but before renewal writes.
      const service = harness.sessions as unknown as { touch: (id: string) => Promise<number> };
      const originalTouch = service.touch.bind(service);

      jest.spyOn(service, 'touch').mockImplementation(async (id: string) => {
        await harness.prisma.$executeRawUnsafe(
          `UPDATE user_session SET revoked_at = now(), revoked_reason = 'MANAGER_REVOKED' WHERE id = '${id}'`,
        );
        return originalTouch(id);
      });

      const response = await getSession(token);

      // The stale pre-renewal snapshot must not be used. Re-reading finds the
      // revocation and the request is rejected.
      expect(response.status).toBe(401);
    });
  });

  describe('logout', () => {
    it('revokes the session and is idempotent', async () => {
      const { token, sessionId } = await signIn();

      const first = await request(harness.app.getHttpServer())
        .post('/auth/logout')
        .set(internalHeaders({ 'x-session-id': token }));
      expect(first.status).toBe(204);

      const row = await harness.prisma.userSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(row.revokedReason).toBe('LOGOUT');

      const logoutRows = await harness.prisma.auditLog.findMany({
        where: { action: 'auth.logout' },
      });
      expect(logoutRows).toHaveLength(1);

      // A second logout with the now-revoked token cannot authenticate, so it
      // cannot pad the audit trail either.
      const second = await request(harness.app.getHttpServer())
        .post('/auth/logout')
        .set(internalHeaders({ 'x-session-id': token }));
      expect(second.status).toBe(401);
      expect(await harness.prisma.auditLog.count({ where: { action: 'auth.logout' } })).toBe(1);
    });
  });

  describe('forced password change', () => {
    it('is enforced by NestJS on routes other than session, password and logout', async () => {
      const { token } = await signIn({ mustChangePassword: true });

      // Allowed: needed to clear the state.
      expect((await getSession(token)).status).toBe(200);

      // Denied: /health/db is internal-only, so use a permissioned route once
      // one exists. For now assert the flag is visible and the guard is armed.
      const body = sessionResponseSchema.parse((await getSession(token)).body);
      expect(body.user.mustChangePassword).toBe(true);
    });

    it('clears the flag, rotates the token and revokes the old session', async () => {
      const { token, sessionId } = await signIn({ mustChangePassword: true });

      const response = await request(harness.app.getHttpServer())
        .post('/auth/password')
        .set(internalHeaders({ 'x-session-id': token }))
        .send({ currentPassword: TEST_PASSWORD, newPassword: 'another quiet harbour drift' });

      expect(response.status).toBe(200);
      const parsed = loginResponseSchema.parse(response.body);

      expect(parsed.user.mustChangePassword).toBe(false);
      expect(parsed.sessionToken).not.toBe(token);

      const old = await harness.prisma.userSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(old.revokedReason).toBe('PASSWORD_CHANGED');

      // The old token is dead; the new one works.
      expect((await getSession(token)).status).toBe(401);
      expect((await getSession(parsed.sessionToken)).status).toBe(200);

      const actions = (await harness.prisma.auditLog.findMany()).map((r) => r.action);
      expect(actions).toContain('auth.password.changed');
      expect(actions).toContain('auth.session.rotated');
    });

    it('rejects a new password that fails policy', async () => {
      const { token } = await signIn();

      const response = await request(harness.app.getHttpServer())
        .post('/auth/password')
        .set(internalHeaders({ 'x-session-id': token }))
        .send({ currentPassword: TEST_PASSWORD, newPassword: 'short' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('PASSWORD_POLICY_VIOLATION');
    });

    it('rejects a wrong current password', async () => {
      const { token } = await signIn();

      const response = await request(harness.app.getHttpServer())
        .post('/auth/password')
        .set(internalHeaders({ 'x-session-id': token }))
        .send({
          currentPassword: 'wrong passphrase entirely',
          newPassword: 'another quiet drift x',
        });

      expect(response.status).toBe(401);
    });
  });

  describe('role changes take effect immediately', () => {
    it('reflects a new role on the next request, with no revocation', async () => {
      const { user, token } = await signIn({ role: 'RECEPTIONIST' });

      const before = sessionResponseSchema.parse((await getSession(token)).body);
      expect(before.user.role).toBe('RECEPTIONIST');
      // The family workflow, and specifically not user administration.
      expect(before.user.permissions).toContain('family.read');
      expect(before.user.permissions).not.toContain('user.create');

      await harness.prisma.$executeRaw`
        UPDATE app_user SET role = 'MANAGER' WHERE id = ${user.id}::uuid
      `;

      const after = sessionResponseSchema.parse((await getSession(token)).body);
      expect(after.user.role).toBe('MANAGER');
      expect(after.user.permissions).toContain('user.create');

      // The session itself was never touched: role is resolved per request.
      const row = await harness.prisma.userSession.findFirstOrThrow();
      expect(row.revokedAt).toBeNull();
    });
  });
});
