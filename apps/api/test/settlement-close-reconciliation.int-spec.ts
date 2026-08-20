import { settlementStatementResponseSchema } from '@clinic/contracts';
import { createHarness, resetDatabase, type Harness } from './harness';
import { adjustOverHttp, voidAdjustmentOverHttp, voidChargeOverHttp } from './ledger-support';
import {
  allocateOverHttp,
  closePeriodOverHttp,
  correctRatingOverHttp,
  rateOverHttp,
  ratingRowsFor,
  seedCloseClinic,
  shareRuleId,
  statementOverHttp,
  voidShareRule,
  MONTH_ONE,
  MONTH_TWO,
  MONTH_THREE,
  type CloseFixture,
} from './settlement-support';

/**
 * THE HEADLINE INVARIANT OF CHECKPOINT C6, PROVED ACROSS A SYNTHETIC CLINIC
 * AFTER A SEQUENCE OF CLOSES INTERLEAVED WITH REAL FINANCIAL MOVEMENT.
 *
 *     For every session that has ever been settled, the sum of its PRIMARY
 *     settlement line and all later CORRECTION lines equals its CURRENT
 *     authoritative settlement figures.
 *
 * WHY THIS SUITE IS SEPARATE FROM THE BEHAVIOUR SUITE. That one checks each act
 * produces the right line. This checks that the whole HISTORY still adds up
 * after many acts in many orders — which is a different failure: every
 * individual correction can be right and the accumulated record still drift,
 * because a correction is derived from what previous closes already carried and
 * an error therefore compounds forwards rather than cancelling.
 *
 * THE CROSS-CHECK IS RAW SQL AGAINST THE AUTHORITATIVE ROWS, DELIBERATELY.
 * `expectedTherapistNet` below re-derives what a session is worth from
 * `session_charge`, `session_settlement` and `charge_adjustment` in one
 * statement, in the database, without importing anything from `src/`. Calling
 * the service's own helper here would prove only that the helper agrees with
 * itself, which is exactly the test that cannot fail and therefore cannot find
 * anything.
 *
 * THE SCENARIO CONTAINS, BY CONSTRUCTION: two therapists; ordinary rated
 * sessions; a `FREE` session; a session unrated at the first close and rated
 * afterwards; a therapist-borne concession and a clinic-borne one large enough
 * to make the clinic net negative; a charge withdrawn after its period closed; a
 * rating corrected after its period closed; three closed periods; and a
 * negative signed correction.
 */
describe('the settlement reconciliation invariant (checkpoint C6)', () => {
  let harness: Harness;
  let fixture: CloseFixture;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
    fixture = await seedCloseClinic(harness);
  });

  const close = (range: { from: string; to: string }, therapistId = fixture.therapistId) =>
    closePeriodOverHttp(harness, fixture.managerToken, { therapistId, ...range }).expect(200);

  /**
   * EVERY SESSION EVER SETTLED, WITH THE TWO FIGURES THAT MUST AGREE — the sum
   * of its closed lines, and what the underlying rows say it is worth now.
   *
   * The right-hand side is spelled out here rather than imported: a voided
   * charge is worth nothing whatever its rating says, and a standing one is the
   * applied gross less the ACTIVE therapist-borne portions, which is the whole
   * of the domain rule and is checkable by eye against CLAUDE.md.
   */
  async function reconciliation(): Promise<
    {
      charge: string;
      settled: bigint;
      current: bigint;
      clinicSettled: bigint;
      clinicCurrent: bigint;
    }[]
  > {
    const rows = await harness.prisma.$queryRaw<
      {
        charge: string;
        settled: bigint;
        current: bigint;
        clinic_settled: bigint;
        clinic_current: bigint;
      }[]
    >`
      SELECT
        closed.session_charge_id AS charge,
        closed.settled,
        closed.clinic_settled,
        CASE WHEN c.voided_at IS NULL THEN ss.therapist_gross_toman - active.therapist_borne
             ELSE 0 END::bigint AS current,
        CASE WHEN c.voided_at IS NULL THEN ss.clinic_gross_toman - active.clinic_borne
             ELSE 0 END::bigint AS clinic_current
      FROM (
        SELECT
          session_charge_id,
          sum(therapist_net_toman)::bigint AS settled,
          sum(clinic_net_toman)::bigint AS clinic_settled
        FROM settlement_line
        GROUP BY session_charge_id
      ) closed
      JOIN session_charge c ON c.id = closed.session_charge_id
      JOIN session_settlement ss
        ON ss.session_charge_id = c.id AND ss.voided_at IS NULL
      JOIN LATERAL (
        SELECT
          coalesce(sum(a.therapist_discount_toman), 0)::bigint AS therapist_borne,
          coalesce(sum(a.clinic_discount_toman), 0)::bigint AS clinic_borne
        FROM charge_adjustment a
        WHERE a.session_charge_id = c.id AND a.voided_at IS NULL
      ) active ON TRUE
      ORDER BY closed.session_charge_id
    `;

    return rows.map((row) => ({
      charge: row.charge,
      settled: row.settled,
      current: row.current,
      clinicSettled: row.clinic_settled,
      clinicCurrent: row.clinic_current,
    }));
  }

  /** Asserts the invariant on both sides of the money, and that anything was checked at all. */
  async function expectReconciled(atLeast: number): Promise<void> {
    const rows = await reconciliation();

    expect(rows.length).toBeGreaterThanOrEqual(atLeast);

    for (const row of rows) {
      expect({ charge: row.charge, therapist: row.settled, clinic: row.clinicSettled }).toEqual({
        charge: row.charge,
        therapist: row.current,
        clinic: row.clinicCurrent,
      });
    }
  }

  /** No session ever holds two authoritative PRIMARY settlements. */
  async function expectSettledExactlyOnce(): Promise<void> {
    const doubled = await harness.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT count(*) AS total FROM (
        SELECT session_charge_id FROM settlement_line
        WHERE line_type = 'PRIMARY'
        GROUP BY session_charge_id HAVING count(*) > 1
      ) duplicated
    `;

    expect(Number(doubled[0]?.total ?? 0)).toBe(0);
  }

  /** Every closed PRIMARY still has a valid applied rating behind it. */
  async function expectNoOrphanedClosedLine(): Promise<void> {
    const orphans = await harness.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT count(*) AS total FROM (
        SELECT DISTINCT session_charge_id FROM settlement_line WHERE line_type = 'PRIMARY'
      ) settled
      WHERE NOT EXISTS (
        SELECT 1 FROM session_settlement ss
        WHERE ss.session_charge_id = settled.session_charge_id AND ss.voided_at IS NULL
      )
    `;

    expect(Number(orphans[0]?.total ?? 0)).toBe(0);
  }

  it('holds after every step of a three-period clinic full of later movement', async () => {
    const token = fixture.managerToken;

    // ---- Period one -------------------------------------------------------
    // Month one closes with one unrated exclusion. Three sessions are settled:
    // the ordinary one, the FREE one and the one that will be withdrawn.
    await close(MONTH_ONE);
    await expectReconciled(3);
    await expectSettledExactlyOnce();
    await expectNoOrphanedClosedLine();

    // ---- Movement against the closed period -------------------------------
    // A charge withdrawn after its period closed: the negative signed
    // correction case, and the one that most obviously must not rewrite the
    // closed line.
    await voidChargeOverHttp(harness, token, fixture.withdrawn.chargeId).expect(200);

    // The excluded session is rated at last, so it becomes a historical
    // carry-in rather than a correction.
    await shareRuleId(harness, token, fixture.therapistId, {
      shareBasisPoints: 4000,
      effectiveStart: '2019-01-01',
      effectiveEnd: '2019-12-31',
    });
    await rateOverHttp(harness, token, fixture.unrated.chargeId, {
      reason: 'قاعده سهم پس از بستن دوره وارد شد',
    }).expect(201);

    // A concession granted against a session month one already closed.
    await adjustOverHttp(harness, token, fixture.plain.chargeId, '50000').expect(200);

    // ---- Period two -------------------------------------------------------
    await close(MONTH_TWO);
    await expectReconciled(7);
    await expectSettledExactlyOnce();
    await expectNoOrphanedClosedLine();

    // ---- More movement, including against period two ----------------------
    // The concession is withdrawn again, which gives the share back.
    const granted = await harness.prisma.chargeAdjustment.findFirstOrThrow({
      where: { sessionChargeId: fixture.plain.chargeId },
    });
    await voidAdjustmentOverHttp(harness, token, fixture.plain.chargeId, granted.id).expect(200);

    // A therapist-borne concession granted against a session period two closed.
    await allocateOverHttp(harness, token, fixture.reRated.chargeId, '40000', '10000').expect(200);

    // The agreement is corrected and the rating re-resolved against it, which is
    // the only approved way an applied percentage ever changes. The standing
    // therapist-borne allocation has to go first — C4's rule, untouched here.
    const allocation = await harness.prisma.chargeAdjustment.findFirstOrThrow({
      where: { sessionChargeId: fixture.split.chargeId, voidedAt: null },
    });
    await voidAdjustmentOverHttp(harness, token, fixture.split.chargeId, allocation.id).expect(200);

    await voidShareRule(harness, token, fixture.ruleId).expect(200);
    await shareRuleId(harness, token, fixture.therapistId, {
      shareBasisPoints: 6000,
      effectiveStart: '2020-01-01',
      effectiveEnd: null,
    });

    const standing = (await ratingRowsFor(harness, fixture.split.chargeId)).find(
      (row) => row.voidedAt === null,
    );
    await correctRatingOverHttp(harness, token, {
      sessionSettlementId: standing?.id,
      sessionChargeId: fixture.split.chargeId,
      withdrawReason: 'درصد سهم اشتباه اعمال شده بود',
      replacement: { sessionChargeId: fixture.split.chargeId, reason: 'اعمال درصد اصلاح‌شده' },
    }).expect(200);

    // ---- Period three -----------------------------------------------------
    await close(MONTH_THREE);
    await expectReconciled(8);
    await expectSettledExactlyOnce();
    await expectNoOrphanedClosedLine();

    // ---- And a fourth close over an empty later range ---------------------
    // Nothing has moved since, so it must carry nothing and change nothing.
    const quiet = await closePeriodOverHttp(harness, token, {
      therapistId: fixture.therapistId,
      from: '2026-11-16',
      to: '2026-12-31',
    }).expect(200);

    expect(quiet.body.period.settledSessionCount).toBe(0);
    expect(quiet.body.period.carriedInCorrectionCount).toBe(0);
    expect(quiet.body.period.settledToman).toBe('0');

    await expectReconciled(8);
    await expectSettledExactlyOnce();
    await expectNoOrphanedClosedLine();
  });

  it('keeps every period total equal to the lines beneath it', async () => {
    await close(MONTH_ONE);
    await voidChargeOverHttp(harness, fixture.managerToken, fixture.withdrawn.chargeId).expect(200);
    await close(MONTH_TWO);
    await close(MONTH_THREE);

    // Read straight from the rows: a period whose stated total disagreed with
    // its own lines would be the one number nobody notices drifting, and the
    // CHECK constraint only ties the total to the three summary columns.
    const mismatched = await harness.prisma.$queryRaw<
      { id: string; stated: bigint; summed: bigint }[]
    >`
      SELECT p.id, p.settled_toman AS stated, coalesce(l.summed, 0)::bigint AS summed
      FROM settlement_period p
      LEFT JOIN LATERAL (
        SELECT sum(therapist_net_toman) AS summed
        FROM settlement_line WHERE settlement_period_id = p.id
      ) l ON TRUE
      WHERE p.settled_toman <> coalesce(l.summed, 0)
    `;

    expect(mismatched).toEqual([]);
  });

  it("keeps the two therapists' closed histories entirely separate", async () => {
    await close(MONTH_ONE);
    await close(MONTH_ONE, fixture.otherTherapistId);

    const crossed = await harness.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT count(*) AS total
      FROM settlement_line l
      JOIN settlement_period p ON p.id = l.settlement_period_id
      JOIN session_charge c ON c.id = l.session_charge_id
      WHERE l.therapist_id <> p.therapist_id OR c.therapist_id <> l.therapist_id
    `;

    expect(Number(crossed[0]?.total ?? 0)).toBe(0);
  });

  it('reports the same reconciliation on the statement as the rows carry', async () => {
    await close(MONTH_ONE);
    await voidChargeOverHttp(harness, fixture.managerToken, fixture.withdrawn.chargeId).expect(200);

    const response = await statementOverHttp(harness, fixture.managerToken, {
      therapistId: fixture.therapistId,
      from: '2026-01-01',
      to: '2027-12-31',
    });
    const statement = settlementStatementResponseSchema.parse(response.body);

    // What the whole history has been closed at, straight from the table.
    const closed = await harness.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT coalesce(sum(l.therapist_net_toman), 0)::bigint AS total
      FROM settlement_line l
      WHERE l.therapist_id = ${fixture.therapistId}::uuid
    `;

    expect(statement.totals.settledToman).toBe((closed[0]?.total ?? 0n).toString());
    expect(
      BigInt(statement.totals.earnedUnsettledToman) + BigInt(statement.totals.settledToman),
    ).toBe(BigInt(statement.totals.netSettlementToman));

    // No payout, payable, receivable, balance or amount owed appears anywhere in
    // the response, whatever has been closed.
    expect(JSON.stringify(statement)).not.toMatch(/payable|receivable|payout|owed|balance/i);
  });
});
