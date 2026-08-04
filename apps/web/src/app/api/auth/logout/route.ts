import { NextResponse, type NextRequest } from 'next/server';
import { loadServerEnv } from '@/env';
import { api } from '@/server/api-client';
import { cookieConfig } from '@/server/cookie-config';
import { deleteCookie, setCookie } from '@/server/cookies';
import { issueCsrfToken } from '@/server/csrf';
import {
  guardFailureResponse,
  guardStateChanging,
  readBody,
  sessionTokenFrom,
} from '@/server/handler-support';
import { secureRedirect } from '@/server/security-headers';

export const runtime = 'nodejs';

const CSRF_PRELOGIN_TTL_SECONDS = 30 * 60;

/**
 * Sign out.
 *
 * The session cookie is deleted and the CSRF cookie is replaced in the same
 * response — two `Set-Cookie` headers, one per name, no third. Replacing rather
 * than deleting the CSRF cookie means the user lands on `/login` with a working
 * form instead of bouncing through the proxy for a new token.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await readBody(request);
  const sessionToken = sessionTokenFrom(request);

  try {
    guardStateChanging(request, body, sessionToken === null ? 'unauthenticated' : { sessionToken });
  } catch (error) {
    const refusal = guardFailureResponse(error);
    if (refusal !== null) return refusal;
    throw error;
  }

  if (sessionToken !== null) {
    // Best effort: the cookies are cleared regardless. A NestJS failure must not
    // leave the browser holding a credential it believes is live.
    await api.logout({
      sessionToken,
      clientIp: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: request.headers.get('user-agent'),
    });
  }

  const { SESSION_COOKIE_SECRET } = loadServerEnv();
  const cookies = cookieConfig();
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
