import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Mechanical enumeration of every browser-facing Route Handler.
 *
 * The guards are called explicitly at the top of each handler rather than
 * applied by a wrapper, so this is what stops one being forgotten: a new
 * handler that does not reference the Origin helper fails the build instead of
 * shipping unprotected.
 */

const API_ROOT = join(__dirname, '..', 'app', 'api');

type Handler = { path: string; source: string; methods: string[] };

function collectRouteFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);

    if (statSync(full).isDirectory()) collectRouteFiles(full, found);
    else if (entry === 'route.ts') found.push(full);
  }

  return found;
}

const STATE_CHANGING = ['POST', 'PUT', 'PATCH', 'DELETE'];

const handlers: Handler[] = collectRouteFiles(API_ROOT).map((path) => {
  const source = readFileSync(path, 'utf8');
  const methods = [...source.matchAll(/export\s+(?:async\s+)?function\s+([A-Z]+)\s*\(/g)].map(
    (match) => match[1] as string,
  );

  return { path: path.replace(/\\/g, '/'), source, methods };
});

const stateChangingHandlers = handlers.filter((handler) =>
  handler.methods.some((method) => STATE_CHANGING.includes(method)),
);

/**
 * The single documented exemption. `/api/auth/session-reset` exists precisely
 * for users whose cookie state is broken, so requiring a valid bound token
 * would make recovery unreachable exactly when it is needed. Strict Origin is
 * the control there.
 *
 * Kept as a one-element list so adding a second exemption is a visible diff.
 */
const CSRF_EXEMPT = ['/api/auth/session-reset'];

describe('route handler inventory', () => {
  it('finds the handlers it is meant to be checking', () => {
    // Guards this whole file against silently passing because it enumerated
    // nothing at all.
    expect(handlers.length).toBe(22);
    expect(stateChangingHandlers.length).toBe(21);
  });

  it('exposes no catch-all route', () => {
    for (const handler of handlers) {
      expect(handler.path).not.toMatch(/\[\.\.\..+\]/);
    }
  });

  it('covers exactly the approved surface', () => {
    const routes = handlers
      .map((handler) => handler.path.slice(handler.path.indexOf('/api')).replace('/route.ts', ''))
      .sort();

    expect(routes).toEqual([
      '/api/auth/login',
      '/api/auth/logout',
      '/api/auth/password',
      '/api/auth/session-reset',
      // One handler per state change, never a resource-shaped catch-all: the
      // BFF stays a list of named operations.
      '/api/catalog/rooms/create',
      '/api/catalog/rooms/status',
      '/api/catalog/rooms/update',
      '/api/catalog/services/create',
      '/api/catalog/services/status',
      '/api/catalog/services/update',
      // No update handler for tariffs, deliberately: they are immutable, so a
      // correction voids and replaces rather than editing.
      '/api/catalog/tariffs/create',
      '/api/catalog/tariffs/void',
      '/api/catalog/therapists/create',
      '/api/catalog/therapists/status',
      '/api/catalog/therapists/update',
      '/api/health',
      '/api/staff/create',
      '/api/staff/password-reset',
      '/api/staff/revoke-sessions',
      '/api/staff/role',
      '/api/staff/status',
      '/api/staff/unlock',
    ]);
  });
});

describe('every state-changing handler is protected', () => {
  it.each(stateChangingHandlers.map((handler) => [handler.path, handler] as const))(
    '%s enforces strict Origin',
    (_path, handler) => {
      const callsOrigin =
        handler.source.includes('assertBrowserWriteAllowed') ||
        handler.source.includes('guardStateChanging');

      expect(callsOrigin).toBe(true);
    },
  );

  it.each(
    stateChangingHandlers
      .filter((handler) => !CSRF_EXEMPT.some((exempt) => handler.path.includes(exempt)))
      .map((handler) => [handler.path, handler] as const),
  )('%s verifies CSRF', (_path, handler) => {
    const callsCsrf =
      handler.source.includes('assertCsrf') || handler.source.includes('guardStateChanging');

    expect(callsCsrf).toBe(true);
  });

  it('has exactly one documented CSRF exemption', () => {
    expect(CSRF_EXEMPT).toHaveLength(1);

    const exempt = stateChangingHandlers.find((handler) =>
      handler.path.includes('/api/auth/session-reset'),
    );

    // It still enforces Origin — the exemption is only from the token.
    expect(exempt?.source).toContain('assertBrowserWriteAllowed');
    expect(exempt?.source).not.toContain('assertCsrf');
  });

  it.each(stateChangingHandlers.map((handler) => [handler.path, handler] as const))(
    '%s sets no-store and no-referrer',
    (_path, handler) => {
      const applies =
        handler.source.includes('secureRedirect') ||
        handler.source.includes('applySecurityHeaders') ||
        handler.source.includes('temporaryPasswordResponse') ||
        handler.source.includes('failureRedirect');

      expect(applies).toBe(true);
    },
  );
});

describe('no GET handler mutates a cookie', () => {
  it.each(handlers.filter((h) => h.methods.includes('GET')).map((h) => [h.path, h] as const))(
    '%s',
    (_path, handler) => {
      const getBody = handler.source.slice(
        handler.source.search(/export\s+(?:async\s+)?function\s+GET\s*\(/),
      );

      // SameSite=Lax sends cookies on a cross-site top-level GET navigation, so
      // a cookie-mutating GET would let any page on the internet change a staff
      // member's session state.
      for (const mutator of ['setCookie(', 'deleteCookie(', 'cookies.set(']) {
        expect(getBody).not.toContain(mutator);
      }
    },
  );
});

describe('no token or return URL enters a redirect', () => {
  it.each(handlers.map((handler) => [handler.path, handler] as const))(
    '%s builds redirects from literal paths only',
    (_path, handler) => {
      // Every redirect goes through helpers that take a literal `/path`; a
      // handler reading a destination out of the request would show up here.
      for (const pattern of [
        /searchParams\.get\(\s*['"](next|returnTo|redirect|url|continue)['"]/,
        /redirect\(\s*(?:body|params|searchParams)/,
      ]) {
        expect(handler.source).not.toMatch(pattern);
      }
    },
  );
});
