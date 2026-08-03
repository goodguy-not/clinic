import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  PERMISSIONS,
  USER_ROLES,
  loginResponseSchema,
  sessionResponseSchema,
} from '@clinic/contracts';

/**
 * Proves `@clinic/contracts` is consumable from the bundler side.
 *
 * The package is built once to CommonJS because NestJS requires it at runtime;
 * this test is the guard that the same build stays usable from the ESM/bundler
 * half of the workspace, with no `transpilePackages` entry and no path alias.
 * Its counterpart lives in `apps/api`.
 */
describe('@clinic/contracts (bundler consumption)', () => {
  it('exports the constants the web tier needs for rendering decisions', () => {
    expect(USER_ROLES).toEqual(['MANAGER', 'RECEPTIONIST']);
    expect(PERMISSIONS).toContain('user.read');
  });

  it('exposes every error code, so the Persian map can be checked for completeness', () => {
    // The mapping itself arrives with the web auth surface. What matters here
    // is that the list is enumerable at build time, which is what lets a new
    // code without a translation fail a test rather than reach a user.
    expect(ERROR_CODES.length).toBeGreaterThan(0);
    expect([...ERROR_CODES]).toContain('AUTH_SESSION_EXPIRED');
  });

  it('parses a session response', () => {
    const response = {
      user: {
        id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
        username: 'reza',
        displayName: 'Synthetic Receptionist',
        role: 'RECEPTIONIST',
        mustChangePassword: false,
        permissions: [],
      },
    };

    expect(sessionResponseSchema.safeParse(response).success).toBe(true);
  });

  it('rejects a response carrying a field the contract does not declare', () => {
    const leaked = {
      sessionToken: 'opaque-token',
      session: { cookieMaxAgeSeconds: 43200 },
      user: {
        id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
        username: 'reza',
        displayName: 'Synthetic Manager',
        role: 'MANAGER',
        mustChangePassword: false,
        permissions: ['user.read'],
        tokenHash: 'deadbeef',
      },
    };

    expect(loginResponseSchema.safeParse(leaked).success).toBe(false);
  });

  it('contains no Persian text, which the web tier owns', () => {
    const persian = /[؀-ۿ]/;

    for (const code of ERROR_CODES) expect(persian.test(code)).toBe(false);
    for (const permission of PERMISSIONS) expect(persian.test(permission)).toBe(false);
  });
});
