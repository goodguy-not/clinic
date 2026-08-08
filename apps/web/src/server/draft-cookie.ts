import 'server-only';
import { cookies } from 'next/headers';
import type { NextRequest, NextResponse } from 'next/server';
import { cookieConfig } from './cookie-config';
import { deleteCookie, setCookie } from './cookies';

/**
 * The registration-draft token, held in an HttpOnly cookie between a blocked
 * write and the confirmation screen.
 *
 * The token crosses the NestJS boundary exactly once, in the body of a 409
 * response (`families/drafts.ts`: "so the web tier can put it in an HttpOnly
 * cookie"). This is that cookie. The browser never receives the raw value —
 * not in a form field, not in the confirmation page's markup, not in a
 * redirect target — only the opaque, HttpOnly cookie the browser cannot read
 * or forward anywhere else.
 *
 * A short, capped lifetime: the draft itself expires ten minutes after it was
 * created (`registration-drafts.service.ts`), so the cookie is set for
 * whatever is left of that window, never longer.
 */

const MAX_COOKIE_TTL_SECONDS = 10 * 60;

export function setDraftCookie(response: NextResponse, token: string, expiresAt: string): void {
  const remainingMs = new Date(expiresAt).getTime() - Date.now();
  const maxAge = Math.min(MAX_COOKIE_TTL_SECONDS, Math.max(1, Math.floor(remainingMs / 1000)));

  setCookie(response, cookieConfig().draft, token, maxAge);
}

export function deleteDraftCookie(response: NextResponse): void {
  deleteCookie(response, cookieConfig().draft);
}

/** For a Route Handler reading the token it is about to consume or refresh. */
export function draftTokenFromRequest(request: NextRequest): string | null {
  const value = request.cookies.get(cookieConfig().draft.name)?.value;

  return value === undefined || value === '' ? null : value;
}

/** For a Server Component rendering the confirmation screen. */
export async function readDraftToken(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(cookieConfig().draft.name)?.value;

  return value === undefined || value === '' ? null : value;
}
