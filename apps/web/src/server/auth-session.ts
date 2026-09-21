import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { AuthenticatedUser, Permission } from '@clinic/contracts';
import { loadServerEnv } from '@/env';
import { api, type CallerContext } from './api-client';
import { cookieConfig } from './cookie-config';
import { verifySessionCookie } from './session-cookie';

/**
 * Server-side session resolution for pages.
 *
 * The cookie is treated as a bearer token and nothing else. It carries no user
 * id, no role and no expiry, and none is inferred from it: identity comes from
 * NestJS, which hashes the token, reads PostgreSQL and re-resolves role, status
 * and permissions on every request. A revoked session or a demoted user is
 * therefore correct on the very next page load with nothing to invalidate here.
 *
 * These functions only read cookies and redirect. A Server Component cannot set
 * or delete a cookie during render, which is exactly why stale-session recovery
 * is a redirect to a page with a form rather than something attempted inline
 * (see `/session-expired` and `POST /api/auth/session-reset`).
 */

/** The raw session token, or null when no cookie is present or it fails its signature. */
export async function readSessionToken(): Promise<string | null> {
  const { SESSION_COOKIE_SECRET } = loadServerEnv();
  const store = await cookies();
  const raw = store.get(cookieConfig().session.name)?.value;

  return verifySessionCookie(SESSION_COOKIE_SECRET, raw);
}

export async function readCsrfCookie(): Promise<string | null> {
  const store = await cookies();

  return store.get(cookieConfig().csrf.name)?.value ?? null;
}

/**
 * Client address and user agent as this server sees them, for the audit trail.
 *
 * Only as trustworthy as the deployment's proxy configuration, which is why
 * NestJS records them as reported by the web tier rather than as fact.
 */
export async function callerContext(sessionToken?: string): Promise<CallerContext> {
  const headerList = await headers();
  const forwardedFor = headerList.get('x-forwarded-for');

  return {
    ...(sessionToken === undefined ? {} : { sessionToken }),
    clientIp: forwardedFor?.split(',')[0]?.trim() ?? null,
    userAgent: headerList.get('user-agent'),
  };
}

export type SessionOptions = {
  /** Set on `/change-password` so it is reachable while a change is outstanding. */
  allowPasswordChangePending?: boolean;
  /**
   * Pages that need more than authentication name the permission they need.
   *
   * A LIST MEANS ALL OF THEM, never any of them. A page whose response carries
   * several kinds of information names each authority it displays — the family
   * account is charges, money and promise counts, and `FAMILY_ACCOUNT_READ_PERMISSIONS`
   * is exactly the list its NestJS route requires. OR semantics would let a
   * future role holding one of three render a screen the API then refuses to
   * fill, which is the mismatch this shape exists to make impossible.
   */
  requirePermission?: Permission | readonly Permission[];
};

/**
 * Resolves the signed-in user or redirects. Never returns for an invalid session.
 */
export async function requireSession(options: SessionOptions = {}): Promise<AuthenticatedUser> {
  const token = await readSessionToken();

  // No cookie, or a forged or tampered one. Both land in the same place: a page
  // that can clear the bad cookie through a form post.
  if (token === null) redirect('/session-expired');

  const result = await api.session(await callerContext(token));

  if (!result.ok) {
    if (result.code === 'AUTH_PASSWORD_CHANGE_REQUIRED') redirect('/change-password');
    redirect('/session-expired');
  }

  const user = result.data.user;

  // NestJS enforces this on every route regardless; the redirect exists so the
  // user lands somewhere useful rather than on an error.
  if (user.mustChangePassword && options.allowPasswordChangePending !== true) {
    redirect('/change-password');
  }

  if (options.requirePermission !== undefined) {
    const required =
      typeof options.requirePermission === 'string'
        ? [options.requirePermission]
        : options.requirePermission;

    if (!required.every((permission) => user.permissions.includes(permission))) {
      // NestJS would refuse the underlying call anyway; this keeps a
      // receptionist from rendering a management surface they cannot use.
      redirect('/dashboard');
    }
  }

  return user;
}

/** A session gate for surfaces that are policy-level Manager tools. */
export async function requireManagerSession(): Promise<AuthenticatedUser> {
  const user = await requireSession();
  if (user.role !== 'MANAGER') redirect('/dashboard');
  return user;
}

/**
 * For `/login`, which must not redirect an anonymous visitor anywhere.
 * Returns the user when a valid session exists, otherwise null.
 */
export async function readOptionalSession(): Promise<AuthenticatedUser | null> {
  const token = await readSessionToken();
  if (token === null) return null;

  const result = await api.session(await callerContext(token));

  return result.ok ? result.data.user : null;
}
