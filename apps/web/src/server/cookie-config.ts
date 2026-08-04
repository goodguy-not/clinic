import 'server-only';
import { loadServerEnv } from '@/env';

/**
 * Cookie names and attributes, decided by deployment mode.
 *
 * The names differ between modes, not just the attributes. A `__Host-` prefixed
 * cookie and an unprefixed one cannot be confused for each other, so a
 * development cookie can never be presented to a production deployment or the
 * reverse — and the browser itself enforces the `__Host-` rules (Secure, Path=/,
 * no Domain), which makes those three attributes impossible to weaken by
 * accident rather than merely wrong.
 */

export type CookieAttributes = {
  readonly name: string;
  readonly httpOnly: true;
  readonly secure: boolean;
  readonly sameSite: 'lax';
  readonly path: '/';
  // `domain` is deliberately absent rather than undefined: `__Host-` forbids it,
  // and omitting it keeps the cookie host-only in both modes.
};

export type CookieConfig = {
  readonly session: CookieAttributes;
  readonly csrf: CookieAttributes;
  readonly deploymentMode: 'production' | 'non-production';
};

const PRODUCTION: CookieConfig = {
  deploymentMode: 'production',
  session: {
    name: '__Host-clinic_session',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
  },
  csrf: {
    name: '__Host-clinic_csrf',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
  },
};

const NON_PRODUCTION: CookieConfig = {
  deploymentMode: 'non-production',
  session: {
    name: 'clinic_session_dev',
    httpOnly: true,
    // Not Secure, so local HTTP and LAN testing work. Reachable only by
    // declaring the deployment non-production, never by a runtime override.
    secure: false,
    sameSite: 'lax',
    path: '/',
  },
  csrf: {
    name: 'clinic_csrf_dev',
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/',
  },
};

export function cookieConfigFor(mode: 'production' | 'non-production'): CookieConfig {
  return mode === 'production' ? PRODUCTION : NON_PRODUCTION;
}

export function cookieConfig(): CookieConfig {
  return cookieConfigFor(loadServerEnv().DEPLOYMENT_MODE);
}
