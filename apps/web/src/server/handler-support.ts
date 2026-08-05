import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { ERROR_CODES, type ErrorCode } from '@clinic/contracts';
import { loadServerEnv } from '@/env';
import { cookieConfig } from './cookie-config';
import { csrfCopiesMatch, verifyCsrfToken, type CsrfBinding } from './csrf';
import { assertBrowserWriteAllowed, OriginRejectedError } from './origin';
import { verifySessionCookie } from './session-cookie';
import { applySecurityHeaders, secureRedirect } from './security-headers';

/**
 * The checks every state-changing Route Handler performs, in one place.
 *
 * Handlers still call these explicitly rather than inheriting them from a
 * wrapper: a coverage test enumerates every handler that exports POST, PUT,
 * PATCH or DELETE and fails if one does not reference the Origin helper, and a
 * missing call is far easier to see in review than a missing decorator.
 */

export class CsrfRejectedError extends Error {
  constructor() {
    super('CSRF token is missing, mismatched or bound to a different session');
    this.name = 'CsrfRejectedError';
  }
}

export type SubmittedBody = Record<string, string>;

/**
 * Reads a form submission or a JSON body.
 *
 * The pages post ordinary HTML forms so they work without JavaScript; JSON is
 * accepted because it costs nothing and keeps the handlers testable.
 */
export async function readBody(request: Request): Promise<SubmittedBody> {
  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const parsed: unknown = await request.json().catch(() => ({}));

    if (parsed === null || typeof parsed !== 'object') return {};

    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [
        key,
        typeof value === 'string' ? value : String(value),
      ]),
    );
  }

  const form = await request.formData().catch(() => null);
  if (form === null) return {};

  const body: SubmittedBody = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') body[key] = value;
  }

  return body;
}

/**
 * Reads a form submission, keeping every value of a repeated field.
 *
 * `readBody` collapses repeats to the last value, which is right for the fields
 * it was written for and wrong for a `<select multiple>`: a manager selecting
 * three services would have two of them silently dropped. This returns both
 * views of the same submission, so a handler can use the flat one for ordinary
 * fields and the list for the multi-valued one.
 *
 * Separate from `readBody` rather than a change to it: the request body can
 * only be consumed once, and every existing handler is correct as written.
 */
export async function readBodyWithLists(
  request: Request,
): Promise<{ body: SubmittedBody; lists: Record<string, string[]> }> {
  const form = await request.formData().catch(() => null);
  if (form === null) return { body: {}, lists: {} };

  const body: SubmittedBody = {};
  const lists: Record<string, string[]> = {};

  for (const [key, value] of form.entries()) {
    if (typeof value !== 'string') continue;

    body[key] = value;
    (lists[key] ??= []).push(value);
  }

  return { body, lists };
}

export function sessionTokenFrom(request: NextRequest): string | null {
  const { SESSION_COOKIE_SECRET } = loadServerEnv();

  return verifySessionCookie(
    SESSION_COOKIE_SECRET,
    request.cookies.get(cookieConfig().session.name)?.value,
  );
}

/**
 * Verifies the double-submit pair against the binding this handler expects.
 *
 * The binding is stated by the caller rather than inferred, so a pre-login
 * token cannot be replayed on an authenticated route and a session-bound token
 * cannot be replayed at login. Both directions are tested.
 */
export function assertCsrf(request: NextRequest, body: SubmittedBody, binding: CsrfBinding): void {
  const { SESSION_COOKIE_SECRET } = loadServerEnv();
  const cookieToken = request.cookies.get(cookieConfig().csrf.name)?.value;

  if (!csrfCopiesMatch(cookieToken, body['csrfToken'])) throw new CsrfRejectedError();
  if (!verifyCsrfToken(SESSION_COOKIE_SECRET, cookieToken, binding)) throw new CsrfRejectedError();
}

/** Origin first, then CSRF. Both throw; `toFailureRedirect` turns them into a response. */
export function guardStateChanging(
  request: NextRequest,
  body: SubmittedBody,
  binding: CsrfBinding,
): void {
  assertBrowserWriteAllowed(request);
  assertCsrf(request, body, binding);
}

/**
 * Failure is reported by redirecting back with a fixed `error` flag carrying a
 * contract code — never a token, never a destination, never anything the caller
 * supplied. The receiving page validates the value against `ERROR_CODES` before
 * rendering it, so the parameter cannot inject text into the page.
 */
export function failureRedirect(
  request: NextRequest,
  path: `/${string}`,
  code: ErrorCode | 'API_UNREACHABLE',
): NextResponse {
  const target = new URL(path, new URL(request.url).origin);
  target.searchParams.set('error', code);

  return applySecurityHeaders(NextResponse.redirect(target, 303));
}

export function isKnownErrorCode(value: string | null): value is ErrorCode | 'API_UNREACHABLE' {
  if (value === null) return false;

  return value === 'API_UNREACHABLE' || (ERROR_CODES as readonly string[]).includes(value);
}

/** Origin and CSRF failures never redirect: they are not user mistakes to explain. */
export function guardFailureResponse(error: unknown): NextResponse | null {
  if (error instanceof OriginRejectedError) {
    return applySecurityHeaders(
      NextResponse.json({ error: { code: 'AUTH_ORIGIN_REJECTED' } }, { status: 403 }),
    );
  }

  if (error instanceof CsrfRejectedError) {
    return applySecurityHeaders(
      NextResponse.json({ error: { code: 'AUTH_CSRF_INVALID' } }, { status: 403 }),
    );
  }

  return null;
}

export { secureRedirect };
