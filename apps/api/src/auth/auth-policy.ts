/**
 * Authentication policy — the single home for every tunable security value.
 *
 * These are **owner-confirmable defaults**, approved during Milestone 1
 * planning, with a revisit trigger at the pilot (PROJECT_SPEC.md 16, milestone
 * 10). They are deliberately code constants rather than environment variables:
 * a change to clinic security policy should be a reviewed commit with a
 * decision-log entry, not an untracked edit on a server.
 *
 * The one value that IS environmental is the clinic-specific blocked-term list,
 * because clinic-identifying words must never be committed. See `blocklist.ts`.
 *
 * Milestone 1 Checkpoint A defines only the password, Argon2 and
 * temporary-password values. Lockout and session constants join this file with
 * the code that uses them.
 */

// --- Length -----------------------------------------------------------------
//
// Measured in Unicode CODE POINTS of the NFC-normalised string, per NIST
// SP 800-63B. Not UTF-16 code units, not grapheme clusters. See `normalize.ts`
// for why the distinction is load-bearing.

export const PASSWORD_MIN_CODE_POINTS = 15;
export const PASSWORD_MAX_CODE_POINTS = 128;

/**
 * A pre-normalisation input guard, in bytes rather than characters.
 *
 * Argon2 hashes the whole input, so an unbounded password is a memory-cost
 * denial of service. This is checked before NFC runs, because normalising a
 * pathological string is itself work worth bounding.
 */
export const PASSWORD_MAX_BYTES = 1024;

// --- Argon2id ---------------------------------------------------------------
//
// The OWASP minimum for Argon2id. Measured at ~23 ms per verification on the
// Milestone 1 development machine; the cost is dominated by memory, not time,
// which is what makes it resistant to GPU parallelism.

export const ARGON2_MEMORY_COST_KIB = 19456;
export const ARGON2_TIME_COST = 2;
export const ARGON2_PARALLELISM = 1;
export const ARGON2_OUTPUT_LENGTH_BYTES = 32;

/**
 * Bounds peak hashing memory at ARGON2_MAX_CONCURRENCY * 19 MiB (~76 MiB)
 * regardless of request volume, and makes Argon2's cost the natural throughput
 * limit on the login endpoint rather than a way to exhaust the host.
 */
export const ARGON2_MAX_CONCURRENCY = 4;

// --- Temporary passwords ----------------------------------------------------

/**
 * A-Z a-z 0-9 minus the six ambiguous glyphs `0 O o 1 l I`, leaving 56 symbols.
 * Managers transcribe these by hand, so `l` versus `1` matters.
 */
export const TEMPORARY_PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** 20 characters over a 56-symbol alphabet is 20 * log2(56) ~= 116 bits. */
export const TEMPORARY_PASSWORD_LENGTH = 20;

/** Presentation only. The stored and compared value is never grouped. */
export const TEMPORARY_PASSWORD_DISPLAY_GROUP_SIZE = 5;
