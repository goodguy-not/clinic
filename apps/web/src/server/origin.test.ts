import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertBrowserWriteAllowed, isOriginAllowed, OriginRejectedError } from './origin';

const ALLOWED = ['http://localhost:3000', 'https://clinic.test'];

const requestWith = (origin: string | null): Request =>
  new Request('http://localhost:3000/api/auth/login', {
    method: 'POST',
    ...(origin === null ? {} : { headers: { origin } }),
  });

describe('isOriginAllowed', () => {
  it('accepts an exactly matching origin', () => {
    expect(isOriginAllowed('http://localhost:3000', ALLOWED)).toBe(true);
    expect(isOriginAllowed('https://clinic.test', ALLOWED)).toBe(true);
  });

  it('rejects a missing Origin', () => {
    // Browsers send Origin on every cross-origin POST, so absence is a signal
    // rather than compatibility. Accepting it would defeat the whole check.
    expect(isOriginAllowed(null, ALLOWED)).toBe(false);
    expect(isOriginAllowed('', ALLOWED)).toBe(false);
  });

  it.each(['not-a-url', 'localhost:3000', '//localhost:3000', 'http://', 'javascript:alert(1)'])(
    'rejects a malformed Origin (%s)',
    (origin) => {
      expect(isOriginAllowed(origin, ALLOWED)).toBe(false);
    },
  );

  it.each([
    ['different host', 'https://evil.test'],
    ['different scheme', 'http://clinic.test'],
    ['different port', 'http://localhost:3001'],
    ['subdomain of an allowed host', 'https://sub.clinic.test'],
    ['allowed host as a subdomain of an attacker domain', 'https://clinic.test.evil.test'],
    ['prefix of an allowed origin', 'https://clinic.tes'],
  ])('rejects a disallowed Origin (%s)', (_label, origin) => {
    expect(isOriginAllowed(origin, ALLOWED)).toBe(false);
  });

  it('rejects an origin carrying a path, even when the host matches', () => {
    expect(isOriginAllowed('https://clinic.test/callback', ALLOWED)).toBe(false);
  });

  it('rejects an explicit default port, because matching is exact', () => {
    // A browser normalises https://clinic.test:443 to https://clinic.test before
    // sending it, so the explicit form never arrives from one. Exact matching is
    // what was asked for, and the env schema rejects the same form in config.
    expect(isOriginAllowed('https://clinic.test:443', ALLOWED)).toBe(false);
  });
});

describe('assertBrowserWriteAllowed', () => {
  it('passes for an allowed origin', () => {
    expect(() => assertBrowserWriteAllowed(requestWith('http://localhost:3000'))).not.toThrow();
  });

  it('throws for a missing origin', () => {
    expect(() => assertBrowserWriteAllowed(requestWith(null))).toThrow(OriginRejectedError);
  });

  it('throws for a disallowed origin', () => {
    expect(() => assertBrowserWriteAllowed(requestWith('https://evil.test'))).toThrow(
      OriginRejectedError,
    );
  });
});

describe('there is no Referer fallback', () => {
  it('ignores Referer entirely when Origin is absent', () => {
    const request = new Request('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { referer: 'http://localhost:3000/login' },
    });

    expect(() => assertBrowserWriteAllowed(request)).toThrow(OriginRejectedError);
  });

  it('contains no reference to Referer in the implementation', () => {
    // A fallback would become the path everyone takes — Referer is stripped by
    // privacy settings far more often than Origin is — and the strict check
    // would stop meaning anything. Asserted against the source so it cannot be
    // reintroduced quietly.
    const source = readFileSync(join(__dirname, 'origin.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    expect(code.toLowerCase()).not.toContain('referer');
    expect(code.toLowerCase()).not.toContain('referrer');
  });
});
