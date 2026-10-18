import { sessionChargeResponseSchema } from '@clinic/contracts';
import { createHarness, resetDatabase, type Harness } from './harness';
import { adjustmentRowsFor, adjustOverHttp, voidAdjustmentOverHttp } from './ledger-support';
import {
  allocateOverHttp,
  correctRatingOverHttp,
  ratingRowsFor,
  seedChargedSession,
  voidRatingOverHttp,
  type SettlementFixture,
} from './settlement-support';

/**
 * TWO THERAPIST-BORNE CONCESSIONS AT THE SAME MOMENT — the mirror image of
 * `ledger-adjustment-concurrency`, asked of the other side of the money.
 *
 * THE FAILURE THIS SUITE EXISTS TO EXCLUDE is a negative therapist net: two
 * portions that each fit against the applied share, submitted together, both
 * reading a stale allocated total of zero and both being written. CLAUDE.md
 * forbids a negative therapist net outright, and the person who discovers it is
 * whoever reconciles the month — long after the two managers have forgotten
 * either request.
 *
 * ONE SERIALISATION POINT, AND IT IS THE ONE THE LEDGER ALREADY USED: the parent
 * `session_charge` row, `FOR UPDATE`, taken by the service before anything is
 * decided and again by `enforce_charge_adjustment_bounds` inside the INSERT.
 * That single lock covers BOTH inequalities because every write that can move
 * either side of either one takes it first — a concession here, and every rating
 * write in `SessionRatingService`, which locks the charge before it touches
 * `session_settlement`. A second lock would have been a second lock order.
 *
 * NOTHING IS SYNCHRONISED ON A TIMER, as in every other concurrency suite here.
 *
 * THE FIXTURE: a 250,000 charge rated at 4,000 basis points, so the therapist
 * gross is 100,000 and the clinic's is 150,000.
 */
describe('therapist-borne concession concurrency (real PostgreSQL)', () => {
  let harness: Harness;
  let fixture: SettlementFixture;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    fixture = await seedChargedSession(harness, { shareBasisPoints: 4000 });
  });

  const allocate = (amountToman: string, therapistPortion: string, reason: string) =>
    allocateOverHttp(
      harness,
      fixture.managerToken,
      fixture.chargeId,
      amountToman,
      therapistPortion,
      reason,
    );

  const adjustments = () => adjustmentRowsFor(harness, fixture.chargeId);

  const rating = async () => (await ratingRowsFor(harness, fixture.chargeId))[0];

  const therapistNet = async (): Promise<bigint> => {
    const applied = await rating();
    const allocated = (await adjustments())
      .filter((row) => row.voidedAt === null)
      .reduce((total, row) => total + row.therapistDiscountToman, 0n);

    return (applied?.therapistGrossToman ?? 0n) - allocated;
  };

  /** No race may be answered with an unexplained 500. */
  const noInternalErrors = (...responses: { status: number }[]): void => {
    for (const response of responses) expect(response.status).not.toBe(500);
  };

  it('lets exactly one of two portions succeed when they jointly overdraw the share', async () => {
    // 60,000 + 60,000 against an applied share of 100,000. Each fits alone; the
    // family ceiling is nowhere near reached (120,000 of 250,000), so ONLY the
    // therapist floor can refuse either of them.
    const [first, second] = await Promise.all([
      allocate('60000', '60000', 'تخفیف الف'),
      allocate('60000', '60000', 'تخفیف ب'),
    ]);

    noInternalErrors(first, second);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 422]);

    const refused = first.status === 422 ? first : second;
    expect(refused.body.error.code).toBe('ADJUSTMENT_SPLIT_INVALID');

    // ONE row, ONE audit fact, and a therapist net that is never negative.
    expect(await adjustments()).toHaveLength(1);
    expect(await therapistNet()).toBe(40000n);
    expect(
      await harness.prisma.auditLog.count({ where: { action: 'charge_adjustment.created' } }),
    ).toBe(1);
  }, 30000);

  it('admits both portions when they fit together, and loses neither', async () => {
    const [first, second] = await Promise.all([
      allocate('60000', '60000', 'تخفیف الف'),
      allocate('40000', '40000', 'تخفیف ب'),
    ]);

    noInternalErrors(first, second);
    expect([first.status, second.status]).toEqual([200, 200]);

    const rows = await adjustments();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.therapistDiscountToman).sort()).toEqual([40000n, 60000n]);
    expect(await therapistNet()).toBe(0n);
  }, 30000);

  it('refuses the therapist portion on its own terms while a clinic-borne one commits beside it', async () => {
    // The two floors are independent and are decided under one lock. A wholly
    // clinic-borne concession of 150,000 and a therapist portion of 100,001
    // together fit the 250,000 charge; only the second is refused, and it is
    // refused for the therapist's reason rather than the family's.
    const [clinicBorne, overdrawn] = await Promise.all([
      adjustOverHttp(harness, fixture.managerToken, fixture.chargeId, '100000'),
      allocate('120000', '100001', 'سهم بیش از حد'),
    ]);

    noInternalErrors(clinicBorne, overdrawn);
    expect(clinicBorne.status).toBe(200);
    expect(overdrawn.status).toBe(422);
    expect(overdrawn.body.error.code).toBe('ADJUSTMENT_SPLIT_INVALID');

    expect(await therapistNet()).toBe(100000n);
  }, 30000);

  it('never lets a portion land against a rating being withdrawn at the same moment', async () => {
    // Both acts take the charge row first, so they serialise. Two outcomes are
    // correct and both are checked below: the withdrawal wins and the portion is
    // refused for want of an authoritative rating, or the portion wins and the
    // withdrawal is refused because an allocation now stands against it. What
    // must never happen is both succeeding, which would leave a deduction
    // apportioned to a share that no longer exists.
    const applied = await rating();

    const [allocated, withdrawn] = await Promise.all([
      allocate('50000', '40000', 'سهم درمانگر'),
      voidRatingOverHttp(harness, fixture.managerToken, applied?.id ?? ''),
    ]);

    noInternalErrors(allocated, withdrawn);
    expect([allocated.status, withdrawn.status].filter((status) => status === 200)).toHaveLength(1);

    const standing = await rating();
    if (allocated.status === 200) {
      expect(withdrawn.status).toBe(409);
      expect(withdrawn.body.error.code).toBe('RATING_HAS_THERAPIST_ALLOCATIONS');
      expect(standing?.voidedAt).toBeNull();
      expect(await therapistNet()).toBe(60000n);
    } else {
      expect(allocated.body.error.code).toBe('ADJUSTMENT_SPLIT_INVALID');
      expect(standing?.voidedAt).not.toBeNull();
      expect(await adjustments()).toHaveLength(0);
    }
  }, 30000);

  it('never lets a portion land against a rating being corrected at the same moment', async () => {
    const applied = await rating();

    const [allocated, corrected] = await Promise.all([
      allocate('50000', '40000', 'سهم درمانگر'),
      correctRatingOverHttp(harness, fixture.managerToken, {
        sessionSettlementId: applied?.id,
        sessionChargeId: fixture.chargeId,
        withdrawReason: 'درصد اشتباه اعمال شده بود',
        replacement: { sessionChargeId: fixture.chargeId, reason: 'اعمال درصد اصلاح‌شده' },
      }),
    ]);

    noInternalErrors(allocated, corrected);
    expect([allocated.status, corrected.status].filter((s) => s === 200 || s === 201)).toHaveLength(
      1,
    );

    // Exactly one rating stands either way, and the allocation never outlives
    // the share it was measured against.
    const standing = (await ratingRowsFor(harness, fixture.chargeId)).filter(
      (row) => row.voidedAt === null,
    );
    expect(standing).toHaveLength(1);

    if (allocated.status === 200) {
      expect(corrected.body.error.code).toBe('RATING_HAS_THERAPIST_ALLOCATIONS');
      expect(await therapistNet()).toBe(60000n);
    } else {
      expect(allocated.body.error.code).toBe('ADJUSTMENT_SPLIT_INVALID');
      expect(await adjustments()).toHaveLength(0);
    }
  }, 30000);

  it('does not let a withdrawal and a fresh allocation both consume the same allowance', async () => {
    // The allowance is exhausted, then one portion is withdrawn and two fresh
    // ones race for the 40,000 it released. Only one may have it.
    const first = await allocate('60000', '60000', 'تخفیف الف');
    await allocate('40000', '40000', 'تخفیف ب').expect(200);
    const firstId = sessionChargeResponseSchema.parse(first.body).charge.adjustments[0]?.id ?? '';

    await voidAdjustmentOverHttp(harness, fixture.managerToken, fixture.chargeId, firstId).expect(
      200,
    );

    const [a, b] = await Promise.all([
      allocate('60000', '60000', 'تخفیف ج'),
      allocate('60000', '60000', 'تخفیف د'),
    ]);

    noInternalErrors(a, b);
    expect([a.status, b.status].sort((x, y) => x - y)).toEqual([200, 422]);
    expect(await therapistNet()).toBe(0n);
  }, 30000);
});
