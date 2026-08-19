import {
  BIGINT_MAX,
  closeSettlementPeriodRequestSchema,
  closeSettlementPeriodResultSchema,
  correctSessionRatingRequestSchema,
  RATED_VIA,
  rateSessionRequestSchema,
  SETTLEMENT_CLOSE_OUTCOMES,
  SETTLEMENT_LINE_TYPES,
  SHARE_BASIS_POINTS_MAX,
  SHARE_ROUNDING,
  sessionSettlementSchema,
  settlementPeriodSchema,
  settlementStatementExceptionsSchema,
  settlementStatementLineSchema,
  settlementStatementQuerySchema,
  settlementStatementResponseSchema,
  settlementStatementTotalsSchema,
  shareBasisPointsSchema,
  shareRuleSchema,
  signedTomanAmountSchema,
  tomanAmountSchema,
  voidSessionRatingRequestSchema,
} from '@clinic/contracts';

/**
 * The Milestone 8 settlement contract surface, pinned before anything
 * implements it.
 *
 * Checkpoint C1 freezes these shapes and this vocabulary so the backend and the
 * web workstream can proceed independently without either re-deriving a
 * financial rule. What is asserted here is therefore not "the schema parses"
 * but the properties the freeze is worth having: canonical signed money with no
 * negative zero, basis points that cannot be fractional, the half-up/residual
 * split rule stated as arithmetic rather than as prose, unrated as an absence
 * rather than a zero, a close that survives unrated sessions, an atomic
 * correction, and a naming discipline with no payout semantics anywhere in it.
 *
 * NOTHING HERE EXERCISES BEHAVIOUR, because there is none yet: no table, no
 * migration, no service, no controller. Every value below is synthetic.
 */

const UUID = '01923c9e-4c1a-7000-8000-000000000001';
const OTHER_UUID = '01923c9e-4c1a-7000-8000-000000000002';
const THIRD_UUID = '01923c9e-4c1a-7000-8000-000000000003';

describe('settlement money', () => {
  describe('the signed toman amount', () => {
    it('accepts a positive, a negative and a zero amount', () => {
      for (const value of ['0', '1', '250000', '-1', '-250000']) {
        expect(signedTomanAmountSchema.safeParse(value).success).toBe(true);
      }
    });

    it('refuses a negative zero, because zero has exactly one spelling', () => {
      // The rule this schema exists for. `-0` is the same amount written a
      // second way, it compares unequal as a string, and it is what a naive
      // `String(-0)` in a formatter produces.
      expect(signedTomanAmountSchema.safeParse('-0').success).toBe(false);
      expect(signedTomanAmountSchema.parse('0')).toBe('0');
    });

    it('refuses every non-canonical spelling', () => {
      for (const value of [
        '',
        '+5000',
        '5000.5',
        '-5000.5',
        '05000',
        '-05000',
        '5 000',
        '۵۰۰۰',
        '-۵۰۰۰',
        '5,000',
        '1e5',
        '--5000',
        '- 5000',
        '5000-',
        'NaN',
        '-Infinity',
      ]) {
        expect(signedTomanAmountSchema.safeParse(value).success).toBe(false);
      }
    });

    it('refuses a magnitude PostgreSQL could not store, in both directions', () => {
      expect(signedTomanAmountSchema.safeParse(BIGINT_MAX).success).toBe(true);
      expect(signedTomanAmountSchema.safeParse(`-${BIGINT_MAX}`).success).toBe(true);
      expect(signedTomanAmountSchema.safeParse(`${BIGINT_MAX}0`).success).toBe(false);
      expect(signedTomanAmountSchema.safeParse(`-${BIGINT_MAX}0`).success).toBe(false);
      expect(signedTomanAmountSchema.safeParse('9223372036854775808').success).toBe(false);
    });

    it('is a string type and never a JS number', () => {
      // A `number` reaches `-0`, `NaN` and silent precision loss above 2^53, and
      // none of the three is reachable from this.
      for (const value of [0, -0, 250000, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(signedTomanAmountSchema.safeParse(value).success).toBe(false);
      }
    });

    it('leaves the unsigned amount exactly as it was', () => {
      // Widening the existing type would have deleted a rule: nothing
      // family-facing goes below zero.
      expect(tomanAmountSchema.safeParse('-1').success).toBe(false);
      expect(tomanAmountSchema.safeParse('-0').success).toBe(false);
      expect(tomanAmountSchema.safeParse('0').success).toBe(true);
    });
  });

  describe('the share percentage', () => {
    it('accepts whole basis points across the whole range', () => {
      for (const value of [0, 1, 4000, 4250, 6667, SHARE_BASIS_POINTS_MAX]) {
        expect(shareBasisPointsSchema.safeParse(value).success).toBe(true);
      }
    });

    it('refuses anything outside 0 to 10000 inclusive', () => {
      expect(SHARE_BASIS_POINTS_MAX).toBe(10000);

      for (const value of [-1, -10000, 10001, 100000] as const) {
        expect(shareBasisPointsSchema.safeParse(value).success).toBe(false);
      }
    });

    it('refuses a fractional or non-finite percentage', () => {
      // A floating-point share is a money bug that accumulates over a month and
      // is discovered by the therapist whose settlement is short.
      for (const value of [42.5, 0.425, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(shareBasisPointsSchema.safeParse(value).success).toBe(false);
      }
    });
  });

  describe('the split rule, pinned as arithmetic', () => {
    /**
     * THE REFERENCE IMPLEMENTATION OF THE FROZEN RULE, AND IT LIVES IN THE TEST
     * ON PURPOSE.
     *
     * `@clinic/contracts` contains no functions and no arithmetic, and CLAUDE.md
     * forbids the web tier from calculating a therapist share at all — so the
     * rule cannot ship as shared code. What it can do is be stated here as
     * executable arithmetic with worked examples, so the C3 implementation is
     * checked against a written-down rule rather than against somebody's memory
     * of a planning document.
     */
    function split(baseAmountToman: string, shareBasisPoints: number) {
      const base = BigInt(baseAmountToman);
      const therapistGross =
        (base * BigInt(shareBasisPoints) + BigInt(SHARE_BASIS_POINTS_MAX / 2)) /
        BigInt(SHARE_BASIS_POINTS_MAX);

      return {
        therapistGrossToman: therapistGross.toString(),
        clinicGrossToman: (base - therapistGross).toString(),
      };
    }

    it('is half-up, not half-even and not truncated', () => {
      expect(SHARE_ROUNDING).toBe('HALF_UP');

      // 12345 * 50% = 6172.5 -> 6173, and the clinic takes 6172. Half-even would
      // give 6172, truncation 6172; both are the answer a therapist checking by
      // hand does not get.
      expect(split('12345', 5000)).toEqual({
        therapistGrossToman: '6173',
        clinicGrossToman: '6172',
      });

      // 12347 * 50% = 6173.5 -> 6174. Half-even would round to the even 6174
      // here and to 6172 above; the two rules only agree by accident.
      expect(split('12347', 5000)).toEqual({
        therapistGrossToman: '6174',
        clinicGrossToman: '6173',
      });
    });

    it('gives the clinic the exact residual, so the two halves always sum to the base', () => {
      // Rounding both halves independently is how a report stops balancing.
      for (const base of ['0', '1', '7', '12345', '250000', '999999999']) {
        for (const bp of [0, 1, 3333, 4250, 5000, 6667, 9999, 10000]) {
          const { therapistGrossToman, clinicGrossToman } = split(base, bp);

          expect((BigInt(therapistGrossToman) + BigInt(clinicGrossToman)).toString()).toBe(base);
          expect(BigInt(therapistGrossToman) >= 0n).toBe(true);
          expect(BigInt(clinicGrossToman) >= 0n).toBe(true);
        }
      }
    });

    it('gives the whole session to one side at the two bounds', () => {
      expect(split('250000', 0)).toEqual({
        therapistGrossToman: '0',
        clinicGrossToman: '250000',
      });
      expect(split('250000', 10000)).toEqual({
        therapistGrossToman: '250000',
        clinicGrossToman: '0',
      });
    });

    it('stays exact where a JS number would not', () => {
      // `Math.round((base * bp) / 10000)` is a different answer here, and the
      // difference is silent.
      expect(split('90071992547409910', 5000).therapistGrossToman).toBe('45035996273704955');
    });

    it('earns zero on a FREE session without that being a rating of zero', () => {
      // A FREE session is charged zero at source, so every share of it is zero —
      // and it is still a RATED fact, counted separately from an unrated one.
      expect(split('0', 4000)).toEqual({ therapistGrossToman: '0', clinicGrossToman: '0' });
    });
  });
});

describe('the settlement fact', () => {
  const settlement = {
    id: UUID,
    sessionChargeId: OTHER_UUID,
    appointmentParticipantId: THIRD_UUID,
    therapistId: UUID,
    serviceDate: '2026-08-15',
    appliedShareBasisPoints: 4250,
    appliedShareRuleId: OTHER_UUID,
    ratedVia: 'AUTOMATIC' as const,
    baseAmountToman: '250000',
    therapistGrossToman: '106250',
    clinicGrossToman: '143750',
    reason: null,
    supersedesSessionSettlementId: null,
    createdAt: '2026-08-16T09:00:00.000Z',
    createdByUserId: THIRD_UUID,
    voidedAt: null,
    voidedByUserId: null,
    voidReason: null,
  };

  it('parses a rated session', () => {
    expect(sessionSettlementSchema.safeParse(settlement).success).toBe(true);
  });

  it('names the two ways the rating ACT can happen, and nothing else', () => {
    expect([...RATED_VIA]).toEqual(['AUTOMATIC', 'EXPLICIT']);

    for (const absent of ['UNRATED', 'NONE', 'DEFAULT', 'INHERITED']) {
      expect(sessionSettlementSchema.safeParse({ ...settlement, ratedVia: absent }).success).toBe(
        false,
      );
    }
  });

  it('has no unrated member, no unrated flag and no zero placeholder', () => {
    // Rule 3 of the settlement vocabulary: unrated is the ABSENCE of this row.
    // A flag on the row would assert that somebody earned nothing, which is a
    // different claim from nobody having decided yet — and the difference is a
    // therapist's money.
    for (const field of ['unrated', 'isRated', 'rated', 'ratingState', 'status']) {
      expect(sessionSettlementSchema.safeParse({ ...settlement, [field]: true }).success).toBe(
        false,
      );
    }
  });

  it('carries the applied percentage as a snapshot AND always names the rule it came from', () => {
    // Nothing may re-resolve the number from the rule — the percentage is the
    // snapshot — but every rating HAS a rule behind it, whichever way the act
    // happened. A share rule is the only source of settlement policy in this
    // product, so a rating with no provenance is unrepresentable.
    expect(
      sessionSettlementSchema.safeParse({
        ...settlement,
        ratedVia: 'EXPLICIT',
        reason: 'جلسه بدون قاعده سهم مانده بود',
      }).success,
    ).toBe(true);

    for (const ratedVia of RATED_VIA) {
      expect(
        sessionSettlementSchema.safeParse({
          ...settlement,
          ratedVia,
          appliedShareRuleId: null,
          reason: ratedVia === 'EXPLICIT' ? 'دلیل' : null,
        }).success,
      ).toBe(false);
    }

    // And the percentage itself is never absent.
    const { appliedShareBasisPoints: _omitted, ...withoutShare } = settlement;
    expect(sessionSettlementSchema.safeParse(withoutShare).success).toBe(false);
  });

  it('keeps both gross halves unsigned, because a gross is a split of a positive amount', () => {
    for (const field of ['baseAmountToman', 'therapistGrossToman', 'clinicGrossToman'] as const) {
      expect(sessionSettlementSchema.safeParse({ ...settlement, [field]: '-1' }).success).toBe(
        false,
      );
    }
  });

  it('is voided and never edited', () => {
    expect(
      sessionSettlementSchema.safeParse({
        ...settlement,
        voidedAt: '2026-08-17T09:00:00.000Z',
        voidedByUserId: THIRD_UUID,
        voidReason: 'درصد اشتباه ثبت شده بود',
      }).success,
    ).toBe(true);

    // A replacement names the rating it replaced, exactly as a tariff does.
    expect(
      sessionSettlementSchema.safeParse({
        ...settlement,
        supersedesSessionSettlementId: OTHER_UUID,
      }).success,
    ).toBe(true);
  });
});

describe('rating a session', () => {
  it('takes a reason and nothing else', () => {
    expect(rateSessionRequestSchema.parse({ reason: 'قاعده سهم بعداً ثبت شد' })).toEqual({
      reason: 'قاعده سهم بعداً ثبت شد',
    });
  });

  it('requires the reason, because reaching back to an unrated session is a decision', () => {
    expect(rateSessionRequestSchema.safeParse({}).success).toBe(false);
    expect(rateSessionRequestSchema.safeParse({ reason: '   ' }).success).toBe(false);
  });

  it('REFUSES A PERCENTAGE, because the share rule is the only source of policy', () => {
    // The rule this shape exists for. A percentage typed onto one session would
    // be settlement policy stated somewhere with no effective date, no
    // supersession history and no void trail — and a therapist's figure would
    // depend on which screen somebody used. A wrong percentage is corrected on
    // the RULE and carried onto the session by the correction request.
    for (const field of ['shareBasisPoints', 'appliedShareBasisPoints', 'sharePercent']) {
      expect(
        rateSessionRequestSchema.safeParse({ reason: 'توافق موردی', [field]: 4250 }).success,
      ).toBe(false);
    }
  });

  it('refuses a submitted provenance, so the act cannot be misreported', () => {
    // `ratedVia` records whether the posting path raised the rating or a manager
    // did. A caller that could send it could claim the charge raised one when it
    // did not.
    for (const ratedVia of RATED_VIA) {
      expect(rateSessionRequestSchema.safeParse({ reason: 'دلیل', ratedVia }).success).toBe(false);
    }
  });

  it('never accepts a base amount, because the basis is the posted charge', () => {
    expect(
      rateSessionRequestSchema.safeParse({ reason: 'دلیل', baseAmountToman: '250000' }).success,
    ).toBe(false);
  });

  it('requires a reason to withdraw a rating', () => {
    expect(voidSessionRatingRequestSchema.parse({ reason: 'اشتباه ثبت شده بود' })).toEqual({
      reason: 'اشتباه ثبت شده بود',
    });
    expect(voidSessionRatingRequestSchema.safeParse({}).success).toBe(false);
    expect(voidSessionRatingRequestSchema.safeParse({ reason: '  ' }).success).toBe(false);
  });
});

describe('correcting a rating a closed period depends on', () => {
  const correction = {
    sessionChargeId: OTHER_UUID,
    sessionSettlementId: UUID,
    withdrawReason: 'درصد اشتباه اعمال شده بود',
    replacement: {
      sessionChargeId: OTHER_UUID,
      reason: 'قاعده سهم اصلاح شد و این جلسه دوباره محاسبه می‌شود',
    },
  };

  it('carries the withdrawal and the replacement in one request', () => {
    expect(correctSessionRatingRequestSchema.safeParse(correction).success).toBe(true);
  });

  it('requires the replacement, so a bare withdrawal cannot reach this endpoint', () => {
    // Two separate calls have a moment between them in which the session is
    // unrated — and a close performed in that moment excludes it permanently.
    const { replacement: _omitted, ...withoutReplacement } = correction;

    expect(correctSessionRatingRequestSchema.safeParse(withoutReplacement).success).toBe(false);
  });

  it('requires a withdrawal reason', () => {
    expect(
      correctSessionRatingRequestSchema.safeParse({ ...correction, withdrawReason: '  ' }).success,
    ).toBe(false);
  });

  it('refuses a replacement scoped to a different session charge', () => {
    // Correcting one therapist's month by re-rating a different session is a
    // mistake only ever noticed by whoever ends up short.
    expect(
      correctSessionRatingRequestSchema.safeParse({
        ...correction,
        replacement: { ...correction.replacement, sessionChargeId: THIRD_UUID },
      }).success,
    ).toBe(false);
  });

  it('refuses a percentage on the replacement, which is re-resolved from the rule', () => {
    // This is the second half of correcting a wrong percentage: the manager
    // corrects the RULE — which voids it and writes a replacement naming it —
    // and this carries the corrected agreement onto the session. A number typed
    // here would settle one session against a figure no agreement ever recorded.
    expect(
      correctSessionRatingRequestSchema.safeParse({
        ...correction,
        replacement: { ...correction.replacement, shareBasisPoints: 4000 },
      }).success,
    ).toBe(false);
  });

  it('requires a reason on the replacement as well as on the withdrawal', () => {
    // Two decisions, two explanations: why the old figure went, and why the new
    // one stands.
    expect(
      correctSessionRatingRequestSchema.safeParse({
        ...correction,
        replacement: { sessionChargeId: OTHER_UUID },
      }).success,
    ).toBe(false);
  });
});

describe('the settlement statement', () => {
  const line = {
    sessionSettlementId: UUID,
    sessionChargeId: OTHER_UUID,
    serviceDate: '2026-08-15',
    serviceId: THIRD_UUID,
    serviceName: 'کاردرمانی',
    durationMinutes: 45,
    lineType: 'PRIMARY' as const,
    correctsSessionSettlementId: null,
    appliedShareBasisPoints: 4250,
    ratedVia: 'AUTOMATIC' as const,
    baseAmountToman: '250000',
    therapistGrossToman: '106250',
    therapistDiscountToman: '0',
    therapistNetToman: '106250',
    clinicGrossToman: '143750',
    clinicDiscountToman: '200000',
    clinicNetToman: '-56250',
  };

  const totals = {
    sessionCount: 1,
    correctionCount: 0,
    baseAmountToman: '250000',
    therapistGrossToman: '106250',
    therapistDiscountToman: '0',
    therapistNetToman: '106250',
    clinicGrossToman: '143750',
    clinicDiscountToman: '200000',
    clinicNetToman: '-56250',
    earnedUnsettledToman: '106250',
    settledToman: '0',
    netSettlementToman: '106250',
  };

  const exceptions = {
    unratedSessionCount: 3,
    freeSessionCount: 2,
    unchargedCompletedSessionCount: 1,
  };

  it('is keyed on the session date and adds no new report basis', () => {
    const response = {
      range: { from: '2026-08-01', to: '2026-08-31', dateBasis: 'SESSION_DATE' as const },
      therapist: { id: UUID, fullName: 'درمانگر آزمایشی' },
      lines: [line],
      totals,
      exceptions,
    };

    expect(settlementStatementResponseSchema.safeParse(response).success).toBe(true);

    // A rating entered late belongs to the session's day, never to the day
    // somebody got round to rating it.
    expect(
      settlementStatementResponseSchema.safeParse({
        ...response,
        range: { ...response.range, dateBasis: 'SETTLEMENT_RATED_AT' },
      }).success,
    ).toBe(false);
  });

  it('requires a therapist and a coherent range', () => {
    expect(
      settlementStatementQuerySchema.safeParse({ from: '2026-08-01', to: '2026-08-31' }).success,
    ).toBe(false);
    expect(
      settlementStatementQuerySchema.safeParse({
        therapistId: UUID,
        from: '2026-08-31',
        to: '2026-08-01',
      }).success,
    ).toBe(false);
    expect(
      settlementStatementQuerySchema.safeParse({
        therapistId: UUID,
        from: '2026-08-01',
        to: '2026-08-31',
      }).success,
    ).toBe(true);
  });

  it('lets the clinic net go below zero and keeps the therapist net from doing so', () => {
    // CLAUDE.md: a negative clinic net is an explicit subsidy and must be
    // visible; a therapist net must never be negative.
    expect(settlementStatementLineSchema.safeParse(line).success).toBe(true);
    expect(
      settlementStatementLineSchema.safeParse({ ...line, therapistNetToman: '-1' }).success,
    ).toBe(false);
  });

  it('states every total on the server, including the three settlement figures', () => {
    expect(settlementStatementTotalsSchema.safeParse(totals).success).toBe(true);

    // The web tier never adds settlement money up, so every one of them is
    // required rather than optional.
    for (const field of ['earnedUnsettledToman', 'settledToman', 'netSettlementToman'] as const) {
      const { [field]: _omitted, ...without } = totals;

      expect(settlementStatementTotalsSchema.safeParse(without).success).toBe(false);
    }

    // A period whose carried-in corrections outweigh its primaries is genuinely
    // negative, and clamping it would state a figure the clinic does not mean.
    expect(
      settlementStatementTotalsSchema.safeParse({
        ...totals,
        netSettlementToman: '-25000',
        earnedUnsettledToman: '-25000',
      }).success,
    ).toBe(true);
  });

  it('counts the three exceptions separately and never as money', () => {
    expect(settlementStatementExceptionsSchema.safeParse(exceptions).success).toBe(true);

    for (const field of [
      'unratedSessionCount',
      'freeSessionCount',
      'unchargedCompletedSessionCount',
    ] as const) {
      const { [field]: _omitted, ...without } = exceptions;

      expect(settlementStatementExceptionsSchema.safeParse(without).success).toBe(false);
    }

    // No amount is expressible here: folding an unrated session into a zero
    // amount is exactly how it disappears into a column that already balances.
    expect(
      settlementStatementExceptionsSchema.safeParse({ ...exceptions, unratedToman: '0' }).success,
    ).toBe(false);
  });

  it('distinguishes this period work from a carried-in correction', () => {
    expect([...SETTLEMENT_LINE_TYPES]).toEqual(['PRIMARY', 'CORRECTION']);

    expect(
      settlementStatementLineSchema.safeParse({
        ...line,
        lineType: 'CORRECTION',
        correctsSessionSettlementId: THIRD_UUID,
      }).success,
    ).toBe(true);
  });
});

describe('closing a period', () => {
  const period = {
    id: UUID,
    therapistId: OTHER_UUID,
    from: '2026-08-01',
    to: '2026-08-31',
    settledSessionCount: 24,
    carriedInCorrectionCount: 1,
    excludedUnratedSessionCount: 3,
    therapistGrossToman: '2550000',
    therapistDiscountToman: '50000',
    carriedInCorrectionToman: '-25000',
    settledToman: '2475000',
    closedAt: '2026-09-01T07:00:00.000Z',
    closedByUserId: THIRD_UUID,
  };

  it('takes one therapist and an explicit, coherent range', () => {
    expect(
      closeSettlementPeriodRequestSchema.parse({
        therapistId: UUID,
        from: '2026-08-01',
        to: '2026-08-31',
      }),
    ).toEqual({ therapistId: UUID, from: '2026-08-01', to: '2026-08-31' });

    // No calendar-month shorthand: a period whose boundaries are computed by
    // whoever asks is a period two callers can disagree about.
    expect(closeSettlementPeriodRequestSchema.safeParse({ therapistId: UUID }).success).toBe(false);
    expect(
      closeSettlementPeriodRequestSchema.safeParse({ therapistId: UUID, month: '2026-08' }).success,
    ).toBe(false);
    expect(
      closeSettlementPeriodRequestSchema.safeParse({
        therapistId: UUID,
        from: '2026-08-31',
        to: '2026-08-01',
      }).success,
    ).toBe(false);
  });

  it('closes one therapist at a time', () => {
    // There is no sweep: closing everybody would close periods nobody had read.
    const { therapistId: _omitted, ...withoutTherapist } = {
      therapistId: UUID,
      from: '2026-08-01',
      to: '2026-08-31',
    };

    expect(closeSettlementPeriodRequestSchema.safeParse(withoutTherapist).success).toBe(false);
  });

  it('retains the excluded unrated count on the closed period', () => {
    // THE FIELD THIS SHAPE EXISTS FOR. A close succeeds with unrated sessions in
    // the range and records how many it left out, permanently — recomputing it
    // later would give a different answer the moment one of them was rated.
    expect(settlementPeriodSchema.safeParse(period).success).toBe(true);

    const { excludedUnratedSessionCount: _omitted, ...without } = period;

    expect(settlementPeriodSchema.safeParse(without).success).toBe(false);
  });

  it('keeps this period work separate from a correction carried into it', () => {
    expect(
      settlementPeriodSchema.safeParse({ ...period, carriedInCorrectionToman: '0' }).success,
    ).toBe(true);

    // Signed, because a carried-in withdrawal can outweigh the period.
    expect(settlementPeriodSchema.safeParse({ ...period, settledToman: '-25000' }).success).toBe(
      true,
    );
  });

  it('has no status field and no reopening', () => {
    // A `settlement_period` row exists only because a close happened, so every
    // one of them is closed; the open period is the range no row covers.
    for (const field of ['status', 'state', 'reopenedAt', 'isClosed']) {
      expect(settlementPeriodSchema.safeParse({ ...period, [field]: 'OPEN' }).success).toBe(false);
    }
  });

  it('answers CLOSED or ALREADY_CLOSED, and nothing else', () => {
    expect([...SETTLEMENT_CLOSE_OUTCOMES]).toEqual(['CLOSED', 'ALREADY_CLOSED']);

    for (const outcome of SETTLEMENT_CLOSE_OUTCOMES) {
      expect(closeSettlementPeriodResultSchema.safeParse({ outcome, period }).success).toBe(true);
    }

    // An overlap and an unrated exclusion are not outcomes: the first is a
    // refusal (`SETTLEMENT_PERIOD_OVERLAP`) and the second is a successful close
    // that says how many it left out.
    for (const outcome of ['OVERLAP', 'UNRATED_SESSIONS', 'NOTHING_TO_CLOSE', 'FAILED']) {
      expect(closeSettlementPeriodResultSchema.safeParse({ outcome, period }).success).toBe(false);
    }
  });
});

describe('the settlement naming discipline', () => {
  /**
   * Milestone 8 records no therapist payout, so no settlement field may imply
   * an outstanding money-out ledger. Nothing in this system could ever decrease
   * such a figure, so a field named `owed` would only ever grow — and would be
   * read by the first person who saw it as a debt the clinic is running up.
   *
   * The check walks the declared keys of every settlement shape rather than
   * naming them one by one, so a field added in a later checkpoint is caught by
   * the same rule.
   */
  const FORBIDDEN = /owed|payable|receivable|\bdue\b|balance|payout|paidToTherapist/i;

  const SETTLEMENT_SHAPES = {
    // Checkpoint C2's configuration shape walks the same rule as the facts.
    shareRule: shareRuleSchema,
    sessionSettlement: sessionSettlementSchema,
    statementLine: settlementStatementLineSchema,
    statementTotals: settlementStatementTotalsSchema,
    statementExceptions: settlementStatementExceptionsSchema,
    settlementPeriod: settlementPeriodSchema,
  } as const;

  it('names no settlement field after a debt, a payout or a balance', () => {
    for (const [name, schema] of Object.entries(SETTLEMENT_SHAPES)) {
      for (const field of Object.keys(schema.shape)) {
        expect(`${name}.${field}`).not.toMatch(FORBIDDEN);
      }
    }
  });

  it('uses the three accepted settlement figure names', () => {
    const keys = Object.keys(settlementStatementTotalsSchema.shape);

    expect(keys).toContain('earnedUnsettledToman');
    expect(keys).toContain('settledToman');
    expect(keys).toContain('netSettlementToman');
  });

  it('leaves the family ledger vocabulary alone', () => {
    // The restriction is settlement-specific. A family balance is a real
    // balance, and nothing here renames it.
    expect(FORBIDDEN.test('balanceToman')).toBe(true);
    expect(Object.keys(settlementStatementTotalsSchema.shape)).not.toContain('balanceToman');
  });
});
