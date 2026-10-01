import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cookieConfigFor } from '@/server/cookie-config';
import { issueCsrfToken, verifyCsrfToken } from '@/server/csrf';
import { proxy } from './proxy';

const SECRET = process.env['SESSION_COOKIE_SECRET'] as string;
const DEV = cookieConfigFor('non-production');

function get(
  url = 'http://localhost:3000/login',
  cookies: Record<string, string> = {},
  headers: Record<string, string> = {},
): NextRequest {
  const cookieHeader = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');

  return new NextRequest(url, {
    method: 'GET',
    headers: { ...(cookieHeader === '' ? {} : { cookie: cookieHeader }), ...headers },
  });
}

const setCookieNames = (response: { cookies: { getAll: () => { name: string }[] } }): string[] =>
  response.cookies.getAll().map((cookie) => cookie.name);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('first visit', () => {
  it('sets exactly one CSRF cookie and redirects once to the canonical /login', () => {
    const response = proxy(get());

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
    expect(setCookieNames(response)).toEqual([DEV.csrf.name]);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('issues a token that verifies against the unauthenticated binding', () => {
    const response = proxy(get());
    const token = response.cookies.get(DEV.csrf.name)?.value;

    expect(verifyCsrfToken(SECRET, token, 'unauthenticated')).toBe(true);
    // Not usable after login: the binding differs.
    expect(verifyCsrfToken(SECRET, token, { sessionToken: 'anything' })).toBe(false);
  });
});

describe('the redirect terminates', () => {
  it('passes the second request through without redirecting or setting a cookie', () => {
    const first = proxy(get());
    const token = first.cookies.get(DEV.csrf.name)?.value as string;

    const second = proxy(get('http://localhost:3000/login', { [DEV.csrf.name]: token }));

    // No status 303 and no Set-Cookie: this is what makes the chain finite.
    expect(second.status).not.toBe(303);
    expect(setCookieNames(second)).toEqual([]);
  });

  it('leaves a valid cookie alone, so a form open in another tab keeps working', () => {
    const token = issueCsrfToken(SECRET, 'unauthenticated', 1800);
    const response = proxy(get('http://localhost:3000/login', { [DEV.csrf.name]: token }));

    expect(setCookieNames(response)).toEqual([]);
  });

  it.each([
    ['malformed', 'not-a-token'],
    ['empty', ''],
    [
      'wrong secret',
      issueCsrfToken('a_completely_different_secret_0123456789', 'unauthenticated', 1800),
    ],
    ['expired', issueCsrfToken(SECRET, 'unauthenticated', 1, 1_000_000_000_000)],
    ['session-bound', issueCsrfToken(SECRET, { sessionToken: 'tok' }, 1800)],
  ])('replaces an unusable cookie (%s) in exactly one redirect', (_label, token) => {
    const response = proxy(get('http://localhost:3000/login', { [DEV.csrf.name]: token }));

    expect(response.status).toBe(303);
    expect(setCookieNames(response)).toEqual([DEV.csrf.name]);
    expect(response.cookies.get(DEV.csrf.name)?.value).not.toBe(token);
  });
});

describe('open redirect', () => {
  it.each([
    'http://localhost:3000/login?next=https://evil.test',
    'http://localhost:3000/login?returnTo=//evil.test',
    'http://localhost:3000/login?error=1&next=/staff',
  ])('discards every query parameter of %s', (url) => {
    const response = proxy(get(url));

    // Rebuilt from this application's own origin and the literal path. There is
    // nothing an attacker can steer.
    expect(response.headers.get('location')).toBe('/login');
  });

  it('never redirects to a foreign origin even if the request claims one', () => {
    const response = proxy(get('http://localhost:3000/login', {}, { host: 'evil.test' }));
    const location = response.headers.get('location') as string;

    expect(new URL(location, 'https://public.example').origin).toBe('https://public.example');
  });
});

describe('prohibitions', () => {
  it('marks draft previews no-store without attempting authorization itself', () => {
    const response = proxy(
      get('http://localhost:3000/content/preview/services/synthetic-service-id'),
    );

    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('same-origin');
    expect(setCookieNames(response)).toEqual([]);
  });

  it('passes a request carrying a session cookie straight through', () => {
    const response = proxy(
      get('http://localhost:3000/login', { [DEV.session.name]: 'v1.abc.def' }),
    );

    // A signed-in visitor is the page's business. Touching the cookie here
    // would clobber a bound token belonging to another tab.
    expect(response.status).not.toBe(303);
    expect(setCookieNames(response)).toEqual([]);
  });

  it('ignores non-GET methods', () => {
    const request = new NextRequest('http://localhost:3000/login', { method: 'POST' });
    const response = proxy(request);

    expect(setCookieNames(response)).toEqual([]);
  });

  it('makes no network call', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    proxy(get());

    // It must never call NestJS, authenticate, authorize or read database state.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('matches only login and authenticated preview responses', async () => {
    const { config } = await import('./proxy');

    expect(config.matcher).toEqual(['/login', '/content/preview/:path*']);
  });
});

describe('production over plain HTTP', () => {
  it('returns an explicit error rather than looping forever', () => {
    vi.stubEnv('DEPLOYMENT_MODE', 'production');
    vi.stubEnv('WEB_ALLOWED_ORIGINS', 'https://clinic.test');
    vi.stubEnv('PUBLIC_SITE_ORIGIN', 'https://clinic.test');

    const response = proxy(get('http://clinic.test/login'));

    // A __Host- cookie is dropped by the browser over HTTP, so redirecting
    // would never terminate. Naming the misconfiguration beats an infinite loop.
    expect(response.status).toBe(500);
    expect(setCookieNames(response)).toEqual([]);
  });

  it('issues normally when the forwarded protocol is https', () => {
    vi.stubEnv('DEPLOYMENT_MODE', 'production');
    vi.stubEnv('WEB_ALLOWED_ORIGINS', 'https://clinic.test');
    vi.stubEnv('PUBLIC_SITE_ORIGIN', 'https://clinic.test');

    const response = proxy(get('http://clinic.test/login', {}, { 'x-forwarded-proto': 'https' }));

    expect(response.status).toBe(303);
    expect(setCookieNames(response)).toEqual([cookieConfigFor('production').csrf.name]);
  });
});
