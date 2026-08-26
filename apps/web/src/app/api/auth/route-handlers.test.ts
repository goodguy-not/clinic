import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cookieConfigFor } from '@/server/cookie-config';
import { issueCsrfToken, verifyCsrfToken } from '@/server/csrf';
import { signSessionCookie, verifySessionCookie } from '@/server/session-cookie';
import { POST as login } from './login/route';
import { POST as logout } from './logout/route';
import { GET as sessionResetGet, POST as sessionResetPost } from './session-reset/route';

const SECRET = process.env['SESSION_COOKIE_SECRET'] as string;
const DEV = cookieConfigFor('non-production');
const ORIGIN = 'http://localhost:3000';
const SESSION_TOKEN = 'a-synthetic-session-token-value';

const LOGIN_RESPONSE = {
  sessionToken: SESSION_TOKEN,
  session: { cookieMaxAgeSeconds: 43195 },
  user: {
    id: '019fcce9-0000-7000-8000-00000000aa01',
    username: 'synthetic',
    displayName: 'Synthetic',
    role: 'RECEPTIONIST',
    mustChangePassword: false,
    permissions: [],
  },
};

function post(
  path: string,
  options: {
    origin?: string | null;
    cookies?: Record<string, string>;
    body?: Record<string, string>;
  } = {},
): NextRequest {
  const cookieHeader = Object.entries(options.cookies ?? {})
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');

  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
  };
  if (options.origin !== null) headers['origin'] = options.origin ?? ORIGIN;
  if (cookieHeader !== '') headers['cookie'] = cookieHeader;

  return new NextRequest(`${ORIGIN}${path}`, {
    method: 'POST',
    headers,
    body: new URLSearchParams(options.body ?? {}).toString(),
  });
}

const setCookieNames = (response: { cookies: { getAll: () => { name: string }[] } }): string[] =>
  response.cookies.getAll().map((cookie) => cookie.name);

const rawSetCookies = (response: Response): string[] => response.headers.getSetCookie?.() ?? [];

function mockApi(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(status === 204 ? null : JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ),
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/auth/login', () => {
  const unbound = () => issueCsrfToken(SECRET, 'unauthenticated', 1800);

  it('signs in, writes both cookies once, and redirects to a fixed path', async () => {
    mockApi(200, LOGIN_RESPONSE);
    const token = unbound();

    const response = await login(
      post('/api/auth/login', {
        cookies: { [DEV.csrf.name]: token },
        body: { csrfToken: token, username: 'synthetic', password: 'quiet harbour lantern drift' },
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/dashboard`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');

    // One header per name, and no deletion anywhere.
    expect(setCookieNames(response).sort()).toEqual([DEV.csrf.name, DEV.session.name].sort());
    expect(rawSetCookies(response)).toHaveLength(2);
    expect(rawSetCookies(response).join(';')).not.toContain('Max-Age=0');
  });

  it('uses the lifetime NestJS computed, verbatim', async () => {
    mockApi(200, LOGIN_RESPONSE);
    const token = unbound();

    const response = await login(
      post('/api/auth/login', {
        cookies: { [DEV.csrf.name]: token },
        body: { csrfToken: token, username: 'synthetic', password: 'quiet harbour lantern drift' },
      }),
    );

    // Not recomputed from the Node clock: the web tier must not become a second
    // security clock.
    expect(rawSetCookies(response).join(';')).toContain('Max-Age=43195');
  });

  it('writes a session cookie carrying only the signed token', async () => {
    mockApi(200, LOGIN_RESPONSE);
    const token = unbound();

    const response = await login(
      post('/api/auth/login', {
        cookies: { [DEV.csrf.name]: token },
        body: { csrfToken: token, username: 'synthetic', password: 'quiet harbour lantern drift' },
      }),
    );

    const value = response.cookies.get(DEV.session.name)?.value as string;
    expect(verifySessionCookie(SECRET, value)).toBe(SESSION_TOKEN);
  });

  it('rebinds CSRF to the new session so the pre-login token cannot be replayed', async () => {
    mockApi(200, LOGIN_RESPONSE);
    const token = unbound();

    const response = await login(
      post('/api/auth/login', {
        cookies: { [DEV.csrf.name]: token },
        body: { csrfToken: token, username: 'synthetic', password: 'quiet harbour lantern drift' },
      }),
    );

    const issued = response.cookies.get(DEV.csrf.name)?.value;
    expect(verifyCsrfToken(SECRET, issued, { sessionToken: SESSION_TOKEN })).toBe(true);
    expect(verifyCsrfToken(SECRET, issued, 'unauthenticated')).toBe(false);
  });

  it('sends a user owing a password change to /change-password', async () => {
    mockApi(200, {
      ...LOGIN_RESPONSE,
      user: { ...LOGIN_RESPONSE.user, mustChangePassword: true },
    });
    const token = unbound();

    const response = await login(
      post('/api/auth/login', {
        cookies: { [DEV.csrf.name]: token },
        body: { csrfToken: token, username: 'synthetic', password: 'quiet harbour lantern drift' },
      }),
    );

    expect(response.headers.get('location')).toBe(`${ORIGIN}/change-password`);
  });

  it.each([
    ['missing origin', null],
    ['foreign origin', 'https://evil.test'],
    ['malformed origin', 'not-a-url'],
  ])('refuses a request with a %s', async (_label, origin) => {
    const token = unbound();

    const response = await login(
      post('/api/auth/login', {
        origin,
        cookies: { [DEV.csrf.name]: token },
        body: { csrfToken: token, username: 'synthetic', password: 'x' },
      }),
    );

    expect(response.status).toBe(403);
    expect(setCookieNames(response)).toEqual([]);
  });

  it.each([
    ['no CSRF cookie', {}, { csrfToken: 'anything' }],
    ['no submitted token', { [DEV.csrf.name]: 'cookie-value' }, {}],
    ['mismatched copies', { [DEV.csrf.name]: 'cookie-value' }, { csrfToken: 'other-value' }],
  ])('refuses a request with %s', async (_label, cookies, extra) => {
    const response = await login(
      post('/api/auth/login', {
        cookies,
        body: { ...extra, username: 'synthetic', password: 'x' },
      }),
    );

    expect(response.status).toBe(403);
    expect(setCookieNames(response)).toEqual([]);
  });

  it('refuses a session-bound token presented at login', async () => {
    const bound = issueCsrfToken(SECRET, { sessionToken: 'some-session' }, 1800);

    const response = await login(
      post('/api/auth/login', {
        cookies: { [DEV.csrf.name]: bound },
        body: { csrfToken: bound, username: 'synthetic', password: 'x' },
      }),
    );

    expect(response.status).toBe(403);
  });

  it('reports a failure generically and sets no cookie', async () => {
    mockApi(401, {
      error: {
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'Invalid credentials',
        requestId: '019fcce9-0000-7000-8000-00000000bb01',
      },
    });
    const token = unbound();

    const response = await login(
      post('/api/auth/login', {
        cookies: { [DEV.csrf.name]: token },
        body: { csrfToken: token, username: 'synthetic', password: 'wrong' },
      }),
    );

    const location = new URL(response.headers.get('location') as string);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('error')).toBe('AUTH_INVALID_CREDENTIALS');
    expect(setCookieNames(response)).toEqual([]);
  });

  it('rejects a malformed username without distinguishing it to the user', async () => {
    const token = unbound();

    const response = await login(
      post('/api/auth/login', {
        cookies: { [DEV.csrf.name]: token },
        body: { csrfToken: token, username: 'Has Capitals', password: 'x' },
      }),
    );

    // Strict contract parsing, but the same generic code: the interface must not
    // reintroduce a distinction the API removed.
    expect(new URL(response.headers.get('location') as string).searchParams.get('error')).toBe(
      'AUTH_INVALID_CREDENTIALS',
    );
  });

  it('never puts a token in the redirect', async () => {
    mockApi(200, LOGIN_RESPONSE);
    const token = unbound();

    const response = await login(
      post('/api/auth/login', {
        cookies: { [DEV.csrf.name]: token },
        body: { csrfToken: token, username: 'synthetic', password: 'quiet harbour lantern drift' },
      }),
    );

    const location = response.headers.get('location') as string;
    expect(location).not.toContain(SESSION_TOKEN);
    expect(location).not.toContain(token);
    expect(new URL(location).search).toBe('');
  });
});

describe('POST /api/auth/logout', () => {
  it('deletes the session cookie once and replaces CSRF with an unbound token', async () => {
    mockApi(204, null);
    const bound = issueCsrfToken(SECRET, { sessionToken: SESSION_TOKEN }, 1800);

    const response = await logout(
      post('/api/auth/logout', {
        cookies: {
          [DEV.session.name]: signSessionCookie(SECRET, SESSION_TOKEN),
          [DEV.csrf.name]: bound,
        },
        body: { csrfToken: bound },
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/login`);

    const raw = rawSetCookies(response);
    expect(raw).toHaveLength(2);

    const session = raw.find((line) => line.startsWith(DEV.session.name)) as string;
    const csrf = raw.find((line) => line.startsWith(DEV.csrf.name)) as string;

    // Session deleted, CSRF replaced — never delete-then-set.
    expect(session).toContain('Max-Age=0');
    expect(csrf).not.toContain('Max-Age=0');
    expect(
      verifyCsrfToken(SECRET, response.cookies.get(DEV.csrf.name)?.value, 'unauthenticated'),
    ).toBe(true);
  });

  it('refuses an unbound token from a signed-in caller', async () => {
    const unbound = issueCsrfToken(SECRET, 'unauthenticated', 1800);

    const response = await logout(
      post('/api/auth/logout', {
        cookies: {
          [DEV.session.name]: signSessionCookie(SECRET, SESSION_TOKEN),
          [DEV.csrf.name]: unbound,
        },
        body: { csrfToken: unbound },
      }),
    );

    expect(response.status).toBe(403);
  });
});

describe('/api/auth/session-reset', () => {
  it('returns 405 with Allow: POST on GET and mutates nothing', () => {
    const response = sessionResetGet();

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    // SameSite=Lax would send cookies on a cross-site top-level GET, so a
    // cookie-clearing GET would be a forced-logout vector.
    expect(rawSetCookies(response)).toEqual([]);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('clears the session and lands on /login', async () => {
    const response = await sessionResetPost(
      post('/api/auth/session-reset', {
        cookies: { [DEV.session.name]: 'v1.tampered.value' },
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/login`);

    const raw = rawSetCookies(response);
    expect(raw).toHaveLength(2);
    expect(raw.find((l) => l.startsWith(DEV.session.name))).toContain('Max-Age=0');
    expect(
      verifyCsrfToken(SECRET, response.cookies.get(DEV.csrf.name)?.value, 'unauthenticated'),
    ).toBe(true);
  });

  it('works with no cookies at all, so it is safe to reach in any state', async () => {
    const response = await sessionResetPost(post('/api/auth/session-reset'));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/login`);
  });

  it('requires no CSRF token — the documented exemption', async () => {
    // Recovery must stay reachable for users whose cookie state is broken.
    const response = await sessionResetPost(post('/api/auth/session-reset', { body: {} }));

    expect(response.status).toBe(303);
  });

  it('still enforces strict Origin', async () => {
    const missing = await sessionResetPost(post('/api/auth/session-reset', { origin: null }));
    const foreign = await sessionResetPost(
      post('/api/auth/session-reset', { origin: 'https://evil.test' }),
    );

    expect(missing.status).toBe(403);
    expect(foreign.status).toBe(403);
    expect(rawSetCookies(missing)).toEqual([]);
    expect(rawSetCookies(foreign)).toEqual([]);
  });

  it('accepts no return URL', async () => {
    const request = new NextRequest(
      `${ORIGIN}/api/auth/session-reset?next=https://evil.test&returnTo=/staff`,
      { method: 'POST', headers: { origin: ORIGIN } },
    );

    const response = await sessionResetPost(request);

    expect(response.headers.get('location')).toBe(`${ORIGIN}/login`);
  });

  it('makes no call to NestJS', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await sessionResetPost(post('/api/auth/session-reset'));

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
