import { createHarness, resetDatabase, type Harness } from './harness';
import { voidChargeOverHttp } from './ledger-support';
import {
  ratingAuditRows,
  ratingRowsFor,
  rateOverHttp,
  readRatingOverHttp,
  seedChargedSession,
  shareRuleId,
  voidRatingOverHttp,
} from './settlement-support';

/**
 * What happens when two rating requests for one session arrive at once.
 *
 * THE INVARIANT UNDER TEST: a session carries at most ONE STANDING RATING, so
 * "what did this therapist earn from this session?" has exactly one answer or
 * none — never two, and never one arbitrarily chosen from two. A therapist paid
 * twice for one session is discovered by whoever reconciles the month, not by
 * whoever caused it.
 *
 * AN APPLICATION THAT READS BEFORE IT WRITES CANNOT HOLD THAT on its own: two
 * managers rating the same session at the same instant both find it unrated. So
 * there are two mechanisms and both are exercised here — every write takes the
 * parent charge row `FOR UPDATE` first, so the second request WAITS rather than
 * racing, and `session_settlement_one_valid_per_charge_uq` is the final
 * authority behind it.
 *
 * Every fixture is synthetic.
 */
describe('session rating concurrency (real PostgreSQL)', () => {
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

  it('lets exactly one of two simultaneous ratings become authoritative', async () => {
    const { managerToken, chargeId, therapistId } = await seedChargedSession(harness, {
      shareBasisPoints: null,
    });

    // A rule so both attempts have one to resolve. The two requests are then
    // fired together with no coordination at all: either winner is legitimate,
    // and the invariant is what must hold in both orderings.
    await shareRuleId(harness, managerToken, therapistId, { shareBasisPoints: 4000 });

    const responses = await Promise.all([
      rateOverHttp(harness, managerToken, chargeId),
      rateOverHttp(harness, managerToken, chargeId),
    ]);

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 409]);

    const refused = responses.find((response) => response.status === 409);
    expect(refused?.body.error.code).toBe('SESSION_ALREADY_RATED');

    // ONE standing row, ONE audit row. The refusal wrote neither.
    const rows = await ratingRowsFor(harness, chargeId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.voidedAt).toBeNull();
    expect(await ratingAuditRows(harness)).toHaveLength(1);
  });

  it('lets exactly one of two simultaneous withdrawals succeed', async () => {
    const fixture = await seedChargedSession(harness, { shareBasisPoints: 4000 });
    const rating = (await ratingRowsFor(harness, fixture.chargeId))[0];

    const responses = await Promise.all([
      voidRatingOverHttp(harness, fixture.managerToken, rating?.id ?? ''),
      voidRatingOverHttp(harness, fixture.managerToken, rating?.id ?? ''),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(responses.find((response) => response.status === 409)?.body.error.code).toBe(
      'RATING_ALREADY_VOIDED',
    );

    // One withdrawal, one reason, one audit row. The second could not overwrite
    // the first one's reason even if the check above it were removed.
    const rows = await ratingRowsFor(harness, fixture.chargeId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.voidedAt).not.toBeNull();
    expect(await ratingAuditRows(harness)).toHaveLength(2);
  });

  it('serialises a rating against a concurrent void of its charge', async () => {
    const fixture = await seedChargedSession(harness, { shareBasisPoints: null });
    await shareRuleId(harness, fixture.managerToken, fixture.therapistId, {
      shareBasisPoints: 4000,
    });

    // Both take the same charge row lock, in the same order, so one of two
    // consistent outcomes holds: the rating landed first and was withdrawn with
    // the charge, or the void landed first and the rating was refused. What
    // cannot happen is a standing rating against a withdrawn charge.
    const [rated, voided] = await Promise.all([
      rateOverHttp(harness, fixture.managerToken, fixture.chargeId),
      voidChargeOverHttp(harness, fixture.managerToken, fixture.chargeId),
    ]);

    expect(voided.status).toBe(200);
    expect([201, 409]).toContain(rated.status);

    const standing = await harness.prisma.sessionSettlement.count({
      where: { sessionChargeId: fixture.chargeId, voidedAt: null },
    });
    expect(standing).toBe(0);

    const read = await readRatingOverHttp(harness, fixture.managerToken, fixture.chargeId);
    expect(read.status).toBe(422);
    expect(read.body.error.code).toBe('SESSION_NOT_RATED');
  });
});
