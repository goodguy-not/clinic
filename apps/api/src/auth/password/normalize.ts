import { PASSWORD_MAX_BYTES } from '../auth-policy';

/**
 * The reviewed helper through which every password measurement passes.
 *
 * Three separate notions of "length" exist for a Unicode string and they
 * disagree, so the choice has to be explicit:
 *
 *   "a".repeat(15)      15 UTF-16 units, 15 code points, 15 graphemes
 *   "\u{1D51E}".repeat(8)   16 UTF-16 units,  8 code points,  8 graphemes
 *   family emoji x3     33 UTF-16 units, 21 code points,  3 graphemes
 *
 * We count **code points of the NFC-normalised string**, because NIST
 * SP 800-63B — the stated basis for this policy — treats each Unicode code
 * point as one character. `String.prototype.length` is silently wrong outside
 * the Basic Multilingual Plane, and grapheme clusters would reject a class of
 * legitimately strong inputs while depending on an ICU segmentation table that
 * changes between Unicode versions.
 */

/**
 * Matches only UNPAIRED surrogates.
 *
 * With the `u` flag the pattern iterates by code point, so a well-formed
 * surrogate pair is a single astral code point that is not in the Surrogate
 * category and does not match. A lone surrogate stays in D800-DFFF and does.
 *
 * `String.prototype.isWellFormed()` is the ES2024 equivalent. It is not used
 * because `tsconfig.base.json` targets lib ES2023, and this needs no lib bump.
 */
const LONE_SURROGATE = /\p{Surrogate}/u;

export type NormalizeRejection = 'ILL_FORMED_UNICODE' | 'TOO_MANY_BYTES';

export type NormalizeResult =
  { ok: true; normalized: string } | { ok: false; reason: NormalizeRejection };

export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/** Counts Unicode code points. The string iterator yields code points, not UTF-16 units. */
export function countCodePoints(value: string): number {
  return Array.from(value).length;
}

export function isWellFormedUnicode(value: string): boolean {
  return !LONE_SURROGATE.test(value);
}

/**
 * Steps 1 to 4 of the approved check order. Each bounds the cost of the next:
 *
 *   1. reject ill-formed Unicode  — NFC on a lone surrogate is not meaningful,
 *                                   and a lone surrogate cannot have come from
 *                                   a real keyboard
 *   2. raw byte cap               — bounds the cost of normalisation itself
 *   3. NFC normalise
 *   4. normalised byte cap        — NFC can grow a string
 *
 * Code-point range and blocklist checks (steps 5 and 6) belong to `policy.ts`.
 *
 * This function is also the login path's input guard. Rejection here happens
 * BEFORE any Argon2 work, which is the documented exception to "exactly one
 * Argon2 verification per attempt": that rule covers syntactically valid,
 * well-formed, byte-bounded credentials. The timing difference this creates
 * depends only on attacker-supplied input and reveals nothing about any
 * account.
 */
export function normalizePassword(input: string): NormalizeResult {
  if (!isWellFormedUnicode(input)) {
    return { ok: false, reason: 'ILL_FORMED_UNICODE' };
  }

  if (utf8ByteLength(input) > PASSWORD_MAX_BYTES) {
    return { ok: false, reason: 'TOO_MANY_BYTES' };
  }

  const normalized = input.normalize('NFC');

  if (utf8ByteLength(normalized) > PASSWORD_MAX_BYTES) {
    return { ok: false, reason: 'TOO_MANY_BYTES' };
  }

  return { ok: true, normalized };
}
