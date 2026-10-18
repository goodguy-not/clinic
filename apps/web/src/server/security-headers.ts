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

/** A browser redirect that resolves against the public page's origin. */
export function relativeRedirect(path: `/${string}`): NextResponse {
  // Next.js sees its private :3000 URL behind a reverse proxy. A relative
  // Location lets the browser use the origin it actually visited, without
  // trusting forwarded headers or requiring a proxy rewrite.
  if (path.startsWith('//')) throw new Error('Redirect path must stay on this site');
  return applySecurityHeaders(new NextResponse(null, { status: 303, headers: { location: path } }));
}

/** A redirect to a fixed path on the public site's origin. */
export function secureRedirect(_request: Request, path: `/${string}`): NextResponse {
  return relativeRedirect(path);
}

export function secureJson(body: unknown, status = 200): NextResponse {
  return applySecurityHeaders(NextResponse.json(body, { status }));
}
