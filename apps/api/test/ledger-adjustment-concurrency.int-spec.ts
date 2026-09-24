import { createHarness, resetDatabase, type Harness } from './harness';
import {
  adjustmentAuditRowsFor,
  adjustmentRowsFor,
  adjustOverHttp,
  seedPostedSession,
  voidAdjustmentOverHttp,
  voidChargeOverHttp,
  type PostedSession,
} from './ledger-support';

/**
 * What happens when two concessions against one charge arrive at the same moment.
 *
 * THE FAILURE THIS SUITE EXISTS TO EXCLUDE is a negative effective amount: two
 * adjustments that each fit on their own, submitted together, both reading a
 * stale active total and both being written. CLAUDE.md forbids the family's
 * effective session charge from ever being negative, and no correction afterwards
 * can un-tell a family they are owed money.
 *
 * ONE SERIALISATION POINT: the parent `session_charge` row, taken `FOR UPDATE`
 * before anything is decided — by the service, and again by
 * `enforce_charge_adjustment_bounds` inside the INSERT. Voiding the charge takes
 * the same row and nothing else, so an adjustment and a charge void cannot
 * interleave either. The application check is not a substitute for the trigger
 * and does not weaken it; both refuse the same request, and the test below cares
 * only that exactly one of the two survives.
 *
 * NOTHING IS SYNCHRONISED ON A TIMER, as in every other concurrency suite here.
 */
describe('charge adjustment concurrency (real PostgreSQL)', () => {
  let harness: Harness;
  let session: PostedSession;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    session = await seedPostedSession(harness);
  });

  const adjust = (amountToman: string, reason: string) =>
    adjustOverHttp(harness, session.managerToken, session.chargeId, amountToman, reason);

  const adjustments = () => adjustmentRowsFor(harness, session.chargeId);

  const activeTotal = async () =>
    (await adjustments())
      .filter((row) => row.voidedAt === null)
      .reduce((total, row) => total + row.amountToman, 0n);

  /** No race may be answered with an unexplained 500. */
  const noInternalErrors = (...responses: { status: number }[]): void => {
    for (const response of responses) expect(response.status).not.toBe(500);
  };

  it('lets exactly one of two concessions succeed when they jointly overflow the charge', async () => {
    // 150,000 + 150,000 against a charge of 250,000. Each fits alone; together
    // they would leave the family owed 50,000 toman.
    const [first, second] = await Promise.all([
      adjust('150000', 'تخفیف الف'),
      adjust('150000', 'تخفیف ب'),
    ]);

    noInternalErrors(first, second);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 422]);

    const refused = first.status === 422 ? first : second;
    expect(refused.body.error.code).toBe('ADJUSTMENT_EXCEEDS_CHARGE');

    // ONE row, ONE audit fact, and an effective amount that is never negative.
    const rows = await adjustments();
    expect(rows).toHaveLength(1);
    expect(await activeTotal()).toBe(150000n);

    const winner = first.status === 200 ? first : second;
    expect(winner.body.charge.effectiveAmountToman).toBe('100000');
    expect(
      await harness.prisma.auditLog.count({ where: { action: 'charge_adjustment.created' } }),
    ).toBe(1);
  }, 30000);

  it('admits both concessions when they fit together, and neither is lost', async () => {
    const [first, second] = await Promise.all([
      adjust('100000', 'تخفیف الف'),
      adjust('150000', 'تخفیف ب'),
    ]);

    noInternalErrors(first, second);
    expect([first.status, second.status]).toEqual([200, 200]);

    const rows = await adjustments();
    expect(rows).toHaveLength(2);
    expect(await activeTotal()).toBe(250000n);

    // Whichever committed second reports the whole picture; neither reports a
    // total that omits the other.
    const totals = [
      first.body.charge.activeAdjustmentTotalToman,
      second.body.charge.activeAdjustmentTotalToman,
    ];
    expect(totals).toContain('250000');
    expect(
      await harness.prisma.auditLog.count({ where: { action: 'charge_adjustment.created' } }),
    ).toBe(2);
  }, 30000);

  it('never adjusts a charge that is being voided at the same moment', async () => {
    const [adjusted, voided] = await Promise.all([
      adjust('50000', 'تخفیف همزمان'),
      voidChargeOverHttp(harness, session.managerToken, session.chargeId, 'اصلاح مالی'),
    ]);

    noInternalErrors(adjusted, voided);

    // The void is an update of a live row and always succeeds.
    expect(voided.status).toBe(200);
    // The adjustment either committed before the void was visible, or saw the
    // committed void and refused. Both are correct; a concession written against
    // an already-voided charge would not be.
    expect([200, 409]).toContain(adjusted.status);

    const rows = await adjustments();

    if (adjusted.status === 200) {
      expect(rows).toHaveLength(1);
      // Attached to a charge that is now void: history, with no current effect.
      expect(rows[0]?.voidedAt).toBeNull();
    } else {
      expect(adjusted.body.error.code).toBe('CHARGE_VOIDED');
      expect(rows).toHaveLength(0);
      expect(
        await harness.prisma.auditLog.count({ where: { action: 'charge_adjustment.created' } }),
      ).toBe(0);
    }
  }, 30000);

  it('lets exactly one of two simultaneous voids of one concession succeed', async () => {
    const created = await adjust('50000', 'تخفیف اولیه').expect(200);
    const adjustmentId = created.body.charge.adjustments[0].id as string;

    const [first, second] = await Promise.all([
      voidAdjustmentOverHttp(
        harness,
        session.managerToken,
        session.chargeId,
        adjustmentId,
        'دلیل الف',
      ),
      voidAdjustmentOverHttp(
        harness,
        session.managerToken,
        session.chargeId,
        adjustmentId,
        'دلیل ب',
      ),
    ]);

    noInternalErrors(first, second);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);

    const refused = first.status === 409 ? first : second;
    expect(refused.body.error.code).toBe('ADJUSTMENT_ALREADY_VOIDED');

    // ONE transition, ONE audit row, and the winner's reason stands.
    const rows = await adjustments();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.voidedAt).not.toBeNull();
    expect(['دلیل الف', 'دلیل ب']).toContain(rows[0]?.voidReason);
    expect(
      await adjustmentAuditRowsFor(harness, 'charge_adjustment.voided', adjustmentId),
    ).toHaveLength(1);

    // The concession's effect is fully restored, once.
    expect(await activeTotal()).toBe(0n);
  }, 30000);

  it('never lets a void of one concession make room for two that then overflow', async () => {
    const created = await adjust('200000', 'تخفیف بزرگ').expect(200);
    const adjustmentId = created.body.charge.adjustments[0].id as string;

    // Withdrawing 200,000 frees room for exactly one of these two.
    const [voided, a, b] = await Promise.all([
      voidAdjustmentOverHttp(harness, session.managerToken, session.chargeId, adjustmentId),
      adjust('150000', 'تخفیف الف'),
      adjust('150000', 'تخفیف ب'),
    ]);

    noInternalErrors(voided, a, b);
    expect(voided.status).toBe(200);

    // Whatever order the three landed in, the floor holds.
    const total = await activeTotal();
    expect(total).toBeLessThanOrEqual(250000n);
    expect([200, 422]).toContain(a.status);
    expect([200, 422]).toContain(b.status);
  }, 30000);
});
