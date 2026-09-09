import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DASHBOARD_READ_PERMISSIONS,
  FAMILY_ACCOUNT_READ_PERMISSIONS,
  FAMILY_ACCOUNT_REPORT_READ_PERMISSIONS,
  PAYMENT_REPORT_READ_PERMISSIONS,
  type Permission,
} from '@clinic/contracts';

/**
 * The page gate, and the one place a page's authority can drift from its API's.
 *
 * A page that renders a NestJS response has to demand what that response's route
 * demands. When it demands less, the mismatch is invisible until a role exists
 * that holds part of the list: the page renders, the API refuses, and the
 * operator sees a failure rather than a refusal. The family account is the
 * response with three authorities, so it is the one this file pins.
 *
 * Every value here is synthetic.
 */

const APP_ROOT = join(__dirname, '..', 'app', '(internal)');

const redirected = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

vi.mock('next/navigation', () => ({ redirect: (path: string) => redirected(path) }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: 'synthetic-cookie' }) }),
  headers: async () => new Headers(),
}));
vi.mock('@/env', () => ({ loadServerEnv: () => ({ SESSION_COOKIE_SECRET: 'synthetic-secret' }) }));
vi.mock('@/server/session-cookie', () => ({ verifySessionCookie: () => 'synthetic-token' }));

const sessionUser = vi.fn();
vi.mock('@/server/api-client', () => ({ api: { session: () => sessionUser() } }));

async function requireWith(permissions: readonly Permission[], required: unknown) {
  sessionUser.mockResolvedValue({
    ok: true,
    data: {
      user: {
        id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d01',
        username: 'synthetic',
        displayName: 'کاربر آزمایشی',
        role: 'RECEPTIONIST',
        mustChangePassword: false,
        permissions,
      },
    },
  });

  const { requireSession } = await import('./auth-session');
  return requireSession({ requirePermission: required as Permission });
}

afterEach(() => {
  redirected.mockClear();
});

describe('a page may demand several permissions, and then demands all of them', () => {
  it('admits a user holding every named permission', async () => {
    const user = await requireWith(
      [...FAMILY_ACCOUNT_READ_PERMISSIONS],
      FAMILY_ACCOUNT_READ_PERMISSIONS,
    );

    expect(user.permissions).toEqual([...FAMILY_ACCOUNT_READ_PERMISSIONS]);
    expect(redirected).not.toHaveBeenCalled();
  });

  it('turns away a user holding only some of them', async () => {
    // AND, not OR. A future role with `charge.read` alone must not render an
    // account whose position the API will refuse to compute for it.
    await expect(requireWith(['charge.read'], FAMILY_ACCOUNT_READ_PERMISSIONS)).rejects.toThrow(
      'REDIRECT:/dashboard',
    );
    expect(redirected).toHaveBeenCalledWith('/dashboard');
  });

  it('still accepts a single permission, exactly as before', async () => {
    const user = await requireWith(['payment.read'], 'payment.read');
    expect(user.permissions).toEqual(['payment.read']);
    expect(redirected).not.toHaveBeenCalled();

    await expect(requireWith(['payment.read'], 'payment.void')).rejects.toThrow(
      'REDIRECT:/dashboard',
    );
  });
});

describe('the family money pages name the authority their API route requires', () => {
  const source = (path: string): string => readFileSync(join(APP_ROOT, path), 'utf8');

  it('states the three account authorities once, in the shared contract', () => {
    // The API guard and this page read the same list. Two lists would be two
    // answers, and the one on the page is the one nobody notices drifting.
    expect([...FAMILY_ACCOUNT_READ_PERMISSIONS]).toEqual([
      'charge.read',
      'payment.read',
      'promise.read',
    ]);
  });

  it('gates /families/[id]/account on the shared list rather than on charge.read alone', () => {
    const page = source(join('families', '[id]', 'account', 'page.tsx'));

    expect(page).toContain('requirePermission: FAMILY_ACCOUNT_READ_PERMISSIONS');
    expect(page).not.toMatch(/requirePermission:\s*'charge\.read'/);
  });

  it('leaves the two single-authority money pages exactly as they were', () => {
    // Neither page renders the account response, so neither is broadened or
    // narrowed by the account fix.
    expect(source(join('families', '[id]', 'payments', 'page.tsx'))).toContain(
      "requirePermission: 'payment.read'",
    );
    expect(source(join('families', '[id]', 'promises', 'page.tsx'))).toContain(
      "requirePermission: 'promise.read'",
    );
  });
});

describe('the dashboard page names every authority in its aggregated response', () => {
  it('gates the page on the frozen shared list with AND semantics', async () => {
    expect([...DASHBOARD_READ_PERMISSIONS]).toEqual([
      'appointment.read',
      'charge.read',
      'payment.read',
      'promise.read',
      // Milestone 9, checkpoint A4: the dashboard states how many website
      // requests are waiting, so it names the authority to read one.
      'website_request.read',
    ]);

    const user = await requireWith([...DASHBOARD_READ_PERMISSIONS], DASHBOARD_READ_PERMISSIONS);
    expect(user.permissions).toEqual([...DASHBOARD_READ_PERMISSIONS]);

    await expect(
      requireWith(['appointment.read', 'payment.read', 'promise.read'], DASHBOARD_READ_PERMISSIONS),
    ).rejects.toThrow('REDIRECT:/dashboard');
  });

  it('uses the shared dashboard permission constant on the landing page', () => {
    const page = readFileSync(join(APP_ROOT, 'dashboard', 'page.tsx'), 'utf8');
    expect(page).toContain('requirePermission: DASHBOARD_READ_PERMISSIONS');
  });
});

describe('clinic-wide financial reports are manager-only at the page boundary', () => {
  it('admits every frozen route authority and refuses receptionist operational money permissions', async () => {
    await expect(
      requireWith([...PAYMENT_REPORT_READ_PERMISSIONS], PAYMENT_REPORT_READ_PERMISSIONS),
    ).resolves.toEqual(
      expect.objectContaining({ permissions: [...PAYMENT_REPORT_READ_PERMISSIONS] }),
    );
    await expect(
      requireWith(
        [...FAMILY_ACCOUNT_REPORT_READ_PERMISSIONS],
        FAMILY_ACCOUNT_REPORT_READ_PERMISSIONS,
      ),
    ).resolves.toEqual(
      expect.objectContaining({ permissions: [...FAMILY_ACCOUNT_REPORT_READ_PERMISSIONS] }),
    );

    await expect(
      requireWith(
        ['charge.read', 'payment.read', 'promise.read'],
        FAMILY_ACCOUNT_REPORT_READ_PERMISSIONS,
      ),
    ).rejects.toThrow('REDIRECT:/dashboard');
  });

  it('pins both report pages to the same frozen lists their API routes use', () => {
    const payments = readFileSync(join(APP_ROOT, 'reports', 'payments', 'page.tsx'), 'utf8');
    const accounts = readFileSync(join(APP_ROOT, 'reports', 'family-accounts', 'page.tsx'), 'utf8');
    expect(payments).toContain('requirePermission: PAYMENT_REPORT_READ_PERMISSIONS');
    expect(accounts).toContain('requirePermission: FAMILY_ACCOUNT_REPORT_READ_PERMISSIONS');
  });
});

describe('B6 editorial page authority follows the accepted draft/publish split', () => {
  it('admits the receptionist drafting authorities but refuses manager publication controls', async () => {
    await expect(
      requireWith(
        ['service.draft_public_copy', 'therapist.draft_public_profile'],
        'service.draft_public_copy',
      ),
    ).resolves.toEqual(expect.objectContaining({ role: 'RECEPTIONIST' }));
    await expect(
      requireWith(['therapist.draft_public_profile'], 'therapist.publish_profile'),
    ).rejects.toThrow('REDIRECT:/dashboard');
    await expect(requireWith(['service.draft_public_copy'], 'service.update')).rejects.toThrow(
      'REDIRECT:/dashboard',
    );
    await expect(
      requireWith(['media.read', 'media.upload', 'media.attach'], 'media.publish'),
    ).rejects.toThrow('REDIRECT:/dashboard');
  });

  it('pins the detail pages and clinic form to their narrow page gates', () => {
    const service = readFileSync(join(APP_ROOT, 'content', 'services', '[id]', 'page.tsx'), 'utf8');
    const therapist = readFileSync(
      join(APP_ROOT, 'content', 'therapists', '[id]', 'page.tsx'),
      'utf8',
    );
    const clinic = readFileSync(join(APP_ROOT, 'content', 'clinic-profile', 'page.tsx'), 'utf8');
    expect(service).toContain("requirePermission: 'service.draft_public_copy'");
    expect(therapist).toContain("requirePermission: 'therapist.draft_public_profile'");
    expect(clinic).toContain("requirePermission: ['clinic_profile.read', 'clinic_profile.update']");
  });
});
