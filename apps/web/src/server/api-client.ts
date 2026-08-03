import 'server-only';
import { loadServerEnv } from '@/env';

/**
 * Server-only client for the NestJS API.
 *
 * `server-only` makes importing this module from a Client Component a build
 * error, so API credentials and internal URLs can never reach the browser.
 * Server Components may call this directly; there is no generic proxy route.
 *
 * Milestone 0 exposes health only. Domain calls arrive with their milestones.
 */

export type ApiLiveness = {
  status: string;
  service: string;
  uptimeSeconds: number;
  timestamp: string;
};

export type ApiCallResult<T> =
  { ok: true; data: T } | { ok: false; reason: 'unreachable' | 'unhealthy' };

const REQUEST_TIMEOUT_MS = 3000;

async function getJson<T>(path: string): Promise<ApiCallResult<T>> {
  const { API_BASE_URL } = loadServerEnv();

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    });

    if (!response.ok) {
      return { ok: false, reason: 'unhealthy' };
    }

    return { ok: true, data: (await response.json()) as T };
  } catch {
    // Detail is deliberately dropped: an upstream failure must not surface
    // internal hostnames or stack traces to a browser response.
    return { ok: false, reason: 'unreachable' };
  }
}

export function fetchApiLiveness(): Promise<ApiCallResult<ApiLiveness>> {
  return getJson<ApiLiveness>('/health');
}
