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

// --- Lockout ----------------------------------------------------------------
//
// Five failures inside a fifteen-minute observation window lock the account for
// fifteen minutes, and the lock clears itself. Per-account only: every
// workstation in the clinic shares one NAT address, so a per-IP rule would lock
// out the whole front desk at once.

export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_WINDOW_MINUTES = 15;
export const LOCKOUT_DURATION_MINUTES = 15;

// --- Sessions ---------------------------------------------------------------

export const SESSION_TOKEN_BYTES = 32;

/** Rolling: renewed on activity, clamped so it can never pass the absolute cap. */
export const SESSION_IDLE_MINUTES = 8 * 60;

/** Fixed at creation and never extended. */
export const SESSION_ABSOLUTE_MINUTES = 12 * 60;

/**
 * `last_seen_at` is rewritten at most once per this interval, so an active user
 * costs one write every five minutes instead of one per request. The cost is
 * that idle expiry is accurate to within the interval.
 */
export const SESSION_TOUCH_MINUTES = 5;

/**
 * A session that has been over — expired or revoked — for this many days is
 * removed by the nightly `SESSION_PRUNE` job (Milestone 10, checkpoint A3).
 * Long enough to answer "was that session still live?" during an incident; the
 * database trigger `user_session_prune_only_ended` states the same window.
 */
export const SESSION_PRUNE_AFTER_DAYS = 30;

/**
 * Subtracted from the cookie lifetime PostgreSQL computes.
 *
 * A relative `Max-Age` starts counting when the browser receives the response,
 * which is after PostgreSQL measured the remaining time, so the cookie would
 * otherwise outlive the database expiry by roughly one round trip. This margin
 * is hygiene, not the guarantee: the guarantee is that every request
 * revalidates against `absolute_expires_at`, so a late cookie is simply
 * unusable.
 */
export const COOKIE_MAX_AGE_SAFETY_MARGIN_SECONDS = 5;
