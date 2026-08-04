import { NextResponse, type NextRequest } from 'next/server';
import { loadServerEnv } from '@/env';
import { cookieConfigFor } from '@/server/cookie-config';
import { issueCsrfToken, verifyCsrfToken } from '@/server/csrf';

/**
 * Pre-login CSRF cookie issuance. That is the whole job.
 *
 * It exists because a Server Component cannot set a response cookie, so nothing
 * else can attach a cookie to the navigation that renders `/login` — and
 * without a cookie there is no double-submit pair to verify. The alternative,
 * a client component fetching a token on mount, would make signing in require
 * JavaScript for no security gain.
 *
 * This file must never: call NestJS, authenticate, authorize, reset a session,
 * inspect database state, or grow into general middleware. Page protection
 * lives in `requireSession()`, which is authoritative; stale-session recovery
 * is a POST handler. Tests assert each of those prohibitions.
 *
 * `proxy.ts` is the Next.js 16 file convention that replaced `middleware.ts`.
 */

export const config = {
  matcher: ['/login'],
};

/** 30 minutes: long enough to fill a form, short enough that a stale one fails closed. */
const CSRF_PRELOGIN_TTL_SECONDS = 30 * 60;

export function proxy(request: NextRequest): NextResponse {
  // GET only. A cookie-mutating response to any other method would be a
  // state-changing request without Origin or CSRF protection.
  if (request.method !== 'GET') return NextResponse.next();

  const env = loadServerEnv();
  const cookies = cookieConfigFor(env.DEPLOYMENT_MODE);

  // A visitor carrying a session is handled by the page: it either sends them
  // onward or, if the session is stale, to `/session-expired`. Passing through
  // also avoids clobbering a *bound* CSRF cookie belonging to a signed-in user
  // in another tab, which this code cannot validate because it never sees the
  // binding.
  if (request.cookies.has(cookies.session.name)) return NextResponse.next();

  if (env.DEPLOYMENT_MODE === 'production' && !isHttps(request)) {
    // A `__Host-` cookie is silently dropped by the browser over plain HTTP,
    // so redirecting would loop forever. An explicit error names the real
    // problem instead of looking like a broken login page.
    return new NextResponse(
      'Misconfigured deployment: DEPLOYMENT_MODE=production requires HTTPS.',
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }

  const existing = request.cookies.get(cookies.csrf.name)?.value;

  // Already holds a usable unbound token: nothing to do, and re-issuing would
  // invalidate a form open in another tab. This is what makes the redirect
  // happen at most once.
  if (verifyCsrfToken(env.SESSION_COOKIE_SECRET, existing, 'unauthenticated')) {
    return NextResponse.next();
  }

  // Rebuilt from this application's own origin and the literal matched path.
  // The query string is discarded entirely, so no `?next=` can steer it and
  // there is nothing for an open redirect to work with.
  const target = new URL('/login', request.nextUrl.origin);
  const response = NextResponse.redirect(target, 303);

  response.cookies.set({
    name: cookies.csrf.name,
    value: issueCsrfToken(env.SESSION_COOKIE_SECRET, 'unauthenticated', CSRF_PRELOGIN_TTL_SECONDS),
    httpOnly: cookies.csrf.httpOnly,
    secure: cookies.csrf.secure,
    sameSite: cookies.csrf.sameSite,
    path: cookies.csrf.path,
    maxAge: CSRF_PRELOGIN_TTL_SECONDS,
  });

  // A cached redirect that sets a cookie would be worse than no cookie at all.
  response.headers.set('cache-control', 'no-store');
  response.headers.set('referrer-policy', 'no-referrer');

  return response;
}

function isHttps(request: NextRequest): boolean {
  if (request.nextUrl.protocol === 'https:') return true;

  // Behind a TLS-terminating proxy the request arrives as HTTP; the forwarded
  // header is the only signal, and it is trustworthy exactly as far as the
  // deployment's proxy configuration is.
  return request.headers.get('x-forwarded-proto') === 'https';
}

export default proxy;
