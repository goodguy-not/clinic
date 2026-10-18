import {
  closeSettlementPeriodResponseSchema,
  settlementPeriodListResponseSchema,
  settlementStatementResponseSchema,
  type SettlementPeriod,
  type SettlementStatementResponse,
} from '@clinic/contracts';
import { signIn } from './appointments-support';
import { createHarness, resetDatabase, type Harness } from './harness';
import { adjustOverHttp, voidAdjustmentOverHttp, voidChargeOverHttp } from './ledger-support';
import {
  closePeriodOverHttp,
  correctRatingOverHttp,
  listPeriodsOverHttp,
  periodAuditRows,
  rateOverHttp,
  ratingRowsFor,
  seedCloseClinic,
  settlementLinesFor,
  shareRuleId,
  statementOverHttp,
  voidRatingOverHttp,
  voidShareRule,
  MONTH_ONE,
  MONTH_ONE_DAY,
  MONTH_TWO,
  MONTH_THREE,
  type CloseFixture,
} from './settlement-support';

/**
 * MILESTONE 8, CHECKPOINT C6 — closing a settlement period, end to end over the
 * real endpoints and against real PostgreSQL rows.
 *
 * WHAT THIS SUITE IS FOR. C5 could be wrong about one number. C6 can be wrong
 * FOREVER: a close materialises figures that are never rewritten, so a session
 * settled twice, a session settled at zero because nobody had rated it, or a
 * later movement that quietly never surfaces is a permanent defect in somebody's
 * earnings history. The cases below are ordered by that risk.
 *
 * THE FIXTURE IS ONE SYNTHETIC THREE-MONTH CLINIC (`seedCloseClinic`) and every
 * number asserted is derivable by hand from a 250,000 charge at 40%. Nothing is
 * seeded with raw SQL; every state is one the application itself produced over
 * HTTP.
 *
 * THE HIGHEST-VALUE ASSERTION IS THE LAST ONE — the reconciliation invariant,
 * checked against the underlying charge, rating and adjustment rows read straight
 * from the database rather than against a second copy of the service's own
 * arithmetic living in a helper, which would only prove the helper agrees with
 * itself.
 */
describe('closing a settlement period (checkpoint C6)', () => {
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

  /** Close a range for the fixture's therapist, parsed against the frozen schema. */
  async function close(
    range: { from: string; to: string },
    overrides: { therapistId?: string; token?: string } = {},
  ): Promise<{ outcome: string; period: SettlementPeriod }> {
    const response = await closePeriodOverHttp(harness, overrides.token ?? fixture.managerToken, {
      therapistId: overrides.therapistId ?? fixture.therapistId,
      ...range,
    });

    expect(response.status).toBe(200);

    // Parsed rather than merely inspected: the frozen result schema is strict,
    // so an extra key, a number where a canonical amount string belongs or a
    // negative count fails here before any assertion below runs.
    return closeSettlementPeriodResponseSchema.parse(response.body);
  }

  async function statement(range: {
    from: string;
    to: string;
  }): Promise<SettlementStatementResponse> {
    const response = await statementOverHttp(harness, fixture.managerToken, {
      therapistId: fixture.therapistId,
      ...range,
    });

    expect(response.status).toBe(200);

    return settlementStatementResponseSchema.parse(response.body);
  }

  const linesOf = (periodId: string) =>
    harness.prisma.settlementLine.findMany({
      where: { settlementPeriodId: periodId },
      orderBy: [{ lineType: 'asc' }, { serviceDate: 'asc' }],
    });

  // -------------------------------------------------------------------------
  // The close itself
  // -------------------------------------------------------------------------

  describe('what a first close materialises', () => {
    /**
     * MONTH ONE, STATED ONCE AND CHECKED FIELD BY FIELD.
     *
     * FOUR SESSIONS IN THE RANGE AND THREE LINES. The `plain` session earns
     * 100,000 of its 250,000 at 40%; the `free` session is RATED and earns
     * nothing; the `withdrawn` session earns 100,000 and is still standing at
     * this point. The fourth is UNRATED and is the one absence, asserted
     * separately below.
     */
    it('settles every rated session in the range and states what the close made final', async () => {
      const { outcome, period } = await close(MONTH_ONE);

      expect(outcome).toBe('CLOSED');
      expect(period).toMatchObject({
        therapistId: fixture.therapistId,
        from: MONTH_ONE.from,
        to: MONTH_ONE.to,
        settledSessionCount: 3,
        carriedInCorrectionCount: 0,
        excludedUnratedSessionCount: 1,
        // 100,000 + 0 + 100,000, with no concession anywhere in month one.
        therapistGrossToman: '200000',
        therapistDiscountToman: '0',
        carriedInCorrectionToman: '0',
        settledToman: '200000',
      });
      expect(period.closedByUserId).toBe(fixture.managerId);

      const lines = await linesOf(period.id);
      expect(lines).toHaveLength(3);
      expect(lines.every((line) => line.lineType === 'PRIMARY')).toBe(true);
      expect(lines.every((line) => line.correctsSettlementLineId === null)).toBe(true);

      // The FREE session is a line worth nothing, not an omission: complimentary
      // work is work, and it IS settled.
      const free = lines.find((line) => line.sessionChargeId === fixture.free.chargeId);
      expect(free).toBeDefined();
      expect(free?.baseAmountToman).toBe(0n);
      expect(free?.therapistNetToman).toBe(0n);
    });

    it('copies the applied percentage onto the line rather than resolving one', async () => {
      const { period } = await close(MONTH_ONE);
      const lines = await linesOf(period.id);

      const plain = lines.find((line) => line.sessionChargeId === fixture.plain.chargeId);
      const rating = (await ratingRowsFor(harness, fixture.plain.chargeId))[0];

      expect(plain?.appliedShareBasisPoints).toBe(4000);
      expect(plain?.ratedVia).toBe('AUTOMATIC');
      // The line names the exact rating row it was materialised from, which is
      // what makes the closed figure traceable back to the decision behind it.
      expect(plain?.sessionSettlementId).toBe(rating?.id);
      expect(plain?.therapistGrossToman).toBe(100000n);
      expect(plain?.clinicGrossToman).toBe(150000n);
    });

    it('settles nobody else, however close their sessions are', async () => {
      const { period } = await close(MONTH_ONE);
      const lines = await linesOf(period.id);

      expect(lines.map((line) => line.therapistId)).not.toContain(fixture.otherTherapistId);
      expect(await settlementLinesFor(harness, fixture.otherTherapist.chargeId)).toHaveLength(0);
    });

    it('writes exactly one permanent audit fact, and it names the period', async () => {
      const { period } = await close(MONTH_ONE);
      const rows = await periodAuditRows(harness);

      expect(rows).toHaveLength(1);
      expect(rows[0]?.action).toBe('settlement_period.closed');
      expect(rows[0]?.entityId).toBe(period.id);
      expect(rows[0]?.actorUserId).toBe(fixture.managerId);

      // The fact in full — the range, the counts and the amounts — which is what
      // makes the trail usable for the corrections it exists to explain. And no
      // family, child or name anywhere in it.
      expect(rows[0]?.after).toMatchObject({
        from: MONTH_ONE.from,
        to: MONTH_ONE.to,
        settledSessionCount: 3,
        excludedUnratedSessionCount: 1,
        settledToman: '200000',
      });
      expect(JSON.stringify(rows[0]?.after)).not.toMatch(/child|family|guardian/i);

      // A line is not independently decided, so no audit row names one.
      expect(
        await harness.prisma.auditLog.count({ where: { entityType: 'settlement_line' } }),
      ).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Option A — unrated sessions at close
  // -------------------------------------------------------------------------

  describe('unrated sessions, which are excluded and counted and never zeroed', () => {
    it('succeeds with an unrated session in the range and records the count for ever', async () => {
      const { period } = await close(MONTH_ONE);

      expect(period.excludedUnratedSessionCount).toBe(1);
      // No line, not a zero line: a session nobody has rated is not a session
      // worth nothing, and the difference is a therapist's month.
      expect(await settlementLinesFor(harness, fixture.unrated.chargeId)).toHaveLength(0);
    });

    it('keeps that count unchanged after the session is rated afterwards', async () => {
      const { period } = await close(MONTH_ONE);

      await shareRuleId(harness, fixture.managerToken, fixture.therapistId, {
        shareBasisPoints: 4000,
        effectiveStart: '2019-01-01',
        effectiveEnd: '2019-12-31',
      });
      await rateOverHttp(harness, fixture.managerToken, fixture.unrated.chargeId, {
        reason: 'قاعده سهم پس از بستن دوره وارد شد',
      }).expect(201);

      const listed = settlementPeriodListResponseSchema.parse(
        (
          await listPeriodsOverHttp(harness, fixture.managerToken, {
            therapistId: fixture.therapistId,
          })
        ).body,
      );

      // The stored count says what the closed figure did NOT include. Recomputing
      // it would now answer zero, and a period that lost that number is a total
      // nobody could reconcile against the diary.
      const reread = listed.periods.find((row) => row.id === period.id);
      expect(reread?.excludedUnratedSessionCount).toBe(1);
      expect(reread?.settledToman).toBe('200000');
    });

    it('closes an empty range as a real close with everything at zero', async () => {
      const { outcome, period } = await close({ from: '2027-03-01', to: '2027-03-31' });

      expect(outcome).toBe('CLOSED');
      expect(period).toMatchObject({
        settledSessionCount: 0,
        carriedInCorrectionCount: 0,
        excludedUnratedSessionCount: 0,
        therapistGrossToman: '0',
        settledToman: '0',
      });

      // A range reviewed and found empty is a fact worth recording; refusing it
      // would leave a gap indistinguishable from a month nobody got round to.
      expect(await linesOf(period.id)).toHaveLength(0);
      expect(await periodAuditRows(harness)).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Historical carry-ins
  // -------------------------------------------------------------------------

  describe('a session excluded from one close and rated later', () => {
    /**
     * THE CARRY-IN, WHICH IS THE CASE OPTION A CREATES AND MUST THEN RESOLVE.
     *
     * The unrated session sits inside month one, which is closed. It is rated
     * afterwards, and the NEXT close picks it up as the `PRIMARY` it always
     * should have had — once, with its original clinic day, and without the
     * earlier period moving at all.
     */
    it('arrives exactly once in a later close, as a PRIMARY carrying its original date', async () => {
      const first = await close(MONTH_ONE);

      await shareRuleId(harness, fixture.managerToken, fixture.therapistId, {
        shareBasisPoints: 4000,
        effectiveStart: '2019-01-01',
        effectiveEnd: '2019-12-31',
      });
      await rateOverHttp(harness, fixture.managerToken, fixture.unrated.chargeId, {
        reason: 'قاعده سهم پس از بستن دوره وارد شد',
      }).expect(201);

      const second = await close(MONTH_TWO);

      const carriedIn = (await settlementLinesFor(harness, fixture.unrated.chargeId))[0];
      expect(carriedIn).toBeDefined();
      expect(carriedIn?.lineType).toBe('PRIMARY');
      expect(carriedIn?.settlementPeriodId).toBe(second.period.id);
      // ITS ORIGINAL SERVICE DATE, NOT THE PERIOD IT WAS SETTLED IN. A carry-in
      // is identifiable precisely because the two disagree, and it must never be
      // restated as work performed in the later month.
      expect(carriedIn?.serviceDate.toISOString().slice(0, 10)).toBe(MONTH_ONE_DAY);
      expect(carriedIn?.therapistNetToman).toBe(100000n);

      // It is a first settlement, so it counts as settled work rather than as a
      // carried-in correction.
      expect(second.period.settledSessionCount).toBe(4);
      expect(second.period.carriedInCorrectionCount).toBe(0);

      // And the earlier period did not move.
      const listed = settlementPeriodListResponseSchema.parse(
        (
          await listPeriodsOverHttp(harness, fixture.managerToken, {
            therapistId: fixture.therapistId,
          })
        ).body,
      );
      expect(listed.periods.find((row) => row.id === first.period.id)?.settledToman).toBe('200000');
    });

    it('settles it exactly once however many later periods are closed', async () => {
      await close(MONTH_ONE);
      await shareRuleId(harness, fixture.managerToken, fixture.therapistId, {
        shareBasisPoints: 4000,
        effectiveStart: '2019-01-01',
        effectiveEnd: '2019-12-31',
      });
      await rateOverHttp(harness, fixture.managerToken, fixture.unrated.chargeId, {
        reason: 'قاعده سهم پس از بستن دوره وارد شد',
      }).expect(201);

      await close(MONTH_TWO);
      const third = await close(MONTH_THREE);

      const lines = await settlementLinesFor(harness, fixture.unrated.chargeId);
      expect(lines).toHaveLength(1);
      expect(lines[0]?.lineType).toBe('PRIMARY');
      // The third close saw a session already carried by a PRIMARY whose value
      // has not moved, so it wrote nothing for it at all.
      expect(third.period.carriedInCorrectionCount).toBe(0);
    });

    it('leaves a session sitting in an unclosed gap exactly where it is', async () => {
      // Month two is never closed here, so the month-two sessions are in a GAP.
      await close(MONTH_ONE);
      await close(MONTH_THREE);

      // Gaps are permitted, and a close must not sweep work out of one into a
      // period the manager did not ask for.
      expect(await settlementLinesFor(harness, fixture.split.chargeId)).toHaveLength(0);
      expect(await settlementLinesFor(harness, fixture.subsidised.chargeId)).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Idempotence and overlap
  // -------------------------------------------------------------------------

  describe('repeating and overlapping a close', () => {
    it('answers ALREADY_CLOSED for the identical request, with no second period or audit row', async () => {
      const first = await close(MONTH_ONE);
      const again = await close(MONTH_ONE);

      expect(again.outcome).toBe('ALREADY_CLOSED');
      expect(again.period).toEqual(first.period);

      expect(await harness.prisma.settlementPeriod.count()).toBe(1);
      expect(await linesOf(first.period.id)).toHaveLength(3);
      // Nothing happened the second time, so nothing is recorded as having
      // happened.
      expect(await periodAuditRows(harness)).toHaveLength(1);
    });

    it('refuses a partially overlapping range whole rather than trimming it', async () => {
      await close(MONTH_ONE);

      const overlapping = await closePeriodOverHttp(harness, fixture.managerToken, {
        therapistId: fixture.therapistId,
        from: '2026-09-15',
        to: '2026-10-15',
      });

      expect(overlapping.status).toBe(409);
      expect(overlapping.body.error.code).toBe('SETTLEMENT_PERIOD_OVERLAP');

      // Nothing was trimmed to the free days and nothing was merged: the refusal
      // wrote no period, no line and no audit row.
      expect(await harness.prisma.settlementPeriod.count()).toBe(1);
      expect(await harness.prisma.settlementLine.count()).toBe(3);
      expect(await periodAuditRows(harness)).toHaveLength(1);
    });

    it('refuses a range that merely contains an existing one', async () => {
      await close(MONTH_ONE);

      const swallowing = await closePeriodOverHttp(harness, fixture.managerToken, {
        therapistId: fixture.therapistId,
        from: '2026-01-01',
        to: '2026-12-31',
      });

      expect(swallowing.status).toBe(409);
      expect(swallowing.body.error.code).toBe('SETTLEMENT_PERIOD_OVERLAP');
    });

    it('permits adjacent periods and permits gaps between them', async () => {
      await close(MONTH_ONE);
      await close(MONTH_TWO);
      await close({ from: '2026-12-01', to: '2026-12-31' });

      const listed = settlementPeriodListResponseSchema.parse(
        (
          await listPeriodsOverHttp(harness, fixture.managerToken, {
            therapistId: fixture.therapistId,
          })
        ).body,
      );

      // Newest first, and the November gap between the second and third is not
      // an error and is not filled in by anything.
      expect(listed.periods.map((row) => row.from)).toEqual([
        '2026-12-01',
        MONTH_TWO.from,
        MONTH_ONE.from,
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Corrections
  // -------------------------------------------------------------------------

  describe('what moves after a close, and what does not', () => {
    it('produces no correction from a later share-rule change', async () => {
      const first = await close(MONTH_ONE);

      // The agreement is corrected wholesale — voided and replaced at a
      // different percentage, covering the same days.
      await voidShareRule(harness, fixture.managerToken, fixture.ruleId).expect(200);
      await shareRuleId(harness, fixture.managerToken, fixture.therapistId, {
        shareBasisPoints: 9000,
        effectiveStart: '2020-01-01',
        effectiveEnd: null,
      });

      const second = await close(MONTH_TWO);

      // NOTHING MOVED. The applied percentage lives on each rating as a number
      // and is never re-resolved, so last month's earnings cannot be restated by
      // this month's agreement. This is the single failure the whole milestone
      // exists to make impossible.
      expect(second.period.carriedInCorrectionCount).toBe(0);
      expect(second.period.carriedInCorrectionToman).toBe('0');

      const monthOneLines = await linesOf(first.period.id);
      expect(monthOneLines.every((line) => line.appliedShareBasisPoints === 4000)).toBe(true);
    });

    it('carries a charge voided after close as a negative correction, mutating nothing', async () => {
      await close(MONTH_ONE);
      const primary = (await settlementLinesFor(harness, fixture.withdrawn.chargeId))[0];
      const ratingBefore = (await ratingRowsFor(harness, fixture.withdrawn.chargeId))[0];

      await voidChargeOverHttp(harness, fixture.managerToken, fixture.withdrawn.chargeId).expect(
        200,
      );

      const second = await close(MONTH_TWO);

      const lines = await settlementLinesFor(harness, fixture.withdrawn.chargeId);
      expect(lines).toHaveLength(2);

      const correction = lines.find((line) => line.lineType === 'CORRECTION');
      expect(correction?.settlementPeriodId).toBe(second.period.id);
      expect(correction?.correctsSettlementLineId).toBe(primary?.id);
      // The session is worth nothing now, so the movement is the whole of what
      // was closed, with the sign that says so.
      expect(correction?.therapistNetToman).toBe(-100000n);
      expect(correction?.baseAmountToman).toBe(-250000n);
      // Its ORIGINAL clinic day, so the correction stays traceable to the
      // session it reconciles rather than to the month it landed in.
      expect(correction?.serviceDate).toEqual(primary?.serviceDate);

      // NOTHING HISTORICAL WAS REWRITTEN. The old line and the rating are exactly
      // as they were written.
      const primaryNow = lines.find((line) => line.lineType === 'PRIMARY');
      expect(primaryNow).toEqual(primary);
      expect((await ratingRowsFor(harness, fixture.withdrawn.chargeId))[0]).toEqual(ratingBefore);

      // And month two carries the movement on its own record, separately from
      // its own work.
      expect(second.period.carriedInCorrectionCount).toBe(1);
      expect(second.period.carriedInCorrectionToman).toBe('-100000');
    });

    it('carries a concession granted after close, and its later withdrawal, as two movements', async () => {
      await close(MONTH_ONE);

      await adjustOverHttp(harness, fixture.managerToken, fixture.plain.chargeId, '50000').expect(
        200,
      );
      const second = await close(MONTH_TWO);

      // A clinic-borne concession moves the CLINIC net and leaves the therapist
      // untouched, which is exactly what a correction has to be able to say.
      const afterGrant = (await settlementLinesFor(harness, fixture.plain.chargeId)).find(
        (line) => line.settlementPeriodId === second.period.id,
      );
      expect(afterGrant?.lineType).toBe('CORRECTION');
      expect(afterGrant?.therapistNetToman).toBe(0n);
      expect(afterGrant?.clinicNetToman).toBe(-50000n);
      expect(second.period.carriedInCorrectionToman).toBe('0');

      const adjustment = await harness.prisma.chargeAdjustment.findFirstOrThrow({
        where: { sessionChargeId: fixture.plain.chargeId },
      });
      await voidAdjustmentOverHttp(
        harness,
        fixture.managerToken,
        fixture.plain.chargeId,
        adjustment.id,
      ).expect(200);

      const third = await close(MONTH_THREE);
      const afterVoid = (await settlementLinesFor(harness, fixture.plain.chargeId)).find(
        (line) => line.settlementPeriodId === third.period.id,
      );

      // Withdrawing it gives the share back by the read, so the third close
      // carries the movement the other way.
      expect(afterVoid?.clinicNetToman).toBe(50000n);
      expect(await settlementLinesFor(harness, fixture.plain.chargeId)).toHaveLength(3);
    });

    it('carries a rating corrected after close as the delta between the two percentages', async () => {
      await close(MONTH_TWO);

      const before = (await ratingRowsFor(harness, fixture.reRated.chargeId)).find(
        (row) => row.voidedAt === null,
      );

      // The agreement is corrected first — a share rule is the only source of
      // settlement policy, so a percentage cannot be typed onto one session.
      await voidShareRule(harness, fixture.managerToken, fixture.ruleId).expect(200);
      await shareRuleId(harness, fixture.managerToken, fixture.therapistId, {
        shareBasisPoints: 6000,
        effectiveStart: '2020-01-01',
        effectiveEnd: null,
      });

      await correctRatingOverHttp(harness, fixture.managerToken, {
        sessionSettlementId: before?.id,
        sessionChargeId: fixture.reRated.chargeId,
        withdrawReason: 'درصد سهم اشتباه اعمال شده بود',
        replacement: { sessionChargeId: fixture.reRated.chargeId, reason: 'اعمال درصد اصلاح‌شده' },
      }).expect(200);

      const third = await close(MONTH_THREE);

      const lines = await settlementLinesFor(harness, fixture.reRated.chargeId);
      const correction = lines.find((line) => line.lineType === 'CORRECTION');

      // 60% of 250,000 is 150,000; the closed PRIMARY carried 40%, or 100,000.
      expect(correction?.therapistNetToman).toBe(50000n);
      expect(correction?.appliedShareBasisPoints).toBe(6000);
      // The correction names the rating that STANDS NOW, and points back at the
      // PRIMARY built from the one that was withdrawn.
      const standing = (await ratingRowsFor(harness, fixture.reRated.chargeId)).find(
        (row) => row.voidedAt === null,
      );
      expect(correction?.sessionSettlementId).toBe(standing?.id);
      expect(correction?.correctsSettlementLineId).toBe(
        lines.find((line) => line.lineType === 'PRIMARY')?.id,
      );

      expect(third.period.carriedInCorrectionToman).toBe('50000');
    });

    it('writes no correction when a re-close finds nothing has moved', async () => {
      await close(MONTH_ONE);
      const second = await close(MONTH_TWO);
      const third = await close(MONTH_THREE);

      expect(second.period.carriedInCorrectionCount).toBe(0);
      expect(third.period.carriedInCorrectionCount).toBe(0);
      // Three months, three periods, and one line per settled session and no
      // more.
      expect(await harness.prisma.settlementLine.count({ where: { lineType: 'CORRECTION' } })).toBe(
        0,
      );
    });
  });

  // -------------------------------------------------------------------------
  // The closed-line rating integrity rule
  // -------------------------------------------------------------------------

  describe('a session carried by a closed PRIMARY keeps a valid rating at all times', () => {
    it('refuses a bare rating withdrawal after the session has been closed', async () => {
      await close(MONTH_ONE);

      const rating = (await ratingRowsFor(harness, fixture.plain.chargeId))[0];
      const refused = await voidRatingOverHttp(harness, fixture.managerToken, rating?.id ?? '');

      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('RATING_REPLACEMENT_REQUIRED');

      // The rating stands, untouched: the refusal wrote nothing.
      const after = (await ratingRowsFor(harness, fixture.plain.chargeId))[0];
      expect(after?.voidedAt).toBeNull();
      expect(
        await harness.prisma.auditLog.count({
          where: { entityType: 'session_settlement', action: 'session_settlement.voided' },
        }),
      ).toBe(0);
    });

    it('still permits a bare withdrawal on a session no closed period carries', async () => {
      // The rule is about closed history, not about ratings in general. Month two
      // is not closed here.
      const rating = (await ratingRowsFor(harness, fixture.split.chargeId))[0];

      // The therapist-borne allocation has to go first — that is C4's rule and it
      // is untouched by this checkpoint.
      const allocation = await harness.prisma.chargeAdjustment.findFirstOrThrow({
        where: { sessionChargeId: fixture.split.chargeId },
      });
      await voidAdjustmentOverHttp(
        harness,
        fixture.managerToken,
        fixture.split.chargeId,
        allocation.id,
      ).expect(200);

      await voidRatingOverHttp(harness, fixture.managerToken, rating?.id ?? '').expect(200);
    });

    it('permits the atomic correction, which never leaves the session unrated', async () => {
      await close(MONTH_ONE);

      const rating = (await ratingRowsFor(harness, fixture.plain.chargeId))[0];

      const corrected = await correctRatingOverHttp(harness, fixture.managerToken, {
        sessionSettlementId: rating?.id,
        sessionChargeId: fixture.plain.chargeId,
        withdrawReason: 'اصلاح درصد اعمال‌شده',
        replacement: { sessionChargeId: fixture.plain.chargeId, reason: 'درصد اصلاح‌شده' },
      });

      expect(corrected.status).toBe(200);

      // Two ratings on the row now — one withdrawn, one standing — and at no
      // point visible to any other transaction was there none.
      const rows = await ratingRowsFor(harness, fixture.plain.chargeId);
      expect(rows).toHaveLength(2);
      expect(rows.filter((row) => row.voidedAt === null)).toHaveLength(1);
    });

    it('keeps C4 intact: a rating bearing a therapist-borne concession is still unwithdrawable', async () => {
      const rating = (await ratingRowsFor(harness, fixture.split.chargeId))[0];
      const refused = await voidRatingOverHttp(harness, fixture.managerToken, rating?.id ?? '');

      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('RATING_HAS_THERAPIST_ALLOCATIONS');
    });

    it('leaves no closed PRIMARY without a valid rating, however the history was built', async () => {
      await close(MONTH_ONE);
      await voidChargeOverHttp(harness, fixture.managerToken, fixture.withdrawn.chargeId).expect(
        200,
      );
      await close(MONTH_TWO);

      // THE INVARIANT, ASKED OF THE WHOLE DATABASE. Every charge carrying a
      // closed PRIMARY line has a standing rating — including the one whose
      // charge was withdrawn, because a charge void deliberately does not touch
      // the rating.
      const orphans = await harness.prisma.$queryRaw<{ total: bigint }[]>`
        SELECT count(*) AS total FROM (
          SELECT DISTINCT l.session_charge_id FROM settlement_line l
          WHERE l.line_type = 'PRIMARY'
        ) settled
        WHERE NOT EXISTS (
          SELECT 1 FROM session_settlement ss
          WHERE ss.session_charge_id = settled.session_charge_id AND ss.voided_at IS NULL
        )
      `;

      expect(Number(orphans[0]?.total ?? 0)).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Authorisation
  // -------------------------------------------------------------------------

  describe('who may close and who may read', () => {
    it('refuses a receptionist whole, on both routes', async () => {
      const receptionist = await signIn(harness, 'RECEPTIONIST');

      const attempted = await closePeriodOverHttp(harness, receptionist.token, {
        therapistId: fixture.therapistId,
        ...MONTH_ONE,
      });
      expect(attempted.status).toBe(403);
      // No partial financial response, no redacted period, no empty success:
      // this route is financial in its entirety.
      expect(attempted.body.period).toBeUndefined();

      const listed = await listPeriodsOverHttp(harness, receptionist.token, {
        therapistId: fixture.therapistId,
      });
      expect(listed.status).toBe(403);
      expect(listed.body.periods).toBeUndefined();

      // And the refusal materialised nothing.
      expect(await harness.prisma.settlementPeriod.count()).toBe(0);
      expect(await periodAuditRows(harness)).toHaveLength(0);
    });

    it('refuses a therapist id that names nobody, before writing anything', async () => {
      const missing = await closePeriodOverHttp(harness, fixture.managerToken, {
        therapistId: '00000000-0000-4000-8000-000000000000',
        ...MONTH_ONE,
      });

      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('THERAPIST_NOT_FOUND');
      expect(await harness.prisma.settlementPeriod.count()).toBe(0);
    });

    it('refuses an inverted range and an unknown field at the contract', async () => {
      const inverted = await closePeriodOverHttp(harness, fixture.managerToken, {
        therapistId: fixture.therapistId,
        from: MONTH_ONE.to,
        to: MONTH_ONE.from,
      });
      expect(inverted.status).toBe(400);

      const extra = await closePeriodOverHttp(harness, fixture.managerToken, {
        therapistId: fixture.therapistId,
        ...MONTH_ONE,
        // No amount is ever submittable: every figure on a period is the
        // server's own.
        settledToman: '1',
      } as never);
      expect(extra.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // The statement, after closes exist
  // -------------------------------------------------------------------------

  describe('the statement distinguishes earned, settled and pending', () => {
    it('reports everything as earned and unsettled before any close', async () => {
      const before = await statement(MONTH_ONE);

      expect(before.totals.settledToman).toBe('0');
      expect(before.totals.pendingCorrectionToman).toBe('0');
      expect(before.totals.earnedUnsettledToman).toBe(before.totals.therapistNetToman);
      expect(before.lines.every((line) => line.settledToman === '0')).toBe(true);
    });

    it('moves the same figures into settled once the period is closed', async () => {
      await close(MONTH_ONE);
      const after = await statement(MONTH_ONE);

      expect(after.totals.settledToman).toBe('200000');
      expect(after.totals.earnedUnsettledToman).toBe('0');
      expect(after.totals.pendingCorrectionToman).toBe('0');
      expect(after.totals.netSettlementToman).toBe('200000');
      expect(after.totals.correctionCount).toBe(0);

      // Per line, too: the settled figure is the session's own.
      const plain = after.lines.find((line) => line.sessionChargeId === fixture.plain.chargeId);
      expect(plain?.settledToman).toBe('100000');
      expect(plain?.therapistNetToman).toBe('100000');
    });

    it('shows a pending negative correction after a charge is voided, and clears it once carried', async () => {
      await close(MONTH_ONE);
      await voidChargeOverHttp(harness, fixture.managerToken, fixture.withdrawn.chargeId).expect(
        200,
      );

      const pending = await statement(MONTH_ONE);

      // The session is worth nothing now but a closed period still carries
      // 100,000 of it, so the line stays — with zeroes and a settled figure —
      // and the difference is the movement waiting to be carried.
      const line = pending.lines.find((row) => row.sessionChargeId === fixture.withdrawn.chargeId);
      expect(line?.therapistNetToman).toBe('0');
      expect(line?.settledToman).toBe('100000');

      expect(pending.totals.settledToman).toBe('200000');
      expect(pending.totals.pendingCorrectionToman).toBe('-100000');
      expect(pending.totals.earnedUnsettledToman).toBe('-100000');
      expect(pending.totals.netSettlementToman).toBe('100000');
      expect(pending.totals.correctionCount).toBe(1);

      await close(MONTH_TWO);
      const carried = await statement(MONTH_ONE);

      // Once the movement is carried into a later period, nothing is pending and
      // the settled figure is what the session is now worth.
      expect(carried.totals.settledToman).toBe('100000');
      expect(carried.totals.pendingCorrectionToman).toBe('0');
      expect(carried.totals.earnedUnsettledToman).toBe('0');
      expect(carried.totals.correctionCount).toBe(1);
    });

    it('keeps the three settlement figures adding up on every range it is asked about', async () => {
      await close(MONTH_ONE);
      await voidChargeOverHttp(harness, fixture.managerToken, fixture.withdrawn.chargeId).expect(
        200,
      );
      await close(MONTH_TWO);

      for (const range of [
        MONTH_ONE,
        MONTH_TWO,
        MONTH_THREE,
        { from: '2026-01-01', to: '2027-12-31' },
      ]) {
        const { totals } = await statement(range);

        expect(BigInt(totals.earnedUnsettledToman) + BigInt(totals.settledToman)).toBe(
          BigInt(totals.netSettlementToman),
        );
        expect(totals.netSettlementToman).toBe(totals.therapistNetToman);
      }
    });

    it('keeps a FREE session a rated line rather than an unrated exclusion', async () => {
      await close(MONTH_ONE);
      const { lines, exceptions } = await statement(MONTH_ONE);

      const free = lines.find((line) => line.sessionChargeId === fixture.free.chargeId);
      expect(free?.therapistNetToman).toBe('0');
      expect(free?.settledToman).toBe('0');
      expect(exceptions.freeSessionCount).toBe(1);
      // The unrated session is the other kind of absence entirely, and is still
      // reported as one.
      expect(exceptions.unratedSessionCount).toBe(1);
    });
  });
});
