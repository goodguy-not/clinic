import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Signed, session-bound, double-submit CSRF tokens.
 *
 * The cookie is HttpOnly and the same token is rendered into a hidden form
 * field by the server. That is stronger than the classic JS-readable
 * double-submit: script cannot read the token, and the double-submit property
 * survives because the server owns both copies.
 *
 *   v1.<nonce>.<expiry>.<HMAC(secret, "csrf|v1|" + nonce + "|" + expiry + "|" + binding)>
 *
 * The binding is what stops a pre-login token being replayed after
 * authentication and the reverse:
 *
 *   before login   binding = ""
 *   after  login   binding = fingerprint of the raw session token
 *
 * The fingerprint is derived under a *different* HMAC label from the cookie
 * signature, so it is not equal to `sha256(token)` — the value NestJS uses as
 * its database lookup key — and the cookie never contains the fingerprint
 * itself, only a MAC over it. The binding is recomputed at verification time
 * from the session cookie presented on the same request.
 */

const VERSION = 'v1';

export type CsrfBinding = 'unauthenticated' | { sessionToken: string };

function mac(secret: string, signedPart: string): string {
  return createHmac('sha256', secret).update(signedPart, 'utf8').digest('base64url');
}

/**
 * Domain-separated from the cookie signature by its label. Truncated to 16
 * bytes: it is an equality tag inside a MAC, not a secret on its own.
 */
export function sessionFingerprint(secret: string, sessionToken: string): string {
  return createHmac('sha256', secret)
    .update(`csrf-binding|${VERSION}|${sessionToken}`, 'utf8')
    .digest('base64url')
    .slice(0, 22);
}

function bindingValue(secret: string, binding: CsrfBinding): string {
  return binding === 'unauthenticated' ? '' : sessionFingerprint(secret, binding.sessionToken);
}

export function issueCsrfToken(
  secret: string,
  binding: CsrfBinding,
  ttlSeconds: number,
  nowMs: number = Date.now(),
): string {
  const nonce = randomBytes(18).toString('base64url');
  const expiry = String(Math.floor(nowMs / 1000) + ttlSeconds);
  const signedPart = `${VERSION}.${nonce}.${expiry}`;
  const label = `csrf|${VERSION}|${nonce}|${expiry}|${bindingValue(secret, binding)}`;

  return `${signedPart}.${mac(secret, label)}`;
}

/**
 * Verifies a token against the binding the handler expects.
 *
 * Expiry is carried inside the signed value rather than relied on from the
 * cookie's `Max-Age`, so a token cannot be replayed by re-presenting it after
 * the cookie would have gone. This is the one place a wall clock is used, and
 * it governs a form's freshness, not a session's validity.
 */
export function verifyCsrfToken(
  secret: string,
  token: string | undefined,
  binding: CsrfBinding,
  nowMs: number = Date.now(),
): boolean {
  if (token === undefined || token === '') return false;

  const parts = token.split('.');
  if (parts.length !== 4) return false;

  const [version, nonce, expiry, signature] = parts;
  if (version !== VERSION) return false;
  if (nonce === undefined || expiry === undefined || signature === undefined) return false;
  if (nonce === '' || signature === '') return false;

  if (!/^\d+$/.test(expiry)) return false;
  if (Number(expiry) * 1000 <= nowMs) return false;

  const label = `csrf|${VERSION}|${nonce}|${expiry}|${bindingValue(secret, binding)}`;

  return constantTimeEquals(signature, mac(secret, label));
}

/**
 * The double-submit half: the cookie copy and the submitted copy must match.
 * Compared in constant time so a mismatch reveals nothing about the expected
 * value.
 */
export function csrfCopiesMatch(cookieToken: string | undefined, formToken: unknown): boolean {
  if (cookieToken === undefined || cookieToken === '') return false;
  if (typeof formToken !== 'string' || formToken === '') return false;

  return constantTimeEquals(cookieToken, formToken);
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');

  if (left.length !== right.length) return false;

  return timingSafeEqual(left, right);
}
