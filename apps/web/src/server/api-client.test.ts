import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api-client';

/**
 * The header set is the security boundary. NestJS resolves identity only from
 * `x-session-id`, and these tests pin that this module cannot be persuaded to
 * send anything else.
 */
type Captured = { url: string; init: RequestInit; headers: Headers };

let captured: Captured[] = [];

function mockFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      captured.push({ url, init, headers: new Headers(init.headers) });

      return Promise.resolve(
        new Response(status === 204 ? null : JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
}

const LOGIN_RESPONSE = {
  sessionToken: 'a-session-token',
  session: { cookieMaxAgeSeconds: 43195 },
  user: {
    id: '019fcce9-0000-7000-8000-00000000aa01',
    username: 'synthetic',
    displayName: 'Synthetic',
    role: 'MANAGER',
    mustChangePassword: false,
    permissions: ['user.read'],
  },
};

beforeEach(() => {
  captured = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('operational report reads', () => {
  it('serializes only the frozen report vocabulary and strictly parses empty successes', async () => {
    mockFetch(200, {
      range: { from: '2026-08-01', to: '2026-08-18', dateBasis: 'SESSION_DATE' },
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
      page: { page: 1, pageSize: 25, total: 0, hasMore: false },
    });
    await api.sessionReport(
      {
        from: '2026-08-01',
        to: '2026-08-18',
        page: 1,
        pageSize: 25,
        therapistId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b01',
      },
      {},
    );
    mockFetch(200, {
      range: { from: '2026-08-01', to: '2026-08-18', dateBasis: 'PROMISE_DUE_ON' },
      summary: { total: 0, open: 0, missed: 0, fulfilled: 0, rescheduled: 0, cancelled: 0 },
      promises: [],
      page: { page: 1, pageSize: 25, total: 0, hasMore: false },
    });
    await api.promiseReport(
      { from: '2026-08-01', to: '2026-08-18', page: 1, pageSize: 25, status: 'MISSED' },
      {},
    );
    mockFetch(200, {
      range: { from: '2026-08-01', to: '2026-08-18', dateBasis: 'SESSION_DATE' },
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
    });
    await api.therapistActivityReport(
      { from: '2026-08-01', to: '2026-08-18', includeInactive: false },
      {},
    );

    const urls = captured.map(({ url }) => new URL(url));
    expect(urls.map((url) => url.pathname)).toEqual([
      '/reports/sessions',
      '/reports/promises',
      '/reports/therapist-activity',
    ]);
    expect(Object.fromEntries(urls[0]!.searchParams)).toEqual({
      from: '2026-08-01',
      to: '2026-08-18',
      page: '1',
      pageSize: '25',
      therapistId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b01',
    });
    expect(Object.fromEntries(urls[1]!.searchParams)).toEqual({
      from: '2026-08-01',
      to: '2026-08-18',
      page: '1',
      pageSize: '25',
      status: 'MISSED',
    });
    expect(Object.fromEntries(urls[2]!.searchParams)).toEqual({
      from: '2026-08-01',
      to: '2026-08-18',
      includeInactive: 'false',
    });
  });
});

describe('financial report reads', () => {
  const familyId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d01';
  const userId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d02';

  it('serializes receipt-date, closed enum, opaque id, and paging filters exactly', async () => {
    mockFetch(200, {
      range: { from: '2026-08-01', to: '2026-08-18', dateBasis: 'PAYMENT_RECEIVED_ON' },
      totals: {
        confirmedCount: 0,
        confirmedTotalToman: '0',
        voidedCount: 0,
        byMethod: [
          { method: 'CASH', confirmedCount: 0, confirmedTotalToman: '0' },
          { method: 'CARD', confirmedCount: 0, confirmedTotalToman: '0' },
          { method: 'TRANSFER', confirmedCount: 0, confirmedTotalToman: '0' },
        ],
        byUser: [],
      },
      payments: [],
      page: { page: 2, pageSize: 25, total: 0, hasMore: false },
    });
    await api.paymentReport(
      {
        from: '2026-08-01',
        to: '2026-08-18',
        page: 2,
        pageSize: 25,
        familyId,
        method: 'CARD',
        recordedByUserId: userId,
        includeVoided: false,
      },
      {},
    );

    const request = captured[0] as Captured;
    const url = new URL(request.url);
    expect(url.pathname).toBe('/reports/payments');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      from: '2026-08-01',
      to: '2026-08-18',
      page: '2',
      pageSize: '25',
      familyId,
      method: 'CARD',
      recordedByUserId: userId,
      includeVoided: 'false',
    });
    expect(request.init.cache).toBe('no-store');
  });

  it('strictly consumes empty family-account totals without deriving a balance', async () => {
    mockFetch(200, {
      totals: {
        familyCount: 0,
        owingFamilyCount: 0,
        inCreditFamilyCount: 0,
        totalAmountDueToman: '0',
        totalCreditToman: '0',
      },
      families: [],
      page: { page: 1, pageSize: 25, total: 0, hasMore: false },
    });
    const result = await api.familyAccountReport(
      { page: 1, pageSize: 25, standing: 'OWING', includeInactive: true },
      {},
    );

    expect(result.ok && result.data.totals.totalAmountDueToman).toBe('0');
    const url = new URL((captured[0] as Captured).url);
    expect(url.pathname).toBe('/reports/family-accounts');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      page: '1',
      pageSize: '25',
      standing: 'OWING',
      includeInactive: 'true',
    });
  });
});

describe('outbound headers', () => {
  it('always sends the internal key and a generated request id', async () => {
    mockFetch(200, LOGIN_RESPONSE);

    await api.login({ username: 'synthetic', password: 'quiet harbour lantern drift' }, {});

    const headers = captured[0]?.headers as Headers;
    expect(headers.get('x-internal-key')).toBe(process.env['INTERNAL_API_KEY']);
    expect(headers.get('x-request-id')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('generates a fresh request id per call rather than reusing one', async () => {
    mockFetch(200, LOGIN_RESPONSE);

    await api.login({ username: 'a', password: 'b' }, {});
    await api.login({ username: 'a', password: 'b' }, {});

    expect(captured[0]?.headers.get('x-request-id')).not.toBe(
      captured[1]?.headers.get('x-request-id'),
    );
  });

  it('sends x-session-id only when a verified token is supplied', async () => {
    mockFetch(200, { user: LOGIN_RESPONSE.user });

    await api.session({});
    expect(captured[0]?.headers.get('x-session-id')).toBeNull();

    await api.session({ sessionToken: 'verified-token' });
    expect(captured[1]?.headers.get('x-session-id')).toBe('verified-token');
  });

  it('sends client address and user agent only when present', async () => {
    mockFetch(200, LOGIN_RESPONSE);

    await api.login({ username: 'a', password: 'b' }, { clientIp: null, userAgent: null });
    expect(captured[0]?.headers.get('x-client-ip')).toBeNull();
    expect(captured[0]?.headers.get('x-client-user-agent')).toBeNull();

    await api.login(
      { username: 'a', password: 'b' },
      { clientIp: '192.0.2.10', userAgent: 'Synthetic/1.0' },
    );
    expect(captured[1]?.headers.get('x-client-ip')).toBe('192.0.2.10');
    expect(captured[1]?.headers.get('x-client-user-agent')).toBe('Synthetic/1.0');
  });

  it('truncates an oversized user agent', async () => {
    mockFetch(200, LOGIN_RESPONSE);

    await api.login({ username: 'a', password: 'b' }, { userAgent: 'u'.repeat(1000) });

    // The NestJS column is capped by a CHECK constraint; truncating here means
    // an over-long value cannot fail the whole audit write.
    expect(captured[0]?.headers.get('x-client-user-agent')).toHaveLength(256);
  });

  it('sends no identity, authorization or permission header at all', async () => {
    mockFetch(200, { user: LOGIN_RESPONSE.user });

    await api.session({ sessionToken: 'verified-token' });

    const names = [...(captured[0]?.headers as Headers).keys()];

    // The module exposes no header bag, so there is no parameter through which
    // a browser-supplied claim could travel. This asserts the resulting set.
    expect(names.sort()).toEqual(['accept', 'x-internal-key', 'x-request-id', 'x-session-id']);
    for (const forbidden of [
      'x-user-id',
      'x-user-role',
      'x-permissions',
      'authorization',
      'cookie',
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });
});

describe('response handling', () => {
  it('parses a success against the strict contract', async () => {
    mockFetch(200, LOGIN_RESPONSE);

    const result = await api.login({ username: 'a', password: 'b' }, {});

    expect(result.ok).toBe(true);
    expect(result.ok && result.data.user.username).toBe('synthetic');
  });

  it('rejects a response carrying an unexpected field', async () => {
    // A serialised password hash is the case that matters. The strict schema
    // turns it into a thrown error rather than something rendered.
    mockFetch(200, {
      ...LOGIN_RESPONSE,
      user: { ...LOGIN_RESPONSE.user, passwordHash: '$argon2id$leaked' },
    });

    await expect(api.login({ username: 'a', password: 'b' }, {})).rejects.toThrow();
  });

  it('surfaces a contract error code', async () => {
    mockFetch(401, {
      error: {
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'Invalid credentials',
        requestId: '019fcce9-0000-7000-8000-00000000bb01',
      },
    });

    const result = await api.login({ username: 'a', password: 'b' }, {});

    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('reports an unreachable API without leaking transport detail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.5:3001'))),
    );

    const result = await api.login({ username: 'a', password: 'b' }, {});

    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe('API_UNREACHABLE');
    expect(JSON.stringify(result)).not.toContain('10.0.0.5');
  });

  it('handles a 204 with no body', async () => {
    mockFetch(204, null);

    const result = await api.logout({ sessionToken: 'verified-token' });

    expect(result.ok).toBe(true);
  });
});

describe('frozen dashboard endpoint', () => {
  const ownDashboard = {
    financialScope: 'OWN_ENTRIES_ONLY',
    date: '2026-08-18',
    availabilityOverrideCount: 0,
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
    reconciliation: {
      scope: 'RECORDED_BY_ME',
      dateBasis: 'PAYMENT_RECORDED_AT',
      confirmedCount: 0,
      confirmedTotalToman: '0',
      voidedCount: 0,
      byMethod: [
        { method: 'CASH', count: 0, totalToman: '0' },
        { method: 'CARD', count: 0, totalToman: '0' },
        { method: 'TRANSFER', count: 0, totalToman: '0' },
      ],
      entries: [],
    },
  };

  it('uses the named no-store GET and lets NestJS choose the default clinic day', async () => {
    mockFetch(200, ownDashboard);

    const result = await api.dashboard({}, { sessionToken: 'verified-token' });

    expect(result.ok && result.data.financialScope).toBe('OWN_ENTRIES_ONLY');
    expect(new URL((captured[0] as Captured).url).pathname).toBe('/dashboard');
    expect(new URL((captured[0] as Captured).url).search).toBe('');
    expect(captured[0]?.init.method).toBe('GET');
    expect(captured[0]?.init.cache).toBe('no-store');
  });

  it('passes an explicit review date without adding any local aggregate input', async () => {
    mockFetch(200, ownDashboard);

    await api.dashboard({ date: '2026-08-17' }, { sessionToken: 'verified-token' });

    expect(new URL((captured[0] as Captured).url).searchParams.toString()).toBe('date=2026-08-17');
  });

  it('rejects an own-scoped response that leaks a clinic financial key', async () => {
    mockFetch(200, { ...ownDashboard, clinicFinancial: null });

    await expect(api.dashboard({}, { sessionToken: 'verified-token' })).rejects.toThrow();
  });
});

describe('availability endpoints', () => {
  const therapistId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a60';
  const exceptionId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a61';

  it('replaces the whole recurring set with PUT', async () => {
    mockFetch(200, {
      windows: [
        {
          id: exceptionId,
          therapistId,
          weekday: 0,
          startTime: '09:00',
          endTime: '13:00',
          createdAt: '2026-08-13T00:00:00.000Z',
        },
      ],
    });

    await api.replaceAvailabilityWindows(
      therapistId,
      { windows: [{ weekday: 0, startTime: '09:00', endTime: '13:00' }] },
      { sessionToken: 'verified-token' },
    );

    expect(captured[0]?.url).toContain(`/availability/therapists/${therapistId}/windows`);
    expect(captured[0]?.init.method).toBe('PUT');
    expect(JSON.parse(String(captured[0]?.init.body))).toEqual({
      windows: [{ weekday: 0, startTime: '09:00', endTime: '13:00' }],
    });
  });

  it('adds and removes dated exceptions through distinct methods', async () => {
    mockFetch(201, {
      exception: {
        id: exceptionId,
        therapistId,
        exceptionDate: '2026-08-15',
        isAvailable: false,
        startTime: null,
        endTime: null,
        reason: 'مرخصی',
        createdAt: '2026-08-13T00:00:00.000Z',
      },
    });
    await api.addAvailabilityException(
      therapistId,
      { isAvailable: false, exceptionDate: '2026-08-15', reason: 'مرخصی' },
      { sessionToken: 'verified-token' },
    );
    expect(captured[0]?.init.method).toBe('POST');

    mockFetch(204, null);
    await api.removeAvailabilityException(therapistId, exceptionId, {
      sessionToken: 'verified-token',
    });
    expect(captured[1]?.url).toContain(`/exceptions/${exceptionId}`);
    expect(captured[1]?.init.method).toBe('DELETE');
  });

  it('asks the API for the resolved answer rather than composing it in Web', async () => {
    mockFetch(200, {
      availability: {
        therapistId,
        date: '2026-08-15',
        weekday: 0,
        isClosed: true,
        closedReason: 'مرخصی',
        windows: [{ startTime: '15:00', endTime: '18:00' }],
      },
    });

    await api.resolveAvailability(
      { therapistId, date: '2026-08-15' },
      { sessionToken: 'verified-token' },
    );

    expect(captured[0]?.url).toContain('/availability/resolution?');
    expect(captured[0]?.url).toContain(`therapistId=${therapistId}`);
    expect(captured[0]?.url).toContain('date=2026-08-15');
    expect(captured[0]?.init.method).toBe('GET');
  });
});

describe('frozen ledger endpoints', () => {
  const familyId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b01';
  const childId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b02';
  const appointmentId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b03';
  const participantId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b04';
  const chargeId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b05';
  const adjustmentId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b06';

  const charge = {
    id: chargeId,
    familyId,
    childId,
    appointmentId,
    appointmentParticipantId: participantId,
    serviceId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b07',
    therapistId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b08',
    durationMinutes: 45,
    serviceDate: '2026-08-14',
    tariffId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b09',
    priceMode: 'PAID',
    amountToman: '1500000',
    createdAt: '2026-08-14T01:00:00.000Z',
    createdByUserId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b10',
    voidedAt: null,
    voidedByUserId: null,
    voidReason: null,
    adjustments: [],
    activeAdjustmentTotalToman: '0',
    effectiveAmountToman: '1500000',
  };

  it('reads a filtered family account as a server-only no-store request', async () => {
    mockFetch(200, {
      familyId,
      totals: {
        chargedTotalToman: '1500000',
        adjustmentTotalToman: '0',
        netChargedTotalToman: '1500000',
        chargeCount: 1,
        voidedChargeCount: 0,
      },
      position: {
        netChargedTotalToman: '1500000',
        confirmedPaymentTotalToman: '0',
        creditToman: '0',
        amountDueToman: '1500000',
        paymentCount: 0,
        voidedPaymentCount: 0,
        lastPayment: null,
        openPromiseCount: 0,
        missedPromiseCount: 0,
      },
      charges: [
        {
          charge,
          child: { id: childId, firstName: 'Test', lastName: 'Child', fileNumber: '1405000001' },
          service: { id: charge.serviceId, name: 'Test service' },
          therapist: { id: charge.therapistId, fullName: 'Test therapist' },
        },
      ],
      page: { page: 2, pageSize: 10, total: 11, hasMore: false },
    });

    await api.getFamilyAccount(
      familyId,
      {
        page: 2,
        pageSize: 10,
        includeVoided: false,
        childId,
        from: '2026-08-01',
        to: '2026-08-14',
      },
      { sessionToken: 'verified-token' },
    );

    const request = captured[0] as Captured;
    const url = new URL(request.url);
    expect(url.pathname).toBe(`/families/${familyId}/account`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      page: '2',
      pageSize: '10',
      includeVoided: 'false',
      childId,
      from: '2026-08-01',
      to: '2026-08-14',
    });
    expect(request.init.method).toBe('GET');
    expect(request.init.cache).toBe('no-store');
  });

  it('posts a participant charge with the frozen empty request body', async () => {
    mockFetch(200, { outcome: 'POSTED', charge });

    await api.postSessionCharge(participantId, { sessionToken: 'verified-token' });

    const url = new URL((captured[0] as Captured).url);
    expect(url.pathname).toBe(`/session-charges/participants/${participantId}`);
    expect(url.search).toBe('');
    expect(captured[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(captured[0]?.init.body))).toEqual({});
  });

  it('reads appointment charge state by participant without a generic lookup', async () => {
    // The frozen `sessionChargeResponse` envelope NestJS actually answers with,
    // not a bare charge: parsing the wrong one fails on every charged seat.
    mockFetch(200, { charge });

    const result = await api.getParticipantSessionCharge(participantId, {
      sessionToken: 'verified-token',
    });

    expect(new URL((captured[0] as Captured).url).pathname).toBe(
      `/session-charges/participants/${participantId}`,
    );
    expect(captured[0]?.init.method).toBe('GET');
    expect(captured[0]?.init.cache).toBe('no-store');
    expect(result.ok && result.data).toEqual(charge);
  });

  it('exposes only the three frozen correction writes with typed bodies', async () => {
    mockFetch(200, { charge });

    await api.voidSessionCharge(chargeId, { reason: 'wrong session' }, { sessionToken: 'token' });
    await api.createChargeAdjustment(
      chargeId,
      { amountToman: '250000', reason: 'clinic waiver' },
      { sessionToken: 'token' },
    );
    await api.voidChargeAdjustment(
      chargeId,
      adjustmentId,
      { reason: 'waiver entered in error' },
      { sessionToken: 'token' },
    );

    expect(
      captured.map((request) => [
        new URL(request.url).pathname,
        JSON.parse(String(request.init.body)),
      ]),
    ).toEqual([
      [`/session-charges/${chargeId}/void`, { reason: 'wrong session' }],
      [
        `/session-charges/${chargeId}/adjustments`,
        { amountToman: '250000', reason: 'clinic waiver' },
      ],
      [
        `/session-charges/${chargeId}/adjustments/${adjustmentId}/void`,
        { reason: 'waiver entered in error' },
      ],
    ]);
    expect(captured.every((request) => request.init.method === 'POST')).toBe(true);
    expect(captured.every((request) => request.init.cache === 'no-store')).toBe(true);
  });
});

describe('frozen payment and promise endpoints', () => {
  const familyId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4c01';
  const paymentId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4c02';
  const promiseId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4c03';
  const successorId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4c04';
  const userId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4c05';

  const payment = {
    id: paymentId,
    familyId,
    amountToman: '700000',
    method: 'CARD',
    receivedOn: '2026-08-15',
    reference: 'synthetic-ref',
    note: null,
    status: 'CONFIRMED',
    createdAt: '2026-08-15T08:00:00.000Z',
    createdByUserId: userId,
    voidedAt: null,
    voidedByUserId: null,
    voidReason: null,
  };

  const openPromise = {
    id: promiseId,
    familyId,
    amountToman: '700000',
    dueOn: '2026-08-20',
    note: 'synthetic promise',
    status: 'OPEN',
    createdAt: '2026-08-15T08:00:00.000Z',
    createdByUserId: userId,
    resolvedAt: null,
    resolvedByUserId: null,
    resolutionReason: null,
    fulfillingPayment: null,
    rescheduledToPromiseId: null,
    rescheduledFromPromiseId: null,
  };

  it('uses the frozen family-scoped create and list routes with typed queries', async () => {
    mockFetch(200, { payment });
    await api.createPayment(
      familyId,
      { amountToman: '700000', method: 'CARD', receivedOn: '2026-08-15' },
      { sessionToken: 'token' },
    );

    mockFetch(200, {
      familyId,
      payments: [payment],
      page: { page: 2, pageSize: 10, total: 1, hasMore: false },
    });
    const payments = await api.listPayments(
      familyId,
      { page: 2, pageSize: 10, includeVoided: false, from: '2026-08-01', to: '2026-08-15' },
      { sessionToken: 'token' },
    );

    mockFetch(200, { promise: openPromise });
    await api.createPromise(
      familyId,
      { amountToman: '700000', dueOn: '2026-08-20' },
      { sessionToken: 'token' },
    );

    mockFetch(200, {
      familyId,
      promises: [openPromise],
      page: { page: 1, pageSize: 25, total: 1, hasMore: false },
    });
    const promises = await api.listPromises(
      familyId,
      { page: 1, pageSize: 25, status: 'OPEN' },
      { sessionToken: 'token' },
    );

    expect(payments.ok && payments.data.payments[0]?.status).toBe('CONFIRMED');
    expect(promises.ok && promises.data.promises[0]?.status).toBe('OPEN');
    expect(
      captured.map((request) => {
        const url = new URL(request.url);
        return [request.init.method, url.pathname, Object.fromEntries(url.searchParams)];
      }),
    ).toEqual([
      ['POST', `/families/${familyId}/payments`, {}],
      [
        'GET',
        `/families/${familyId}/payments`,
        { page: '2', pageSize: '10', includeVoided: 'false', from: '2026-08-01', to: '2026-08-15' },
      ],
      ['POST', `/families/${familyId}/promises`, {}],
      ['GET', `/families/${familyId}/promises`, { page: '1', pageSize: '25', status: 'OPEN' }],
    ]);
  });

  it('supports every frozen resolution route and strictly parses its response', async () => {
    mockFetch(200, {
      payment: {
        ...payment,
        status: 'VOIDED',
        voidedAt: '2026-08-16T08:00:00.000Z',
        voidedByUserId: userId,
        voidReason: 'synthetic correction',
      },
    });
    await api.voidPayment(paymentId, { reason: 'synthetic correction' }, {});

    mockFetch(200, {
      promise: {
        ...openPromise,
        status: 'FULFILLED',
        resolvedAt: '2026-08-16T08:00:00.000Z',
        resolvedByUserId: userId,
        fulfillingPayment: {
          id: paymentId,
          amountToman: '700000',
          method: 'CARD',
          receivedOn: '2026-08-15',
          status: 'CONFIRMED',
        },
      },
    });
    await api.fulfillPromise(promiseId, { paymentId }, {});

    const successor = {
      ...openPromise,
      id: successorId,
      dueOn: '2026-08-30',
      rescheduledFromPromiseId: promiseId,
    };
    mockFetch(200, {
      promise: {
        ...openPromise,
        status: 'RESCHEDULED',
        resolvedAt: '2026-08-16T08:00:00.000Z',
        resolvedByUserId: userId,
        resolutionReason: 'synthetic new date',
        rescheduledToPromiseId: successorId,
      },
      successor,
    });
    await api.reschedulePromise(
      promiseId,
      { dueOn: '2026-08-30', reason: 'synthetic new date' },
      {},
    );

    mockFetch(200, {
      promise: {
        ...openPromise,
        status: 'CANCELLED',
        resolvedAt: '2026-08-16T08:00:00.000Z',
        resolvedByUserId: userId,
        resolutionReason: 'synthetic cancellation',
      },
    });
    await api.cancelPromise(promiseId, { reason: 'synthetic cancellation' }, {});

    expect(captured.map((request) => new URL(request.url).pathname)).toEqual([
      `/payments/${paymentId}/void`,
      `/promises/${promiseId}/fulfill`,
      `/promises/${promiseId}/reschedule`,
      `/promises/${promiseId}/cancel`,
    ]);

    mockFetch(200, { payment: { ...payment, status: 'VOIDED' } });
    await expect(
      api.createPayment(
        familyId,
        { amountToman: '1', method: 'CASH', receivedOn: '2026-08-15' },
        {},
      ),
    ).rejects.toThrow();
  });
});
