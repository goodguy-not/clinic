import 'server-only';
import { NextResponse } from 'next/server';

/**
 * Headers every auth and staff response carries.
 *
 * `no-store` matters most for the two responses that hand back a one-time
 * temporary password: a cached copy of that body is a stored credential.
 * Applying it to the whole surface rather than to those two handlers means the
 * next handler someone adds is covered by default.
 *
 * `no-referrer` keeps the current path out of any outbound request, which is
 * belt-and-braces alongside the rule that no token ever enters a URL.
 */
export function applySecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('cache-control', 'no-store');
  response.headers.set('referrer-policy', 'no-referrer');

  return response;
}

/** A redirect to a fixed, literal path on this application's own origin. */
export function secureRedirect(request: Request, path: `/${string}`): NextResponse {
  // Built from the request's own origin and a literal path. No header, query
  // parameter or body value contributes, so there is nothing for an attacker to
  // steer — the handlers accept no return URL at all.
  const target = new URL(path, new URL(request.url).origin);

  return applySecurityHeaders(NextResponse.redirect(target, 303));
}

export function secureJson(body: unknown, status = 200): NextResponse {
  return applySecurityHeaders(NextResponse.json(body, { status }));
}
