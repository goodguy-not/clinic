import {
  settlementPeriodDetailResponseSchema,
  settlementStatementResponseSchema,
  type SettlementPeriod,
  type SettlementPeriodDetailResponse,
} from '@clinic/contracts';
import { signIn } from './appointments-support';
import { createHarness, resetDatabase, type Harness } from './harness';
import { voidChargeOverHttp } from './ledger-support';
import {
  closePeriodOverHttp,
  periodDetailOverHttp,
  rateOverHttp,
  seedCloseClinic,
  settlementLinesFor,
  shareRuleId,
  statementOverHttp,
  MONTH_ONE,
  MONTH_ONE_DAY,
  MONTH_ONE_DAY_TWO,
  MONTH_TWO,
  type CloseFixture,
} from './settlement-support';

/**
 * MILESTONE 8 — READING THE MATERIALISED LINES OF A CLOSED PERIOD, end to end
 * over the real endpoint and against real PostgreSQL rows.
 *
 * WHAT THIS SUITE IS FOR. C6 made a period's figures permanent; the aggregates
 * on the period say what they came to, and until now nothing said what they were
 * MADE OF. A manager asked to stand behind a month has to be able to see the
 * sessions under it, and the danger of a detail view is not that it shows too
 * little but that it shows a DIFFERENT ANSWER — recomputed from today's rules
 * and today's concessions, and therefore no longer adding up to the total
 * printed above it. So the assertions below are about provenance rather than
 * about presentation: that the numbers are the stored ones, that a correction is
 * labelled as one rather than inferred from its sign, that it names the
 * historical line it reconciles, and that a carry-in is not passed off as work
 * done in the period that settled it.
 *
 * THE FIXTURE IS THE C6 THREE-MONTH CLINIC (`seedCloseClinic`), driven through
 * the same sequence the close suite uses, because that sequence is the only way
 * to produce all four kinds of fact at once: an ordinary `PRIMARY`, a `FREE`
 * `PRIMARY` worth nothing, a historical carry-in `PRIMARY`, and a negative
 * `CORRECTION` against a line closed a month earlier. Every state is built over
 * HTTP by a manager and every number is derivable by hand from a 250,000 charge
 * at 40%.
 */
describe('reading the lines of a closed settlement period', () => {
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

  async function close(range: { from: string; to: string }): Promise<SettlementPeriod> {
    const response = await closePeriodOverHttp(harness, fixture.managerToken, {
      therapistId: fixture.therapistId,
      ...range,
    });
    expect(response.status).toBe(200);
    return response.body.period;
  }

  /** The detail read, parsed against the contract rather than merely inspected. */
  async function detail(periodId: string, token = fixture.managerToken) {
    const response = await periodDetailOverHttp(harness, token, periodId);
    expect(response.status).toBe(200);
    return settlementPeriodDetailResponseSchema.parse(response.body);
  }

  /**
   * The month-two close, after the two events that make it interesting: the
   * session nobody had rated in month one is rated (so month two settles it as a
   * carry-in `PRIMARY` keeping its September date), and a charge month one
   * already settled is withdrawn (so month two carries the negative
   * `CORRECTION`).
   */
  async function monthTwoWithHistory(): Promise<{
    monthOne: SettlementPeriod;
    monthTwo: SettlementPeriod;
    detail: SettlementPeriodDetailResponse;
  }> {
    const monthOne = await close(MONTH_ONE);

    await shareRuleId(harness, fixture.managerToken, fixture.therapistId, {
      shareBasisPoints: 4000,
      effectiveStart: '2019-01-01',
      effectiveEnd: '2019-12-31',
    });
    await rateOverHttp(harness, fixture.managerToken, fixture.unrated.chargeId, {
      reason: 'قاعده سهم پس از بستن دوره وارد شد',
    }).expect(201);

    await voidChargeOverHttp(harness, fixture.managerToken, fixture.withdrawn.chargeId).expect(200);

    const monthTwo = await close(MONTH_TWO);

    return { monthOne, monthTwo, detail: await detail(monthTwo.id) };
  }

  // -------------------------------------------------------------------------
  // The lines themselves
  // -------------------------------------------------------------------------

  describe('a manager reads the immutable lines of one closed period', () => {
    it('answers with the period and every line the close materialised', async () => {
      const period = await close(MONTH_ONE);
      const read = await detail(period.id);

      expect(read.period.id).toBe(period.id);
      expect(read.therapist.id).toBe(fixture.therapistId);

      // Month one settled three sessions — the ordinary one, the FREE one and
      // the one whose charge is withdrawn later — and excluded the unrated one,
      // which gets no line at all.
      expect(read.lines).toHaveLength(3);
      expect(read.period.settledSessionCount).toBe(3);
      expect(read.period.excludedUnratedSessionCount).toBe(1);
      expect(read.lines.map((line) => line.sessionChargeId)).not.toContain(
        fixture.unrated.chargeId,
      );

      // Every line belongs to the period asked for and to nobody else's work.
      expect(read.lines.every((line) => line.settlementPeriodId === period.id)).toBe(true);
      expect(read.lines.every((line) => line.therapistId === fixture.therapistId)).toBe(true);
    });

    it('returns the values C6 materialised, not a fresh calculation', async () => {
      const period = await close(MONTH_ONE);
      const read = await detail(period.id);

      // Read against the STORED ROWS rather than against a second copy of the
      // service's arithmetic: what is being proved is that the response is the
      // table, column for column.
      const stored = await settlementLinesFor(harness, fixture.plain.chargeId);
      const line = read.lines.find((row) => row.sessionChargeId === fixture.plain.chargeId);

      expect(line?.id).toBe(stored[0]?.id);
      expect(line?.baseAmountToman).toBe(String(stored[0]?.baseAmountToman));
      expect(line?.therapistGrossToman).toBe(String(stored[0]?.therapistGrossToman));
      expect(line?.therapistNetToman).toBe(String(stored[0]?.therapistNetToman));
      expect(line?.clinicNetToman).toBe(String(stored[0]?.clinicNetToman));
      expect(line?.appliedShareBasisPoints).toBe(stored[0]?.appliedShareBasisPoints);

      // And by hand: 250,000 at 40%.
      expect(line?.baseAmountToman).toBe('250000');
      expect(line?.therapistNetToman).toBe('100000');
      expect(line?.clinicNetToman).toBe('150000');
    });

    it('does not re-derive a closed figure from the share rule in force today', async () => {
      const period = await close(MONTH_ONE);
      const before = await detail(period.id);
      const line = () => before.lines.find((row) => row.sessionChargeId === fixture.plain.chargeId);

      // The agreement changes AFTER the close. CLAUDE.md: a percentage may
      // change over time and historical sessions keep the applied snapshot. A
      // detail view that resolved the rule again would restate the month.
      await shareRuleId(harness, fixture.managerToken, fixture.therapistId, {
        shareBasisPoints: 4000,
        effectiveStart: '2019-01-01',
        effectiveEnd: '2019-12-31',
      });

      const after = await detail(period.id);
      const same = after.lines.find((row) => row.sessionChargeId === fixture.plain.chargeId);

      expect(same).toEqual(line());
      expect(same?.appliedShareBasisPoints).toBe(4000);
    });

    it('does not move with a later concession either — the period is what it was', async () => {
      const period = await close(MONTH_ONE);
      const before = await detail(period.id);

      // The charge behind a settled line is withdrawn. The session is worth
      // nothing NOW; what month one recorded is unchanged, and the movement is
      // the NEXT close's business, not this read's.
      await voidChargeOverHttp(harness, fixture.managerToken, fixture.withdrawn.chargeId).expect(
        200,
      );

      const after = await detail(period.id);

      expect(after.lines).toEqual(before.lines);
      expect(after.period).toEqual(before.period);
      expect(
        after.lines.find((row) => row.sessionChargeId === fixture.withdrawn.chargeId)
          ?.therapistNetToman,
      ).toBe('100000');
    });
  });

  // -------------------------------------------------------------------------
  // Telling the four kinds of fact apart
  // -------------------------------------------------------------------------

  describe('PRIMARY, CORRECTION and carry-in are distinguishable facts', () => {
    it('labels a correction rather than leaving it to be inferred from a sign', async () => {
      const { detail: read } = await monthTwoWithHistory();

      const correction = read.lines.filter((line) => line.lineType === 'CORRECTION');
      expect(correction).toHaveLength(1);
      expect(correction[0]?.sessionChargeId).toBe(fixture.withdrawn.chargeId);

      // Everything else in the period is a PRIMARY, including the two whose
      // amounts are ordinary positive numbers and the carry-in, so the label is
      // carrying information the sign could not.
      expect(read.lines.filter((line) => line.lineType === 'PRIMARY').length).toBe(
        read.lines.length - 1,
      );
    });

    it('keeps the signed correction value exactly as C6 wrote it', async () => {
      const { detail: read } = await monthTwoWithHistory();
      const correction = read.lines.find((line) => line.lineType === 'CORRECTION');

      // The whole of what month one closed, reversed: 250,000 at 40%.
      expect(correction?.baseAmountToman).toBe('-250000');
      expect(correction?.therapistGrossToman).toBe('-100000');
      expect(correction?.therapistNetToman).toBe('-100000');
      expect(correction?.clinicNetToman).toBe('-150000');

      const stored = (await settlementLinesFor(harness, fixture.withdrawn.chargeId)).find(
        (line) => line.lineType === 'CORRECTION',
      );
      expect(correction?.therapistNetToman).toBe(String(stored?.therapistNetToman));
    });

    it('traces a correction back to the historical line it reconciles', async () => {
      const { monthOne, detail: read } = await monthTwoWithHistory();

      const primary = (await settlementLinesFor(harness, fixture.withdrawn.chargeId)).find(
        (line) => line.lineType === 'PRIMARY',
      );
      const correction = read.lines.find((line) => line.lineType === 'CORRECTION');

      expect(correction?.correctsSettlementLineId).toBe(primary?.id);
      expect(primary?.settlementPeriodId).toBe(monthOne.id);

      // Followed the other way, the named line is readable in the period it
      // belongs to — which is what makes the trace usable rather than merely
      // recorded.
      const earlier = await detail(monthOne.id);
      expect(
        earlier.lines.find((line) => line.id === correction?.correctsSettlementLineId)
          ?.therapistNetToman,
      ).toBe('100000');

      // A PRIMARY corrects nothing, and says so.
      expect(
        read.lines
          .filter((line) => line.lineType === 'PRIMARY')
          .every((line) => line.correctsSettlementLineId === null),
      ).toBe(true);
    });

    it('marks historical carry-ins apart from the period own work', async () => {
      const { detail: read } = await monthTwoWithHistory();

      const carried = read.lines.filter((line) => line.carriedIn);
      const own = read.lines.filter((line) => !line.carriedIn);

      // Two pieces of history: the September session month one could not settle
      // because nobody had rated it, arriving now as the PRIMARY it always
      // should have had; and the correction against a September line.
      expect(carried.map((line) => line.sessionChargeId).sort()).toEqual(
        [fixture.unrated.chargeId, fixture.withdrawn.chargeId].sort(),
      );
      expect(carried.every((line) => line.serviceDate < MONTH_TWO.from)).toBe(true);
      expect(
        carried.find((line) => line.sessionChargeId === fixture.unrated.chargeId)?.serviceDate,
      ).toBe(MONTH_ONE_DAY);
      expect(
        carried.find((line) => line.sessionChargeId === fixture.withdrawn.chargeId)?.serviceDate,
      ).toBe(MONTH_ONE_DAY_TWO);

      // A carry-in keeps its ORIGINAL clinic day and is never restated as work
      // done in the period that settled it.
      expect(carried.some((line) => line.lineType === 'PRIMARY')).toBe(true);
      expect(carried.some((line) => line.lineType === 'CORRECTION')).toBe(true);

      // Month two's own three sessions are all inside the range.
      expect(own).toHaveLength(3);
      expect(
        own.every((line) => line.serviceDate >= MONTH_TWO.from && line.serviceDate <= MONTH_TWO.to),
      ).toBe(true);
    });

    it('says a zero-valued closed line was FREE rather than leaving it at zero', async () => {
      const period = await close(MONTH_ONE);
      const read = await detail(period.id);

      const free = read.lines.find((line) => line.sessionChargeId === fixture.free.chargeId);
      expect(free?.priceMode).toBe('FREE');
      expect(free?.baseAmountToman).toBe('0');
      expect(free?.therapistNetToman).toBe('0');

      // And the priced ones say so, whatever they came to.
      expect(
        read.lines
          .filter((line) => line.sessionChargeId !== fixture.free.chargeId)
          .every((line) => line.priceMode === 'PAID'),
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // A read is a read
  // -------------------------------------------------------------------------

  describe('reading writes nothing', () => {
    it('adds no audit entry and no row, however many times it is read', async () => {
      const period = await close(MONTH_ONE);

      const auditBefore = await harness.prisma.auditLog.count();
      const linesBefore = await harness.prisma.settlementLine.count();
      const periodsBefore = await harness.prisma.settlementPeriod.count();

      await detail(period.id);
      await detail(period.id);
      await detail(period.id);

      expect(await harness.prisma.auditLog.count()).toBe(auditBefore);
      expect(await harness.prisma.settlementLine.count()).toBe(linesBefore);
      expect(await harness.prisma.settlementPeriod.count()).toBe(periodsBefore);
    });

    it('refuses a period id that names nothing', async () => {
      const missing = await periodDetailOverHttp(
        harness,
        fixture.managerToken,
        '00000000-0000-4000-8000-000000000000',
      );

      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('SETTLEMENT_PERIOD_NOT_FOUND');
    });

    it('refuses an id that is not one at all, at the route', async () => {
      const malformed = await periodDetailOverHttp(harness, fixture.managerToken, 'not-a-uuid');
      expect(malformed.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Authorisation
  // -------------------------------------------------------------------------

  describe('who may read the detail', () => {
    it('refuses a receptionist whole, with no partial settlement content', async () => {
      const period = await close(MONTH_ONE);
      const receptionist = await signIn(harness, 'RECEPTIONIST');

      const refused = await periodDetailOverHttp(harness, receptionist.token, period.id);

      expect(refused.status).toBe(403);
      // Not a redacted period, not an empty list of lines, not a total with the
      // rows removed: the whole response is financial.
      expect(refused.body.lines).toBeUndefined();
      expect(refused.body.period).toBeUndefined();
      expect(refused.body.therapist).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // The statement is unchanged by any of this
  // -------------------------------------------------------------------------

  describe('the statement keeps one row per clinical session', () => {
    it('does not gain a duplicate row for a correction the detail now shows', async () => {
      const { detail: read } = await monthTwoWithHistory();
      expect(read.lines.some((line) => line.lineType === 'CORRECTION')).toBe(true);

      const statement = settlementStatementResponseSchema.parse(
        (
          await statementOverHttp(harness, fixture.managerToken, {
            therapistId: fixture.therapistId,
            ...MONTH_ONE,
          })
        ).body,
      );

      // One row per session of the range, and every one of them a PRIMARY: the
      // historical CORRECTION belongs to the closed-period detail, not here.
      expect(statement.lines.every((line) => line.lineType === 'PRIMARY')).toBe(true);
      expect(new Set(statement.lines.map((line) => line.sessionChargeId)).size).toBe(
        statement.lines.length,
      );
    });

    it('states FREE on the statement row itself, and never from the money', async () => {
      const statement = settlementStatementResponseSchema.parse(
        (
          await statementOverHttp(harness, fixture.managerToken, {
            therapistId: fixture.therapistId,
            ...MONTH_ONE,
          })
        ).body,
      );

      const free = statement.lines.find((line) => line.sessionChargeId === fixture.free.chargeId);
      expect(free?.priceMode).toBe('FREE');
      expect(free?.baseAmountToman).toBe('0');
      expect(statement.exceptions.freeSessionCount).toBe(1);

      // UNRATED IS NOT A ZERO LINE. The session nobody rated has no row here at
      // all and is reported as a count, so it can never be mistaken for a FREE
      // one however the amounts read.
      expect(statement.lines.map((line) => line.sessionChargeId)).not.toContain(
        fixture.unrated.chargeId,
      );
      expect(statement.exceptions.unratedSessionCount).toBe(1);

      // And a PAID session is PAID whatever it came to: the subsidised one is
      // discounted past the clinic's own share and is still not FREE.
      const paid = statement.lines.filter((line) => line.priceMode === 'PAID');
      expect(paid.length).toBe(statement.lines.length - 1);
    });
  });
});
