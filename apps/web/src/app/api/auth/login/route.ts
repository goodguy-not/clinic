import { NextResponse, type NextRequest } from 'next/server';
import { loginRequestSchema } from '@clinic/contracts';
import { loadServerEnv } from '@/env';
import { api } from '@/server/api-client';
import { cookieConfig } from '@/server/cookie-config';
import { setCookie } from '@/server/cookies';
import { issueCsrfToken } from '@/server/csrf';
import {
  failureRedirect,
  guardFailureResponse,
  guardStateChanging,
  readBody,
} from '@/server/handler-support';
import { secureRedirect } from '@/server/security-headers';
import { signSessionCookie } from '@/server/session-cookie';

export const runtime = 'nodejs';

/**
 * Sign in.
 *
 * Origin is checked first, then the CSRF pair under the *unauthenticated*
 * binding — any session cookie presented here is ignored, because logging in is
 * by definition something an unauthenticated caller does, and NestJS revokes a
 * presented session as SUPERSEDED anyway.
 *
 * On success both cookies are written directly, one `Set-Cookie` each: the
 * signed session cookie with the lifetime PostgreSQL computed, and a CSRF token
 * rebound to the new session's fingerprint so the pre-login token cannot be
 * replayed afterwards.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await readBody(request);

  try {
    guardStateChanging(request, body, 'unauthenticated');
  } catch (error) {
    const refusal = guardFailureResponse(error);
    if (refusal !== null) return refusal;
    throw error;
  }

  const parsed = loginRequestSchema.safeParse({
    username: body['username'] ?? '',
    password: body['password'] ?? '',
  });

  if (!parsed.success) {
    // A malformed username is a client-side mistake, but the message shown is
    // the same generic one: the interface must not distinguish failure causes
    // that the API deliberately made indistinguishable.
    return failureRedirect(request, '/login', 'AUTH_INVALID_CREDENTIALS');
  }

  const result = await api.login(parsed.data, {
    clientIp: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: request.headers.get('user-agent'),
  });

  if (!result.ok) {
    return failureRedirect(
      request,
      '/login',
      result.code === 'API_UNREACHABLE' ? 'API_UNREACHABLE' : 'AUTH_INVALID_CREDENTIALS',
    );
  }

  const { SESSION_COOKIE_SECRET } = loadServerEnv();
  const cookies = cookieConfig();
  const { sessionToken, session, user } = result.data;

  const response = secureRedirect(request, user.mustChangePassword ? '/change-password' : '/');

  // `cookieMaxAgeSeconds` is used verbatim. It was computed by PostgreSQL from
  // `absolute_expires_at - clock_timestamp()` minus a safety margin; deriving it
  // here from Node's clock would make the web tier a second security clock, and
  // a fast one would mint a cookie outliving the absolute cap.
  setCookie(
    response,
    cookies.session,
    signSessionCookie(SESSION_COOKIE_SECRET, sessionToken),
    session.cookieMaxAgeSeconds,
  );

  setCookie(
    response,
    cookies.csrf,
    issueCsrfToken(SESSION_COOKIE_SECRET, { sessionToken }, session.cookieMaxAgeSeconds),
    session.cookieMaxAgeSeconds,
  );

  return response;
}
