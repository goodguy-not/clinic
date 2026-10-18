import { AuditService } from '../src/audit/audit.service';
import { AuditPayloadError } from '../src/audit/audit-payload';
import { uuidv7 } from '../src/common/uuid';
import { createHarness, resetDatabase, seedUser, type Harness, ownerPrisma } from './harness';

describe('audit runtime (real PostgreSQL)', () => {
  let harness: Harness;
  let audit: AuditService;

  beforeAll(async () => {
    harness = await createHarness();
    audit = harness.app.get(AuditService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  const context = (userId?: string) => ({
    actor:
      userId === undefined
        ? ({ type: 'ANONYMOUS' } as const)
        : ({ type: 'USER', userId, sessionId: null } as const),
    requestId: uuidv7(),
    clientIp: '192.0.2.10',
    userAgent: 'integration-test',
  });

  describe('transactional coupling', () => {
    it('commits the state change and its audit row together', async () => {
      const user = await seedUser(harness);

      await harness.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          UPDATE app_user SET display_name = 'Changed' WHERE id = ${user.id}::uuid
        `;
        await audit.record(tx, context(user.id), {
          action: 'user.status_changed',
          entityType: 'app_user',
          entityId: user.id,
          before: { displayName: 'Synthetic Tester' },
          after: { displayName: 'Changed' },
        });
      });

      const rows = await harness.prisma.auditLog.findMany({ where: { entityId: user.id } });
      const changed = await harness.prisma.appUser.findUniqueOrThrow({ where: { id: user.id } });

      expect(rows).toHaveLength(1);
      expect(changed.displayName).toBe('Changed');
    });

    it('rolls back the audit row when the state change fails', async () => {
      const user = await seedUser(harness);

      await expect(
        harness.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`
            UPDATE app_user SET display_name = 'Rolled back' WHERE id = ${user.id}::uuid
          `;
          await audit.record(tx, context(user.id), {
            action: 'user.status_changed',
            entityType: 'app_user',
            entityId: user.id,
          });

          throw new Error('deliberate failure after both writes');
        }),
      ).rejects.toThrow('deliberate failure');

      const rows = await harness.prisma.auditLog.findMany({ where: { entityId: user.id } });
      const unchanged = await harness.prisma.appUser.findUniqueOrThrow({ where: { id: user.id } });

      // Neither survived. An audit trail that outlives a rolled-back change
      // would be worse than none, because it would assert something false.
      expect(rows).toHaveLength(0);
      expect(unchanged.displayName).toBe('Synthetic Tester');
    });

    it('gives every row in one transaction the same occurred_at', async () => {
      const user = await seedUser(harness);

      await harness.prisma.$transaction(async (tx) => {
        await audit.record(tx, context(user.id), {
          action: 'auth.password.changed',
          entityType: 'app_user',
          entityId: user.id,
        });
        // A deliberate gap: with clock_timestamp() these would differ.
        await new Promise((resolve) => setTimeout(resolve, 25));
        await audit.record(tx, context(user.id), {
          action: 'auth.session.rotated',
          entityType: 'user_session',
          entityId: uuidv7(),
        });
      });

      const rows = await harness.prisma.auditLog.findMany({ orderBy: { action: 'asc' } });

      expect(rows).toHaveLength(2);
      // transaction_timestamp(), not clock_timestamp(): a state change and its
      // audit rows are provably simultaneous.
      expect(rows[0]?.occurredAt.getTime()).toBe(rows[1]?.occurredAt.getTime());
    });

    it('refuses the base PrismaClient, which would write outside any transaction', async () => {
      await expect(
        audit.record(harness.prisma, context(), {
          action: 'auth.logout',
          entityType: 'user_session',
        }),
      ).rejects.toThrow(/interactive transaction client/i);

      expect(await harness.prisma.auditLog.count()).toBe(0);
    });
  });

  describe('secret material never reaches the trail', () => {
    it.each([
      ['passwordHash', { passwordHash: 'anything' }],
      ['password_hash', { password_hash: 'anything' }],
      ['newPassword', { newPassword: 'anything' }],
      ['sessionToken', { sessionToken: 'anything' }],
      ['internalKey', { internalKey: 'anything' }],
      ['cookie', { cookie: 'anything' }],
      ['authorization', { authorization: 'anything' }],
      ['nested secret', { outer: { inner: { apiKey: 'anything' } } }],
    ])('rejects a payload containing %s, before any insert', async (_label, after) => {
      await expect(
        harness.prisma.$transaction((tx) =>
          audit.record(tx, context(), {
            action: 'user.created',
            entityType: 'app_user',
            after: after as Record<string, string>,
          }),
        ),
      ).rejects.toBeInstanceOf(AuditPayloadError);

      expect(await harness.prisma.auditLog.count()).toBe(0);
    });

    it('rejects an Argon2 hash appearing as a value under an innocent key', async () => {
      const hash = await harness.passwords.hash('quiet harbour lantern drift');

      await expect(
        harness.prisma.$transaction((tx) =>
          audit.record(tx, context(), {
            action: 'user.created',
            entityType: 'app_user',
            metadata: { note: hash },
          }),
        ),
      ).rejects.toBeInstanceOf(AuditPayloadError);

      expect(await harness.prisma.auditLog.count()).toBe(0);
    });
  });

  describe('PostgreSQL refuses to rewrite history', () => {
    async function writeOneRow(): Promise<string> {
      const user = await seedUser(harness);
      await harness.prisma.$transaction((tx) =>
        audit.record(tx, context(user.id), {
          action: 'user.created',
          entityType: 'app_user',
          entityId: user.id,
        }),
      );
      return user.id;
    }

    // As the OWNER, deliberately: the runtime role is refused all of these by
    // privilege before any trigger fires (runtime-role.int-spec.ts). What is
    // proved here is that the triggers hold even for a role that owns the table.
    it('rejects UPDATE on audit_log', async () => {
      await writeOneRow();
      await expect(
        ownerPrisma().$executeRawUnsafe(`UPDATE audit_log SET action = 'user.created'`),
      ).rejects.toThrow(/protected|not permitted/i);
    });

    it('rejects DELETE on audit_log', async () => {
      await writeOneRow();
      await expect(ownerPrisma().$executeRawUnsafe('DELETE FROM audit_log')).rejects.toThrow(
        /protected|not permitted/i,
      );
      expect(await harness.prisma.auditLog.count()).toBe(1);
    });

    it('rejects TRUNCATE on audit_log, which bypasses row triggers', async () => {
      await writeOneRow();
      await expect(ownerPrisma().$executeRawUnsafe('TRUNCATE audit_log')).rejects.toThrow(
        /protected|not permitted/i,
      );
      expect(await harness.prisma.auditLog.count()).toBe(1);
    });

    it('rejects DELETE on app_user', async () => {
      const id = await writeOneRow();
      await expect(
        ownerPrisma().$executeRawUnsafe(`DELETE FROM app_user WHERE id = '${id}'`),
      ).rejects.toThrow(/protected|not permitted/i);
    });

    it('rejects TRUNCATE on app_user', async () => {
      await writeOneRow();
      await expect(ownerPrisma().$executeRawUnsafe('TRUNCATE app_user CASCADE')).rejects.toThrow(
        /protected|not permitted/i,
      );
    });
  });

  describe('session retention is decoupled from audit', () => {
    it('deletes an expired session while its audit reference survives', async () => {
      const user = await seedUser(harness);

      const issued = await harness.prisma.$transaction(async (tx) => {
        const session = await harness.sessions.createSession(tx, user.id);
        await audit.record(
          tx,
          {
            actor: { type: 'USER', userId: user.id, sessionId: session.sessionId },
            requestId: uuidv7(),
          },
          {
            action: 'auth.login.succeeded',
            entityType: 'user_session',
            entityId: session.sessionId,
          },
        );
        return session;
      });

      // user_session is operational state the nightly SESSION_PRUNE job removes
      // once it has been over for thirty days (Milestone 10, checkpoint A3).
      // The session is aged past that as the owner — the only way a test can
      // move time — and then pruned by the runtime, exactly as the job does.
      await ownerPrisma().$executeRaw`
        UPDATE user_session
        SET created_at = created_at - interval '40 days',
            last_seen_at = last_seen_at - interval '40 days',
            idle_expires_at = idle_expires_at - interval '40 days',
            absolute_expires_at = absolute_expires_at - interval '40 days'
        WHERE id = ${issued.sessionId}::uuid
      `;

      expect(await harness.sessions.pruneEnded()).toBe(1);
      expect(await harness.prisma.userSession.count()).toBe(0);

      const row = await harness.prisma.auditLog.findFirstOrThrow();
      // The historical reference survives because there is no foreign key.
      expect(row.sessionId).toBe(issued.sessionId);
    });
  });
});
