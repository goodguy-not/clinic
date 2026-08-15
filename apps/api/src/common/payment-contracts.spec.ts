import {
  cancelPromiseRequestSchema,
  createPaymentRequestSchema,
  createPromiseRequestSchema,
  familyAccountResponseSchema,
  familyFinancialPositionSchema,
  fulfillPromiseRequestSchema,
  paymentListQuerySchema,
  paymentListResponseSchema,
  paymentResponseSchema,
  paymentSchema,
  paymentSummarySchema,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  promiseListQuerySchema,
  promiseListResponseSchema,
  promiseSchema,
  PROMISE_STATUSES,
  PROMISE_STORED_STATUSES,
  reschedulePromiseRequestSchema,
  rescheduledPromiseResponseSchema,
  voidPaymentRequestSchema,
} from '@clinic/contracts';

/**
 * The Milestone 6 money-in contract surface, pinned before anything implements
 * it.
 *
 * Checkpoint A2 freezes these shapes so both workstreams build against one
 * description. What is asserted here is not "the schema parses" but the
 * properties the freeze is worth having: the lifecycle vocabulary is exactly
 * what was approved, a payment allocates nothing, a promise moves nothing, the
 * derived words are the server's to say, and the family position stays
 * distinguishable from the filter-scoped totals beside it.
 *
 * Every value below is synthetic.
 */

const UUID = '01923c9e-4c1a-7000-8000-000000000001';
const OTHER_UUID = '01923c9e-4c1a-7000-8000-000000000002';
const THIRD_UUID = '01923c9e-4c1a-7000-8000-000000000003';

const confirmedPayment = {
  id: UUID,
  familyId: OTHER_UUID,
  amountToman: '500000',
  method: 'CASH' as const,
  receivedOn: '2026-08-15',
  reference: null,
  note: null,
  status: 'CONFIRMED' as const,
  createdAt: '2026-08-15T09:00:00.000Z',
  createdByUserId: THIRD_UUID,
  voidedAt: null,
  voidedByUserId: null,
  voidReason: null,
};

const voidedPayment = {
  ...confirmedPayment,
  status: 'VOIDED' as const,
  voidedAt: '2026-08-16T09:00:00.000Z',
  voidedByUserId: THIRD_UUID,
  voidReason: 'مبلغ اشتباه وارد شده بود',
};

const paymentSummary = {
  id: UUID,
  amountToman: '500000',
  method: 'CASH' as const,
  receivedOn: '2026-08-15',
  status: 'CONFIRMED' as const,
};

const openPromise = {
  id: THIRD_UUID,
  familyId: OTHER_UUID,
  amountToman: '500000',
  dueOn: '2026-08-20',
  note: null,
  status: 'OPEN' as const,
  createdAt: '2026-08-15T09:00:00.000Z',
  createdByUserId: UUID,
  resolvedAt: null,
  resolvedByUserId: null,
  resolutionReason: null,
  fulfillingPayment: null,
  rescheduledToPromiseId: null,
  rescheduledFromPromiseId: null,
};

const fulfilledPromise = {
  ...openPromise,
  status: 'FULFILLED' as const,
  resolvedAt: '2026-08-20T09:00:00.000Z',
  resolvedByUserId: UUID,
  resolutionReason: null,
  fulfillingPayment: paymentSummary,
};

const position = {
  netChargedTotalToman: '750000',
  confirmedPaymentTotalToman: '500000',
  creditToman: '0',
  amountDueToman: '250000',
  paymentCount: 1,
  voidedPaymentCount: 0,
  lastPayment: paymentSummary,
  openPromiseCount: 1,
  missedPromiseCount: 0,
};

describe('the payment contract', () => {
  it('names exactly the three approved methods', () => {
    // DECISION_LOG, 2026-08-15: no CHEQUE, because nothing here models
    // presentation, clearing or dishonour; no OTHER, because the value that
    // absorbs every unforeseen case is the one no report can speak about.
    expect([...PAYMENT_METHODS].sort()).toEqual(['CARD', 'CASH', 'TRANSFER']);
    expect(paymentSchema.safeParse({ ...confirmedPayment, method: 'CHEQUE' }).success).toBe(false);
    expect(paymentSchema.safeParse({ ...confirmedPayment, method: 'OTHER' }).success).toBe(false);
  });

  it('has two lifecycle words and no PENDING', () => {
    expect([...PAYMENT_STATUSES]).toEqual(['CONFIRMED', 'VOIDED']);
    expect(paymentSchema.safeParse({ ...confirmedPayment, status: 'PENDING' }).success).toBe(false);
  });

  it('refuses a status that disagrees with the void instant', () => {
    // The word is derived from `voidedAt` — there is no status column — so a
    // response where the two disagree could not have come from the database.
    expect(paymentSchema.safeParse(confirmedPayment).success).toBe(true);
    expect(paymentSchema.safeParse(voidedPayment).success).toBe(true);
    expect(paymentSchema.safeParse({ ...confirmedPayment, status: 'VOIDED' }).success).toBe(false);
    expect(paymentSchema.safeParse({ ...voidedPayment, status: 'CONFIRMED' }).success).toBe(false);
  });

  it('refuses a half-stated void', () => {
    expect(paymentSchema.safeParse({ ...voidedPayment, voidReason: null }).success).toBe(false);
    expect(paymentSchema.safeParse({ ...voidedPayment, voidedByUserId: null }).success).toBe(false);
  });

  it('carries money as the canonical decimal string and never as a number', () => {
    expect(paymentSchema.safeParse({ ...confirmedPayment, amountToman: 500000 }).success).toBe(
      false,
    );
    expect(paymentSchema.safeParse({ ...confirmedPayment, amountToman: '۵۰۰' }).success).toBe(
      false,
    );
    expect(paymentSchema.safeParse({ ...confirmedPayment, amountToman: '0500' }).success).toBe(
      false,
    );
  });

  it('allocates nothing, balances nothing and settles nothing', () => {
    // A payment is a family fact (DECISION_LOG, 2026-08-15). It names no charge,
    // no session, no child and no therapist share, and `strictObject` refuses a
    // response that grew one.
    for (const invented of [
      'sessionChargeId',
      'childId',
      'allocations',
      'balanceToman',
      'creditToman',
      'therapistShareToman',
      'isPrepayment',
    ]) {
      expect(paymentSchema.safeParse({ ...confirmedPayment, [invented]: null }).success).toBe(
        false,
      );
    }
  });

  it('accepts only the five facts an operator types when recording money', () => {
    expect(Object.keys(createPaymentRequestSchema.shape).sort()).toEqual([
      'amountToman',
      'method',
      'note',
      'receivedOn',
      'reference',
    ]);

    // The actor, the instant and the status are the server's.
    for (const owned of ['status', 'createdByUserId', 'createdAt', 'familyId']) {
      expect(
        createPaymentRequestSchema.safeParse({
          amountToman: '500000',
          method: 'CASH',
          receivedOn: '2026-08-15',
          [owned]: UUID,
        }).success,
      ).toBe(false);
    }
  });

  it('takes any positive amount, because partial payment and overpayment are ordinary', () => {
    const base = { method: 'CASH' as const, receivedOn: '2026-08-15' };

    expect(createPaymentRequestSchema.safeParse({ ...base, amountToman: '1' }).success).toBe(true);
    expect(createPaymentRequestSchema.safeParse({ ...base, amountToman: '0' }).success).toBe(false);
    expect(
      createPaymentRequestSchema.safeParse({ ...base, amountToman: '1000000001' }).success,
    ).toBe(false);
  });

  it('states no date bound of its own, because today is the clinic day', () => {
    // A future `receivedOn` is refused by the server as PAYMENT_DATE_IN_FUTURE:
    // the clinic's calendar day is in Asia/Tehran and a browser must not decide
    // it. Back-dating is unlimited (DECISION_LOG, 2026-08-15).
    const base = { amountToman: '500000', method: 'CASH' as const };

    expect(
      createPaymentRequestSchema.safeParse({ ...base, receivedOn: '2019-01-01' }).success,
    ).toBe(true);
    expect(
      createPaymentRequestSchema.safeParse({ ...base, receivedOn: '2099-01-01' }).success,
    ).toBe(true);
    expect(
      createPaymentRequestSchema.safeParse({ ...base, receivedOn: '2026-02-30' }).success,
    ).toBe(false);
  });

  it('asks for a reason and nothing else when voiding', () => {
    expect(Object.keys(voidPaymentRequestSchema.shape)).toEqual(['reason']);
    expect(voidPaymentRequestSchema.safeParse({ reason: '   ' }).success).toBe(false);
    expect(voidPaymentRequestSchema.safeParse({}).success).toBe(false);
  });

  it('answers every write with the payment as it now stands', () => {
    expect(paymentResponseSchema.safeParse({ payment: voidedPayment }).success).toBe(true);
    // Not the family position: one number, one place to learn it.
    expect(paymentResponseSchema.safeParse({ payment: confirmedPayment, position }).success).toBe(
      false,
    );
  });

  it('shows voided payments by default and pages separately from the account', () => {
    expect(paymentListQuerySchema.parse({}).includeVoided).toBe(true);
    expect(paymentListQuerySchema.parse({ includeVoided: 'false' }).includeVoided).toBe(false);
    expect(paymentListQuerySchema.parse({}).page).toBe(1);

    expect(
      paymentListResponseSchema.safeParse({
        familyId: OTHER_UUID,
        payments: [confirmedPayment, voidedPayment],
        page: { page: 1, pageSize: 25, total: 2, hasMore: false },
      }).success,
    ).toBe(true);
  });
});

describe('the promise contract', () => {
  it('reads five statuses and stores four', () => {
    expect([...PROMISE_STATUSES]).toEqual([
      'OPEN',
      'MISSED',
      'FULFILLED',
      'RESCHEDULED',
      'CANCELLED',
    ]);
    expect([...PROMISE_STORED_STATUSES]).toEqual(
      PROMISE_STATUSES.filter((one) => one !== 'MISSED'),
    );
  });

  it('lets a promise read MISSED without pretending it is stored', () => {
    // Derived from the clock against the clinic's calendar day, and stated by
    // the server. A missed promise is still an open one: it carries no
    // resolution.
    expect(promiseSchema.safeParse({ ...openPromise, status: 'MISSED' }).success).toBe(true);
    expect(
      promiseSchema.safeParse({
        ...openPromise,
        status: 'MISSED',
        resolvedAt: '2026-08-21T09:00:00.000Z',
        resolvedByUserId: UUID,
      }).success,
    ).toBe(false);
  });

  it('is fulfilled exactly when it names the payment that fulfilled it', () => {
    expect(promiseSchema.safeParse(fulfilledPromise).success).toBe(true);
    expect(promiseSchema.safeParse({ ...fulfilledPromise, fulfillingPayment: null }).success).toBe(
      false,
    );
    expect(
      promiseSchema.safeParse({ ...openPromise, fulfillingPayment: paymentSummary }).success,
    ).toBe(false);
  });

  it('keeps a fulfilled promise fulfilled when the payment behind it is voided', () => {
    // The void does not un-make a human judgement, and forcing a promise
    // mutation would rewrite history to keep an invariant tidy. The summary's
    // own status is where a reader learns the evidence no longer stands — one
    // fact, one field, and no second boolean beside it.
    const parsed = promiseSchema.parse({
      ...fulfilledPromise,
      fulfillingPayment: { ...paymentSummary, status: 'VOIDED' },
    });

    expect(parsed.fulfillingPayment?.status).toBe('VOIDED');
    expect(parsed.status).toBe('FULFILLED');
    expect(
      promiseSchema.safeParse({ ...fulfilledPromise, fulfillingPaymentVoided: true }).success,
    ).toBe(false);
  });

  it('is rescheduled exactly when it names its successor', () => {
    const rescheduled = {
      ...openPromise,
      status: 'RESCHEDULED' as const,
      resolvedAt: '2026-08-19T09:00:00.000Z',
      resolvedByUserId: UUID,
      resolutionReason: 'خانواده تا هفتهٔ بعد مهلت خواست',
      rescheduledToPromiseId: OTHER_UUID,
    };

    expect(promiseSchema.safeParse(rescheduled).success).toBe(true);
    expect(promiseSchema.safeParse({ ...rescheduled, rescheduledToPromiseId: null }).success).toBe(
      false,
    );
    // The chain reads backwards too, and it is an id rather than a nested
    // promise: five reschedules would otherwise nest five deep.
    expect(
      promiseSchema.safeParse({ ...openPromise, rescheduledFromPromiseId: OTHER_UUID }).success,
    ).toBe(true);
  });

  it('carries no follow-up date and no financial effect', () => {
    // `follow_up_date` was removed from Milestone 6 by name (DECISION_LOG,
    // 2026-08-15), and a promise reduces no balance in any state (CLAUDE.md).
    for (const invented of [
      'followUpDate',
      'balanceToman',
      'amountDueToman',
      'appliedToChargeId',
      'partialAmountToman',
    ]) {
      expect(promiseSchema.safeParse({ ...openPromise, [invented]: null }).success).toBe(false);
    }

    expect(Object.keys(createPromiseRequestSchema.shape).sort()).toEqual([
      'amountToman',
      'dueOn',
      'note',
    ]);
  });

  it('fulfils by an explicit payment and never by an amount', () => {
    // The link is a recorded human judgement, not a proximity match, and there
    // is no partial fulfilment to state (DECISION_LOG, 2026-08-15).
    expect(Object.keys(fulfillPromiseRequestSchema.shape)).toEqual(['paymentId']);
    expect(fulfillPromiseRequestSchema.safeParse({ paymentId: UUID }).success).toBe(true);
    expect(fulfillPromiseRequestSchema.safeParse({}).success).toBe(false);
    expect(
      fulfillPromiseRequestSchema.safeParse({ paymentId: UUID, amountToman: '500000' }).success,
    ).toBe(false);
  });

  it('demands a reason to reschedule and to cancel', () => {
    expect(Object.keys(reschedulePromiseRequestSchema.shape).sort()).toEqual(['dueOn', 'reason']);
    expect(
      reschedulePromiseRequestSchema.safeParse({ dueOn: '2026-09-01', reason: '' }).success,
    ).toBe(false);
    expect(Object.keys(cancelPromiseRequestSchema.shape)).toEqual(['reason']);
    expect(cancelPromiseRequestSchema.safeParse({}).success).toBe(false);
    // Neither the amount nor the note may change on a reschedule: a different
    // amount is a different intention.
    expect(
      reschedulePromiseRequestSchema.safeParse({
        dueOn: '2026-09-01',
        reason: 'تماس گرفته شد',
        amountToman: '400000',
      }).success,
    ).toBe(false);
  });

  it('returns both promises when one is rescheduled', () => {
    expect(
      rescheduledPromiseResponseSchema.safeParse({
        promise: {
          ...openPromise,
          status: 'RESCHEDULED',
          resolvedAt: '2026-08-19T09:00:00.000Z',
          resolvedByUserId: UUID,
          resolutionReason: 'مهلت جدید توافق شد',
          rescheduledToPromiseId: OTHER_UUID,
        },
        successor: { ...openPromise, id: OTHER_UUID, rescheduledFromPromiseId: THIRD_UUID },
      }).success,
    ).toBe(true);
  });

  it('filters on the derived word, including MISSED', () => {
    expect(promiseListQuerySchema.parse({ status: 'MISSED' }).status).toBe('MISSED');
    expect(promiseListQuerySchema.parse({}).status).toBeUndefined();
    expect(promiseListQuerySchema.safeParse({ status: 'EXPIRED' }).success).toBe(false);

    expect(
      promiseListResponseSchema.safeParse({
        familyId: OTHER_UUID,
        promises: [openPromise, fulfilledPromise],
        page: { page: 1, pageSize: 25, total: 2, hasMore: false },
      }).success,
    ).toBe(true);
  });
});

describe('the family financial position', () => {
  it('states what the server derived and nothing a browser would add up', () => {
    expect(Object.keys(familyFinancialPositionSchema.shape).sort()).toEqual([
      'amountDueToman',
      'confirmedPaymentTotalToman',
      'creditToman',
      'lastPayment',
      'missedPromiseCount',
      'netChargedTotalToman',
      'openPromiseCount',
      'paymentCount',
      'voidedPaymentCount',
    ]);
    expect(familyFinancialPositionSchema.safeParse(position).success).toBe(true);
  });

  it('has no signed balance, and never owes and is owed at once', () => {
    // A minus sign is meaning that every consumer must interpret and that reads
    // wrongly the moment somebody formats it away.
    expect(
      familyFinancialPositionSchema.safeParse({ ...position, balanceToman: '-250000' }).success,
    ).toBe(false);
    expect(
      familyFinancialPositionSchema.safeParse({
        ...position,
        creditToman: '100000',
        amountDueToman: '250000',
      }).success,
    ).toBe(false);
    // Credit alone is fine, and so is a family that is square.
    expect(
      familyFinancialPositionSchema.safeParse({
        ...position,
        creditToman: '100000',
        amountDueToman: '0',
      }).success,
    ).toBe(true);
  });

  it('counts promises and never sums them', () => {
    // A promise moves no money in any state, so a promised total beside an
    // amount due would be an invitation to subtract one from the other.
    expect(
      familyFinancialPositionSchema.safeParse({ ...position, promisedTotalToman: '500000' })
        .success,
    ).toBe(false);
    expect(familyFinancialPositionSchema.parse(position).openPromiseCount).toBe(1);
  });

  it('summarises the last payment rather than embedding the whole row', () => {
    expect(Object.keys(paymentSummarySchema.shape).sort()).toEqual([
      'amountToman',
      'id',
      'method',
      'receivedOn',
      'status',
    ]);
    expect(
      familyFinancialPositionSchema.safeParse({ ...position, lastPayment: null }).success,
    ).toBe(true);
    // No reference and no note on a summary: the detail read is where those live.
    expect(paymentSummarySchema.safeParse({ ...paymentSummary, reference: 'TRX-1' }).success).toBe(
      false,
    );
  });
});

describe('the additive family account', () => {
  const account = {
    familyId: OTHER_UUID,
    totals: {
      chargedTotalToman: '750000',
      adjustmentTotalToman: '0',
      netChargedTotalToman: '750000',
      chargeCount: 3,
      voidedChargeCount: 0,
    },
    charges: [],
    page: { page: 1, pageSize: 25, total: 0, hasMore: false },
  };

  it('keeps the Milestone 5 totals exactly as they were frozen', () => {
    expect(Object.keys(familyAccountResponseSchema.shape.totals.shape).sort()).toEqual([
      'adjustmentTotalToman',
      'chargeCount',
      'chargedTotalToman',
      'netChargedTotalToman',
      'voidedChargeCount',
    ]);
  });

  it('requires the position, and is the final Milestone 6 shape', () => {
    // Nothing here is optional. A response without a position is not a thinner
    // account, it is one that cannot say what the family owes — and freezing it
    // as optional to narrow later would itself be a post-freeze change. The
    // interim body the API still returns is parsed by an explicitly transitional
    // legacy schema in `apps/web`, never by this one.
    expect(familyAccountResponseSchema.safeParse({ ...account, position }).success).toBe(true);
    expect(familyAccountResponseSchema.safeParse(account).success).toBe(false);
  });

  it('refuses a position that states only part of itself', () => {
    const { creditToman: _dropped, ...partial } = position;

    expect(familyAccountResponseSchema.safeParse({ ...account, position: partial }).success).toBe(
      false,
    );
  });

  it('keeps the filtered totals and the whole-family position apart', () => {
    // `totals` moves when the reader narrows to one child or one month;
    // `position` never does. Two numbers that look alike and mean different
    // things are how a screen quotes a filtered balance to a family.
    const parsed = familyAccountResponseSchema.parse({
      ...account,
      totals: { ...account.totals, netChargedTotalToman: '250000', chargeCount: 1 },
      position,
    });

    expect(parsed.totals.netChargedTotalToman).toBe('250000');
    expect(parsed.position.netChargedTotalToman).toBe('750000');
  });
});
