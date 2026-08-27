import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import type { ChildSex } from '@clinic/contracts';

/**
 * The two keyed hashes that make abuse control possible without keeping
 * anything a database dump could read back.
 *
 * Milestone 9, checkpoint A3.
 *
 * WHY KEYED AT ALL. Both of the things this file hashes are LOW-ENTROPY. An
 * IPv4 address has four billion possible values and an Iranian mobile number
 * has a billion; either can be exhaustively enumerated against an unkeyed
 * SHA-256 on a laptop in minutes. An unkeyed `submitter_fingerprint` would
 * therefore BE the IP address, and an unkeyed `dedupe_key` would BE the
 * submission — stored in a column whose entire justification is that it is
 * neither. HMAC under a key that lives only in the running process is what makes
 * the columns what they claim to be.
 *
 * WHERE THE KEY COMES FROM, AND WHY IT IS NOT A NEW ENVIRONMENT VARIABLE. It is
 * derived from `INTERNAL_API_KEY` by HKDF-SHA-256 under a fixed, versioned info
 * string. HKDF gives DOMAIN SEPARATION: the derived key cannot be used to forge
 * the internal key and the internal key cannot be recovered from it, so this is
 * not the secret-reuse it would be if the API key were passed to `createHmac`
 * directly.
 *
 * The alternative is a second required secret, and it was rejected for a
 * concrete reason: a required environment variable with no default is a variable
 * the application refuses to start without, and adding one during a checkpoint
 * that ships no deployment work would break every existing development and CI
 * environment the moment it merged. Hosting and secret provisioning belong to
 * Milestone 10.
 *
 * THE TRADE-OFF IS REAL AND SMALL. Rotating `INTERNAL_API_KEY` re-derives this
 * key, which silently resets the duplicate window and the throttle counters:
 * for a few hours after a rotation, a resubmission would be stored again and a
 * flooder would get a fresh allowance. Nothing is corrupted and nothing is
 * disclosed. If that ever matters — a real anti-abuse requirement, or a key
 * rotated on a schedule — the answer is a dedicated secret provisioned by M10,
 * not weakening the derivation.
 */

/**
 * Versioned, so the day a dedicated secret arrives the old fingerprints are
 * distinguishable from the new ones rather than silently comparable.
 */
const FINGERPRINT_INFO = 'clinic:website-request-fingerprint:v1';

/**
 * HKDF's salt. Fixed and non-secret by construction — RFC 5869 permits an empty
 * salt, and a constant one is equivalent for a single-purpose derivation. It is
 * written out rather than omitted so that a reader can see there is nothing
 * per-request being mixed in, which is what makes the same input produce the
 * same fingerprint across processes and restarts.
 */
const FINGERPRINT_SALT = 'clinic:website-request:2026-08';

/** Derived once per key, because HKDF on every request would be pure waste. */
const derivedKeys = new Map<string, Buffer>();

function fingerprintKey(internalApiKey: string): Buffer {
  const cached = derivedKeys.get(internalApiKey);
  if (cached !== undefined) return cached;

  const derived = Buffer.from(
    hkdfSync('sha256', Buffer.from(internalApiKey, 'utf8'), FINGERPRINT_SALT, FINGERPRINT_INFO, 32),
  );

  derivedKeys.set(internalApiKey, derived);
  return derived;
}

function hmacHex(internalApiKey: string, namespace: string, value: string): string {
  return createHmac('sha256', fingerprintKey(internalApiKey))
    .update(`${namespace}\u0000${value}`)
    .digest('hex');
}

/**
 * Who is submitting, as far as this application is ever allowed to know.
 *
 * The raw address is passed in, hashed, and DISCARDED. It is stored in no
 * column of `website_request`, and the audit row for a submission carries none
 * either — which is the one place this checkpoint departs from every other
 * audited write in the application, deliberately (see
 * `anonymousWebsiteAuditContext`).
 *
 * Returns `null` when the web tier reported no address. That is a real state —
 * a proxy misconfiguration, or a deployment that does not forward the header —
 * and the honest response is to store nothing and skip the throttle for that
 * request. The alternative, bucketing every unidentified caller together, would
 * throttle EVERY visitor the moment a header stopped arriving, which turns a
 * configuration mistake into an outage of the contact form.
 */
export function submitterFingerprint(
  internalApiKey: string,
  clientIp: string | null,
): string | null {
  if (clientIp === null || clientIp === '') return null;
  return hmacHex(internalApiKey, 'submitter', clientIp);
}

/** The submission facts a duplicate is judged on. */
export type DedupeSubject = {
  readonly contactMobile: string;
  readonly requestedServiceId: string | null;
  readonly childAgeYears: number;
  readonly childSex: ChildSex;
};

/**
 * What makes two submissions "the same request again". OWNER-APPROVED, AND
 * FROZEN AS FOUR FIELDS.
 *
 * THE MOBILE AND THE SERVICE SAY WHO IS ASKING AND WHAT FOR. THE AGE AND THE SEX
 * ARE WHAT KEEPS TWO CHILDREN APART. That last half is the approved semantics
 * and it is worth stating plainly, because an earlier planning shorthand
 * described this as mobile plus service only: one parent with two children needs
 * two appointments, and mobile-and-service alone would have silently discarded
 * the second request — a family waiting for a call that nobody was ever going to
 * make, with no trace anywhere that they had asked.
 *
 * THIS IS NOT AN IDENTITY SYSTEM AND MUST NOT GROW INTO ONE. It compares four
 * structured facts, exactly and case-sensitively, under one HMAC. There is no
 * fuzzy matching, no name normalisation, no Persian folding, no birth-date
 * inference, no scoring, no candidate list and no reuse of the family or child
 * duplicate-detection machinery — all of which exist elsewhere in this
 * application and are deliberately not reached from here. Those answer "is this
 * the same PERSON?" about clinic records a member of staff can inspect; this
 * answers the far smaller question "is this the same MESSAGE, again, within a
 * day?" about a stranger nobody has verified.
 *
 * THE FREE TEXT IS DELIBERATELY EXCLUDED, and so is the contact name. A parent
 * who resubmits after adding a sentence to the note has not made a different
 * request — they have made the same one twice, which is the case this exists to
 * absorb — and including the note would make deduplication defeatable by a
 * whitespace change, which is the same as not having it. The name is excluded
 * for that reason and one more: the mobile already identifies the caller, so a
 * name that two submissions might spell differently could only ever split a
 * duplicate pair, never join one.
 *
 * THE COST OF THE WIDER KEY IS NAMED RATHER THAN HIDDEN. Two submissions that
 * differ ONLY by a corrected age — a parent who typed 6, noticed, and resubmitted
 * with 7 — are two rows rather than one. That is the right way round: a
 * receptionist who sees a near-identical pair loses a few seconds, where the
 * alternative loses a child.
 *
 * The fields are joined with a null byte, which no validated field can contain,
 * so no combination of values can be made to collide by moving a separator.
 */
export function dedupeKey(internalApiKey: string, subject: DedupeSubject): string {
  const canonical = [
    subject.contactMobile,
    subject.requestedServiceId ?? '',
    String(subject.childAgeYears),
    subject.childSex,
  ].join('\u0000');

  return hmacHex(internalApiKey, 'dedupe', canonical);
}

/**
 * Constant-time comparison of two fingerprints.
 *
 * Not used by the submission path — PostgreSQL does the comparing there — but
 * exported for the tests that assert two derivations agree, so that even the
 * test helper cannot become the place where a timing-variable comparison of a
 * keyed value gets written.
 */
export function fingerprintsEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}
