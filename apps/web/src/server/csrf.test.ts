import { describe, expect, it } from 'vitest';
import { csrfCopiesMatch, issueCsrfToken, sessionFingerprint, verifyCsrfToken } from './csrf';

const SECRET = 'synthetic_test_cookie_secret_0123456789ab';
const TOKEN_A = 'session-token-aaaaaaaaaaaaaaaaaaaaaaaa';
const TOKEN_B = 'session-token-bbbbbbbbbbbbbbbbbbbbbbbb';
const TTL = 1800;

describe('CSRF tokens', () => {
  it('verifies a freshly issued unbound token', () => {
    const token = issueCsrfToken(SECRET, 'unauthenticated', TTL);

    expect(verifyCsrfToken(SECRET, token, 'unauthenticated')).toBe(true);
  });

  it('verifies a freshly issued session-bound token', () => {
    const token = issueCsrfToken(SECRET, { sessionToken: TOKEN_A }, TTL);

    expect(verifyCsrfToken(SECRET, token, { sessionToken: TOKEN_A })).toBe(true);
  });

  describe('bound and unbound tokens are not interchangeable', () => {
    it('rejects a pre-login token replayed after authentication', () => {
      const unbound = issueCsrfToken(SECRET, 'unauthenticated', TTL);

      expect(verifyCsrfToken(SECRET, unbound, { sessionToken: TOKEN_A })).toBe(false);
    });

    it('rejects a bound token replayed at login', () => {
      const bound = issueCsrfToken(SECRET, { sessionToken: TOKEN_A }, TTL);

      expect(verifyCsrfToken(SECRET, bound, 'unauthenticated')).toBe(false);
    });

    it('rejects a token bound to a different session', () => {
      const bound = issueCsrfToken(SECRET, { sessionToken: TOKEN_A }, TTL);

      expect(verifyCsrfToken(SECRET, bound, { sessionToken: TOKEN_B })).toBe(false);
    });
  });

  it('rejects a token issued under a different secret', () => {
    const foreign = issueCsrfToken(
      'another_synthetic_secret_0123456789abcd',
      'unauthenticated',
      TTL,
    );

    expect(verifyCsrfToken(SECRET, foreign, 'unauthenticated')).toBe(false);
  });

  it('rejects an expired token even if the cookie still carries it', () => {
    // Expiry is inside the signed value, so re-presenting the cookie after its
    // Max-Age would have passed does not resurrect it.
    const token = issueCsrfToken(SECRET, 'unauthenticated', 60, 1_000_000_000_000);

    expect(verifyCsrfToken(SECRET, token, 'unauthenticated', 1_000_000_000_000)).toBe(true);
    expect(verifyCsrfToken(SECRET, token, 'unauthenticated', 1_000_000_061_000)).toBe(false);
  });

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['garbage', 'nonsense'],
    ['wrong version', 'v2.nonce.9999999999.sig'],
    ['non-numeric expiry', 'v1.nonce.later.sig'],
    ['too few parts', 'v1.nonce.9999999999'],
  ])('rejects a malformed token (%s)', (_label, token) => {
    expect(verifyCsrfToken(SECRET, token, 'unauthenticated')).toBe(false);
  });

  it('issues a distinct nonce each time', () => {
    const first = issueCsrfToken(SECRET, 'unauthenticated', TTL);
    const second = issueCsrfToken(SECRET, 'unauthenticated', TTL);

    expect(first).not.toBe(second);
  });
});

describe('session fingerprint', () => {
  it('is domain-separated from anything NestJS stores', () => {
    const fingerprint = sessionFingerprint(SECRET, TOKEN_A);
    const sha256 = createSha256(TOKEN_A);

    // NestJS stores sha256(token) as its lookup key. The binding must not be
    // that value, or the cookie would carry a database key.
    expect(fingerprint).not.toBe(sha256);
    expect(fingerprint.length).toBeLessThan(sha256.length);
  });

  it('differs per session and is stable for one', () => {
    expect(sessionFingerprint(SECRET, TOKEN_A)).toBe(sessionFingerprint(SECRET, TOKEN_A));
    expect(sessionFingerprint(SECRET, TOKEN_A)).not.toBe(sessionFingerprint(SECRET, TOKEN_B));
  });

  it('never appears verbatim in the issued token', () => {
    const token = issueCsrfToken(SECRET, { sessionToken: TOKEN_A }, TTL);

    // The cookie holds a nonce, an expiry and a MAC over the binding — never
    // the binding itself.
    expect(token).not.toContain(sessionFingerprint(SECRET, TOKEN_A));
  });
});

describe('double-submit comparison', () => {
  it('accepts an exact match', () => {
    expect(csrfCopiesMatch('same-value', 'same-value')).toBe(true);
  });

  it.each([
    ['different values', 'a-value', 'other-value'],
    ['missing cookie', undefined, 'a-value'],
    ['empty cookie', '', 'a-value'],
    ['non-string form value', 'a-value', 42],
    ['empty form value', 'a-value', ''],
    ['both missing', undefined, undefined],
  ])('rejects %s', (_label, cookie, form) => {
    expect(csrfCopiesMatch(cookie as string | undefined, form)).toBe(false);
  });

  it('rejects values of different lengths without throwing', () => {
    expect(() => csrfCopiesMatch('short', 'a-much-longer-value')).not.toThrow();
    expect(csrfCopiesMatch('short', 'a-much-longer-value')).toBe(false);
  });
});

function createSha256(value: string): string {
  // Local helper so the test states what NestJS does without importing from it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require('node:crypto') as typeof import('node:crypto');

  return createHash('sha256').update(value, 'utf8').digest('base64url');
}
