import {
  settlementStatementResponseSchema,
  type SettlementStatementResponse,
} from '@clinic/contracts';
import { signIn } from './appointments-support';
import { createHarness, resetDatabase, type Harness } from './harness';
import { adjustOverHttp, voidAdjustmentOverHttp, voidChargeOverHttp } from './ledger-support';
import { clinicDay, recordPaymentOverHttp } from './payment-support';
import {
  allocateOverHttp,
  ratingRowsFor,
  seedStatementClinic,
  shareRuleId,
  statementOverHttp,
  voidRatingOverHttp,
  voidShareRule,
  type StatementFixture,
} from './settlement-support';

/**
 * MILESTONE 8, CHECKPOINT C5 — the therapist settlement statement, end to end
 * over the real endpoint and against real PostgreSQL rows.
 *
 * WHAT THIS SUITE IS FOR. C3 froze what a session earned onto the session; C4
 * allocated a family concession between the two sides. Neither was ever READ in
 * bulk. This is the first read, and the risk it carries is not that a single
 * figure is wrong — it is that the DOCUMENT does not reconcile: that a session
 * appears twice, or in two exception categories, or that a total describes a
 * different snapshot from the lines above it, or that a percentage is quietly
 * re-resolved from today's configuration instead of read from the row that was
 * written when somebody decided it.
 *
 * THE FIXTURE IS ONE SYNTHETIC MONTH containing every fact the statement has to
 * tell apart (`seedStatementClinic`), and every number asserted below is
 * derivable by hand from a 250,000 charge at 40% or 50%. Nothing is seeded with
 * raw SQL; every state is one the application itself produced over HTTP.
 *
 * THE HIGHEST-VALUE ASSERTIONS ARE THE IDENTITIES, and they are checked against
 * the underlying `session_charge` and `charge_adjustment` rows read straight
 * from the database — not against a second copy of the service's arithmetic
 * living in a test helper, which would only prove the helper agrees with itself.
 */
describe('the therapist settlement statement (checkpoint C5)', () => {
  let harness: Harness;
  let fixture: StatementFixture;

  const WEEK_ONE = '2026-09-05';
  const WEEK_TWO = '2026-09-12';
  const WEEK_THREE = '2026-09-19';

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
    fixture = await seedStatementClinic(harness);
  });

  /** The whole month, as the manager who owns the fixture reads it. */
  async function statement(
    overrides: Record<string, string> = {},
    token = fixture.managerToken,
  ): Promise<SettlementStatementResponse> {
    const response = await statementOverHttp(harness, token, {
      therapistId: fixture.therapistId,
      from: WEEK_ONE,
      to: WEEK_THREE,
      ...overrides,
    });

    expect(response.status).toBe(200);

    // Parsed rather than merely inspected: the frozen response schema is strict,
    // so an extra key, a number where a canonical amount string belongs or a
    // negative therapist net fails here before any assertion below runs.
    return settlementStatementResponseSchema.parse(response.body);
  }

  // -------------------------------------------------------------------------
  // The document itself
  // -------------------------------------------------------------------------

  describe('the lines', () => {
    /**
     * THE WHOLE STATEMENT, STATED ONCE AND CHECKED FIELD BY FIELD.
     *
     * FIVE LINES OUT OF EIGHT SESSIONS, and each of the three absences is a
     * different fact asserted separately below: one session is unrated, one had
     * its charge withdrawn, and one belongs to another therapist.
     *
     * TWO DIFFERENT APPLIED PERCENTAGES APPEAR, from one therapist, in one
     * document. That is the milestone's central promise made visible: the 40%
     * agreement covered the first week and the 50% one covers the rest, and the
     * statement reads each session's own snapshot rather than one percentage
     * resolved today.
     */
    it('states every rated, still-valid session and what each side of it was worth', async () => {
      const { lines } = await statement();

      expect(lines.map((line) => line.sessionChargeId)).toEqual([
        fixture.plain.chargeId,
        fixture.free.chargeId,
        fixture.split.chargeId,
        fixture.restored.chargeId,
        fixture.subsidised.chargeId,
      ]);

      expect(lines[0]).toMatchObject({
        serviceDate: WEEK_ONE,
        appliedShareBasisPoints: 4000,
        ratedVia: 'AUTOMATIC',
        baseAmountToman: '250000',
        therapistGrossToman: '100000',
        therapistDiscountToman: '0',
        therapistNetToman: '100000',
        clinicGrossToman: '150000',
        clinicDiscountToman: '0',
        clinicNetToman: '150000',
      });

      // The FREE session: rated, and worth nothing to either side.
      expect(lines[1]).toMatchObject({
        serviceDate: WEEK_ONE,
        appliedShareBasisPoints: 4000,
        baseAmountToman: '0',
        therapistGrossToman: '0',
        therapistNetToman: '0',
        clinicGrossToman: '0',
        clinicNetToman: '0',
      });

      // The concession both sides bore part of: 60,000 off the family, 20,000 of
      // it out of the therapist's 125,000.
      expect(lines[2]).toMatchObject({
        serviceDate: WEEK_TWO,
        appliedShareBasisPoints: 5000,
        baseAmountToman: '250000',
        therapistGrossToman: '125000',
        therapistDiscountToman: '20000',
        therapistNetToman: '105000',
        clinicGrossToman: '125000',
        clinicDiscountToman: '40000',
        clinicNetToman: '85000',
      });

      // The concession that was granted and then withdrawn: both sides whole.
      expect(lines[3]).toMatchObject({
        serviceDate: WEEK_TWO,
        therapistDiscountToman: '0',
        therapistNetToman: '125000',
        clinicDiscountToman: '0',
        clinicNetToman: '125000',
      });

      // The clinic bearing 200,000 out of its own 125,000: a subsidy, reported
      // as the negative number it is rather than clamped to zero.
      expect(lines[4]).toMatchObject({
        serviceDate: WEEK_THREE,
        therapistDiscountToman: '0',
        therapistNetToman: '125000',
        clinicDiscountToman: '200000',
        clinicNetToman: '-75000',
      });
    });

    it('names the session by its date, its service and its charge, and no family or child', async () => {
      const { lines } = await statement();

      expect(lines[0]).toMatchObject({
        sessionChargeId: fixture.plain.chargeId,
        serviceId: fixture.paidServiceId,
        durationMinutes: 45,
      });
      expect(typeof lines[0]?.serviceName).toBe('string');

      // The frozen line carries no family, child, guardian or appointment key.
      // `strictObject` has already refused any extra above; this states the
      // intent rather than leaving it to the schema's silence.
      for (const key of ['familyId', 'childId', 'family', 'child', 'guardian']) {
        expect(lines[0]).not.toHaveProperty(key);
      }
    });

    /**
     * PRE-C6 HONESTY. No settlement period exists in this database, so no line
     * can be the carried-in delta of one that was closed.
     */
    it('carries no correction line and no closed-period fact, because neither exists yet', async () => {
      const response = await statement();

      expect(response.lines.every((line) => line.lineType === 'PRIMARY')).toBe(true);
      expect(response.lines.every((line) => line.correctsSessionSettlementId === null)).toBe(true);
      expect(response.totals.correctionCount).toBe(0);
      expect(response.totals.settledToman).toBe('0');
    });

    it('echoes the period it was run over and the day it is keyed on', async () => {
      const response = await statement();

      expect(response.range).toEqual({ from: WEEK_ONE, to: WEEK_THREE, dateBasis: 'SESSION_DATE' });
      expect(response.therapist.id).toBe(fixture.therapistId);
      expect(response.therapist.fullName.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // The totals, and the identities that make them a document rather than a list
  // -------------------------------------------------------------------------

  describe('the totals', () => {
    it('states the column sum of the lines it returned', async () => {
      const { totals } = await statement();

      expect(totals).toEqual({
        sessionCount: 5,
        correctionCount: 0,
        baseAmountToman: '1000000',
        therapistGrossToman: '475000',
        therapistDiscountToman: '20000',
        therapistNetToman: '455000',
        clinicGrossToman: '525000',
        clinicDiscountToman: '240000',
        clinicNetToman: '285000',
        earnedUnsettledToman: '455000',
        settledToman: '0',
        netSettlementToman: '455000',
      });
    });

    it('adds up to exactly what the lines add up to, in every column', async () => {
      const { lines, totals } = await statement();

      const column = (pick: (line: (typeof lines)[number]) => string): string =>
        lines.reduce((running, line) => running + BigInt(pick(line)), 0n).toString();

      expect(totals.baseAmountToman).toBe(column((line) => line.baseAmountToman));
      expect(totals.therapistGrossToman).toBe(column((line) => line.therapistGrossToman));
      expect(totals.therapistDiscountToman).toBe(column((line) => line.therapistDiscountToman));
      expect(totals.therapistNetToman).toBe(column((line) => line.therapistNetToman));
      expect(totals.clinicGrossToman).toBe(column((line) => line.clinicGrossToman));
      expect(totals.clinicDiscountToman).toBe(column((line) => line.clinicDiscountToman));
      expect(totals.clinicNetToman).toBe(column((line) => line.clinicNetToman));
      expect(totals.sessionCount).toBe(lines.length);
    });

    /**
     * THE RECONCILIATION THIS CHECKPOINT EXISTS FOR, CHECKED AGAINST THE STORED
     * ROWS RATHER THAN AGAINST A SECOND COPY OF THE SERVICE'S ARITHMETIC.
     *
     * For every included session, the two nets must sum to what the FAMILY is
     * actually charged — the posted amount less every concession still active
     * against it — and that figure is read here straight from `session_charge`
     * and `charge_adjustment`.
     */
    it('reconciles every line against the charge and concessions it was derived from', async () => {
      const { lines, totals } = await statement();

      let effectiveTotal = 0n;

      for (const line of lines) {
        const charge = await harness.prisma.sessionCharge.findFirstOrThrow({
          where: { id: line.sessionChargeId },
        });
        const active = await harness.prisma.chargeAdjustment.findMany({
          where: { sessionChargeId: line.sessionChargeId, voidedAt: null },
        });

        const conceded = active.reduce((running, row) => running + row.amountToman, 0n);
        const effective = charge.amountToman - conceded;
        effectiveTotal += effective;

        expect(line.baseAmountToman).toBe(charge.amountToman.toString());
        expect(BigInt(line.therapistNetToman) + BigInt(line.clinicNetToman)).toBe(effective);

        // The two gross shares are the split of the PRE-discount basis, and the
        // two borne portions are the whole of the family's concession.
        expect(BigInt(line.therapistGrossToman) + BigInt(line.clinicGrossToman)).toBe(
          charge.amountToman,
        );
        expect(BigInt(line.therapistDiscountToman) + BigInt(line.clinicDiscountToman)).toBe(
          conceded,
        );
      }

      expect(BigInt(totals.therapistNetToman) + BigInt(totals.clinicNetToman)).toBe(effectiveTotal);
    });

    it('never states a negative therapist net, and never hides a negative clinic net', async () => {
      const { lines, totals } = await statement();

      expect(lines.every((line) => BigInt(line.therapistNetToman) >= 0n)).toBe(true);
      expect(BigInt(totals.therapistNetToman) >= 0n).toBe(true);

      // The subsidy is visible on the line rather than clamped away, and it is
      // carried into the total rather than dropped out of it.
      expect(lines.some((line) => BigInt(line.clinicNetToman) < 0n)).toBe(true);
    });

    /**
     * The three accepted settlement names, and what they mean before anything
     * has ever been closed.
     */
    it('reports the whole range as earned and unsettled, because no period covers it', async () => {
      const { totals } = await statement();

      expect(totals.earnedUnsettledToman).toBe(totals.therapistNetToman);
      expect(totals.settledToman).toBe('0');
      expect(BigInt(totals.netSettlementToman)).toBe(
        BigInt(totals.earnedUnsettledToman) + BigInt(totals.settledToman),
      );
    });

    it('uses none of the payout vocabulary this milestone refuses', async () => {
      const { totals } = await statement();

      for (const banned of [
        'owedToman',
        'payableToman',
        'receivableToman',
        'dueToman',
        'balanceToman',
      ]) {
        expect(totals).not.toHaveProperty(banned);
      }
    });
  });

  // -------------------------------------------------------------------------
  // The snapshot, and what a later change to configuration may not do to it
  // -------------------------------------------------------------------------

  describe('the applied snapshot', () => {
    /**
     * THE SINGLE MOST IMPORTANT TEST IN THIS FILE. The 50% agreement is
     * withdrawn and replaced with a 60% one covering the very same dates, and
     * the statement for sessions already rated under it does not move by one
     * toman.
     */
    it('does not change when the share rule behind it is later corrected', async () => {
      const before = await statement();

      await voidShareRule(harness, fixture.managerToken, fixture.lateRuleId).expect(200);
      await shareRuleId(harness, fixture.managerToken, fixture.therapistId, {
        shareBasisPoints: 6000,
        effectiveStart: WEEK_TWO,
        effectiveEnd: null,
      });

      const after = await statement();

      expect(after).toEqual(before);
      expect(after.lines.map((line) => line.appliedShareBasisPoints)).toEqual([
        4000, 4000, 5000, 5000, 5000,
      ]);
    });

    it('reads each session at the percentage its own snapshot records', async () => {
      const { lines } = await statement();

      for (const line of lines) {
        const rating = await harness.prisma.sessionSettlement.findFirstOrThrow({
          where: { id: line.sessionSettlementId },
        });

        expect(line.appliedShareBasisPoints).toBe(rating.appliedShareBasisPoints);
        expect(line.therapistGrossToman).toBe(rating.therapistGrossToman.toString());
        expect(line.clinicGrossToman).toBe(rating.clinicGrossToman.toString());
        expect(line.baseAmountToman).toBe(rating.baseAmountToman.toString());
        expect(rating.voidedAt).toBeNull();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Withdrawal, on both sides
  // -------------------------------------------------------------------------

  describe('withdrawal', () => {
    it('drops a session whose charge was withdrawn, and leaves its rating exactly as written', async () => {
      const response = await statement();

      expect(response.lines.map((line) => line.sessionChargeId)).not.toContain(
        fixture.uncharged.chargeId,
      );

      // The rating is history, not a figure this statement reports, and voiding
      // the charge did not touch it.
      const ratings = await ratingRowsFor(harness, fixture.uncharged.chargeId);
      expect(ratings).toHaveLength(1);
      expect(ratings[0]?.voidedAt).toBeNull();
      expect(ratings[0]?.therapistGrossToman).toBe(125000n);
    });

    it('stops counting a concession the moment it is withdrawn', async () => {
      const before = await statement();
      const line = before.lines.find((one) => one.sessionChargeId === fixture.plain.chargeId);
      expect(line?.clinicNetToman).toBe('150000');

      await adjustOverHttp(harness, fixture.managerToken, fixture.plain.chargeId, '50000').expect(
        200,
      );

      const granted = await harness.prisma.chargeAdjustment.findFirstOrThrow({
        where: { sessionChargeId: fixture.plain.chargeId, voidedAt: null },
      });

      const during = await statement();
      expect(
        during.lines.find((one) => one.sessionChargeId === fixture.plain.chargeId)?.clinicNetToman,
      ).toBe('100000');

      await voidAdjustmentOverHttp(
        harness,
        fixture.managerToken,
        fixture.plain.chargeId,
        granted.id,
      ).expect(200);

      const after = await statement();
      expect(after).toEqual(before);
    });

    it('returns a session to the unrated count when its rating is withdrawn', async () => {
      const before = await statement();
      expect(before.exceptions.unratedSessionCount).toBe(1);

      const rating = (await ratingRowsFor(harness, fixture.plain.chargeId))[0];
      if (rating === undefined) throw new Error('the fixture rated this session');

      await voidRatingOverHttp(harness, fixture.managerToken, rating.id).expect(200);

      const after = await statement();

      expect(after.lines.map((line) => line.sessionChargeId)).not.toContain(fixture.plain.chargeId);
      expect(after.exceptions.unratedSessionCount).toBe(2);
      // Not folded into the money as a zero: the session left the statement, and
      // the therapist gross fell by exactly the share that was withdrawn.
      expect(BigInt(before.totals.therapistNetToman) - BigInt(after.totals.therapistNetToman)).toBe(
        100000n,
      );
    });
  });

  // -------------------------------------------------------------------------
  // The three exceptions, which are three different facts
  // -------------------------------------------------------------------------

  describe('the exceptions', () => {
    it('counts the unrated, the free and the uncharged separately and never sums them', async () => {
      const { exceptions } = await statement();

      expect(exceptions).toEqual({
        unratedSessionCount: 1,
        freeSessionCount: 1,
        unchargedCompletedSessionCount: 1,
      });
    });

    /**
     * A FREE SESSION IS A RATED FACT, and the count explains a line of zeroes
     * rather than replacing it. An unrated session is the opposite: no line at
     * all, because nobody has decided the share and a zero would be a decision.
     */
    it('keeps the free session on the statement and the unrated one off it', async () => {
      const { lines, exceptions } = await statement();

      expect(lines.map((line) => line.sessionChargeId)).toContain(fixture.free.chargeId);
      expect(lines.map((line) => line.sessionChargeId)).not.toContain(fixture.unrated.chargeId);

      expect(exceptions.freeSessionCount).toBe(1);
      expect(exceptions.unratedSessionCount).toBe(1);

      // The unrated session has a valid charge worth 250,000 and no standing
      // rating; nothing in the money above accounts for it.
      const charge = await harness.prisma.sessionCharge.findFirstOrThrow({
        where: { id: fixture.unrated.chargeId },
      });
      expect(charge.voidedAt).toBeNull();
      expect(charge.amountToman).toBe(250000n);
      expect(
        await harness.prisma.sessionSettlement.count({
          where: { sessionChargeId: fixture.unrated.chargeId, voidedAt: null },
        }),
      ).toBe(0);
    });

    it('counts a completed, attended session with no valid charge as its own kind of gap', async () => {
      const { exceptions } = await statement();

      expect(exceptions.unchargedCompletedSessionCount).toBe(1);

      // And it is not also counted as unrated: it has no charge to be unrated
      // against.
      expect(exceptions.unratedSessionCount).toBe(1);
    });

    it('moves a session out of the uncharged count when its charge is withdrawn and back when re-posted', async () => {
      const before = await statement();
      expect(before.exceptions.unchargedCompletedSessionCount).toBe(1);

      await voidChargeOverHttp(harness, fixture.managerToken, fixture.plain.chargeId).expect(200);

      const after = await statement();
      expect(after.exceptions.unchargedCompletedSessionCount).toBe(2);
      expect(after.lines.map((line) => line.sessionChargeId)).not.toContain(fixture.plain.chargeId);
    });
  });

  // -------------------------------------------------------------------------
  // Scope: one therapist, one range, and nothing about what a family paid
  // -------------------------------------------------------------------------

  describe('scope', () => {
    it('reports one therapist and never another', async () => {
      const mine = await statement();
      expect(mine.lines.map((line) => line.sessionChargeId)).not.toContain(
        fixture.otherTherapist.chargeId,
      );

      const theirs = await statement({ therapistId: fixture.otherTherapistId });

      expect(theirs.therapist.id).toBe(fixture.otherTherapistId);
      expect(theirs.lines).toHaveLength(1);
      expect(theirs.lines[0]).toMatchObject({
        sessionChargeId: fixture.otherTherapist.chargeId,
        appliedShareBasisPoints: 3000,
        therapistGrossToman: '75000',
        clinicGrossToman: '175000',
      });
    });

    it('narrows to the days it was asked for, on both ends inclusively', async () => {
      const week = await statement({ from: WEEK_TWO, to: WEEK_TWO });

      expect(week.lines.map((line) => line.sessionChargeId)).toEqual([
        fixture.split.chargeId,
        fixture.restored.chargeId,
      ]);
      expect(week.totals.sessionCount).toBe(2);
      expect(week.exceptions).toEqual({
        unratedSessionCount: 0,
        freeSessionCount: 0,
        unchargedCompletedSessionCount: 0,
      });
    });

    it('answers a range the therapist did nothing in with a successful empty statement', async () => {
      const quiet = await statement({ from: '2026-10-03', to: '2026-10-10' });

      expect(quiet.lines).toEqual([]);
      expect(quiet.totals.sessionCount).toBe(0);
      expect(quiet.totals.netSettlementToman).toBe('0');
      expect(quiet.exceptions).toEqual({
        unratedSessionCount: 0,
        freeSessionCount: 0,
        unchargedCompletedSessionCount: 0,
      });
    });

    /**
     * SETTLEMENT IS INDEPENDENT OF WHETHER OR WHEN THE FAMILY PAYS (CLAUDE.md).
     * A payment large enough to clear the family's whole account changes not one
     * figure here.
     */
    it('is unmoved by what the family paid', async () => {
      const before = await statement();

      await recordPaymentOverHttp(harness, fixture.managerToken, fixture.familyId, {
        amountToman: '1000000',
        method: 'CASH',
        receivedOn: await clinicDay(harness),
      }).expect(200);

      expect(await statement()).toEqual(before);
    });
  });

  // -------------------------------------------------------------------------
  // Authorisation, and what a read may not do
  // -------------------------------------------------------------------------

  describe('authority and side effects', () => {
    it('refuses the receptionist the whole response', async () => {
      const receptionist = await signIn(harness, 'RECEPTIONIST');

      const response = await statementOverHttp(harness, receptionist.token, {
        therapistId: fixture.therapistId,
        from: WEEK_ONE,
        to: WEEK_THREE,
      });

      expect(response.status).toBe(403);
      expect(response.body).not.toHaveProperty('lines');
      expect(response.body).not.toHaveProperty('totals');
      expect(JSON.stringify(response.body)).not.toContain('455000');
    });

    it('writes nothing: no financial row, no audit row, no rating', async () => {
      const snapshot = async () => ({
        charges: await harness.prisma.sessionCharge.findMany({ orderBy: { id: 'asc' } }),
        adjustments: await harness.prisma.chargeAdjustment.findMany({ orderBy: { id: 'asc' } }),
        ratings: await harness.prisma.sessionSettlement.findMany({ orderBy: { id: 'asc' } }),
        audit: await harness.prisma.auditLog.count(),
      });

      const before = await snapshot();

      await statement();
      await statement({ from: WEEK_TWO, to: WEEK_TWO });

      expect(await snapshot()).toEqual(before);
    });

    it('answers the same thing twice over unchanged facts', async () => {
      expect(await statement()).toEqual(await statement());
    });

    it('refuses a therapist nobody has recorded', async () => {
      const response = await statementOverHttp(harness, fixture.managerToken, {
        therapistId: '00000000-0000-7000-8000-000000000000',
        from: WEEK_ONE,
        to: WEEK_THREE,
      });

      expect(response.status).toBe(404);
      expect(response.body?.error?.code).toBe('THERAPIST_NOT_FOUND');
    });

    it('refuses an inverted range and an unknown filter', async () => {
      const inverted = await statementOverHttp(harness, fixture.managerToken, {
        therapistId: fixture.therapistId,
        from: WEEK_THREE,
        to: WEEK_ONE,
      });
      expect(inverted.status).toBe(400);

      const unknown = await statementOverHttp(harness, fixture.managerToken, {
        therapistId: fixture.therapistId,
        from: WEEK_ONE,
        to: WEEK_THREE,
        familyId: fixture.familyId,
      });
      expect(unknown.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // The allocation itself, read back
  // -------------------------------------------------------------------------

  describe('concession allocation', () => {
    it('reflects a therapist-borne portion exactly, on both sides of the line', async () => {
      await allocateOverHttp(
        harness,
        fixture.managerToken,
        fixture.plain.chargeId,
        '80000',
        '30000',
      ).expect(200);

      const { lines } = await statement();
      const line = lines.find((one) => one.sessionChargeId === fixture.plain.chargeId);

      expect(line).toMatchObject({
        therapistGrossToman: '100000',
        therapistDiscountToman: '30000',
        therapistNetToman: '70000',
        clinicGrossToman: '150000',
        clinicDiscountToman: '50000',
        clinicNetToman: '100000',
      });

      // 250,000 less an 80,000 concession, split 30,000 / 50,000.
      expect(BigInt(line!.therapistNetToman) + BigInt(line!.clinicNetToman)).toBe(170000n);
    });

    it('lets a therapist give up their whole share without ever going below zero', async () => {
      await allocateOverHttp(
        harness,
        fixture.managerToken,
        fixture.plain.chargeId,
        '100000',
        '100000',
      ).expect(200);

      const { lines } = await statement();
      const line = lines.find((one) => one.sessionChargeId === fixture.plain.chargeId);

      expect(line?.therapistNetToman).toBe('0');
      expect(line?.clinicNetToman).toBe('150000');
    });
  });
});
