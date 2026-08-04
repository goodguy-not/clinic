import 'server-only';
import type { NextResponse } from 'next/server';
import type { CookieAttributes } from './cookie-config';

/**
 * The only way this application writes or removes a cookie.
 *
 * Four rules, in one place so they cannot drift apart:
 *
 *  1. Replacement is direct. Writing a new value never deletes first — a
 *     delete-then-set emits two `Set-Cookie` headers for one name, and which
 *     one wins is a question nobody should have to answer.
 *  2. Deletion uses `Max-Age=0` with byte-identical attributes. A mismatch in
 *     `Path`, `Secure` or `SameSite` silently fails to delete anything, which
 *     is the classic invisible bug in logout code.
 *  3. Exactly one `Set-Cookie` per name per response.
 *  4. Never on a GET. Cookies are written by the proxy's pre-login redirect and
 *     by POST handlers, nothing else.
 */

export function setCookie(
  response: NextResponse,
  attributes: CookieAttributes,
  value: string,
  maxAgeSeconds: number,
): void {
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds <= 0) {
    // A non-positive lifetime would either delete the cookie or mint one for an
    // already-expired session. Both are bugs, and silently doing either is
    // worse than refusing.
    throw new Error(
      `Refusing to set ${attributes.name} with a non-positive Max-Age (${String(maxAgeSeconds)})`,
    );
  }

  response.cookies.set({
    name: attributes.name,
    value,
    httpOnly: attributes.httpOnly,
    secure: attributes.secure,
    sameSite: attributes.sameSite,
    path: attributes.path,
    maxAge: maxAgeSeconds,
  });
}

export function deleteCookie(response: NextResponse, attributes: CookieAttributes): void {
  response.cookies.set({
    name: attributes.name,
    value: '',
    httpOnly: attributes.httpOnly,
    secure: attributes.secure,
    sameSite: attributes.sameSite,
    path: attributes.path,
    maxAge: 0,
  });
}

/** Test and review aid: the `Set-Cookie` names a response is emitting. */
export function setCookieNames(response: NextResponse): string[] {
  return response.cookies.getAll().map((cookie) => cookie.name);
}
