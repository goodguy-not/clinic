import { NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';
import { cookieConfigFor } from './cookie-config';
import { deleteCookie, setCookie } from './cookies';

const PRODUCTION = cookieConfigFor('production');
const NON_PRODUCTION = cookieConfigFor('non-production');

/** `Set-Cookie` as the browser would receive it. */
const rawSetCookies = (response: NextResponse): string[] => response.headers.getSetCookie?.() ?? [];

describe('cookie configuration', () => {
  it('uses __Host- prefixed Secure cookies in production', () => {
    for (const attributes of [PRODUCTION.session, PRODUCTION.csrf]) {
      expect(attributes.name.startsWith('__Host-')).toBe(true);
      expect(attributes.secure).toBe(true);
      expect(attributes.httpOnly).toBe(true);
      expect(attributes.sameSite).toBe('lax');
      expect(attributes.path).toBe('/');
      // `__Host-` forbids Domain; it is absent rather than set to undefined.
      expect('domain' in attributes).toBe(false);
    }

    expect(PRODUCTION.session.name).toBe('__Host-clinic_session');
    expect(PRODUCTION.csrf.name).toBe('__Host-clinic_csrf');
  });

  it('uses unprefixed non-Secure cookies in a non-production deployment', () => {
    for (const attributes of [NON_PRODUCTION.session, NON_PRODUCTION.csrf]) {
      expect(attributes.name.startsWith('__Host-')).toBe(false);
      expect(attributes.secure).toBe(false);
      expect(attributes.httpOnly).toBe(true);
      expect(attributes.sameSite).toBe('lax');
      expect(attributes.path).toBe('/');
      expect('domain' in attributes).toBe(false);
    }

    expect(NON_PRODUCTION.session.name).toBe('clinic_session_dev');
    expect(NON_PRODUCTION.csrf.name).toBe('clinic_csrf_dev');
  });

  it('gives the two modes different names, so a cookie cannot cross between them', () => {
    expect(PRODUCTION.session.name).not.toBe(NON_PRODUCTION.session.name);
    expect(PRODUCTION.csrf.name).not.toBe(NON_PRODUCTION.csrf.name);
  });
});

describe('setCookie', () => {
  it('emits exactly one Set-Cookie with the configured attributes', () => {
    const response = NextResponse.json({});
    setCookie(response, PRODUCTION.session, 'value', 3600);

    const raw = rawSetCookies(response);
    expect(raw).toHaveLength(1);
    expect(raw[0]).toContain('__Host-clinic_session=value');
    expect(raw[0]).toContain('Path=/');
    expect(raw[0]).toContain('HttpOnly');
    expect(raw[0]).toContain('Secure');
    expect(raw[0]).toMatch(/SameSite=lax/i);
    expect(raw[0]).toContain('Max-Age=3600');
    expect(raw[0]).not.toContain('Domain');
  });

  it('replaces directly rather than deleting first', () => {
    const response = NextResponse.json({});
    setCookie(response, NON_PRODUCTION.csrf, 'first', 600);
    setCookie(response, NON_PRODUCTION.csrf, 'second', 600);

    const raw = rawSetCookies(response);

    // One header, the new value, and no Max-Age=0 anywhere: a delete-then-set
    // would emit two headers and leave which one wins to the browser.
    expect(raw).toHaveLength(1);
    expect(raw[0]).toContain('clinic_csrf_dev=second');
    expect(raw.join(';')).not.toContain('Max-Age=0');
  });

  it('keeps one header per name when both cookies are written', () => {
    const response = NextResponse.json({});
    setCookie(response, PRODUCTION.session, 'a', 60);
    setCookie(response, PRODUCTION.csrf, 'b', 60);

    const names = rawSetCookies(response).map((line) => line.split('=')[0]);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });

  it('refuses a non-positive lifetime instead of minting a dead cookie', () => {
    const response = NextResponse.json({});

    expect(() => setCookie(response, PRODUCTION.session, 'v', 0)).toThrow(/non-positive/);
    expect(() => setCookie(response, PRODUCTION.session, 'v', -5)).toThrow(/non-positive/);
    expect(rawSetCookies(response)).toHaveLength(0);
  });
});

describe('deleteCookie', () => {
  it('uses Max-Age=0 with byte-identical attributes', () => {
    const response = NextResponse.json({});
    deleteCookie(response, PRODUCTION.session);

    const raw = rawSetCookies(response);
    expect(raw).toHaveLength(1);

    // An attribute mismatch silently fails to delete anything, which is the
    // classic invisible bug in logout code.
    expect(raw[0]).toContain('Max-Age=0');
    expect(raw[0]).toContain('Path=/');
    expect(raw[0]).toContain('HttpOnly');
    expect(raw[0]).toContain('Secure');
    expect(raw[0]).toMatch(/SameSite=lax/i);
    expect(raw[0]).not.toContain('Domain');
  });

  it('produces attributes matching what setCookie wrote', () => {
    const written = NextResponse.json({});
    setCookie(written, NON_PRODUCTION.session, 'v', 60);
    const deleted = NextResponse.json({});
    deleteCookie(deleted, NON_PRODUCTION.session);

    // Lifetime attributes differ by design; what must match byte for byte are
    // the ones the browser uses to decide *which* cookie is being replaced.
    const attributesOf = (line: string) =>
      line
        .split(';')
        .slice(1)
        .map((part) => part.trim())
        .filter((part) => !part.startsWith('Max-Age') && !part.startsWith('Expires'))
        .sort();

    expect(attributesOf(rawSetCookies(deleted)[0] as string)).toEqual(
      attributesOf(rawSetCookies(written)[0] as string),
    );
  });
});
