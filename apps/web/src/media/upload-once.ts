import 'server-only';
import { createHash } from 'node:crypto';
import type { MediaAssetResponse } from '@clinic/contracts';
import type { ApiResult } from '@/server/api-client';

const ATTEMPT_TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 128;

type Entry = {
  expiresAt: number;
  result: Promise<ApiResult<MediaAssetResponse>>;
};

const attempts = new Map<string, Entry>();

function keyFor(sessionToken: string, attemptId: string): string {
  return `${createHash('sha256').update(sessionToken).digest('hex')}:${attemptId}`;
}

/**
 * A browser retry reuses the same opaque attempt id. Keeping the settled or
 * in-flight result means a lost browser response does not trigger a second
 * POST to A5 in the ordinary single-process deployment.
 */
export function uploadOnce(
  sessionToken: string,
  attemptId: string,
  operation: () => Promise<ApiResult<MediaAssetResponse>>,
): Promise<ApiResult<MediaAssetResponse>> {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (entry.expiresAt <= now) attempts.delete(key);
  }

  const key = keyFor(sessionToken, attemptId);
  const existing = attempts.get(key);
  if (existing !== undefined) return existing.result;

  if (attempts.size >= MAX_ATTEMPTS) attempts.delete(attempts.keys().next().value as string);
  const result = operation().then((answer) => {
    // A definite refusal/unreachable result must remain retryable. Successful
    // and in-flight attempts stay memoised, covering double-taps and a lost
    // browser response without making a refusal sticky for fifteen minutes.
    if (!answer.ok) uploadAttemptsDelete(key);
    return answer;
  });
  attempts.set(key, { expiresAt: now + ATTEMPT_TTL_MS, result });
  return result;
}

function uploadAttemptsDelete(key: string): void {
  attempts.delete(key);
}
