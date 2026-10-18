import {
  actorSession,
  auditContext,
  createHarness,
  resetDatabase,
  seedUser,
  type Harness,
} from './harness';

/**
 * The last-manager race.
 *
 * Two managers, each removing the other, at the same time. Both transactions
 * count active managers excluding their own target, so without serialisation
 * both see one manager remaining, both succeed, and the clinic is left with
 * none — an outcome no single request could produce and no error message would
 * report.
 *
 * `pg_advisory_xact_lock` makes the count-then-act sequence exclusive. Row locks
 * alone are not enough: `SELECT ... FOR UPDATE` on the target locks the target,
 * and the two transactions have different targets, so they never contend.
 */
describe('last-manager concurrency (real PostgreSQL)', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  async function twoManagers() {
    const first = await seedUser(harness, { username: 'managerone', role: 'MANAGER' });
    const second = await seedUser(harness, { username: 'managertwo', role: 'MANAGER' });
    return { first, second };
  }

  const activeManagers = () =>
    harness.prisma.appUser.count({ where: { role: 'MANAGER', status: 'ACTIVE' } });

  it('lets only one of two simultaneous demotions succeed', async () => {
    const { first, second } = await twoManagers();
    expect(await activeManagers()).toBe(2);

    // Each manager demotes the other, concurrently.
    const results = await Promise.allSettled([
      harness.users.changeRole(second.id, 'RECEPTIONIST', actorSession(first.id), auditContext()),
      harness.users.changeRole(first.id, 'RECEPTIONIST', actorSession(second.id), auditContext()),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'USER_LAST_MANAGER',
    });

    // The invariant that actually matters.
    expect(await activeManagers()).toBe(1);
  });

  it('lets only one of two simultaneous disables succeed', async () => {
    const { first, second } = await twoManagers();

    const results = await Promise.allSettled([
      harness.users.changeStatus(second.id, 'DISABLED', actorSession(first.id), auditContext()),
      harness.users.changeStatus(first.id, 'DISABLED', actorSession(second.id), auditContext()),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await activeManagers()).toBe(1);
  });

  it('holds when a demotion and a disable race each other', async () => {
    const { first, second } = await twoManagers();

    const results = await Promise.allSettled([
      harness.users.changeRole(second.id, 'RECEPTIONIST', actorSession(first.id), auditContext()),
      harness.users.changeStatus(first.id, 'DISABLED', actorSession(second.id), auditContext()),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await activeManagers()).toBe(1);
  });

  it('writes exactly one audit row for the one change that committed', async () => {
    const { first, second } = await twoManagers();

    await Promise.allSettled([
      harness.users.changeRole(second.id, 'RECEPTIONIST', actorSession(first.id), auditContext()),
      harness.users.changeRole(first.id, 'RECEPTIONIST', actorSession(second.id), auditContext()),
    ]);

    // The losing transaction rolled back, taking its audit row with it.
    const rows = await harness.prisma.auditLog.findMany({ where: { action: 'user.role_changed' } });
    expect(rows).toHaveLength(1);
  });

  it('serialises many simultaneous demotions down to a safe result', async () => {
    const managers = await Promise.all(
      Array.from({ length: 5 }, (_unused, index) =>
        seedUser(harness, { username: `crowdmanager${index}`, role: 'MANAGER' }),
      ),
    );

    // Everyone demotes the next manager around the ring at once.
    const results = await Promise.allSettled(
      managers.map((actor, index) => {
        const target = managers[(index + 1) % managers.length];
        return harness.users.changeRole(
          (target as { id: string }).id,
          'RECEPTIONIST',
          actorSession(actor.id),
          auditContext(),
        );
      }),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const remaining = await activeManagers();

    // Whatever the interleaving, a manager always remains, and the number of
    // successes is consistent with the number removed.
    expect(remaining).toBeGreaterThanOrEqual(1);
    expect(succeeded).toBe(managers.length - remaining);
  });
});
