import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
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
const APP_ROOT = join(__dirname, '..', 'app');

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
    expect(handlers.length).toBe(54);
    expect(stateChangingHandlers.length).toBe(53);
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
      '/api/appointment-series/cancel-from',
      '/api/appointment-series/update-from',
      '/api/appointments/attendance',
      '/api/appointments/cancel',
      '/api/appointments/complete',
      '/api/appointments/move',
      '/api/appointments/reopen',
      '/api/auth/login',
      '/api/auth/logout',
      '/api/auth/password',
      '/api/auth/session-reset',
      '/api/availability/[therapistId]/exceptions',
      '/api/availability/[therapistId]/exceptions/remove',
      '/api/availability/[therapistId]/windows',
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
      // Families and children. There is deliberately NO search handler: the
      // term is personal data, so search is a Server Action that answers in
      // the response to its own POST (`app/families/search-action.tsx`) — no
      // redirect, so no URL and no cookie has to carry it. There is no
      // `update` handler for a child's `familyId` either: it is immutable, and
      // a genuine reassignment is a designed repair operation outside this
      // milestone.
      '/api/children/confirm-registration',
      '/api/children/confirm-update',
      '/api/children/create',
      '/api/children/status',
      '/api/children/update',
      '/api/families/confirm-registration',
      '/api/families/confirm-update',
      '/api/families/create',
      '/api/families/status',
      '/api/families/update',
      '/api/health',
      // Milestone 5 financial writes. IDs and reasons stay in the POST body;
      // each handler is a named operation rather than a generic ledger proxy.
      '/api/ledger/adjustments/create',
      '/api/ledger/adjustments/void',
      '/api/ledger/session-charges/post',
      '/api/ledger/session-charges/void',
      // Milestone 6 family money writes: B1 payments and B2 promise workflow.
      '/api/payments/create',
      '/api/payments/void',
      '/api/promises/cancel',
      '/api/promises/create',
      '/api/promises/fulfill',
      '/api/promises/reschedule',
      '/api/registration-drafts/discard',
      // Presentation-only POST: turns Jalali selects into the frozen, privacy-safe
      // report URL vocabulary. It calls no domain write endpoint.
      '/api/reports/filter',
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

/**
 * Server Actions are the other way a browser can reach server code, and the
 * guards above do not apply to them: they are not `route.ts` files, so nothing
 * in the enumeration over `/api` would ever see one. An action that skipped
 * `requireSession` would be an unauthenticated endpoint that no existing test
 * could notice.
 *
 * Family search is the first and only entry, exactly as anticipated. It is an
 * action rather than a Route Handler because the term is personal data: an
 * action answers in the response to its own POST, so — unlike a handler, which
 * must redirect and therefore needs a URL or a cookie to carry state across the
 * hop — there is nothing to leak in the first place.
 */
const USE_SERVER_DIRECTIVE = /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/.*\n\s*)*['"]use server['"]/;

function collectSourceFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);

    if (statSync(full).isDirectory()) collectSourceFiles(full, found);
    else if (/\.tsx?$/.test(entry) && !/\.(?:test|spec)\.tsx?$/.test(entry)) found.push(full);
  }

  return found;
}

const serverActionModules = collectSourceFiles(APP_ROOT)
  .map((path) => ({ path: path.split(sep).join('/'), source: readFileSync(path, 'utf8') }))
  .filter((module) => USE_SERVER_DIRECTIVE.test(module.source));

describe('every Server Action authorises for itself', () => {
  it('enumerates the Server Action modules that exist', () => {
    // Stated as an exact count for the same reason the handler count is: a file
    // that stops being found must fail here rather than pass silently.
    expect(serverActionModules).toHaveLength(2);
  });

  it.each(serverActionModules.map((module) => [module.path, module] as const))(
    '%s resolves a session and names a permission',
    (_path, module) => {
      expect(module.source).toContain('requireSession');
      expect(module.source).toMatch(/requirePermission:/);
    },
  );

  it.each(serverActionModules.map((module) => [module.path, module] as const))(
    '%s enforces strict Origin',
    (_path, module) => {
      // A Server Action receives no `Request`, so it reads the header itself.
      // Reading is not a state change, but a check applied only to writes is a
      // check somebody forgets to add to the first action that writes.
      expect(module.source).toMatch(/assertOriginAllowed|assertBrowserWriteAllowed/);
    },
  );

  it.each(serverActionModules.map((module) => [module.path, module] as const))(
    '%s exports only async functions',
    (_path, module) => {
      // React rejects any other export at call time rather than at build time.
      // `check-web-boundary.mjs` enforces this repository-wide; asserted here
      // too because the failure is invisible until a form is submitted.
      for (const line of module.source.split('\n')) {
        if (!/^export\s/.test(line)) continue;
        expect(line).toMatch(/^export\s+(?:async\s+function\s|type\s|interface\s)/);
      }
    },
  );
});
