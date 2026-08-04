import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The signed, opaque session cookie.
 *
 * The value carries the NestJS session token and nothing else — no user id, no
 * role, no expiry. Those come from the database on every request, so a cookie
 * cannot assert an identity or outlive a revocation.
 *
 * The signature is defence in depth, not authentication. What it buys is that a
 * garbage or foreign cookie is rejected here without a round trip to NestJS,
 * and that a cookie is bound to one deployment's secret. The authoritative
 * check is always the database lookup NestJS performs.
 *
 *   v1.<base64url(token)>.<base64url(HMAC-SHA256(secret, "v1." + payload))>
 *
 * The version prefix means a future format or secret change is detectable
 * rather than silently broken.
 */

const VERSION = 'v1';

function sign(secret: string, signedPart: string): string {
  return createHmac('sha256', secret).update(signedPart, 'utf8').digest('base64url');
}

export function signSessionCookie(secret: string, sessionToken: string): string {
  const payload = Buffer.from(sessionToken, 'utf8').toString('base64url');
  const signedPart = `${VERSION}.${payload}`;

  return `${signedPart}.${sign(secret, signedPart)}`;
}

/**
 * Returns the session token, or null for anything that is not a cookie this
 * deployment issued: wrong shape, unknown version, tampered payload, or a
 * signature made with a different secret.
 */
export function verifySessionCookie(secret: string, value: string | undefined): string | null {
  if (value === undefined || value === '') return null;

  const parts = value.split('.');
  if (parts.length !== 3) return null;

  const [version, payload, signature] = parts;
  if (version !== VERSION || payload === undefined || signature === undefined) return null;
  if (payload === '' || signature === '') return null;

  const expected = sign(secret, `${version}.${payload}`);

  // Compare as bytes of equal length. `timingSafeEqual` throws on a length
  // mismatch, which would leak the expected signature length through an early
  // exception, so the lengths are checked first and unequal ones simply fail.
  const provided = Buffer.from(signature, 'utf8');
  const computed = Buffer.from(expected, 'utf8');
  if (provided.length !== computed.length) return null;
  if (!timingSafeEqual(provided, computed)) return null;

  const token = Buffer.from(payload, 'base64url').toString('utf8');

  return token === '' ? null : token;
}
