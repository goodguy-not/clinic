import { describe, expect, it } from 'vitest';
import { signSessionCookie, verifySessionCookie } from './session-cookie';

const SECRET = 'synthetic_test_cookie_secret_0123456789ab';
const OTHER_SECRET = 'a_different_synthetic_secret_0123456789ab';
const TOKEN = 'DbMcZ0kXW3Qe6b1v9aKcP1nT5rY8uW2xA4sD7fG0hJk';

describe('session cookie signing', () => {
  it('round-trips the token', () => {
    expect(verifySessionCookie(SECRET, signSessionCookie(SECRET, TOKEN))).toBe(TOKEN);
  });

  it('carries only the token — no identity, role or expiry', () => {
    const value = signSessionCookie(SECRET, TOKEN);
    const [version, payload] = value.split('.');

    expect(version).toBe('v1');
    expect(Buffer.from(payload as string, 'base64url').toString('utf8')).toBe(TOKEN);
    // Nothing else is encoded: identity comes from the database on every
    // request, never from the cookie.
    expect(value.split('.')).toHaveLength(3);
  });

  it('rejects a tampered payload', () => {
    const value = signSessionCookie(SECRET, TOKEN);
    const [version, , signature] = value.split('.');
    const forged = Buffer.from('forged-token', 'utf8').toString('base64url');

    expect(verifySessionCookie(SECRET, `${version}.${forged}.${signature}`)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const value = signSessionCookie(SECRET, TOKEN);
    const [version, payload, signature] = value.split('.');
    const flipped = `${(signature as string).slice(0, -1)}${(signature as string).endsWith('A') ? 'B' : 'A'}`;

    expect(verifySessionCookie(SECRET, `${version}.${payload}.${flipped}`)).toBeNull();
  });

  it('rejects a cookie signed with a different secret', () => {
    // Binds the cookie to one deployment: a value from staging is useless here.
    expect(verifySessionCookie(SECRET, signSessionCookie(OTHER_SECRET, TOKEN))).toBeNull();
  });

  it('rejects an unknown version', () => {
    const value = signSessionCookie(SECRET, TOKEN);
    const [, payload, signature] = value.split('.');

    expect(verifySessionCookie(SECRET, `v2.${payload}.${signature}`)).toBeNull();
  });

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['no separators', 'garbage'],
    ['two parts', 'v1.abc'],
    ['four parts', 'v1.a.b.c'],
    ['empty payload', 'v1..signature'],
    ['empty signature', 'v1.cGF5bG9hZA.'],
  ])('rejects a malformed cookie (%s)', (_label, value) => {
    expect(verifySessionCookie(SECRET, value)).toBeNull();
  });

  it('rejects a signature of a different length without throwing', () => {
    // `timingSafeEqual` throws on unequal buffers, which would leak the
    // expected length through an exception rather than a null.
    const value = signSessionCookie(SECRET, TOKEN);
    const [version, payload] = value.split('.');

    expect(() => verifySessionCookie(SECRET, `${version}.${payload}.short`)).not.toThrow();
    expect(verifySessionCookie(SECRET, `${version}.${payload}.short`)).toBeNull();
  });

  it('produces the same signature for the same input', () => {
    expect(signSessionCookie(SECRET, TOKEN)).toBe(signSessionCookie(SECRET, TOKEN));
  });
});
