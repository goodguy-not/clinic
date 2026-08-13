import {
  BIGINT_MAX,
  CHARGE_POST_OUTCOMES,
  chargeAdjustmentSchema,
  chargePostResultSchema,
  createChargeAdjustmentRequestSchema,
  familyAccountQuerySchema,
  familyAccountResponseSchema,
  ledgerPageQuerySchema,
  LEDGER_PAGE_SIZE_DEFAULT,
  LEDGER_PAGE_SIZE_MAX,
  postSessionChargeRequestSchema,
  sessionChargeDetailSchema,
  sessionChargeSchema,
  TARIFF_MAX_PRICE_TOMAN,
  voidChargeAdjustmentRequestSchema,
  voidSessionChargeRequestSchema,
} from '@clinic/contracts';

/**
 * The Milestone 5 ledger contract surface, pinned before anything implements
 * it.
 *
 * Checkpoint A2 freezes these shapes so the web workstream can build against
 * them without guessing. What is asserted here is therefore not "the schema
 * parses" but the handful of properties the freeze is worth having: no
 * therapist portion is submittable, money stays a canonical decimal string, a
 * free session stays distinct from a waived one, and nothing that belongs to
 * payments or settlement has crept in.
 *
 * Every value below is synthetic.
 */

const UUID = '01923c9e-4c1a-7000-8000-000000000001';
const OTHER_UUID = '01923c9e-4c1a-7000-8000-000000000002';

const charge = {
  id: UUID,
  familyId: OTHER_UUID,
  childId: UUID,
  appointmentId: OTHER_UUID,
  appointmentParticipantId: UUID,
  serviceId: OTHER_UUID,
  therapistId: UUID,
  durationMinutes: 45,
  serviceDate: '2026-08-15',
  tariffId: OTHER_UUID,
  priceMode: 'PAID' as const,
  amountToman: '250000',
  createdAt: '2026-08-15T09:00:00.000Z',
  createdByUserId: UUID,
  voidedAt: null,
  voidedByUserId: null,
  voidReason: null,
};

const adjustment = {
  id: UUID,
  sessionChargeId: OTHER_UUID,
  amountToman: '250000',
  therapistDiscountToman: '0',
  clinicDiscountToman: '250000',
  reason: 'دلیل آزمایشی',
  createdAt: '2026-08-15T10:00:00.000Z',
  createdByUserId: UUID,
  voidedAt: null,
  voidedByUserId: null,
  voidReason: null,
};

const detail = {
  ...charge,
  adjustments: [],
  activeAdjustmentTotalToman: '0',
  effectiveAmountToman: '250000',
};

describe('ledger contracts', () => {
  describe('the adjustment request', () => {
    it('accepts an amount and a reason, and nothing else', () => {
      expect(
        createChargeAdjustmentRequestSchema.parse({ amountToman: '50000', reason: 'تخفیف' }),
      ).toEqual({ amountToman: '50000', reason: 'تخفیف' });
    });

    it('has no therapist portion, and refuses one', () => {
      // The rule this test exists for: every Milestone 5 discount is genuinely
      // clinic-borne (DECISION_LOG, 2026-08-14). A therapist can only be said to
      // bear part of a concession once Milestone 8 approves settlement, so the
      // request must not even have a place to say so.
      for (const field of [
        'therapistDiscountToman',
        'clinicDiscountToman',
        'therapistShareToman',
        'therapistSharePercent',
        'splitMode',
        'borneBy',
      ]) {
        expect(
          createChargeAdjustmentRequestSchema.safeParse({
            amountToman: '50000',
            reason: 'تخفیف',
            [field]: '10000',
          }).success,
        ).toBe(false);
      }

      expect(Object.keys(createChargeAdjustmentRequestSchema.shape).sort()).toEqual([
        'amountToman',
        'reason',
      ]);
    });

    it('requires a reason that is not blank', () => {
      expect(createChargeAdjustmentRequestSchema.safeParse({ amountToman: '50000' }).success).toBe(
        false,
      );
      expect(
        createChargeAdjustmentRequestSchema.safeParse({ amountToman: '50000', reason: '   ' })
          .success,
      ).toBe(false);
    });

    it('refuses an amount that reduces nothing or is not canonical', () => {
      for (const amount of ['0', '-5000', '5000.5', '۵۰۰۰', '05000', '5 000', '']) {
        expect(
          createChargeAdjustmentRequestSchema.safeParse({ amountToman: amount, reason: 'تخفیف' })
            .success,
        ).toBe(false);
      }
    });

    it('refuses an amount beyond the global ledger ceiling before it reaches the database', () => {
      // `charge_adjustment_amount_bounds_chk` caps every amount at
      // TARIFF_MAX_PRICE_TOMAN. A request carrying more is a mistyped run of
      // digits, and it must be an ordinary validation failure rather than a
      // CHECK violation surfacing as an internal error.
      expect(
        createChargeAdjustmentRequestSchema.safeParse({
          amountToman: TARIFF_MAX_PRICE_TOMAN,
          reason: 'تخفیف',
        }).success,
      ).toBe(true);

      for (const amount of [
        (BigInt(TARIFF_MAX_PRICE_TOMAN) + 1n).toString(),
        '900000000000',
        BIGINT_MAX,
      ]) {
        expect(
          createChargeAdjustmentRequestSchema.safeParse({ amountToman: amount, reason: 'تخفیف' })
            .success,
        ).toBe(false);
      }
    });

    it('still states no per-charge ceiling, because only the ledger knows the remainder', () => {
      // An amount inside the global bound is well formed; whether it exceeds
      // THIS charge's remainder is decided by the server under a lock on the
      // parent row and reported as ADJUSTMENT_EXCEEDS_CHARGE.
      expect(
        createChargeAdjustmentRequestSchema.safeParse({ amountToman: '999999999', reason: 'تخفیف' })
          .success,
      ).toBe(true);
    });

    it('takes only a reason to withdraw a concession', () => {
      expect(Object.keys(voidChargeAdjustmentRequestSchema.shape)).toEqual(['reason']);
      expect(voidChargeAdjustmentRequestSchema.safeParse({}).success).toBe(false);
    });
  });

  describe('money on the wire', () => {
    it('carries every amount as a canonical unsigned decimal string', () => {
      const parsed = sessionChargeSchema.parse(charge);

      expect(parsed.amountToman).toBe('250000');
      expect(typeof parsed.amountToman).toBe('string');
    });

    it('refuses a number, a bigint or a signed amount anywhere it appears', () => {
      expect(sessionChargeSchema.safeParse({ ...charge, amountToman: 250000 }).success).toBe(false);
      expect(
        sessionChargeSchema.safeParse({ ...charge, amountToman: 250000n as unknown as string })
          .success,
      ).toBe(false);
      expect(sessionChargeSchema.safeParse({ ...charge, amountToman: '-250000' }).success).toBe(
        false,
      );
      expect(
        sessionChargeDetailSchema.safeParse({ ...detail, effectiveAmountToman: '-1' }).success,
      ).toBe(false);
    });

    it('reports the split it does not accept, always clinic-borne in this milestone', () => {
      const parsed = chargeAdjustmentSchema.parse(adjustment);

      expect(parsed.therapistDiscountToman).toBe('0');
      expect(parsed.clinicDiscountToman).toBe(parsed.amountToman);
    });
  });

  describe('free and waived stay two different facts', () => {
    it('keeps a free charge at zero with no concession attached', () => {
      const free = {
        ...detail,
        priceMode: 'FREE' as const,
        amountToman: '0',
        effectiveAmountToman: '0',
      };

      expect(sessionChargeDetailSchema.safeParse(free).success).toBe(true);
      // A free session was never priced, so there is nothing to reduce.
      expect(
        sessionChargeDetailSchema.safeParse({ ...free, adjustments: [adjustment] }).success,
      ).toBe(false);
    });

    it('keeps a fully waived session a PAID charge that reaches zero', () => {
      const waived = sessionChargeDetailSchema.parse({
        ...detail,
        adjustments: [adjustment],
        activeAdjustmentTotalToman: '250000',
        effectiveAmountToman: '0',
      });

      expect(waived.priceMode).toBe('PAID');
      expect(waived.amountToman).toBe('250000');
      expect(waived.effectiveAmountToman).toBe('0');
    });

    it('keeps a voided concession visible on the charge it no longer reduces', () => {
      const restored = sessionChargeDetailSchema.parse({
        ...detail,
        adjustments: [
          {
            ...adjustment,
            voidedAt: '2026-08-16T08:00:00.000Z',
            voidedByUserId: UUID,
            voidReason: 'اشتباه',
          },
        ],
        activeAdjustmentTotalToman: '0',
        effectiveAmountToman: '250000',
      });

      expect(restored.adjustments).toHaveLength(1);
      expect(restored.effectiveAmountToman).toBe('250000');
    });

    it('keeps a voided charge representable in a read', () => {
      const voided = sessionChargeSchema.parse({
        ...charge,
        voidedAt: '2026-08-16T08:00:00.000Z',
        voidedByUserId: UUID,
        voidReason: 'ثبت اشتباه',
      });

      expect(voided.voidedAt).not.toBeNull();
    });
  });

  describe('posting a charge', () => {
    it('accepts an empty body and refuses a caller-supplied amount', () => {
      expect(postSessionChargeRequestSchema.parse({})).toEqual({});
      expect(postSessionChargeRequestSchema.safeParse({ amountToman: '1' }).success).toBe(false);
      expect(postSessionChargeRequestSchema.safeParse({ tariffId: UUID }).success).toBe(false);
    });

    it('distinguishes a first post from an idempotent retry', () => {
      expect(CHARGE_POST_OUTCOMES).toEqual(['POSTED', 'ALREADY_POSTED']);

      const posted = chargePostResultSchema.parse({ outcome: 'POSTED', charge: detail });
      const retried = chargePostResultSchema.parse({ outcome: 'ALREADY_POSTED', charge: detail });

      expect(posted.outcome).toBe('POSTED');
      expect(retried.charge.id).toBe(UUID);
    });

    it('has no success member for a refusal', () => {
      // Ineligibility and a missing tariff are error envelopes, not outcomes a
      // caller could mistake for a recorded charge.
      for (const outcome of ['NOT_ELIGIBLE', 'TARIFF_MISSING', 'SKIPPED', 'FAILED']) {
        expect(chargePostResultSchema.safeParse({ outcome, charge: detail }).success).toBe(false);
      }
    });

    it('takes only a reason to void a charge, and offers no way back', () => {
      expect(Object.keys(voidSessionChargeRequestSchema.shape)).toEqual(['reason']);
      expect(voidSessionChargeRequestSchema.safeParse({ reason: '' }).success).toBe(false);
    });
  });

  describe('the family account', () => {
    const view = {
      charge: detail,
      child: { id: UUID, firstName: 'کودک', lastName: 'آزمایشی', fileNumber: '10001' },
      service: { id: OTHER_UUID, name: 'خدمت آزمایشی' },
      therapist: { id: UUID, fullName: 'درمانگر آزمایشی' },
    };

    const response = {
      familyId: OTHER_UUID,
      totals: {
        chargedTotalToman: '250000',
        adjustmentTotalToman: '0',
        netChargedTotalToman: '250000',
        chargeCount: 1,
        voidedChargeCount: 0,
      },
      charges: [view],
      page: { page: 1, pageSize: LEDGER_PAGE_SIZE_DEFAULT, total: 1, hasMore: false },
    };

    it('identifies the child on every row', () => {
      const parsed = familyAccountResponseSchema.parse(response);

      expect(parsed.charges[0]?.charge.childId).toBe(UUID);
      expect(parsed.charges[0]?.child.id).toBe(UUID);
    });

    it('states no balance, credit or payment', () => {
      // Milestone 6 owns payments. A zero balance shown before payments exist is
      // the one number a reader would trust most, and it would be a claim the
      // ledger cannot support.
      for (const field of [
        'balanceToman',
        'creditToman',
        'paidTotalToman',
        'outstandingToman',
        'lastPaymentAt',
      ]) {
        expect(
          familyAccountResponseSchema.safeParse({
            ...response,
            totals: { ...response.totals, [field]: '0' },
          }).success,
        ).toBe(false);
      }

      expect(Object.keys(familyAccountResponseSchema.shape.totals.shape).sort()).toEqual([
        'adjustmentTotalToman',
        'chargeCount',
        'chargedTotalToman',
        'netChargedTotalToman',
        'voidedChargeCount',
      ]);
    });

    it('defaults the page and bounds its size', () => {
      expect(ledgerPageQuerySchema.parse({})).toEqual({
        page: 1,
        pageSize: LEDGER_PAGE_SIZE_DEFAULT,
      });
      expect(ledgerPageQuerySchema.parse({ page: '3', pageSize: '10' })).toEqual({
        page: 3,
        pageSize: 10,
      });
      expect(
        ledgerPageQuerySchema.safeParse({ pageSize: String(LEDGER_PAGE_SIZE_MAX + 1) }).success,
      ).toBe(false);
      expect(ledgerPageQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    });

    it('shows voided financial history by default', () => {
      // A voided charge is not owed, but it did happen. An account that dropped
      // it by default would disagree with the audit trail, and PROJECT_SPEC.md 7
      // lists voids among what the account shows.
      expect(familyAccountQuerySchema.parse({}).includeVoided).toBe(true);
      expect(familyAccountQuerySchema.parse({ includeVoided: 'true' }).includeVoided).toBe(true);
    });

    it('lets an operator hide it, and actually turns it off', () => {
      // The regression a coerced boolean would cause: `Boolean('false')` is
      // `true`, so the filter would be unusable in exactly the direction it
      // exists for.
      expect(familyAccountQuerySchema.parse({ includeVoided: 'false' }).includeVoided).toBe(false);
      expect(familyAccountQuerySchema.safeParse({ includeVoided: 'no' }).success).toBe(false);
    });

    it('marks a voided charge as voided wherever it appears', () => {
      const parsed = familyAccountResponseSchema.parse({
        ...response,
        totals: { ...response.totals, chargeCount: 0, voidedChargeCount: 1 },
        charges: [
          {
            ...view,
            charge: {
              ...detail,
              voidedAt: '2026-08-16T08:00:00.000Z',
              voidedByUserId: UUID,
              voidReason: 'ثبت اشتباه',
            },
          },
        ],
      });

      expect(parsed.charges[0]?.charge.voidedAt).not.toBeNull();
      expect(parsed.charges[0]?.charge.voidReason).not.toBeNull();
      // Shown, and counted in neither effective total.
      expect(parsed.totals.chargeCount).toBe(0);
      expect(parsed.totals.voidedChargeCount).toBe(1);
    });

    it('keeps the other filters and the paging', () => {
      expect(familyAccountQuerySchema.parse({ childId: UUID }).childId).toBe(UUID);
      expect(familyAccountQuerySchema.parse({ page: '2' }).page).toBe(2);
      expect(familyAccountQuerySchema.safeParse({ from: '15-08-2026' }).success).toBe(false);
    });
  });
});
