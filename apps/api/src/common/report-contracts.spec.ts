import {
  FAMILY_ACCOUNT_STANDINGS,
  LEDGER_PAGE_SIZE_DEFAULT,
  LEDGER_PAGE_SIZE_MAX,
  PAYMENT_METHODS,
  REPORT_DATE_BASES,
  clinicWideDashboardResponseSchema,
  dashboardQuerySchema,
  dashboardResponseSchema,
  ownScopedDashboardResponseSchema,
  familyAccountReportQuerySchema,
  familyAccountReportResponseSchema,
  paymentReportQuerySchema,
  paymentReportResponseSchema,
  promiseReportQuerySchema,
  promiseReportResponseSchema,
  reportRangeSchema,
  sessionReportQuerySchema,
  sessionReportResponseSchema,
  therapistActivityQuerySchema,
  therapistActivityResponseSchema,
} from '@clinic/contracts';

/**
 * The Milestone 7 reporting contract surface, pinned before anything implements
 * it.
 *
 * Checkpoint C1 freezes these shapes so the API and web workstreams build
 * against one description. What is asserted here is not "the schema parses" but
 * the properties the freeze is worth having: which business day each report is
 * keyed on and that the two payment bases stay apart, that a range is mandatory
 * and ordered but never capped, that no filter carries personal free text, that
 * the operational
 * reports carry no money at all, that a promise is never summed, that the
 * dashboard cannot leak the clinic's finances to a receptionist, and that an
 * empty period is a successful read.
 *
 * Every value below is synthetic.
 */

const UUID = '01923c9e-4c1a-7000-8000-000000000001';
const OTHER_UUID = '01923c9e-4c1a-7000-8000-000000000002';
const THIRD_UUID = '01923c9e-4c1a-7000-8000-000000000003';

const range = { from: '2026-08-01', to: '2026-08-31' } as const;

const family = { id: UUID, familyName: 'خانوادهٔ نمونه' };
const user = { id: OTHER_UUID, displayName: 'کاربر نمونه' };
const emptyPage = { page: 1, pageSize: 25, total: 0, hasMore: false };

/** Every method, zero-filled, which is what the reconciliation block promises. */
const zeroedMethods = PAYMENT_METHODS.map((method) => ({ method, count: 0, totalToman: '0' }));

const emptyReconciliation = {
  scope: 'RECORDED_BY_ME' as const,
  dateBasis: 'PAYMENT_RECORDED_AT' as const,
  confirmedCount: 0,
  confirmedTotalToman: '0',
  voidedCount: 0,
  byMethod: zeroedMethods,
  entries: [],
};

const quietDashboard = {
  financialScope: 'OWN_ENTRIES_ONLY' as const,
  date: '2026-08-18',
  appointments: {
    total: 0,
    scheduled: 0,
    completed: 0,
    cancelled: 0,
    unresolvedOutcomes: 0,
    noShows: 0,
  },
  promises: { dueTodayCount: 0, missedCount: 0 },
  dataIssues: { missingTariffCount: 0, unchargedCompletedSessionCount: 0 },
  reconciliation: emptyReconciliation,
};

/** The same day, as the caller who may see the clinic's money receives it. */
const managerDashboard = { ...quietDashboard, financialScope: 'CLINIC_WIDE' as const };

const clinicFinancial = {
  payments: {
    dateBasis: 'PAYMENT_RECORDED_AT' as const,
    confirmedCount: 2,
    confirmedTotalToman: '750000',
    voidedCount: 1,
    byMethod: zeroedMethods,
    byUser: [{ user, confirmedCount: 2, confirmedTotalToman: '750000', voidedCount: 1 }],
  },
  charges: {
    dateBasis: 'SESSION_DATE' as const,
    chargeCount: 3,
    netChargedTotalToman: '600000',
    voidedChargeCount: 0,
  },
};

describe('the reporting date vocabulary', () => {
  it('names exactly the four business days a Milestone 7 read may be keyed on', () => {
    expect([...REPORT_DATE_BASES].sort()).toEqual(
      ['SESSION_DATE', 'PAYMENT_RECEIVED_ON', 'PAYMENT_RECORDED_AT', 'PROMISE_DUE_ON'].sort(),
    );
  });

  it('makes every ranged response state its own basis', () => {
    // A period without the day it counts is three different reports.
    expect(reportRangeSchema.safeParse({ ...range, dateBasis: 'SESSION_DATE' }).success).toBe(true);
    expect(reportRangeSchema.safeParse(range).success).toBe(false);
    expect(reportRangeSchema.safeParse({ ...range, dateBasis: 'ENTRY_DATE' }).success).toBe(false);
  });

  it('keeps the daily reconciliation and the payments report on DIFFERENT bases', () => {
    // The distinction Milestone 7 exists to preserve: money received on
    // Thursday and entered on Saturday is in Saturday's drawer and in
    // Thursday's takings. The dashboard pins its basis with a literal...
    expect(dashboardResponseSchema.safeParse(quietDashboard).success).toBe(true);
    expect(
      dashboardResponseSchema.safeParse({
        ...quietDashboard,
        reconciliation: { ...emptyReconciliation, dateBasis: 'PAYMENT_RECEIVED_ON' },
      }).success,
    ).toBe(false);

    // ...and the payments report may only ever state the other one.
    const payments = {
      range: { ...range, dateBasis: 'PAYMENT_RECEIVED_ON' as const },
      totals: {
        confirmedCount: 0,
        confirmedTotalToman: '0',
        voidedCount: 0,
        byMethod: [],
        byUser: [],
      },
      payments: [],
      page: emptyPage,
    };

    expect(paymentReportResponseSchema.safeParse(payments).success).toBe(true);
  });
});

describe('a report range', () => {
  const paged = { ...range, page: 1, pageSize: 25 };

  it('is mandatory, because a clinic-wide report with no period is every row ever written', () => {
    expect(sessionReportQuerySchema.safeParse({ page: 1 }).success).toBe(false);
    expect(sessionReportQuerySchema.safeParse({ from: range.from }).success).toBe(false);
    expect(sessionReportQuerySchema.safeParse(paged).success).toBe(true);
  });

  it('includes both ends, so a single day is `from` equal to `to`', () => {
    expect(
      sessionReportQuerySchema.safeParse({ from: '2026-08-18', to: '2026-08-18' }).success,
    ).toBe(true);
  });

  it('refuses a range that ends before it starts', () => {
    expect(
      sessionReportQuerySchema.safeParse({ from: '2026-08-18', to: '2026-08-17' }).success,
    ).toBe(false);
  });

  it('never refuses a range for being long, in any ranged report', () => {
    // THE ACCEPTED DECISION: no server-side maximum span. A clinic asking for a
    // whole year — or for three — is asking a real question, and a refusal would
    // be a number nobody measured. A default opening window is the Web tier's,
    // where a reader can widen it.
    const start = Date.UTC(2026, 0, 1);
    const day = (offset: number) =>
      new Date(start + offset * 86_400_000).toISOString().slice(0, 10);

    for (const schema of [
      sessionReportQuerySchema,
      promiseReportQuerySchema,
      paymentReportQuerySchema,
      therapistActivityQuerySchema,
    ]) {
      for (const span of [366, 367, 400, 1_200]) {
        expect(schema.safeParse({ from: day(0), to: day(span) }).success).toBe(true);
      }
    }
  });

  it('states no maximum-span constant for anybody to enforce', async () => {
    // A constant left behind is a limit waiting to be reintroduced by a consumer
    // that finds it and assumes it means something.
    const contracts: Record<string, unknown> = await import('@clinic/contracts');

    for (const name of Object.keys(contracts)) {
      expect(name).not.toMatch(/RANGE_MAX|MAX_DAYS|MAX_SPAN/i);
    }
  });

  it('pages with the conventions the ledger already established', () => {
    const parsed = sessionReportQuerySchema.parse(range);

    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(LEDGER_PAGE_SIZE_DEFAULT);
    expect(
      sessionReportQuerySchema.safeParse({ ...paged, pageSize: LEDGER_PAGE_SIZE_MAX + 1 }).success,
    ).toBe(false);
  });
});

describe('what a report filter may not carry', () => {
  it('refuses free text in every query shape', () => {
    // A guardian's name, a child's name or a mobile number in a query string
    // reaches the browser history, the `Referer` header and every access log —
    // which is why family search is a POST. Nothing here reopens that.
    for (const schema of [
      sessionReportQuerySchema,
      promiseReportQuerySchema,
      paymentReportQuerySchema,
      therapistActivityQuerySchema,
    ]) {
      for (const field of ['term', 'query', 'search', 'familyName', 'childName', 'mobile']) {
        expect(schema.safeParse({ ...range, [field]: 'نمونه' }).success).toBe(false);
      }
    }

    expect(familyAccountReportQuerySchema.safeParse({ term: 'نمونه' }).success).toBe(false);
    expect(dashboardQuerySchema.safeParse({ familyName: 'نمونه' }).success).toBe(false);
  });

  it('takes its entity filters as opaque ids, never as names', () => {
    expect(
      sessionReportQuerySchema.safeParse({ ...range, therapistId: UUID, serviceId: OTHER_UUID })
        .success,
    ).toBe(true);
    expect(sessionReportQuerySchema.safeParse({ ...range, therapistId: 'نمونه' }).success).toBe(
      false,
    );
    expect(paymentReportQuerySchema.safeParse({ ...range, recordedByUserId: UUID }).success).toBe(
      true,
    );
    // A username is personal data and is not how a user is named in a filter.
    expect(
      paymentReportQuerySchema.safeParse({ ...range, recordedByUsername: 'synthetic' }).success,
    ).toBe(false);
  });
});

describe('the operational reports, which both roles read', () => {
  it('carry no money anywhere in a session row or its summary', () => {
    const financial = /tariff|price|amount|toman|charge|discount|fee|paid|balance/i;
    const row = {
      appointmentId: UUID,
      participantId: OTHER_UUID,
      date: '2026-08-18',
      startsAt: '2026-08-18T05:30:00.000Z',
      durationMinutes: 45,
      status: 'COMPLETED' as const,
      attendance: 'ATTENDED' as const,
      family,
      child: { id: THIRD_UUID, firstName: 'کودک', lastName: 'نمونه', fileNumber: '10001' },
      therapist: { id: UUID, fullName: 'درمانگر نمونه' },
      service: { id: OTHER_UUID, name: 'خدمت نمونه' },
      room: { id: THIRD_UUID, name: 'اتاق نمونه' },
    };

    const response = {
      range: { ...range, dateBasis: 'SESSION_DATE' as const },
      summary: {
        total: 1,
        scheduled: 0,
        completed: 1,
        cancelled: 0,
        attended: 1,
        noShows: 0,
        unresolvedOutcomes: 0,
        totalDurationMinutes: 45,
      },
      sessions: [row],
      page: { page: 1, pageSize: 25, total: 1, hasMore: false },
    };

    expect(sessionReportResponseSchema.safeParse(response).success).toBe(true);

    for (const field of Object.keys(row)) expect(field).not.toMatch(financial);
    for (const field of Object.keys(response.summary)) expect(field).not.toMatch(financial);

    // Strict, so a price added to a row later fails a test rather than reaching
    // a receptionist's screen.
    expect(
      sessionReportResponseSchema.safeParse({
        ...response,
        sessions: [{ ...row, amountToman: '250000' }],
      }).success,
    ).toBe(false);
  });

  it('carry no money and no share in therapist activity, which is the domain rule', () => {
    // Therapist settlement is Milestone 8 and no part of it may be inferred
    // before then (CLAUDE.md). A session value here would be the first half of
    // a settlement calculation published before the second half was approved.
    const financial = /amount|toman|price|share|percent|settlement|earning|fee/i;
    const row = {
      therapist: { id: UUID, fullName: 'درمانگر نمونه' },
      scheduledCount: 1,
      completedCount: 4,
      cancelledCount: 1,
      attendedCount: 4,
      noShowCount: 0,
      unresolvedOutcomeCount: 0,
      attendedDurationMinutes: 180,
    };

    const response = {
      range: { ...range, dateBasis: 'SESSION_DATE' as const },
      totals: {
        therapistCount: 1,
        scheduledCount: 1,
        completedCount: 4,
        cancelledCount: 1,
        attendedCount: 4,
        noShowCount: 0,
        unresolvedOutcomeCount: 0,
        attendedDurationMinutes: 180,
      },
      therapists: [row],
    };

    expect(therapistActivityResponseSchema.safeParse(response).success).toBe(true);

    for (const field of [...Object.keys(row), ...Object.keys(response.totals)]) {
      expect(field).not.toMatch(financial);
    }

    expect(
      therapistActivityResponseSchema.safeParse({
        ...response,
        therapists: [{ ...row, therapistSharePercent: 40 }],
      }).success,
    ).toBe(false);
  });

  it('count promises and never sum them', () => {
    // A promise moves no money in any state (CLAUDE.md), so a clinic-wide
    // promised total would be a number that looks like money owed, one line
    // from the money that really is owed.
    const response = {
      range: { ...range, dateBasis: 'PROMISE_DUE_ON' as const },
      summary: { total: 2, open: 1, missed: 1, fulfilled: 0, rescheduled: 0, cancelled: 0 },
      promises: [
        {
          id: UUID,
          family,
          amountToman: '300000',
          dueOn: '2026-08-20',
          status: 'OPEN' as const,
          createdAt: '2026-08-10T09:00:00.000Z',
          resolvedAt: null,
        },
      ],
      page: { page: 1, pageSize: 25, total: 1, hasMore: false },
    };

    expect(promiseReportResponseSchema.safeParse(response).success).toBe(true);

    for (const field of Object.keys(response.summary))
      expect(field).not.toMatch(/toman|total[A-Z]/);
    expect(
      promiseReportResponseSchema.safeParse({
        ...response,
        summary: { ...response.summary, promisedTotalToman: '300000' },
      }).success,
    ).toBe(false);
  });

  it('accepts the derived MISSED word as a filter, which PostgreSQL never stores', () => {
    expect(promiseReportQuerySchema.safeParse({ ...range, status: 'MISSED' }).success).toBe(true);
    expect(promiseReportQuerySchema.safeParse({ ...range, status: 'OVERDUE' }).success).toBe(false);
  });
});

describe('the dashboard', () => {
  it('scopes the reconciliation block to the caller, and says so on the wire', () => {
    // The authority rule: a receptionist receives the payment entries THEY
    // recorded, and any count or sum there is limited to those entries.
    expect(dashboardResponseSchema.safeParse(quietDashboard).success).toBe(true);

    expect(
      dashboardResponseSchema.safeParse({
        ...quietDashboard,
        reconciliation: { ...emptyReconciliation, scope: 'CLINIC' },
      }).success,
    ).toBe(false);

    // No per-user attribution inside the caller's own block: it is one person's
    // day, so a `byUser` breakdown there could only be somebody else's money.
    expect(
      dashboardResponseSchema.safeParse({
        ...quietDashboard,
        reconciliation: { ...emptyReconciliation, byUser: [] },
      }).success,
    ).toBe(false);
  });

  it('leaves clinic-wide financial content OUT of an unauthorised response', () => {
    // ABSENT, NOT NULL AND NOT EMPTY. The unauthorised variant is a strict object
    // with no `clinicFinancial` key, so a response carrying one — even a null,
    // even a zeroed block — cannot be parsed by either tier. A leak would have to
    // change this schema rather than slip past a nullable field somebody forgot
    // to check.
    const parsed = dashboardResponseSchema.parse(quietDashboard);

    expect(parsed.financialScope).toBe('OWN_ENTRIES_ONLY');
    expect('clinicFinancial' in parsed).toBe(false);

    for (const leaked of [null, clinicFinancial]) {
      expect(
        dashboardResponseSchema.safeParse({ ...quietDashboard, clinicFinancial: leaked }).success,
      ).toBe(false);
    }

    // And the own-scoped variant carries no clinic-wide figure under any other
    // spelling either.
    expect(Object.keys(ownScopedDashboardResponseSchema.shape).sort()).toEqual(
      ['financialScope', 'date', 'appointments', 'promises', 'dataIssues', 'reconciliation'].sort(),
    );
  });

  it('gives the authorised caller the clinic-wide variant, where the block is required', () => {
    const authorised = { ...managerDashboard, clinicFinancial };
    const parsed = dashboardResponseSchema.parse(authorised);

    expect(parsed.financialScope).toBe('CLINIC_WIDE');
    expect(parsed).toHaveProperty('clinicFinancial.payments.byUser');

    // Not optional and not nullable: a CLINIC_WIDE response that cannot state the
    // clinic's day would be a variant that means nothing. A quiet day is zeros.
    const { clinicFinancial: _absent, ...withoutBlock } = authorised;
    expect(dashboardResponseSchema.safeParse(withoutBlock).success).toBe(false);
    expect(
      dashboardResponseSchema.safeParse({ ...authorised, clinicFinancial: null }).success,
    ).toBe(false);
  });

  it('makes the caller branch on a server-stated word, not on a missing key', () => {
    // The scope is the discriminator, so a consumer cannot accidentally treat an
    // unauthorised response as an empty clinic.
    expect(
      dashboardResponseSchema.safeParse({ ...quietDashboard, financialScope: 'BOTH' }).success,
    ).toBe(false);

    const { financialScope: _absent, ...withoutScope } = quietDashboard;
    expect(dashboardResponseSchema.safeParse(withoutScope).success).toBe(false);

    expect(clinicWideDashboardResponseSchema.safeParse(quietDashboard).success).toBe(false);
    expect(
      ownScopedDashboardResponseSchema.safeParse({ ...managerDashboard, clinicFinancial }).success,
    ).toBe(false);
  });

  it('reports both actionable data conditions, which are not the same condition', () => {
    // A voided charge leaves a completed, attended seat uncharged with a price
    // list that resolves perfectly; a tariff recorded after the fact removes the
    // MISSING reading and leaves the charge still unposted. Neither count implies
    // the other, so the dashboard states both.
    expect(
      dashboardResponseSchema.safeParse({
        ...quietDashboard,
        dataIssues: { missingTariffCount: 0, unchargedCompletedSessionCount: 3 },
      }).success,
    ).toBe(true);

    expect(
      dashboardResponseSchema.safeParse({
        ...quietDashboard,
        dataIssues: { missingTariffCount: 2 },
      }).success,
    ).toBe(false);

    // And nothing broader: no severity, no category vocabulary, no issue rows.
    expect(
      dashboardResponseSchema.safeParse({
        ...quietDashboard,
        dataIssues: {
          missingTariffCount: 0,
          unchargedCompletedSessionCount: 0,
          severity: 'WARNING',
        },
      }).success,
    ).toBe(false);
  });

  it('keeps the clinic-wide charge and payment figures on their own bases', () => {
    expect(
      dashboardResponseSchema.safeParse({
        ...managerDashboard,
        clinicFinancial: {
          ...clinicFinancial,
          charges: { ...clinicFinancial.charges, dateBasis: 'PAYMENT_RECEIVED_ON' },
        },
      }).success,
    ).toBe(false);
  });

  it('lets the server decide today, and echoes the day it used', () => {
    // A browser must not compute the clinic's calendar day: a receptionist
    // opening the screen at 00:30 must see the day the clinic is in.
    expect(dashboardQuerySchema.parse({}).date).toBeUndefined();
    expect(dashboardQuerySchema.safeParse({ date: '2026-08-18' }).success).toBe(true);
    // A range over this shape is a report, and reports have their own routes.
    expect(dashboardQuerySchema.safeParse({ from: '2026-08-01', to: '2026-08-31' }).success).toBe(
      false,
    );
  });
});

describe('the manager-only financial reports', () => {
  it('name the person who recorded each payment, which is why they are manager-only', () => {
    const response = {
      range: { ...range, dateBasis: 'PAYMENT_RECEIVED_ON' as const },
      totals: {
        confirmedCount: 1,
        confirmedTotalToman: '500000',
        voidedCount: 0,
        byMethod: PAYMENT_METHODS.map((method) => ({
          method,
          confirmedCount: 0,
          confirmedTotalToman: '0',
        })),
        byUser: [{ user, confirmedCount: 1, confirmedTotalToman: '500000', voidedCount: 0 }],
      },
      payments: [
        {
          id: UUID,
          family,
          amountToman: '500000',
          method: 'CASH' as const,
          receivedOn: '2026-08-13',
          status: 'CONFIRMED' as const,
          recordedAt: '2026-08-15T09:00:00.000Z',
          recordedBy: user,
        },
      ],
      page: { page: 1, pageSize: 25, total: 1, hasMore: false },
    };

    expect(paymentReportResponseSchema.safeParse(response).success).toBe(true);

    // The bank reference and the note stay on the payment record an operator
    // opens deliberately, not on a page that gets printed and left on a desk.
    for (const field of ['reference', 'note']) {
      expect(
        paymentReportResponseSchema.safeParse({
          ...response,
          payments: [{ ...response.payments[0], [field]: 'x' }],
        }).success,
      ).toBe(false);
    }
  });

  it('reuses the frozen family position rather than restating what a family owes', () => {
    const position = {
      netChargedTotalToman: '750000',
      confirmedPaymentTotalToman: '500000',
      creditToman: '0',
      amountDueToman: '250000',
      paymentCount: 1,
      voidedPaymentCount: 0,
      lastPayment: {
        id: OTHER_UUID,
        amountToman: '500000',
        method: 'CASH' as const,
        receivedOn: '2026-08-13',
        status: 'CONFIRMED' as const,
      },
      openPromiseCount: 1,
      missedPromiseCount: 0,
    };

    const response = {
      totals: {
        familyCount: 1,
        owingFamilyCount: 1,
        inCreditFamilyCount: 0,
        totalAmountDueToman: '250000',
        totalCreditToman: '0',
      },
      families: [{ family, position }],
      page: { page: 1, pageSize: 25, total: 1, hasMore: false },
    };

    expect(familyAccountReportResponseSchema.safeParse(response).success).toBe(true);

    // The position's own invariant travels with it: a family owes money or is
    // owed money, never both.
    expect(
      familyAccountReportResponseSchema.safeParse({
        ...response,
        families: [{ family, position: { ...position, creditToman: '100000' } }],
      }).success,
    ).toBe(false);
  });

  it('has no date range, because a position is not a period', () => {
    expect(Object.keys(familyAccountReportQuerySchema.shape).sort()).toEqual(
      ['page', 'pageSize', 'standing', 'includeInactive'].sort(),
    );
    expect(familyAccountReportQuerySchema.safeParse({ from: '2026-08-01' }).success).toBe(false);
  });

  it('describes standing as a closed word rather than an invented threshold', () => {
    expect([...FAMILY_ACCOUNT_STANDINGS].sort()).toEqual(['OWING', 'IN_CREDIT', 'SETTLED'].sort());
    expect(familyAccountReportQuerySchema.safeParse({ standing: 'OWING' }).success).toBe(true);
    expect(familyAccountReportQuerySchema.safeParse({ minAmountDueToman: '1' }).success).toBe(
      false,
    );
  });

  it('states no clinic balance, because one family’s credit is not another’s debt', () => {
    const financial = /^balance$|netBalance|clinicBalance/i;

    for (const field of Object.keys(familyAccountReportResponseSchema.shape.totals.shape)) {
      expect(field).not.toMatch(financial);
    }
  });

  it('shows financial history by default and hides a deactivated family by default', () => {
    // `includeVoided` defaults TRUE everywhere financial history is listed;
    // `includeInactive` defaults FALSE because a deactivated record is not
    // history, it is a record somebody retired.
    expect(paymentReportQuerySchema.parse(range).includeVoided).toBe(true);
    expect(paymentReportQuerySchema.parse({ ...range, includeVoided: 'false' }).includeVoided).toBe(
      false,
    );
    expect(familyAccountReportQuerySchema.parse({}).includeInactive).toBe(false);
    expect(therapistActivityQuerySchema.parse(range).includeInactive).toBe(false);
  });
});

describe('an empty period', () => {
  it('is a successful read of every report, never a missing resource', () => {
    // A clinic that did nothing in a week is an answer, and there is no
    // `REPORT_NOT_FOUND` anywhere in the error vocabulary.
    expect(
      sessionReportResponseSchema.safeParse({
        range: { ...range, dateBasis: 'SESSION_DATE' },
        summary: {
          total: 0,
          scheduled: 0,
          completed: 0,
          cancelled: 0,
          attended: 0,
          noShows: 0,
          unresolvedOutcomes: 0,
          totalDurationMinutes: 0,
        },
        sessions: [],
        page: emptyPage,
      }).success,
    ).toBe(true);

    expect(
      promiseReportResponseSchema.safeParse({
        range: { ...range, dateBasis: 'PROMISE_DUE_ON' },
        summary: { total: 0, open: 0, missed: 0, fulfilled: 0, rescheduled: 0, cancelled: 0 },
        promises: [],
        page: emptyPage,
      }).success,
    ).toBe(true);

    expect(
      therapistActivityResponseSchema.safeParse({
        range: { ...range, dateBasis: 'SESSION_DATE' },
        totals: {
          therapistCount: 0,
          scheduledCount: 0,
          completedCount: 0,
          cancelledCount: 0,
          attendedCount: 0,
          noShowCount: 0,
          unresolvedOutcomeCount: 0,
          attendedDurationMinutes: 0,
        },
        therapists: [],
      }).success,
    ).toBe(true);

    expect(
      familyAccountReportResponseSchema.safeParse({
        totals: {
          familyCount: 0,
          owingFamilyCount: 0,
          inCreditFamilyCount: 0,
          totalAmountDueToman: '0',
          totalCreditToman: '0',
        },
        families: [],
        page: emptyPage,
      }).success,
    ).toBe(true);
  });
});
