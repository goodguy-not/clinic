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
    mockFetch(200, charge);

    await api.getParticipantSessionCharge(participantId, { sessionToken: 'verified-token' });

    expect(new URL((captured[0] as Captured).url).pathname).toBe(
      `/appointment-participants/${participantId}/session-charge`,
    );
    expect(captured[0]?.init.method).toBe('GET');
    expect(captured[0]?.init.cache).toBe('no-store');
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
      [`/charge-adjustments/${adjustmentId}/void`, { reason: 'waiver entered in error' }],
    ]);
    expect(captured.every((request) => request.init.method === 'POST')).toBe(true);
    expect(captured.every((request) => request.init.cache === 'no-store')).toBe(true);
  });
});
