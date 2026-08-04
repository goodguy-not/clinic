import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string comparison.
 *
 * `timingSafeEqual` requires equal-length buffers and throws otherwise, so
 * comparing raw secrets would leak the expected length through an early throw.
 * Hashing both sides first makes them always 32 bytes, so the comparison itself
 * carries no length information and the digest of a wrong-length guess is as
 * uninformative as any other wrong guess.
 */
export function constantTimeEquals(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();

  return timingSafeEqual(a, b);
}
