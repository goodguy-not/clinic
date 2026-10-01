import { RequestMethod, type Type } from '@nestjs/common';
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { Permission, UserRole } from '@clinic/contracts';
import { ENDPOINT_ACCESS_KEY, type EndpointAccess } from './decorators/endpoint-access';
import { ROLE_PERMISSIONS } from './permissions';

/**
 * THE ROUTE × ROLE MATRIX, DERIVED FROM THE CODE (Milestone 10, checkpoint A5).
 *
 * Every route is read from the decorators NestJS itself routes by — the
 * controller and method paths, the HTTP verb and the endpoint access
 * classification — by walking the module graph from `AppModule`. Nothing here is
 * a second statement of who may do what: a role's access to a route is the
 * guard chain's own rule applied to `ROLE_PERMISSIONS`, so the matrix cannot
 * disagree with the guards without the guards changing.
 *
 * No application is instantiated and no database is touched, so the pinning
 * test is a unit test and runs with nothing but Node.
 */

export interface RouteEntry {
  readonly method: string;
  readonly path: string;
  readonly controller: string;
  readonly handler: string;
  readonly access: EndpointAccess;
}

/** What a caller may do with one route, in the matrix's vocabulary. */
export type RouteVerdict = 'yes' | 'no' | 'web';

export type MatrixColumn = UserRole | 'VISITOR';

export const MATRIX_COLUMNS: readonly MatrixColumn[] = ['MANAGER', 'RECEPTIONIST', 'VISITOR'];

function joinPath(prefix: string | string[] | undefined, path: string | string[] | undefined) {
  const first = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? value[0] : value) ?? '';
  const segments = [first(prefix), first(path)]
    .map((segment) => segment.replace(/^\/+|\/+$/g, ''))
    .filter((segment) => segment !== '');
  return `/${segments.join('/')}`;
}

function controllersOf(root: Type<unknown>): Type<unknown>[] {
  const seen = new Set<unknown>();
  const controllers: Type<unknown>[] = [];

  const visit = (module: unknown) => {
    if (module == null || seen.has(module)) return;
    seen.add(module);

    // A dynamic module would arrive as `{ module, controllers, imports }`. None
    // exists today; reading both shapes keeps the walk honest if one appears.
    const target = (
      typeof module === 'function' ? module : (module as { module: unknown }).module
    ) as Type<unknown> | undefined;
    if (target === undefined) return;

    const dynamic = typeof module === 'function' ? {} : (module as Record<string, unknown>);
    const imports = [
      ...((Reflect.getMetadata(MODULE_METADATA.IMPORTS, target) as unknown[] | undefined) ?? []),
      ...((dynamic.imports as unknown[] | undefined) ?? []),
    ];
    controllers.push(
      ...((Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, target) as
        Type<unknown>[] | undefined) ?? []),
      ...((dynamic.controllers as Type<unknown>[] | undefined) ?? []),
    );

    for (const imported of imports) {
      // `forwardRef(() => X)` resolves lazily.
      const resolved =
        imported != null && typeof imported === 'object' && 'forwardRef' in imported
          ? (imported as { forwardRef: () => unknown }).forwardRef()
          : imported;
      visit(resolved);
    }
  };

  visit(root);
  return [...new Set(controllers)];
}

/** Every registered route, sorted by path then verb. */
export function collectRoutes(root: Type<unknown>): RouteEntry[] {
  const routes: RouteEntry[] = [];

  for (const controller of controllersOf(root)) {
    const prefix = Reflect.getMetadata(PATH_METADATA, controller) as string | string[] | undefined;
    const prototype = controller.prototype as Record<string, unknown>;

    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (name === 'constructor') continue;
      const handler = prototype[name];
      if (typeof handler !== 'function' || !Reflect.hasMetadata(PATH_METADATA, handler)) continue;

      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod;
      const access = (Reflect.getMetadata(ENDPOINT_ACCESS_KEY, handler) ??
        Reflect.getMetadata(ENDPOINT_ACCESS_KEY, controller)) as EndpointAccess | undefined;

      routes.push({
        method: RequestMethod[method],
        path: joinPath(prefix, Reflect.getMetadata(PATH_METADATA, handler) as string),
        controller: controller.name,
        handler: name,
        // An unclassified route is denied by the first guard; the matrix shows it
        // as such and the pinning test refuses it outright.
        access: access ?? { kind: 'permissions', permissions: ['__unclassified__' as Permission] },
      });
    }
  }

  return routes.sort((a, b) =>
    a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path),
  );
}

/**
 * The guard chain's rule, stated once.
 *
 * `public`         anybody, with no key and no session (liveness probes).
 * `internal`       the internal key and no session: reachable only through the
 *                  Next.js server, which is how a visitor's browser reaches it —
 *                  `web` in the visitor column.
 * `authenticated`  any signed-in user.
 * `permissions`    a signed-in user holding EVERY named permission.
 */
export function verdict(access: EndpointAccess, column: MatrixColumn): RouteVerdict {
  switch (access.kind) {
    case 'public':
      return 'yes';
    case 'internal':
      return column === 'VISITOR' ? 'web' : 'yes';
    case 'authenticated':
      return column === 'VISITOR' ? 'no' : 'yes';
    case 'permissions':
      if (column === 'VISITOR') return 'no';
      return access.permissions.every((permission) => ROLE_PERMISSIONS[column].includes(permission))
        ? 'yes'
        : 'no';
  }
}

export function describeAccess(access: EndpointAccess): string {
  return access.kind === 'permissions' ? access.permissions.join(' + ') : `(${access.kind})`;
}

/**
 * THE PRODUCT AREA EACH CONTROLLER BELONGS TO.
 *
 * Keyed by controller class, so a new controller has no area until somebody
 * gives it one — and the pinning test fails until they do. The order is the
 * order the matrix document presents them in.
 */
export const PRODUCT_AREAS = [
  {
    area: 'Families and children',
    controllers: ['FamiliesController', 'ChildrenController', 'RegistrationDraftsController'],
  },
  {
    area: 'Catalog (therapists, services, rooms, tariffs, availability)',
    controllers: [
      'TherapistsController',
      'ServicesController',
      'RoomsController',
      'TariffsController',
      'AvailabilityController',
    ],
  },
  {
    area: 'Scheduling',
    controllers: [
      'AppointmentsController',
      'AppointmentSeriesController',
      'AppointmentDayController',
    ],
  },
  {
    area: 'Charges, payments and promises',
    controllers: [
      'FamilyAccountController',
      'SessionChargesController',
      'ChargeAdjustmentsController',
      'PaymentsController',
      'PaymentVoidController',
      'PromisesController',
      'PromiseResolutionController',
    ],
  },
  {
    area: 'Therapist settlement',
    controllers: [
      'ShareRulesController',
      'SessionRatingsController',
      'SettlementPeriodsController',
      'SettlementStatementController',
    ],
  },
  {
    area: 'Reports and export',
    controllers: [
      'DashboardController',
      'OperationalReportsController',
      'FinancialReportsController',
      'ReportExportController',
    ],
  },
  { area: 'Website requests', controllers: ['WebsiteRequestsController'] },
  {
    area: 'Content and media',
    controllers: [
      'ArticlesController',
      'TestimonialsController',
      'SpacesController',
      'ServicePublicCopyController',
      'TherapistProfileCopyController',
      'TherapistPublicProfileController',
      'ClinicProfileController',
      'MediaController',
    ],
  },
  { area: 'Public website (served to visitors)', controllers: ['PublicSiteController'] },
  { area: 'Sign-in and staff accounts', controllers: ['AuthController', 'UsersController'] },
  { area: 'Operations and backups', controllers: ['OperationsController', 'HealthController'] },
] as const;

/**
 * EVERY ROUTE THAT REQUIRES NO PERMISSION, AND WHY.
 *
 * A route classified `public`, `internal` or `authenticated` is reachable by
 * somebody who holds no named authority, so each one is listed here by verb and
 * path with the audience it is FOR. The pinning test fails for an open route
 * missing from this list and for an entry whose route no longer exists or has
 * changed kind: opening a route is a decision that has to be written down.
 *
 * `visitor` decides the visitor column for an `internal` route: whether the
 * Next.js server fronts it for an anonymous browser (`web`) or not (`no`).
 */
export const OPEN_ROUTES: Record<
  string,
  {
    readonly kind: 'public' | 'internal' | 'authenticated';
    readonly visitor: RouteVerdict;
    readonly why: string;
  }
> = {
  'GET /health': { kind: 'public', visitor: 'yes', why: 'Liveness probe; carries no data.' },
  'GET /health/ready': { kind: 'public', visitor: 'yes', why: 'Readiness probe; carries no data.' },
  'GET /health/db': {
    kind: 'internal',
    visitor: 'no',
    why: 'Database reachability for the operator; the web tier does not front it.',
  },
  'POST /auth/login': {
    kind: 'internal',
    visitor: 'web',
    why: 'Where a session begins, so it cannot require one; the sign-in page.',
  },
  'POST /auth/logout': {
    kind: 'authenticated',
    visitor: 'no',
    why: "Ends the caller's own session.",
  },
  'GET /auth/session': { kind: 'authenticated', visitor: 'no', why: "The caller's own identity." },
  'POST /auth/password': {
    kind: 'authenticated',
    visitor: 'no',
    why: "Changes the caller's own password; requires the current one.",
  },
  'GET /public/articles': { kind: 'internal', visitor: 'web', why: 'Published articles only.' },
  'GET /public/articles/:slug': {
    kind: 'internal',
    visitor: 'web',
    why: 'One published article.',
  },
  'GET /public/clinic-content': {
    kind: 'internal',
    visitor: 'web',
    why: 'Published clinic copy.',
  },
  'GET /public/clinic-profile': {
    kind: 'internal',
    visitor: 'web',
    why: 'Address and contact details the site prints.',
  },
  'GET /public/media/:renditionId': {
    kind: 'internal',
    visitor: 'web',
    why: 'Bytes of a published attachment only, by opaque rendition id.',
  },
  'POST /public/requests': {
    kind: 'internal',
    visitor: 'web',
    why: 'The contact form; consent-gated and throttled, it creates an inbox row only.',
  },
  'GET /public/services': { kind: 'internal', visitor: 'web', why: 'Published services.' },
  'GET /public/services/:slug': {
    kind: 'internal',
    visitor: 'web',
    why: 'One published service.',
  },
  'GET /public/sitemap': {
    kind: 'internal',
    visitor: 'web',
    why: 'Published slugs for the sitemap.',
  },
  'GET /public/spaces': { kind: 'internal', visitor: 'web', why: 'Published clinic spaces.' },
  'GET /public/team': {
    kind: 'internal',
    visitor: 'web',
    why: 'Therapists whose profile a manager published.',
  },
  'GET /public/team/:slug': {
    kind: 'internal',
    visitor: 'web',
    why: 'One published therapist profile.',
  },
  'GET /public/testimonials': {
    kind: 'internal',
    visitor: 'web',
    why: 'Approved, published testimonials.',
  },
};

/**
 * AUTHORITY CHECKED INSIDE A HANDLER, IN ADDITION TO THE ROUTE'S.
 *
 * The route decorator is the gate; these are the few places a handler asks for
 * a second name depending on what the request does. Each source file that reads
 * `permissions.includes(...)` must appear here — the pinning test scans the
 * source — so a new in-handler check cannot arrive unrecorded.
 */
export const IN_HANDLER_AUTHORITY: readonly {
  readonly file: string;
  readonly permission: Permission;
  readonly rule: string;
}[] = [
  {
    file: 'appointments/scheduling-rules.ts',
    permission: 'appointment.override_availability',
    rule: "Booking or moving a session outside the therapist's hours also requires this name, with a recorded reason.",
  },
  {
    file: 'appointments/appointment-series.service.ts',
    permission: 'appointment.override_availability',
    rule: 'The same override for a recurring series.',
  },
  {
    file: 'media/media.service.ts',
    permission: 'media.publish',
    rule: 'Changing the description of a photograph that is already publicly served also requires this name.',
  },
  {
    file: 'media/media-preview.service.ts',
    permission: 'media.read',
    rule: 'A staff preview of an unpublished photograph is limited to the owner types whose content the caller may read.',
  },
  {
    file: 'reports/dashboard.service.ts',
    permission: 'report.read_financial',
    rule: "Without it the dashboard shows the caller's own payment entries only, and no clinic-wide money.",
  },
  {
    file: 'settlement/share-rules/share-rules.service.ts',
    permission: 'therapist_share.void',
    rule: 'Creating a share rule that supersedes another also requires the void name.',
  },
];

const CELL: Record<RouteVerdict, string> = { yes: '✔', no: '—', web: 'via site' };

/** The visitor column: `internal` routes are decided by `OPEN_ROUTES`. */
export function visitorVerdict(route: RouteEntry): RouteVerdict {
  return route.access.kind === 'internal'
    ? (OPEN_ROUTES[`${route.method} ${route.path}`]?.visitor ?? 'no')
    : verdict(route.access, 'VISITOR');
}

/** The matrix document, rendered from the code. Pinned byte for byte. */
export function renderMatrix(routes: readonly RouteEntry[]): string {
  const lines: string[] = [
    '# Route × role matrix',
    '',
    '<!-- GENERATED by apps/api/src/auth/route-access-matrix.spec.ts from the route decorators and',
    '     ROLE_PERMISSIONS. Do not edit by hand. Regenerate from apps/api with:',
    '     UPDATE_PERMISSION_MATRIX=1 pnpm exec jest src/auth/route-access-matrix.spec.ts -->',
    '',
    'Every NestJS route, what it requires, and whether each caller may use it. A permission list is',
    'an AND: the caller must hold every name. ✔ allowed · — refused · _via site_ reachable by an',
    'anonymous browser only through the Next.js public site or sign-in page (NestJS itself is never',
    'exposed to the internet). Open routes and in-handler checks are listed after the tables.',
    '',
  ];

  const counts = { MANAGER: 0, RECEPTIONIST: 0, VISITOR: 0 };

  for (const { area, controllers } of PRODUCT_AREAS) {
    const names: readonly string[] = controllers;
    const inArea = routes.filter((route) => names.includes(route.controller));
    lines.push(
      `## ${area}`,
      '',
      '| Route | Requires | Manager | Receptionist | Visitor |',
      '| --- | --- | :-: | :-: | :-: |',
    );
    for (const route of inArea) {
      const cells = [
        verdict(route.access, 'MANAGER'),
        verdict(route.access, 'RECEPTIONIST'),
        visitorVerdict(route),
      ];
      if (cells[0] === 'yes') counts.MANAGER += 1;
      if (cells[1] === 'yes') counts.RECEPTIONIST += 1;
      if (cells[2] !== 'no') counts.VISITOR += 1;
      lines.push(
        `| \`${route.method} ${route.path}\` | ${describeAccess(route.access)} | ${cells
          .map((cell) => CELL[cell])
          .join(' | ')} |`,
      );
    }
    lines.push('');
  }

  const probes = routes.filter((route) => route.access.kind === 'public').length;

  lines.push(
    '## Totals',
    '',
    `${routes.length} routes. Manager ${counts.MANAGER}, receptionist ${counts.RECEPTIONIST}, ` +
      `visitor ${counts.VISITOR} (${probes} liveness probes directly, the rest via the site).`,
    '',
    '## Routes that require no permission',
    '',
    '| Route | Kind | Why |',
    '| --- | --- | --- |',
    ...Object.entries(OPEN_ROUTES).map(
      ([route, entry]) => `| \`${route}\` | ${entry.kind} | ${entry.why} |`,
    ),
    '',
    '## Authority checked inside a handler',
    '',
    '| Permission | Where | Rule |',
    '| --- | --- | --- |',
    ...IN_HANDLER_AUTHORITY.map(
      (entry) => `| ${entry.permission} | \`apps/api/src/${entry.file}\` | ${entry.rule} |`,
    ),
    '',
  );

  return lines.join('\n');
}
