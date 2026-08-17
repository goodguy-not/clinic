import { seedSyntheticClinic } from '../src/dev/synthetic-clinic';
import { createHarness, resetDatabase, type Harness } from './harness';

/**
 * The one precondition the synthetic-clinic seeder has, in a suite of its own
 * because proving it means emptying the database — which would destroy the
 * clinic the seeding suite builds.
 */
describe('the synthetic clinic seed, with no manager to act as', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('refuses, rather than creating an account with a known password', async () => {
    // Creating the first manager is `bootstrap-manager`'s job and only its job:
    // it is the single credential path in this system and it refuses to run
    // against a populated `app_user`. A seeder that quietly created a second one
    // would be a permanent, shared, known-password account in whatever database
    // somebody pointed it at.
    await resetDatabase(harness.prisma);

    await expect(seedSyntheticClinic(harness.app, { runTag: 'nomgr', weeks: 1 })).rejects.toThrow(
      /No active manager exists/,
    );

    // And it wrote nothing on the way to refusing.
    expect(await harness.prisma.family.count()).toBe(0);
    expect(await harness.prisma.appointment.count()).toBe(0);
  }, 60_000);
});
