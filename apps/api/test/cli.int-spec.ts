import { PrismaClient } from '@prisma/client';
import { runCli } from '../src/cli/run-cli';
import type { CliIo } from '../src/cli/cli-io';
import { resetDatabase, testDatabaseUrl } from './harness';

/**
 * Bootstrap and recovery CLI, against a real database.
 *
 * The CLI runs as its own NestJS application context, so these tests drive
 * `runCli` exactly as `main.ts` does rather than reaching into the subcommands.
 */
describe('operator CLI (real PostgreSQL)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient({ datasources: { db: { url: testDatabaseUrl() } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  function captureIo(stdin = ''): CliIo & { stdout: string[]; stderr: string[] } {
    const stdout: string[] = [];
    const stderr: string[] = [];

    return {
      stdout,
      stderr,
      out: (line) => stdout.push(line),
      err: (line) => stderr.push(line),
      readStdin: () => Promise.resolve(stdin),
    };
  }

  const printedPassword = (io: { stdout: string[] }): string | undefined =>
    io.stdout.map((line) => line.trim()).find((line) => /^[A-Za-z2-9]{20}$/.test(line));

  describe('bootstrap-manager', () => {
    it('creates the first manager and prints the password exactly once', async () => {
      const io = captureIo();

      const code = await runCli(
        ['bootstrap-manager', '--username', 'firstmanager', '--display-name', 'First Manager'],
        io,
      );

      expect(code).toBe(0);

      const user = await prisma.appUser.findFirstOrThrow({ where: { username: 'firstmanager' } });
      expect(user.role).toBe('MANAGER');
      expect(user.status).toBe('ACTIVE');
      expect(user.mustChangePassword).toBe(true);
      expect(user.createdByUserId).toBeNull();
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);

      const password = printedPassword(io);
      expect(password).toBeDefined();
      expect(io.stdout.filter((line) => line.includes(password as string))).toHaveLength(1);

      // Plaintext exists only on stdout; the database holds a hash of it.
      expect(user.passwordHash).not.toContain(password as string);
    });

    it('writes a SYSTEM audit row in the same transaction', async () => {
      await runCli(
        ['bootstrap-manager', '--username', 'auditedboot', '--display-name', 'Audited'],
        captureIo(),
      );

      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'user.created' } });

      // Nobody was authenticated, and the database CHECK enforces that a SYSTEM
      // actor names no user.
      expect(audit.actorType).toBe('SYSTEM');
      expect(audit.actorUserId).toBeNull();
      expect(audit.metadata).toMatchObject({ mechanism: 'bootstrap_cli' });
    });

    it('refuses when any user already exists', async () => {
      await runCli(
        ['bootstrap-manager', '--username', 'already', '--display-name', 'Already'],
        captureIo(),
      );

      const io = captureIo();
      const code = await runCli(
        ['bootstrap-manager', '--username', 'second', '--display-name', 'Second'],
        io,
      );

      expect(code).toBe(1);
      expect(io.stderr.join(' ')).toMatch(/already contains/i);
      expect(await prisma.appUser.count()).toBe(1);
    });

    it('lets only one of two concurrent bootstraps win', async () => {
      const first = captureIo();
      const second = captureIo();

      const [a, b] = await Promise.all([
        runCli(
          ['bootstrap-manager', '--username', 'racerone', '--display-name', 'Race One'],
          first,
        ),
        runCli(
          ['bootstrap-manager', '--username', 'racetwo', '--display-name', 'Race Two'],
          second,
        ),
      ]);

      // The advisory lock serialises the check-then-insert; the loser sees the
      // winner's row and refuses.
      expect([a, b].filter((code) => code === 0)).toHaveLength(1);
      expect([a, b].filter((code) => code === 1)).toHaveLength(1);
      expect(await prisma.appUser.count()).toBe(1);
    });

    it('accepts a password from stdin and never echoes it', async () => {
      const supplied = 'quiet harbour lantern drift';
      const io = captureIo(`${supplied}\n`);

      const code = await runCli(
        [
          'bootstrap-manager',
          '--username',
          'stdinboot',
          '--display-name',
          'Stdin',
          '--password-stdin',
        ],
        io,
      );

      expect(code).toBe(0);
      expect(io.stdout.join('\n')).not.toContain(supplied);

      const user = await prisma.appUser.findFirstOrThrow({ where: { username: 'stdinboot' } });
      expect(user.passwordHash).not.toContain(supplied);
    });

    it('rejects a stdin password that fails policy', async () => {
      const io = captureIo('short\n');

      const code = await runCli(
        [
          'bootstrap-manager',
          '--username',
          'weakboot',
          '--display-name',
          'Weak',
          '--password-stdin',
        ],
        io,
      );

      expect(code).toBe(2);
      expect(io.stderr.join(' ')).toMatch(/rejected by policy/i);
      expect(await prisma.appUser.count()).toBe(0);
    });

    it('validates the username', async () => {
      const io = captureIo();

      const code = await runCli(
        ['bootstrap-manager', '--username', 'Has Capitals', '--display-name', 'Bad'],
        io,
      );

      expect(code).toBe(2);
      expect(await prisma.appUser.count()).toBe(0);
    });
  });

  describe('reset-password', () => {
    async function bootstrapped(): Promise<string> {
      await runCli(
        ['bootstrap-manager', '--username', 'recovertarget', '--display-name', 'Recover'],
        captureIo(),
      );
      const user = await prisma.appUser.findFirstOrThrow({ where: { username: 'recovertarget' } });
      return user.id;
    }

    it('resets, forces a change, revokes sessions and audits as SYSTEM', async () => {
      const id = await bootstrapped();
      const before = await prisma.appUser.findUniqueOrThrow({ where: { id } });

      await prisma.userSession.create({
        data: {
          id: '019fcce9-0000-7000-8000-000000000001',
          tokenHash: Buffer.alloc(32, 7),
          userId: id,
          idleExpiresAt: new Date(Date.now() + 3600_000),
          absoluteExpiresAt: new Date(Date.now() + 7200_000),
        },
      });

      const io = captureIo();
      const code = await runCli(['reset-password', '--username', 'recovertarget'], io);

      expect(code).toBe(0);

      const after = await prisma.appUser.findUniqueOrThrow({ where: { id } });
      expect(after.passwordHash).not.toBe(before.passwordHash);
      expect(after.mustChangePassword).toBe(true);
      expect(after.lockedUntil).toBeNull();
      expect(after.failedLoginCount).toBe(0);

      const session = await prisma.userSession.findFirstOrThrow();
      expect(session.revokedReason).toBe('PASSWORD_CHANGED');

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'auth.password.reset' },
      });
      expect(audit.actorType).toBe('SYSTEM');
      expect(audit.actorUserId).toBeNull();
      expect(audit.metadata).toMatchObject({ mechanism: 'cli' });
    });

    it('never records the password or a hash in the audit payload', async () => {
      await bootstrapped();
      const io = captureIo();

      await runCli(['reset-password', '--username', 'recovertarget'], io);

      const password = printedPassword(io);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'auth.password.reset' },
      });
      const serialised = JSON.stringify(audit);

      expect(password).toBeDefined();
      expect(serialised).not.toContain(password as string);
      expect(serialised).not.toContain('$argon2');
    });

    it('reports an unknown username without creating anything', async () => {
      const io = captureIo();
      const code = await runCli(['reset-password', '--username', 'nosuchperson'], io);

      expect(code).toBe(1);
      expect(io.stderr.join(' ')).toMatch(/no account/i);
    });
  });

  describe('a password may never be an argument', () => {
    it('refuses --password outright', async () => {
      const io = captureIo();

      const code = await runCli(
        [
          'bootstrap-manager',
          '--username',
          'argvuser',
          '--display-name',
          'Argv',
          '--password',
          'somevalue',
        ],
        io,
      );

      // Rejected rather than ignored: an ignored flag would leave the operator
      // believing the value was used, and it is already in shell history and the
      // process list by the time this runs.
      expect(code).toBe(2);
      expect(io.stderr.join(' ')).toMatch(/never be passed as an argument/i);
      expect(await prisma.appUser.count()).toBe(0);
    });

    it('keeps generated passwords out of process.argv', async () => {
      const io = captureIo();
      await runCli(['bootstrap-manager', '--username', 'argvclean', '--display-name', 'Clean'], io);

      const password = printedPassword(io);
      expect(password).toBeDefined();
      expect(process.argv.join(' ')).not.toContain(password as string);
    });
  });

  // Milestone 10, checkpoint A3. The jobs themselves are proved in
  // `scheduled-jobs.int-spec.ts`; here, the command systemd runs.
  describe('run-jobs', () => {
    it('prints one line per job, counts only, and writes nothing on a dry run', async () => {
      const io = captureIo();

      expect(await runCli(['run-jobs', '--dry-run'], io)).toBe(0);

      expect(io.stdout).toEqual([
        'WEBSITE_REQUEST_PURGE DRY_RUN eligible=0',
        'SESSION_PRUNE DRY_RUN eligible=0',
        'TESTIMONIAL_ERASURE DRY_RUN eligible=0',
        'MEDIA_ERASURE DRY_RUN eligible=0',
      ]);
      expect(await prisma.auditLog.count()).toBe(0);
    });

    it('refuses a job that does not exist, before doing anything', async () => {
      const io = captureIo();

      expect(await runCli(['run-jobs', '--only', 'EVERYTHING'], io)).toBe(2);
      expect(io.stderr).toEqual(['Unknown job: EVERYTHING']);
    });
  });
});
