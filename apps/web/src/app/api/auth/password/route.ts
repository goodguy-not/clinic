import { NextResponse, type NextRequest } from 'next/server';
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
  sessionTokenFrom,
} from '@/server/handler-support';
import { secureRedirect } from '@/server/security-headers';
import { signSessionCookie } from '@/server/session-cookie';

export const runtime = 'nodejs';

/**
 * Change the signed-in user's password.
 *
 * NestJS rotates the session: it revokes every existing session for the user and
 * issues a new token, so a stolen credential cannot survive the change that was
 * meant to lock the thief out. Both cookies are therefore *replaced* here —
 * written once each with new values, never deleted first.
 *
 * The confirmation field is checked in the web layer only. It is a typing aid,
 * not policy; every real rule lives in NestJS and none of it is duplicated here.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await readBody(request);
  const sessionToken = sessionTokenFrom(request);

  if (sessionToken === null) return secureRedirect(request, '/session-expired');

  try {
    guardStateChanging(request, body, { sessionToken });
  } catch (error) {
    const refusal = guardFailureResponse(error);
    if (refusal !== null) return refusal;
    throw error;
  }

  const currentPassword = body['currentPassword'] ?? '';
  const newPassword = body['newPassword'] ?? '';
  const confirmPassword = body['confirmPassword'] ?? '';

  if (newPassword !== confirmPassword) {
    return failureRedirect(request, '/change-password', 'VALIDATION_FAILED');
  }

  const result = await api.changePassword(
    { currentPassword, newPassword },
    {
      sessionToken,
      clientIp: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: request.headers.get('user-agent'),
    },
  );

  if (!result.ok) {
    return failureRedirect(request, '/change-password', result.code);
  }

  const { SESSION_COOKIE_SECRET } = loadServerEnv();
  const cookies = cookieConfig();
  const { sessionToken: rotated, session } = result.data;

  const response = secureRedirect(request, '/');

  setCookie(
    response,
    cookies.session,
    signSessionCookie(SESSION_COOKIE_SECRET, rotated),
    session.cookieMaxAgeSeconds,
  );

  // Rebound to the new token's fingerprint: the token issued against the old
  // session is now useless, which is the point of the binding.
  setCookie(
    response,
    cookies.csrf,
    issueCsrfToken(SESSION_COOKIE_SECRET, { sessionToken: rotated }, session.cookieMaxAgeSeconds),
    session.cookieMaxAgeSeconds,
  );

  return response;
}
