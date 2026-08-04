import { NextResponse, type NextRequest } from 'next/server';
import { loadServerEnv } from '@/env';
import { cookieConfig } from '@/server/cookie-config';
import { deleteCookie, setCookie } from '@/server/cookies';
import { issueCsrfToken } from '@/server/csrf';
import { guardFailureResponse, readBody } from '@/server/handler-support';
import { assertBrowserWriteAllowed } from '@/server/origin';
import { applySecurityHeaders, secureRedirect } from '@/server/security-headers';

export const runtime = 'nodejs';

const CSRF_PRELOGIN_TTL_SECONDS = 30 * 60;

/**
 * Clears a stale, forged or revoked session so the user can sign in again.
 *
 * POST, never GET. `SameSite=Lax` — which this application uses so ordinary
 * navigation keeps people signed in — sends cookies on a cross-site top-level
 * GET navigation, so a cookie-clearing GET would let any page on the internet
 * force a staff member to be signed out by linking to it.
 *
 * This is the single documented CSRF-token exemption. The token cannot be
 * required here: the endpoint exists precisely for users whose cookie state is
 * broken, and demanding a valid bound token would make recovery unreachable
 * exactly when it is needed. Strict Origin is the control, and browsers send
 * `Origin` on every cross-origin POST. The residual risk is a forced logout,
 * which is the same severity class as logout CSRF generally.
 *
 * It calls NestJS not at all and performs no authorization: it is pure cookie
 * hygiene, safe to reach with any cookie state including none.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Read so a form post is consumed cleanly; no field is used.
  await readBody(request);

  try {
    assertBrowserWriteAllowed(request);
  } catch (error) {
    const refusal = guardFailureResponse(error);
    if (refusal !== null) return refusal;
    throw error;
  }

  const { SESSION_COOKIE_SECRET } = loadServerEnv();
  const cookies = cookieConfig();

  // Fixed literal destination. No return URL, no query parameter, nothing the
  // caller supplied — there is nothing here for an open redirect to work with.
  const response = secureRedirect(request, '/login');

  deleteCookie(response, cookies.session);
  setCookie(
    response,
    cookies.csrf,
    issueCsrfToken(SESSION_COOKIE_SECRET, 'unauthenticated', CSRF_PRELOGIN_TTL_SECONDS),
    CSRF_PRELOGIN_TTL_SECONDS,
  );

  return response;
}

/**
 * Explicit 405 rather than relying on a framework default, so the absence of
 * cookie mutation on GET is a property this file states and a test pins.
 */
export function GET(): NextResponse {
  const response = applySecurityHeaders(
    NextResponse.json(
      { error: { code: 'AUTH_ORIGIN_REJECTED', message: 'Use POST' } },
      { status: 405 },
    ),
  );

  response.headers.set('allow', 'POST');

  return response;
}
