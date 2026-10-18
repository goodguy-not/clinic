import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { PERMISSIONS, USER_ROLES } from '@clinic/contracts';
import { AppModule } from '../app.module';
import { ROLE_PERMISSIONS } from './permissions';
import {
  collectRoutes,
  IN_HANDLER_AUTHORITY,
  OPEN_ROUTES,
  PRODUCT_AREAS,
  renderMatrix,
  verdict,
  visitorVerdict,
} from './route-access-matrix';

/**
 * THE ROUTE × ROLE MATRIX, PINNED (Milestone 10, checkpoint A5).
 *
 * EVERYTHING HERE IS SYNTHETIC — it reads decorators, never data.
 *
 * `docs/PERMISSION_MATRIX.md` is rendered from the route decorators and the
 * role map and compared byte for byte, so adding a route, changing what one
 * requires, or granting a role a name changes the document — and the test fails
 * until somebody regenerates it and the diff is reviewed. The other assertions
 * are what make "nothing is reachable by accident" true rather than merely
 * documented: every open route is recorded with its reason, every controller has
 * a product area, every permission is demanded somewhere, and every in-handler
 * check is listed.
 */
describe('the route × role matrix', () => {
  const routes = collectRoutes(AppModule);
  const matrixPath = resolve(__dirname, '../../../../docs/PERMISSION_MATRIX.md');

  it('finds every route the guard coverage test counts', () => {
    // The same 171 `test/guards.int-spec.ts` counts by instantiating the app;
    // agreeing proves the static walk missed no module.
    expect(routes).toHaveLength(171);
    expect(new Set(routes.map((route) => `${route.method} ${route.path}`)).size).toBe(
      routes.length,
    );
  });

  it('classifies every route', () => {
    expect(
      routes.filter(
        (route) =>
          route.access.kind === 'permissions' &&
          route.access.permissions.some((permission) => !PERMISSIONS.includes(permission)),
      ),
    ).toEqual([]);
  });

  it('puts every controller in exactly one product area', () => {
    const assigned = PRODUCT_AREAS.flatMap(({ controllers }) => [...controllers]);
    expect(new Set(assigned).size).toBe(assigned.length);
    expect([...new Set(routes.map((route) => route.controller))].sort()).toEqual(
      [...assigned].sort(),
    );
  });

  it('records every route that requires no permission, with its reason', () => {
    const open = routes
      .filter((route) => route.access.kind !== 'permissions')
      .map((route) => `${route.method} ${route.path}`);
    expect(open.sort()).toEqual(Object.keys(OPEN_ROUTES).sort());

    for (const route of routes) {
      const entry = OPEN_ROUTES[`${route.method} ${route.path}`];
      if (entry !== undefined) expect(route.access.kind).toBe(entry.kind);
    }
  });

  it('opens nothing to a visitor except liveness, sign-in and the published site', () => {
    const reachable = routes
      .filter((route) => visitorVerdict(route) !== 'no')
      .map((route) => `${route.method} ${route.path}`);
    for (const route of reachable) {
      expect(route).toMatch(
        /^(GET \/health(\/ready)?|POST \/auth\/login|(GET|POST) \/public\/.*)$/,
      );
    }
    // And every public-site route is a read except the contact form.
    expect(reachable.filter((route) => route.startsWith('POST ')).sort()).toEqual([
      'POST /auth/login',
      'POST /public/requests',
    ]);
  });

  it('demands every permission on some route or in a recorded in-handler check', () => {
    const demanded = new Set([
      ...routes.flatMap((route) =>
        route.access.kind === 'permissions' ? route.access.permissions : [],
      ),
      ...IN_HANDLER_AUTHORITY.map((entry) => entry.permission),
    ]);
    expect(PERMISSIONS.filter((permission) => !demanded.has(permission))).toEqual([]);
  });

  it('demands no permission that no role holds', () => {
    const held = new Set(USER_ROLES.flatMap((role) => [...ROLE_PERMISSIONS[role]]));
    for (const route of routes) {
      if (route.access.kind !== 'permissions') continue;
      for (const permission of route.access.permissions) expect(held.has(permission)).toBe(true);
    }
  });

  it('gives a manager every route and a visitor no signed-in route', () => {
    for (const route of routes) {
      expect(verdict(route.access, 'MANAGER')).toBe('yes');
      if (route.access.kind === 'permissions' || route.access.kind === 'authenticated') {
        expect(visitorVerdict(route)).toBe('no');
      }
    }
  });

  it('lists every source file that checks a permission inside a handler', () => {
    const root = resolve(__dirname, '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) files.push(path);
      }
    };
    walk(root);

    const checking = files
      .filter((path) =>
        /permissions\.includes\(|MEDIA_PREVIEW_OWNER_PERMISSION\[/.test(readFileSync(path, 'utf8')),
      )
      .map((path) => relative(root, path).replace(/\\/g, '/'))
      // The guard is the gate itself, and this module restates the guard's rule.
      .filter(
        (path) =>
          path !== 'auth/guards/permissions.guard.ts' && path !== 'auth/route-access-matrix.ts',
      );

    expect(checking.sort()).toEqual([...new Set(IN_HANDLER_AUTHORITY.map((e) => e.file))].sort());
  });

  it('matches docs/PERMISSION_MATRIX.md byte for byte', () => {
    const rendered = renderMatrix(routes);
    if (process.env.UPDATE_PERMISSION_MATRIX === '1') writeFileSync(matrixPath, rendered);
    expect(readFileSync(matrixPath, 'utf8')).toBe(rendered);
  });
});
