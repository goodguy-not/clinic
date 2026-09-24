import request from 'supertest';
import { sessionChargeResponseSchema } from '@clinic/contracts';
import { asUser, signIn } from './appointments-support';
import { uuidv7 } from '../src/common/uuid';
import { createHarness, resetDatabase, type Harness } from './harness';
import {
  adjustmentAuditRowsFor,
  adjustmentRowsFor,
  adjustOverHttp,
  voidAdjustmentOverHttp,
  voidChargeOverHttp,
} from './ledger-support';
import {
  allocateOverHttp,
  correctRatingOverHttp,
  ratingRowsFor,
  rateOverHttp,
  seedChargedSession,
  shareRuleId,
  voidRatingOverHttp,
  voidShareRule,
  type SettlementFixture,
} from './settlement-support';

/**
 * MILESTONE 8, CHECKPOINT C4 — the therapist/clinic allocation of a family
 * concession, end to end over the real endpoints.
 *
 * WHAT CHANGED, AND THEREFORE WHAT THIS SUITE IS FOR. Through Milestone 5 every
 * concession was necessarily clinic-borne and the database refused any other
 * shape. C4 drops that pin and replaces it with two rules that CANNOT be
 * expressed as a CHECK, because both are about sums across rows:
 *
 *   1. a therapist portion may exist only where an AUTHORITATIVE APPLIED RATING
 *      exists — the snapshot C3 froze onto the session, never a percentage
 *      re-resolved today;
 *   2. the cumulative therapist-borne portions may never exceed that snapshot's
 *      gross share, because therapist net must never be negative (CLAUDE.md).
 *
 * THE FIXTURE, ONCE, SO EVERY NUMBER BELOW IS CHECKABLE BY HAND. A 250,000
 * charge rated at 4,000 basis points: therapist gross 100,000, clinic gross
 * 150,000. Every figure in this file is derived from those three.
 *
 * EVERYTHING IS SYNTHETIC AND EVERY STATE IS BUILT OVER HTTP by a manager
 * through the real endpoints, so no state under test is one the application
 * cannot itself produce. The raw-SQL question — what PostgreSQL refuses to a
 * writer that never went near the service — is asked in `ledger-schema` and, for
 * the one rule the service could otherwise be trusted with alone, at the end of
 * this file.
 */
describe('therapist-borne concessions (checkpoint C4)', () => {
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

  const allocate = (amountToman: string, therapistPortion: string, reason?: string) =>
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

  /** The therapist's net as this system defines it: the applied gross, less the active portions. */
  const therapistNet = async (): Promise<bigint> => {
    const applied = await rating();
    const allocated = (await adjustments())
      .filter((row) => row.voidedAt === null)
      .reduce((total, row) => total + row.therapistDiscountToman, 0n);

    return (applied?.therapistGrossToman ?? 0n) - allocated;
  };

  /** The clinic's net: its gross share, less every clinic-borne portion still active. */
  const clinicNet = async (): Promise<bigint> => {
    const applied = await rating();
    const borne = (await adjustments())
      .filter((row) => row.voidedAt === null)
      .reduce((total, row) => total + row.clinicDiscountToman, 0n);

    return (applied?.clinicGrossToman ?? 0n) - borne;
  };

  it('starts from the snapshot every number here is derived from', async () => {
    const applied = await rating();

    expect(applied?.baseAmountToman).toBe(250000n);
    expect(applied?.appliedShareBasisPoints).toBe(4000);
    expect(applied?.therapistGrossToman).toBe(100000n);
    expect(applied?.clinicGrossToman).toBe(150000n);
  });

  // -------------------------------------------------------------------------
  // Clinic-borne stays exactly what it was
  // -------------------------------------------------------------------------

  describe('the clinic-borne default', () => {
    /**
     * THE REGRESSION THAT MATTERS MOST IN THIS CHECKPOINT. Almost every
     * concession the clinic will ever grant omits the field, and CLAUDE.md
     * requires a therapist who does not participate in discounts to bear
     * nothing with the clinic taking all of it. If C4 changed anything about
     * that path, it changed the wrong thing.
     */
    it('records an omitted portion exactly as Milestone 5 did', async () => {
      const response = await adjustOverHttp(
        harness,
        fixture.managerToken,
        fixture.chargeId,
        '50000',
      );

      expect(response.status).toBe(200);
      const charge = sessionChargeResponseSchema.parse(response.body).charge;
      expect(charge.effectiveAmountToman).toBe('200000');

      const rows = await adjustments();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.amountToman).toBe(50000n);
      expect(rows[0]?.therapistDiscountToman).toBe(0n);
      expect(rows[0]?.clinicDiscountToman).toBe(50000n);

      // The whole cost fell on the clinic, and the therapist keeps their gross.
      expect(await therapistNet()).toBe(100000n);
      expect(await clinicNet()).toBe(100000n);
    });

    it('records an explicit zero identically, and consults no rating to do it', async () => {
      // The rating is withdrawn first, so a zero-portion concession is proved to
      // ask the settlement table nothing at all. This is the shape every
      // Milestone 5 and 6 row already in a live database has.
      const applied = await rating();
      await voidRatingOverHttp(harness, fixture.managerToken, applied?.id ?? '').expect(200);

      const response = await allocate('50000', '0', 'تخفیف تماماً کلینیک');

      expect(response.status).toBe(200);
      const rows = await adjustments();
      expect(rows[0]?.therapistDiscountToman).toBe(0n);
      expect(rows[0]?.clinicDiscountToman).toBe(50000n);
    });

    it('still refuses a caller that tries to state the clinic allocation', async () => {
      // The clinic half stays unsubmittable, which is what keeps a split that
      // does not add up unrepresentable rather than merely refused.
      const response = await request(harness.app.getHttpServer())
        .post(`/session-charges/${fixture.chargeId}/adjustments`)
        .set(asUser(fixture.managerToken))
        .send({ amountToman: '50000', reason: 'تخفیف', clinicDiscountToman: '50000' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(await adjustments()).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // A real split
  // -------------------------------------------------------------------------

  describe('an explicit therapist portion', () => {
    it('persists the submitted amount rather than discarding it', async () => {
      const response = await allocate('50000', '30000');

      expect(response.status).toBe(200);

      const rows = await adjustments();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.amountToman).toBe(50000n);
      expect(rows[0]?.therapistDiscountToman).toBe(30000n);

      // And it is carried back on the wire, not merely stored.
      const charge = sessionChargeResponseSchema.parse(response.body).charge;
      expect(charge.adjustments[0]?.therapistDiscountToman).toBe('30000');
      expect(charge.adjustments[0]?.clinicDiscountToman).toBe('20000');
    });

    it('makes the two portions sum to the concession exactly, across several', async () => {
      await allocate('50000', '30000', 'تخفیف الف').expect(200);
      await allocate('40000', '10000', 'تخفیف ب').expect(200);
      await adjustOverHttp(harness, fixture.managerToken, fixture.chargeId, '30000').expect(200);

      for (const row of await adjustments()) {
        expect(row.therapistDiscountToman + row.clinicDiscountToman).toBe(row.amountToman);
      }

      // 100,000 + 20,000 clinic-borne of the two splits, plus 30,000 wholly so.
      expect(await therapistNet()).toBe(60000n);
      expect(await clinicNet()).toBe(70000n);
    });

    it('leaves the family unaffected by WHO bears the concession', async () => {
      // The allocation is a settlement fact. The family owes the same 200,000
      // whether the clinic bore all of it or the therapist bore most of it.
      const shared = await allocate('50000', '40000');
      expect(sessionChargeResponseSchema.parse(shared.body).charge.effectiveAmountToman).toBe(
        '200000',
      );
    });

    it('does not move a single column of the applied snapshot', async () => {
      const before = await rating();

      await allocate('50000', '40000').expect(200);

      // C3's central promise, restated from the C4 side: the gross is the split
      // of the PRE-DISCOUNT charge, and the net is derived by reading.
      expect(await rating()).toEqual(before);
      expect(await therapistNet()).toBe(60000n);
    });
  });

  // -------------------------------------------------------------------------
  // The therapist-net floor
  // -------------------------------------------------------------------------

  describe('the therapist-net floor', () => {
    it('accepts a portion equal to the whole applied share, leaving net zero', async () => {
      // Zero is a legitimate net and is the boundary the floor protects, not a
      // value it refuses.
      await allocate('150000', '100000', 'درمانگر تمام سهم را می‌پذیرد').expect(200);

      expect(await therapistNet()).toBe(0n);
      expect(await clinicNet()).toBe(100000n);
    });

    it('refuses a single portion one toman past the applied share', async () => {
      const response = await allocate('150000', '100001');

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('ADJUSTMENT_SPLIT_INVALID');
      expect(await adjustments()).toHaveLength(0);
      expect(await therapistNet()).toBe(100000n);
    });

    it('is cumulative, so portions that each fit cannot jointly overdraw', async () => {
      await allocate('60000', '60000', 'تخفیف الف').expect(200);
      await allocate('35000', '35000', 'تخفیف ب').expect(200);

      // 60,000 + 35,000 = 95,000 of a 100,000 share. A third of 10,000 fits the
      // family ceiling comfortably and does not fit the therapist's.
      const response = await allocate('10000', '10000', 'تخفیف ج');

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('ADJUSTMENT_SPLIT_INVALID');
      expect(await therapistNet()).toBe(5000n);

      // 5,000 is exactly what is left, and it is accepted.
      await allocate('5000', '5000', 'تخفیف د').expect(200);
      expect(await therapistNet()).toBe(0n);
    });

    it('gives the allowance back when a portion is withdrawn, by reading and not by writing', async () => {
      const granted = await allocate('60000', '60000');
      const adjustmentId = sessionChargeResponseSchema.parse(granted.body).charge.adjustments[0]
        ?.id;

      const blocked = await allocate('60000', '60000', 'تخفیف دوم');
      expect(blocked.status).toBe(422);

      await voidAdjustmentOverHttp(
        harness,
        fixture.managerToken,
        fixture.chargeId,
        adjustmentId ?? '',
      ).expect(200);

      // The withdrawn row is still in the table, unedited, and contributes
      // nothing. Nothing was written to the settlement snapshot to restore the
      // share; the sum simply stopped counting a voided row.
      expect(await adjustments()).toHaveLength(1);
      expect(await therapistNet()).toBe(100000n);

      await allocate('60000', '60000', 'تخفیف دوم').expect(200);
      expect(await therapistNet()).toBe(40000n);
    });

    it('measures the floor against the applied snapshot, not against today’s rule', async () => {
      // The agreement is corrected downwards AFTER the session was rated. C3
      // guarantees the applied 4,000 basis points do not move, and C4 must
      // measure the allowance against that frozen figure rather than
      // re-resolving one — otherwise a configuration change would silently
      // widen or narrow what a therapist already agreed to bear.
      const rule = await harness.prisma.therapistShareRule.findFirstOrThrow({
        where: { therapistId: fixture.therapistId, voidedAt: null },
      });
      await voidShareRule(harness, fixture.managerToken, rule.id).expect(200);
      await shareRuleId(harness, fixture.managerToken, fixture.therapistId, {
        shareBasisPoints: 1000,
        effectiveStart: '2020-01-01',
      });

      expect((await rating())?.therapistGrossToman).toBe(100000n);

      // 100,000 is still the allowance. Under the NEW rule the share would be
      // 25,000 and this would be refused.
      await allocate('100000', '100000').expect(200);
      expect(await therapistNet()).toBe(0n);
    });
  });

  // -------------------------------------------------------------------------
  // What a portion may be borne against
  // -------------------------------------------------------------------------

  describe('the authoritative-rating requirement', () => {
    it('refuses a portion on a session nobody has rated', async () => {
      const unrated = await seedChargedSession(harness, { shareBasisPoints: null });

      const response = await allocateOverHttp(
        harness,
        unrated.managerToken,
        unrated.chargeId,
        '50000',
        '10000',
      );

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('ADJUSTMENT_SPLIT_INVALID');
      expect(await adjustmentRowsFor(harness, unrated.chargeId)).toHaveLength(0);
    });

    it('refuses a portion against a rating that has been withdrawn', async () => {
      const applied = await rating();
      await voidRatingOverHttp(harness, fixture.managerToken, applied?.id ?? '').expect(200);

      // The row is still in the table as history; `voided_at IS NULL` is the
      // whole of "authoritative", and history bears nothing.
      const response = await allocate('50000', '10000');

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('ADJUSTMENT_SPLIT_INVALID');
      expect(await adjustments()).toHaveLength(0);
    });

    it('accepts one again once the session is rated afresh', async () => {
      const applied = await rating();
      await voidRatingOverHttp(harness, fixture.managerToken, applied?.id ?? '').expect(200);
      await rateOverHttp(harness, fixture.managerToken, fixture.chargeId).expect(201);

      await allocate('50000', '10000').expect(200);
      expect(await therapistNet()).toBe(90000n);
    });

    it('gives a FREE session no therapist portion to bear, because its share is zero', async () => {
      const free = await seedChargedSession(harness, { priceMode: 'FREE', shareBasisPoints: 4000 });
      const applied = (await ratingRowsFor(harness, free.chargeId))[0];

      // Rated, and the applied share of nothing is nothing.
      expect(applied?.baseAmountToman).toBe(0n);
      expect(applied?.therapistGrossToman).toBe(0n);

      // The family-side ceiling refuses it first — any positive concession
      // exceeds a zero charge — and the therapist floor would refuse it next.
      // Both answers are correct and neither writes a row.
      const response = await allocateOverHttp(harness, free.managerToken, free.chargeId, '1', '1');

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('ADJUSTMENT_EXCEEDS_CHARGE');
      expect(await adjustmentRowsFor(harness, free.chargeId)).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // The floors that are NOT symmetrical
  // -------------------------------------------------------------------------

  describe('clinic net and the family floor', () => {
    it('lets clinic net go negative, and neither clamps nor hides it', async () => {
      // A wholly clinic-borne concession of 200,000 against a clinic gross of
      // 150,000. CLAUDE.md: a negative clinic net is an explicit subsidy and
      // must stay visible; only the THERAPIST net has a floor.
      await adjustOverHttp(harness, fixture.managerToken, fixture.chargeId, '200000').expect(200);

      expect(await clinicNet()).toBe(-50000n);
      expect(await therapistNet()).toBe(100000n);

      // Stored as submitted. No clamp, no compensating therapist portion
      // invented to make the arithmetic tidy.
      const rows = await adjustments();
      expect(rows[0]?.clinicDiscountToman).toBe(200000n);
      expect(rows[0]?.therapistDiscountToman).toBe(0n);
    });

    it('keeps the family effective-charge floor intact under an allocation', async () => {
      await allocate('200000', '50000', 'تخفیف الف').expect(200);

      // 200,000 + 100,000 exceeds the 250,000 charge. The therapist portion
      // fits comfortably; the FAMILY bound is what refuses this, and it is
      // reported as its own code.
      const response = await allocate('100000', '20000', 'تخفیف ب');

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('ADJUSTMENT_EXCEEDS_CHARGE');
      expect(await adjustments()).toHaveLength(1);
    });

    it('refuses a portion larger than the concession it is part of, in the schema', async () => {
      const response = await allocate('50000', '60000');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(await adjustments()).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Rating withdrawal and correction, now that allocations exist
  // -------------------------------------------------------------------------

  describe('a rating that bears an allocation', () => {
    let adjustmentId: string;

    beforeEach(async () => {
      const granted = await allocate('50000', '40000');
      adjustmentId =
        sessionChargeResponseSchema.parse(granted.body).charge.adjustments[0]?.id ?? '';
    });

    it('cannot be withdrawn while the allocation stands', async () => {
      const applied = await rating();

      const response = await voidRatingOverHttp(harness, fixture.managerToken, applied?.id ?? '');

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('RATING_HAS_THERAPIST_ALLOCATIONS');

      // Nothing moved, on either side.
      expect((await rating())?.voidedAt).toBeNull();
      expect(await therapistNet()).toBe(60000n);
    });

    it('cannot be corrected while the allocation stands either', async () => {
      // A correction withdraws and replaces in one act, so it is refused by the
      // same rule. Letting it through when the replacement happened to be large
      // enough would re-anchor a manager's reasoned allocation onto a
      // percentage they never saw — and the allocation row cannot be re-pointed
      // anyway, because it is immutable.
      const applied = await rating();

      const response = await correctRatingOverHttp(harness, fixture.managerToken, {
        sessionSettlementId: applied?.id,
        sessionChargeId: fixture.chargeId,
        withdrawReason: 'درصد اشتباه اعمال شده بود',
        replacement: { sessionChargeId: fixture.chargeId, reason: 'اعمال درصد اصلاح‌شده' },
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('RATING_HAS_THERAPIST_ALLOCATIONS');

      // Exactly one rating, still standing. No replacement was written and no
      // moment existed in which the session was unrated.
      const rows = await ratingRowsFor(harness, fixture.chargeId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.voidedAt).toBeNull();
    });

    it('becomes withdrawable again once the allocation is withdrawn', async () => {
      // The approved sequence, and it is three explicit reasoned acts rather
      // than one clever one.
      await voidAdjustmentOverHttp(
        harness,
        fixture.managerToken,
        fixture.chargeId,
        adjustmentId,
      ).expect(200);

      const applied = await rating();
      await voidRatingOverHttp(harness, fixture.managerToken, applied?.id ?? '').expect(200);

      expect((await ratingRowsFor(harness, fixture.chargeId))[0]?.voidedAt).not.toBeNull();
    });

    it('is unaffected by a concession that is wholly clinic-borne', async () => {
      // Only a THERAPIST-borne portion pins the rating. A clinic-borne
      // concession is not a settlement fact and blocks nothing.
      await voidAdjustmentOverHttp(
        harness,
        fixture.managerToken,
        fixture.chargeId,
        adjustmentId,
      ).expect(200);
      await adjustOverHttp(harness, fixture.managerToken, fixture.chargeId, '50000').expect(200);

      const applied = await rating();
      await voidRatingOverHttp(harness, fixture.managerToken, applied?.id ?? '').expect(200);
    });

    it('is not withdrawn by voiding the charge, and the allocation survives with it', async () => {
      // The C3 regression, under an allocation. A void is a later fact about the
      // charge; it does not travel backwards, and nothing here writes a
      // settlement decision nobody took.
      await voidChargeOverHttp(harness, fixture.managerToken, fixture.chargeId).expect(200);

      expect((await rating())?.voidedAt).toBeNull();
      const rows = await adjustments();
      expect(rows[0]?.voidedAt).toBeNull();
      expect(rows[0]?.therapistDiscountToman).toBe(40000n);
    });
  });

  // -------------------------------------------------------------------------
  // Authority and audit
  // -------------------------------------------------------------------------

  describe('authority and the financial trail', () => {
    it('refuses a receptionist with 403 and records nothing', async () => {
      const receptionist = await signIn(harness, 'RECEPTIONIST');

      const response = await allocateOverHttp(
        harness,
        receptionist.token,
        fixture.chargeId,
        '50000',
        '40000',
      );

      expect(response.status).toBe(403);
      expect(await adjustments()).toHaveLength(0);
      expect(
        await harness.prisma.auditLog.count({ where: { entityType: 'charge_adjustment' } }),
      ).toBe(0);
    });

    it('records the actual split as the financial fact, and no wider', async () => {
      const granted = await allocate('50000', '40000', 'درمانگر بخشی از تخفیف را می‌پذیرد');
      const adjustmentId =
        sessionChargeResponseSchema.parse(granted.body).charge.adjustments[0]?.id ?? '';

      const rows = await adjustmentAuditRowsFor(harness, 'charge_adjustment.created', adjustmentId);
      expect(rows).toHaveLength(1);

      const after = rows[0]?.after as Record<string, unknown>;
      expect(after.therapistDiscountToman).toBe('40000');
      expect(after.clinicDiscountToman).toBe('10000');
      expect(after.amountToman).toBe('50000');
      expect(after.reason).toBe('درمانگر بخشی از تخفیف را می‌پذیرد');

      // The trail explains the financial change and nothing else: no name, no
      // file number, no phone number reaches an append-only permanent store.
      expect(JSON.stringify(rows[0])).not.toMatch(/firstName|lastName|fileNumber|phone/);
    });

    it('leaves no audit history behind a refused allocation', async () => {
      // A request the system cannot honour must leave no trace suggesting it was
      // considered — the refusal happens before any row and any audit entry.
      const response = await allocate('150000', '100001');
      expect(response.status).toBe(422);

      expect(
        await harness.prisma.auditLog.count({ where: { entityType: 'charge_adjustment' } }),
      ).toBe(0);
    });

    it('carries both halves into the withdrawal trail too', async () => {
      const granted = await allocate('50000', '40000');
      const adjustmentId =
        sessionChargeResponseSchema.parse(granted.body).charge.adjustments[0]?.id ?? '';

      await voidAdjustmentOverHttp(
        harness,
        fixture.managerToken,
        fixture.chargeId,
        adjustmentId,
      ).expect(200);

      const rows = await adjustmentAuditRowsFor(harness, 'charge_adjustment.voided', adjustmentId);
      const metadata = rows[0]?.metadata as Record<string, unknown>;
      expect(metadata.therapistDiscountToman).toBe('40000');
      expect(metadata.clinicDiscountToman).toBe('10000');
    });
  });

  // -------------------------------------------------------------------------
  // The database is the authority, not the service
  // -------------------------------------------------------------------------

  describe('PostgreSQL refuses what the service refuses', () => {
    /**
     * THE SERVICE CHECK IS NOT A SUBSTITUTE FOR THE TRIGGER AND IS NOT A
     * WEAKENING OF IT. The statements below never touch `ChargeAdjustmentsService`
     * — they are what a repair script, a psql session or a future second caller
     * would issue — and each is refused by
     * `enforce_charge_adjustment_bounds`. The service exists so a manager is told
     * which rule refused them; this is what makes the rule true of every writer.
     */
    const insertRaw = (chargeId: string, amount: bigint, therapist: bigint, userId: string) =>
      harness.prisma.$executeRaw`
        INSERT INTO charge_adjustment (
          id, session_charge_id, amount_toman, therapist_discount_toman,
          clinic_discount_toman, reason, created_at, created_by_user_id
        ) VALUES (
          ${uuidv7()}::uuid, ${chargeId}::uuid, ${amount}::bigint, ${therapist}::bigint,
          ${amount - therapist}::bigint, 'درج مستقیم آزمایشی',
          transaction_timestamp(), ${userId}::uuid
        )
      `;

    it('refuses a portion past the applied share, whoever issues it', async () => {
      await expect(
        insertRaw(fixture.chargeId, 150000n, 100001n, fixture.managerId),
      ).rejects.toThrow(/charge_adjustment_therapist_net_floor/);

      expect(await adjustments()).toHaveLength(0);
    });

    it('refuses a portion on an unrated session, whoever issues it', async () => {
      const unrated = await seedChargedSession(harness, { shareBasisPoints: null });

      await expect(insertRaw(unrated.chargeId, 50000n, 10000n, unrated.managerId)).rejects.toThrow(
        /charge_adjustment_therapist_share_required/,
      );
    });

    it('refuses to withdraw a rating out from under an allocation, whoever issues it', async () => {
      await allocate('50000', '40000').expect(200);
      const applied = await rating();

      await expect(
        harness.prisma.$executeRaw`
          UPDATE session_settlement
             SET voided_at = transaction_timestamp(),
                 voided_by_user_id = ${fixture.managerId}::uuid,
                 void_reason = 'ابطال مستقیم آزمایشی'
           WHERE id = ${applied?.id ?? ''}::uuid
        `,
      ).rejects.toThrow(/session_settlement_has_therapist_allocations/);

      expect((await rating())?.voidedAt).toBeNull();
    });

    it('still permits a clinic-borne row of exactly the Milestone 5 shape', async () => {
      // WHY THIS IS HERE. Every `charge_adjustment` row written before this
      // checkpoint has `therapist_discount_toman = 0`, and C4 back-filled and
      // rewrote none of them. This is that historical shape, accepted with no
      // rating consulted — which is why no migration of existing rows was
      // needed and none was performed.
      const unrated = await seedChargedSession(harness, { shareBasisPoints: null });
      await insertRaw(unrated.chargeId, 50000n, 0n, unrated.managerId);

      const rows = await adjustmentRowsFor(harness, unrated.chargeId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.clinicDiscountToman).toBe(50000n);
    });
  });
});
