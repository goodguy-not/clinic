import 'server-only';
import { allowedOrigins, loadServerEnv } from '@/env';

/**
 * Strict Origin validation for every browser state-changing request.
 *
 * `Origin` must be present, must parse, and must exactly match a configured
 * origin. There is deliberately **no `Referer` fallback**: `Referer` is
 * suppressed by privacy settings and referrer policies far more often than
 * `Origin` is, so a fallback turns into the path everyone takes and the strict
 * check stops meaning anything. Browsers send `Origin` on every cross-origin
 * POST, which is the case this exists to stop.
 *
 * A missing `Origin` is therefore a rejection, not a pass. Clinic workstations
 * run current browsers; an absent header is a signal, not compatibility.
 */

export class OriginRejectedError extends Error {
  constructor(readonly received: string | null) {
    super('Origin is missing or not allowed');
    this.name = 'OriginRejectedError';
  }
}

export function isOriginAllowed(origin: string | null, allowed: readonly string[]): boolean {
  if (origin === null || origin === '') return false;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  // Compare the normalised origin, so `https://example.com:443` and
  // `https://example.com` cannot disagree, and a value carrying a path can
  // never match.
  if (parsed.origin !== origin) return false;

  return allowed.includes(parsed.origin);
}

/**
 * The check itself, against an `Origin` value the caller has already read.
 *
 * A Server Action never receives a `Request`: it reads headers through
 * `headers()` from `next/headers`. Both entry points must apply the same
 * allow-list, so the rule lives here once and the two callers differ only in
 * where they got the header from.
 */
export function assertOriginAllowed(origin: string | null): void {
  if (!isOriginAllowed(origin, allowedOrigins(loadServerEnv()))) {
    throw new OriginRejectedError(origin);
  }
}

/**
 * Called at the top of every state-changing Route Handler. A coverage test
 * enumerates the handlers and fails if one does not reference it.
 */
export function assertBrowserWriteAllowed(request: Request): void {
  assertOriginAllowed(request.headers.get('origin'));
}
