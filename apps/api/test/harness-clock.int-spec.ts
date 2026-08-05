import { createHarness, resetDatabase, seedUser, type Harness } from './harness';

/**
 * The test fixture reads the same clock production writes with.
 *
 * Production sets every security timestamp from PostgreSQL:
 * `password_updated_at`, `disabled_at`, session expiry and `audit_log`
 * `occurred_at` all come from `transaction_timestamp()`. If a fixture seeds a
 * row using the Node clock instead, any assertion comparing a seeded value with
 * a server-written one is silently comparing two clocks.
 *
 * That is not hypothetical: a Docker suspend and resume leaves the container's
 * clock seconds behind the host, and the password-reset test then fails with
 * "expected the timestamp to move forward" — a failure that reads like a defect
 * in password reset and is nothing of the sort.
 *
 * The fix was to seed through PostgreSQL. This suite is what stops that
 * quietly regressing: it asserts the property directly rather than waiting for
 * a clock to drift on somebody's machine.
 *
 * Nothing here widens an expiry window, sleeps, or weakens an assertion. The
 * authority was always the database; the fixture now agrees with it.
 */
describe('integration fixture clock (real PostgreSQL)', () => {
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

  async function databaseNow(): Promise<Date> {
    const rows = await harness.prisma.$queryRaw<{ now: Date }[]>`
      SELECT transaction_timestamp() AS now
    `;

    const now = rows[0]?.now;
    if (now === undefined) throw new Error('PostgreSQL returned no timestamp');
    return now;
  }

  it('seeds timestamps from PostgreSQL, not from the Node clock', async () => {
    const before = await databaseNow();
    const seeded = await seedUser(harness);
    const after = await databaseNow();

    const row = await harness.prisma.appUser.findUniqueOrThrow({ where: { id: seeded.id } });

    // Between two database readings, with no tolerance for skew. A
    // client-generated value would fall outside this window the moment the
    // container clock and the host clock disagree by more than the test's own
    // duration — which is exactly the failure this guards.
    expect(row.passwordUpdatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(row.passwordUpdatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    expect(row.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(row.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('keeps a seeded row comparable with a value the server writes later', async () => {
    // The shape of the password-reset assertion, reduced to its essentials: a
    // fixture timestamp and a server-written one, ordered.
    const seeded = await seedUser(harness);
    const before = await harness.prisma.appUser.findUniqueOrThrow({ where: { id: seeded.id } });

    await harness.prisma.$executeRaw`
      UPDATE app_user SET password_updated_at = transaction_timestamp()
      WHERE id = ${seeded.id}::uuid
    `;

    const after = await harness.prisma.appUser.findUniqueOrThrow({ where: { id: seeded.id } });

    expect(after.passwordUpdatedAt.getTime()).toBeGreaterThan(before.passwordUpdatedAt.getTime());
  });

  it('records a disabled account with a database timestamp too', async () => {
    const before = await databaseNow();
    const seeded = await seedUser(harness, { status: 'DISABLED' });
    const after = await databaseNow();

    const row = await harness.prisma.appUser.findUniqueOrThrow({ where: { id: seeded.id } });

    expect(row.status).toBe('DISABLED');
    expect(row.disabledAt).not.toBeNull();
    expect(row.disabledAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(row.disabledAt!.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('leaves an active account with no deactivation timestamp', async () => {
    const seeded = await seedUser(harness, { status: 'ACTIVE' });

    const row = await harness.prisma.appUser.findUniqueOrThrow({ where: { id: seeded.id } });

    // The CHECK requires the two to agree; this proves the raw-SQL fixture
    // still satisfies it.
    expect(row.status).toBe('ACTIVE');
    expect(row.disabledAt).toBeNull();
  });
});
