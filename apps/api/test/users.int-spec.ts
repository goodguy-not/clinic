import request from 'supertest';
import {
  createUserResponseSchema,
  loginResponseSchema,
  passwordResetResponseSchema,
  revokeSessionsResponseSchema,
  userListResponseSchema,
  userResponseSchema,
} from '@clinic/contracts';
import {
  actorSession,
  auditContext,
  createHarness,
  internalHeaders,
  resetDatabase,
  seedUser,
  TEST_PASSWORD,
  type Harness,
} from './harness';

describe('staff administration (real PostgreSQL)', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
  });

  const server = () => harness.app.getHttpServer();

  async function signIn(role: 'MANAGER' | 'RECEPTIONIST', username?: string) {
    const user = await seedUser(harness, { role, ...(username === undefined ? {} : { username }) });
    const response = await request(server())
      .post('/auth/login')
      .set(internalHeaders())
      .send({ username: user.username, password: TEST_PASSWORD });

    return { user, token: loginResponseSchema.parse(response.body).sessionToken };
  }

  const asUser = (token: string) => internalHeaders({ 'x-session-id': token });

  describe('authorization', () => {
    const routes: Array<[string, 'get' | 'post' | 'patch', string, object | undefined]> = [
      ['list', 'get', '/users', undefined],
      [
        'create',
        'post',
        '/users',
        { username: 'newstaff', displayName: 'New', role: 'RECEPTIONIST' },
      ],
      ['role', 'patch', '/users/:id/role', { role: 'MANAGER' }],
      ['status', 'patch', '/users/:id/status', { status: 'DISABLED' }],
      ['reset', 'post', '/users/:id/password-reset', undefined],
      ['unlock', 'post', '/users/:id/unlock', undefined],
      ['revoke', 'post', '/users/:id/sessions/revoke', undefined],
    ];

    it.each(routes)('refuses a receptionist on %s', async (_label, method, path, body) => {
      const { token } = await signIn('RECEPTIONIST');
      const target = await seedUser(harness, { username: 'sometarget' });
      const url = path.replace(':id', target.id);

      const response = await request(server())
        [method](url)
        .set(asUser(token))
        .send(body ?? {});

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('refuses an unauthenticated caller', async () => {
      const response = await request(server()).get('/users').set(internalHeaders());

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('AUTH_SESSION_INVALID');
    });

    it('allows a manager to list staff', async () => {
      const { token } = await signIn('MANAGER');

      const response = await request(server()).get('/users').set(asUser(token));

      expect(response.status).toBe(200);
      // Strict schema: an extra field such as a serialised passwordHash fails here.
      const parsed = userListResponseSchema.parse(response.body);
      expect(parsed.users).toHaveLength(1);
      expect(JSON.stringify(parsed)).not.toContain('$argon2');
    });
  });

  describe('creation', () => {
    it('creates an account, returns the temporary password once, and audits atomically', async () => {
      const { token, user: manager } = await signIn('MANAGER');

      const response = await request(server())
        .post('/users')
        .set(asUser(token))
        .send({ username: 'newreception', displayName: 'New Receptionist', role: 'RECEPTIONIST' });

      expect(response.status).toBe(201);
      const parsed = createUserResponseSchema.parse(response.body);

      expect(parsed.user.username).toBe('newreception');
      expect(parsed.user.mustChangePassword).toBe(true);
      expect(parsed.user.status).toBe('ACTIVE');
      expect(parsed.temporaryPassword).toHaveLength(20);

      const stored = await harness.prisma.appUser.findFirstOrThrow({
        where: { username: 'newreception' },
      });

      // Only the hash is persisted, and it is a real Argon2id hash of the value
      // that was returned.
      expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
      expect(stored.passwordHash).not.toContain(parsed.temporaryPassword);
      expect(await harness.passwords.verify(stored.passwordHash, parsed.temporaryPassword)).toBe(
        true,
      );
      expect(stored.createdByUserId).toBe(manager.id);

      const audits = await harness.prisma.auditLog.findMany({ where: { action: 'user.created' } });
      expect(audits).toHaveLength(1);
      expect(audits[0]?.entityId).toBe(stored.id);
      expect(JSON.stringify(audits[0])).not.toContain(parsed.temporaryPassword);
    });

    it('lets the new account sign in and forces a password change', async () => {
      const { token } = await signIn('MANAGER');

      const created = createUserResponseSchema.parse(
        (
          await request(server())
            .post('/users')
            .set(asUser(token))
            .send({ username: 'freshstaff', displayName: 'Fresh', role: 'RECEPTIONIST' })
        ).body,
      );

      const login = await request(server())
        .post('/auth/login')
        .set(internalHeaders())
        .send({ username: 'freshstaff', password: created.temporaryPassword });

      expect(login.status).toBe(200);
      expect(loginResponseSchema.parse(login.body).user.mustChangePassword).toBe(true);
    });

    it('rejects a duplicate username with the stable code', async () => {
      const { token } = await signIn('MANAGER');
      await seedUser(harness, { username: 'takenname' });

      const response = await request(server())
        .post('/users')
        .set(asUser(token))
        .send({ username: 'takenname', displayName: 'Duplicate', role: 'RECEPTIONIST' });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('USER_USERNAME_TAKEN');
      expect(await harness.prisma.auditLog.count({ where: { action: 'user.created' } })).toBe(0);
    });

    it('rejects an invalid username before touching the database', async () => {
      const { token } = await signIn('MANAGER');

      const response = await request(server())
        .post('/users')
        .set(asUser(token))
        .send({ username: 'Has Capitals', displayName: 'Bad', role: 'RECEPTIONIST' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(await harness.prisma.appUser.count()).toBe(1);
    });
  });

  describe('role and status safety', () => {
    it('refuses a self role change', async () => {
      const { token, user } = await signIn('MANAGER');

      const response = await request(server())
        .patch(`/users/${user.id}/role`)
        .set(asUser(token))
        .send({ role: 'RECEPTIONIST' });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('USER_SELF_MODIFICATION_FORBIDDEN');
    });

    it('refuses a self status change', async () => {
      const { token, user } = await signIn('MANAGER');

      const response = await request(server())
        .patch(`/users/${user.id}/status`)
        .set(asUser(token))
        .send({ status: 'DISABLED' });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('USER_SELF_MODIFICATION_FORBIDDEN');
    });

    /**
     * The last-manager rule cannot fire on a single HTTP request, and that is a
     * property of the design rather than a gap in these tests: the caller must
     * hold `user.update_role`, which only an ACTIVE manager has, and the count
     * excludes the target — so there is always at least the caller left. Self
     * changes are refused separately.
     *
     * The rule exists for the interleaving where a second manager is removed
     * concurrently. These two tests drive the service directly to prove the
     * guard itself is correct; `users-concurrency.int-spec.ts` proves it holds
     * under the real race.
     */
    it('refuses to demote the sole active manager (service level)', async () => {
      const target = await seedUser(harness, { username: 'onlymanager', role: 'MANAGER' });
      const actor = await seedUser(harness, { username: 'someoneelse', role: 'RECEPTIONIST' });

      await expect(
        harness.users.changeRole(target.id, 'RECEPTIONIST', actorSession(actor.id), auditContext()),
      ).rejects.toMatchObject({ code: 'USER_LAST_MANAGER' });

      const row = await harness.prisma.appUser.findUniqueOrThrow({ where: { id: target.id } });
      expect(row.role).toBe('MANAGER');
    });

    it('refuses to disable the sole active manager (service level)', async () => {
      const target = await seedUser(harness, { username: 'onlymanager2', role: 'MANAGER' });
      const actor = await seedUser(harness, { username: 'someoneelse2', role: 'RECEPTIONIST' });

      await expect(
        harness.users.changeStatus(target.id, 'DISABLED', actorSession(actor.id), auditContext()),
      ).rejects.toMatchObject({ code: 'USER_LAST_MANAGER' });

      const row = await harness.prisma.appUser.findUniqueOrThrow({ where: { id: target.id } });
      expect(row.status).toBe('ACTIVE');
    });

    it('allows demoting a manager while another active manager remains', async () => {
      const { token } = await signIn('MANAGER', 'keepsmanaging');
      const target = await seedUser(harness, { username: 'demoteme', role: 'MANAGER' });

      const response = await request(server())
        .patch(`/users/${target.id}/role`)
        .set(asUser(token))
        .send({ role: 'RECEPTIONIST' });

      expect(response.status).toBe(200);
      expect(userResponseSchema.parse(response.body).user.role).toBe('RECEPTIONIST');

      const audits = await harness.prisma.auditLog.findMany({
        where: { action: 'user.role_changed' },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0]?.before).toEqual({ role: 'MANAGER' });
      expect(audits[0]?.after).toEqual({ role: 'RECEPTIONIST' });
    });

    it('takes a role change into effect on the next request without revoking the session', async () => {
      const { token: managerToken } = await signIn('MANAGER');
      const { user: target, token: targetToken } = await signIn('RECEPTIONIST', 'promoteme');

      await request(server())
        .patch(`/users/${target.id}/role`)
        .set(asUser(managerToken))
        .send({ role: 'MANAGER' });

      const session = await request(server()).get('/auth/session').set(asUser(targetToken));
      expect(session.body.user.role).toBe('MANAGER');
      expect(session.body.user.permissions).toContain('user.create');

      const rows = await harness.prisma.userSession.findMany({ where: { userId: target.id } });
      expect(rows.every((row) => row.revokedAt === null)).toBe(true);
    });
  });

  describe('disabling', () => {
    it('sets disabled_at from PostgreSQL and revokes sessions in the same transaction', async () => {
      const { token: managerToken } = await signIn('MANAGER');
      const { user: target, token: targetToken } = await signIn('RECEPTIONIST', 'disableme');

      expect((await request(server()).get('/auth/session').set(asUser(targetToken))).status).toBe(
        200,
      );

      const response = await request(server())
        .patch(`/users/${target.id}/status`)
        .set(asUser(managerToken))
        .send({ status: 'DISABLED' });

      expect(response.status).toBe(200);
      expect(userResponseSchema.parse(response.body).user.status).toBe('DISABLED');

      const row = await harness.prisma.appUser.findUniqueOrThrow({ where: { id: target.id } });
      expect(row.disabledAt).not.toBeNull();

      const sessions = await harness.prisma.userSession.findMany({ where: { userId: target.id } });
      expect(sessions.every((s) => s.revokedReason === 'USER_DISABLED')).toBe(true);

      expect((await request(server()).get('/auth/session').set(asUser(targetToken))).status).toBe(
        401,
      );
    });

    it('clears disabled_at when re-enabled', async () => {
      const { token } = await signIn('MANAGER');
      const target = await seedUser(harness, { username: 'toggleme', status: 'DISABLED' });

      const response = await request(server())
        .patch(`/users/${target.id}/status`)
        .set(asUser(token))
        .send({ status: 'ACTIVE' });

      expect(response.status).toBe(200);
      const row = await harness.prisma.appUser.findUniqueOrThrow({ where: { id: target.id } });
      expect(row.status).toBe('ACTIVE');
      expect(row.disabledAt).toBeNull();
    });
  });

  describe('manager actions', () => {
    it('resets a password, forces a change and revokes sessions', async () => {
      const { token: managerToken } = await signIn('MANAGER');
      const { user: target, token: targetToken } = await signIn('RECEPTIONIST', 'resetme');

      const before = await harness.prisma.appUser.findUniqueOrThrow({ where: { id: target.id } });

      const response = await request(server())
        .post(`/users/${target.id}/password-reset`)
        .set(asUser(managerToken));

      expect(response.status).toBe(200);
      const parsed = passwordResetResponseSchema.parse(response.body);
      expect(parsed.temporaryPassword).toHaveLength(20);

      const after = await harness.prisma.appUser.findUniqueOrThrow({ where: { id: target.id } });
      expect(after.passwordHash).not.toBe(before.passwordHash);
      expect(after.mustChangePassword).toBe(true);
      expect(after.passwordUpdatedAt.getTime()).toBeGreaterThan(before.passwordUpdatedAt.getTime());

      const sessions = await harness.prisma.userSession.findMany({ where: { userId: target.id } });
      expect(sessions.every((s) => s.revokedReason === 'PASSWORD_CHANGED')).toBe(true);
      expect((await request(server()).get('/auth/session').set(asUser(targetToken))).status).toBe(
        401,
      );

      const audit = await harness.prisma.auditLog.findFirstOrThrow({
        where: { action: 'auth.password.reset' },
      });
      const serialised = JSON.stringify(audit);
      expect(serialised).not.toContain(parsed.temporaryPassword);
      expect(serialised).not.toContain('$argon2');
    });

    it('unlocks an account and clears every lockout field', async () => {
      const { token } = await signIn('MANAGER');
      const target = await seedUser(harness, { username: 'lockedout' });

      await harness.prisma.$executeRaw`
        UPDATE app_user
        SET locked_until = now() + interval '15 minutes',
            failed_login_count = 4,
            failed_login_window_started_at = now()
        WHERE id = ${target.id}::uuid
      `;

      const response = await request(server())
        .post(`/users/${target.id}/unlock`)
        .set(asUser(token));

      expect(response.status).toBe(200);
      const row = await harness.prisma.appUser.findUniqueOrThrow({ where: { id: target.id } });
      expect(row.lockedUntil).toBeNull();
      expect(row.failedLoginCount).toBe(0);
      expect(row.failedLoginWindowStartedAt).toBeNull();

      const audit = await harness.prisma.auditLog.findFirstOrThrow({
        where: { action: 'user.unlocked' },
      });
      expect(audit.after).toEqual({
        lockedUntil: null,
        failedLoginCount: 0,
        failedLoginWindowStartedAt: null,
      });
    });

    it('revokes sessions with MANAGER_REVOKED and keeps the rows', async () => {
      const { token: managerToken } = await signIn('MANAGER');
      const { user: target } = await signIn('RECEPTIONIST', 'signmeout');

      const response = await request(server())
        .post(`/users/${target.id}/sessions/revoke`)
        .set(asUser(managerToken));

      expect(response.status).toBe(200);
      expect(revokeSessionsResponseSchema.parse(response.body).revokedCount).toBe(1);

      const sessions = await harness.prisma.userSession.findMany({ where: { userId: target.id } });
      // Marked, never deleted: the row is the evidence the session existed.
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.revokedReason).toBe('MANAGER_REVOKED');

      const audit = await harness.prisma.auditLog.findFirstOrThrow({
        where: { action: 'auth.session.revoked' },
      });
      expect(audit.metadata).toEqual({ revokedCount: 1, reason: 'MANAGER_REVOKED' });
    });

    it('returns USER_NOT_FOUND for an unknown target', async () => {
      const { token } = await signIn('MANAGER');

      const response = await request(server())
        .post('/users/00000000-0000-7000-8000-000000000000/unlock')
        .set(asUser(token));

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('USER_NOT_FOUND');
    });
  });

  describe('user rows are never deleted', () => {
    it('has no delete route and the database refuses one', async () => {
      const target = await seedUser(harness, { username: 'permanent' });

      const { token } = await signIn('MANAGER');
      const response = await request(server()).delete(`/users/${target.id}`).set(asUser(token));

      expect([403, 404, 405]).toContain(response.status);

      await expect(
        harness.prisma.$executeRawUnsafe(`DELETE FROM app_user WHERE id = '${target.id}'`),
      ).rejects.toThrow(/protected|not permitted/i);
    });
  });
});
