import { createHarness, resetDatabase, type Harness } from './harness';
import { voidChargeOverHttp } from './ledger-support';
import {
  closePeriodOverHttp,
  periodAuditRows,
  seedCloseClinic,
  MONTH_ONE,
  MONTH_TWO,
  type CloseFixture,
} from './settlement-support';

/**
 * What happens when two settlement closes arrive at once.
 *
 * THE INVARIANTS UNDER TEST ARE THE TWO THE CHECKPOINT RESTS ON, and neither can
 * be held by an application that reads before it writes:
 *
 *   * NO TWO CLOSED PERIODS OF ONE THERAPIST MAY COVER THE SAME DAY. Two managers
 *     submitting overlapping ranges at the same instant both find the range free
 *     if the check is a `SELECT`; against `settlement_period_no_overlap_excl`
 *     exactly one commits.
 *   * A SESSION IS SETTLED EXACTLY ONCE. Two identical requests firing together
 *     must produce ONE authoritative period with ONE set of lines — not two
 *     periods, not one period with duplicated lines, and not one audit trail
 *     claiming the close happened twice.
 *
 * Every case fires its requests with `Promise.all` and no coordination at all,
 * so either ordering is legitimate; what is asserted is what must hold in BOTH.
 */
describe('settlement close concurrency (real PostgreSQL)', () => {
  let harness: Harness;
  let fixture: CloseFixture;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    fixture = await seedCloseClinic(harness);
  });

  const closing = (range: { from: string; to: string }, therapistId = fixture.therapistId) =>
    closePeriodOverHttp(harness, fixture.managerToken, { therapistId, ...range });

  it('lets exactly one of two simultaneous identical closes be the close', async () => {
    const responses = await Promise.all([closing(MONTH_ONE), closing(MONTH_ONE)]);

    // Both succeed — nothing was refused — and exactly one of them is the act.
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(responses.map((response) => response.body.outcome).sort()).toEqual([
      'ALREADY_CLOSED',
      'CLOSED',
    ]);

    // Both describe the SAME period, which is what makes the idempotent answer
    // useful rather than merely non-erroring.
    const [first, second] = responses;
    expect(first?.body.period.id).toBe(second?.body.period.id);

    // ONE period, ONE set of lines, ONE audit row. A retry that duplicated the
    // audit history would make the close look like two acts.
    expect(await harness.prisma.settlementPeriod.count()).toBe(1);
    expect(await harness.prisma.settlementLine.count()).toBe(3);
    expect(await periodAuditRows(harness)).toHaveLength(1);

    // And no session acquired a second authoritative settlement.
    const duplicated = await harness.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT count(*) AS total FROM (
        SELECT session_charge_id FROM settlement_line
        WHERE line_type = 'PRIMARY'
        GROUP BY session_charge_id HAVING count(*) > 1
      ) doubled
    `;
    expect(Number(duplicated[0]?.total ?? 0)).toBe(0);
  });

  it('lets exactly one of two simultaneous overlapping closes commit', async () => {
    const responses = await Promise.all([
      closing(MONTH_ONE),
      closing({ from: '2026-09-15', to: '2026-10-15' }),
    ]);

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 409]);

    const refused = responses.find((response) => response.status === 409);
    expect(refused?.body.error.code).toBe('SETTLEMENT_PERIOD_OVERLAP');

    // One period, one audit row: the refusal wrote nothing and claims nothing.
    expect(await harness.prisma.settlementPeriod.count()).toBe(1);
    expect(await periodAuditRows(harness)).toHaveLength(1);

    // And no orphan line survived a rolled-back close.
    const periods = await harness.prisma.settlementPeriod.findMany();
    const lines = await harness.prisma.settlementLine.findMany();
    expect(lines.every((line) => line.settlementPeriodId === periods[0]?.id)).toBe(true);
  });

  it('does not serialise closes of two different therapists', async () => {
    // The advisory lock is keyed on the therapist, so two people's months close
    // together. Both must commit, and neither may see the other's sessions.
    const responses = await Promise.all([
      closing(MONTH_ONE, fixture.therapistId),
      closing(MONTH_ONE, fixture.otherTherapistId),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(responses.map((response) => response.body.outcome)).toEqual(['CLOSED', 'CLOSED']);

    const periods = await harness.prisma.settlementPeriod.findMany();
    expect(periods).toHaveLength(2);

    for (const period of periods) {
      const lines = await harness.prisma.settlementLine.findMany({
        where: { settlementPeriodId: period.id },
      });
      expect(lines.every((line) => line.therapistId === period.therapistId)).toBe(true);
    }
  });

  it('never lands a concurrent charge void half in and half out of a close', async () => {
    // The close takes every candidate charge `FOR UPDATE` in this project's one
    // lock order, and the void takes the same row, so one waits for the other.
    // EITHER ordering is legitimate; what must never happen is a closed line
    // that reflects a charge nobody can account for.
    const [closed] = await Promise.all([
      closing(MONTH_ONE),
      voidChargeOverHttp(harness, fixture.managerToken, fixture.withdrawn.chargeId),
    ]);

    expect(closed?.status).toBe(200);

    // Close the next month, which carries whatever the first close did not.
    await closing(MONTH_TWO).expect(200);

    // THE INVARIANT, ASKED OF THE WHOLE DATABASE: for every session ever
    // settled, its lines sum to what the session is worth NOW.
    const mismatched = await harness.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT count(*) AS total FROM (
        SELECT
          l.session_charge_id,
          sum(l.therapist_net_toman) AS settled
        FROM settlement_line l
        GROUP BY l.session_charge_id
      ) closed
      JOIN session_charge c ON c.id = closed.session_charge_id
      JOIN session_settlement ss
        ON ss.session_charge_id = c.id AND ss.voided_at IS NULL
      JOIN LATERAL (
        SELECT coalesce(sum(a.therapist_discount_toman), 0) AS borne
        FROM charge_adjustment a
        WHERE a.session_charge_id = c.id AND a.voided_at IS NULL
      ) active ON TRUE
      WHERE closed.settled <> CASE
        WHEN c.voided_at IS NULL THEN ss.therapist_gross_toman - active.borne
        ELSE 0
      END
    `;

    expect(Number(mismatched[0]?.total ?? 0)).toBe(0);
  });
});
