import { Prisma } from '@prisma/client';
import type { DraftPurpose, DuplicateCandidate, DuplicateRule } from '@clinic/contracts';
import { BLOCKING_DUPLICATE_RULES } from '@clinic/contracts';
import { maskIdentifier } from './audit-safe';

/**
 * Duplicate detection, and the locks that make it mean something.
 *
 * A duplicate check that reads before it writes is not a check at all under
 * concurrency: two receptionists registering the same family at the same moment
 * both read "no duplicate", both insert, and the clinic ends up with the two
 * records the check existed to prevent. So every blocking rule is recomputed
 * while a transaction-scoped advisory lock is held on the thing being compared.
 *
 * ----------------------------------------------------------------------------
 * GLOBAL LOCK ORDER — one rule, no exceptions:
 *
 *     registration_draft  ->  family  ->  child  ->  advisory keys
 *
 * and within one advisory class, keys are acquired in ASCENDING NUMERIC ORDER.
 * The two advisory classes are never mixed in a single transaction, so no
 * cross-class order exists to get wrong.
 * ----------------------------------------------------------------------------
 *
 * ON KEY COLLISIONS: the key space is 64-bit and collisions are possible. A
 * collision costs nothing but unnecessary serialisation between two unrelated
 * writes — never a wrong answer — because the lock is purely a mutual-exclusion
 * device and the authoritative decision is the SQL recomputation performed
 * *under* it. Nothing reads meaning back out of the key.
 *
 * ON HASHING: the keys are derived by PostgreSQL's own `hashtextextended`, not
 * by anything in Node. A second implementation would have to agree bit for bit
 * with the first forever, and the day it stopped agreeing two writers would
 * quietly take different locks and the whole mechanism would fail open.
 */

/**
 * Namespaces the advisory key space.
 *
 * Without it, a family mobile and some future unrelated string could hash to
 * the same key and serialise against each other for no reason. It is a prefix
 * on the hashed text, not a separate lock class.
 */
const FAMILY_MOBILE_LOCK_NAMESPACE = 'family-mobile:';

/** What a caller passes to have its duplicates found. */
export type FamilyDuplicateQuery = {
  readonly familyName: string;
  readonly guardianNames: readonly string[];
  readonly mobiles: readonly string[];
  readonly landlines: readonly string[];
  /** Set on an update, so a family is never its own duplicate. Unused until D. */
  readonly excludeFamilyId?: string | null;
};

type CandidateRow = {
  family_id: string;
  family_name: string;
  primary_guardian_name: string | null;
  primary_mobile: string | null;
  primary_landline: string | null;
  child_names: string[];
  rule: DuplicateRule;
};

/**
 * Acquires one transaction-scoped advisory lock per distinct submitted mobile,
 * in ascending numeric key order.
 *
 * The ordering is what prevents deadlock. Two requests submitting the same pair
 * of numbers in opposite orders would otherwise take the two locks in opposite
 * orders and wait on each other forever; sorting by the derived key — not by the
 * number, and not by submission order — gives every transaction in the system
 * one global order to follow.
 *
 * The keys are fetched sorted and then acquired one at a time rather than in a
 * single `SELECT pg_advisory_xact_lock(k) FROM (… ORDER BY k)`, because nothing
 * obliges the planner to evaluate a set-returning projection in the order of a
 * subquery's ORDER BY. A loop is slower by a few round trips and is actually
 * ordered.
 *
 * Locks release on commit or rollback, so there is nothing to clean up and a
 * crashed request cannot leave one behind.
 */
export async function acquireFamilyMobileLocks(
  tx: Prisma.TransactionClient,
  mobiles: readonly string[],
): Promise<bigint[]> {
  if (mobiles.length === 0) return [];

  const keys = await tx.$queryRaw<{ key: bigint }[]>`
    SELECT DISTINCT hashtextextended(${FAMILY_MOBILE_LOCK_NAMESPACE} || m, 0) AS key
    FROM unnest(${[...mobiles]}::text[]) AS m
    ORDER BY key
  `;

  for (const { key } of keys) {
    // `$executeRaw`, not `$queryRaw`: `pg_advisory_xact_lock` returns `void`,
    // and Prisma's query path cannot deserialize a void column. Nothing is read
    // from the result in any case — the lock is the effect.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key}::bigint)`;
  }

  return keys.map((row) => row.key);
}

/**
 * Finds every family worth showing the user before this one is created.
 *
 * MUST be called with the locks of `acquireFamilyMobileLocks` already held. On
 * its own this is a plain read and proves nothing about a concurrent writer.
 *
 * Three rules, and the difference between them is the whole design:
 *
 *  - `FAMILY_DUPLICATE_MOBILE` blocks. An active family already answers on one
 *    of the submitted numbers, which in a clinic almost always means this
 *    family is already registered. Every submitted mobile is compared, primary
 *    or not: the father's number on a second guardian row is the same signal as
 *    the mother's on the first.
 *  - `SHARED_LANDLINE` warns. A shared landline is ordinary — a household, a
 *    workplace, a relative's number — and refusing on it would refuse real
 *    families.
 *  - `SIMILAR_FAMILY_NAME_AND_GUARDIAN` warns. Two families named رضایی with a
 *    guardian named علی are worth a second look and are very often two
 *    different families. A NAME MUST NEVER BLOCK.
 *
 * A submission with no mobile at all triggers no blocking rule, which is
 * correct: a family reachable only on a landline is a real family.
 */
export async function findFamilyDuplicateCandidates(
  tx: Prisma.TransactionClient,
  query: FamilyDuplicateQuery,
): Promise<DuplicateCandidate[]> {
  const exclude = query.excludeFamilyId ?? null;

  const rows = await tx.$queryRaw<CandidateRow[]>`
    WITH submitted AS (
      SELECT
        ${[...query.mobiles]}::text[]        AS mobiles,
        ${[...query.landlines]}::text[]      AS landlines,
        fa_normalize(${query.familyName})    AS family_name,
        (SELECT coalesce(array_agg(fa_normalize(n)), ARRAY[]::text[])
           FROM unnest(${[...query.guardianNames]}::text[]) AS n) AS guardian_names
    ),
    hits AS (
      -- Blocking: an active family already answers on a submitted mobile.
      SELECT DISTINCT g.family_id, 'FAMILY_DUPLICATE_MOBILE'::text AS rule
      FROM guardian g
      JOIN family f ON f.id = g.family_id
      CROSS JOIN submitted s
      WHERE f.status = 'ACTIVE'
        AND g.mobile IS NOT NULL
        AND g.mobile = ANY (s.mobiles)

      UNION ALL

      -- Informational: a shared landline.
      SELECT DISTINCT g.family_id, 'SHARED_LANDLINE'
      FROM guardian g
      JOIN family f ON f.id = g.family_id
      CROSS JOIN submitted s
      WHERE f.status = 'ACTIVE'
        AND g.landline IS NOT NULL
        AND g.landline = ANY (s.landlines)

      UNION ALL

      -- Informational: same surname AND a matching guardian name. Either alone
      -- is far too common in Persian names to be worth showing.
      SELECT DISTINCT f.id, 'SIMILAR_FAMILY_NAME_AND_GUARDIAN'
      FROM family f
      CROSS JOIN submitted s
      WHERE f.status = 'ACTIVE'
        AND f.search_family_name = s.family_name
        AND EXISTS (
          SELECT 1 FROM guardian g
          WHERE g.family_id = f.id AND g.search_full_name = ANY (s.guardian_names)
        )
    )
    SELECT
      h.family_id,
      f.family_name,
      h.rule::text AS rule,
      p.full_name AS primary_guardian_name,
      p.mobile    AS primary_mobile,
      p.landline  AS primary_landline,
      coalesce(
        (SELECT array_agg(c.first_name || ' ' || c.last_name ORDER BY c.last_name, c.first_name)
           FROM child c WHERE c.family_id = h.family_id),
        ARRAY[]::text[]
      ) AS child_names
    FROM hits h
    JOIN family f ON f.id = h.family_id
    LEFT JOIN LATERAL (
      SELECT g.full_name, g.mobile, g.landline
      FROM guardian g
      WHERE g.family_id = h.family_id AND g.is_primary_contact
      LIMIT 1
    ) p ON true
    WHERE ${exclude === null ? Prisma.sql`true` : Prisma.sql`h.family_id <> ${exclude}::uuid`}
    ORDER BY h.rule, f.family_name, h.family_id
  `;

  return rows.map(toCandidate);
}

/**
 * Describes families that were ALREADY shown to somebody, by id.
 *
 * This is presentation, not detection, and the difference matters. Opening or
 * refreshing the confirmation screen must not re-run the authoritative check:
 * that belongs to the confirm transaction, under the advisory locks, where the
 * answer is acted on. A screen that quietly re-detected would mean the set
 * somebody is looking at changes underneath them between one refresh and the
 * next, and the acknowledgement they eventually send would be about a list that
 * no longer exists.
 *
 * So the caller supplies the stored `shown_candidate_ids` and gets back exactly
 * those families — no more, and none dropped. In particular:
 *
 *  - a family registered since the block is NOT surfaced here. It is discovered
 *    by the confirm transaction, which is what refuses and re-arms the draft;
 *  - a family deactivated since the block is still listed, because it is still
 *    what somebody was shown. There is deliberately no `status = 'ACTIVE'`
 *    filter, unlike the detection query above.
 *
 * THE RULE IS SUPPLIED, NOT RE-DERIVED. An earlier version classified each row
 * by comparing that family's guardians against the payload, which meant a
 * candidate whose mobile had since been edited was silently relabelled from a
 * blocking duplicate to a soft warning — the stored confirmation state saying
 * one thing and the screen saying another. What makes that unnecessary is that
 * `shown_candidate_ids` holds only the BLOCKING candidates: membership is the
 * semantic, so the rule follows from the draft's purpose and nothing about the
 * candidate's current data can change it.
 *
 * The family's name, primary contact and children are still read live. Those
 * are descriptive, not semantic — showing a stale name would help nobody
 * recognise the family — and none of them decides whether a write is refused.
 */
export async function describeShownCandidates(
  tx: Prisma.TransactionClient,
  familyIds: readonly string[],
  rule: DuplicateRule,
): Promise<DuplicateCandidate[]> {
  if (familyIds.length === 0) return [];

  const rows = await tx.$queryRaw<CandidateRow[]>`
    SELECT
      f.id AS family_id,
      f.family_name,
      ${rule}::text AS rule,
      p.full_name AS primary_guardian_name,
      p.mobile    AS primary_mobile,
      p.landline  AS primary_landline,
      coalesce(
        (SELECT array_agg(c.first_name || ' ' || c.last_name ORDER BY c.last_name, c.first_name)
           FROM child c WHERE c.family_id = f.id),
        ARRAY[]::text[]
      ) AS child_names
    FROM family f
    LEFT JOIN LATERAL (
      SELECT g.full_name, g.mobile, g.landline
      FROM guardian g
      WHERE g.family_id = f.id AND g.is_primary_contact
      LIMIT 1
    ) p ON true
    WHERE f.id = ANY (${[...familyIds]}::uuid[])
    ORDER BY f.family_name, f.id
  `;

  return rows.map(toCandidate);
}

/**
 * A candidate as it leaves the server.
 *
 * Enough to recognise a family — its name, who answers the phone, the last four
 * digits — and no more. The full number is one click away on the family's own
 * page for anybody who needs it; putting it here would copy an identifier into
 * an error body that a member of staff may never even read, and that error body
 * travels further than the page does.
 */
function toCandidate(row: CandidateRow): DuplicateCandidate {
  return {
    familyId: row.family_id,
    childId: null,
    rule: row.rule,
    blocking: BLOCKING_DUPLICATE_RULES.includes(row.rule),
    familyName: row.family_name,
    primaryGuardianName: row.primary_guardian_name,
    maskedMobile: maskIdentifier(row.primary_mobile),
    maskedLandline: maskIdentifier(row.primary_landline),
    childNames: row.child_names,
  };
}

export function blockingCandidates(
  candidates: readonly DuplicateCandidate[],
): DuplicateCandidate[] {
  return candidates.filter((candidate) => candidate.blocking);
}

/**
 * The ids a draft must remember: the blocking candidates, and only those.
 *
 * Soft warnings are informational and are shown once, in the response that
 * reported them. They are not part of the confirmation state, because
 * acknowledgement is only ever about candidates that actually refuse a write —
 * so storing them would put two kinds of thing in one list and force whatever
 * reads it to guess which is which.
 */
export function blockingCandidateIds(candidates: readonly DuplicateCandidate[]): string[] {
  return [...new Set(blockingCandidates(candidates).map((candidate) => candidate.familyId))];
}

/**
 * Which rule refuses a write, for a given kind of draft.
 *
 * A property of the purpose rather than of any particular candidate, which is
 * what lets a stored id be presented without re-examining the family behind it.
 */
export function blockingRuleFor(purpose: DraftPurpose): DuplicateRule {
  return purpose === 'CHILD_CREATE' || purpose === 'CHILD_UPDATE'
    ? 'CHILD_DUPLICATE_IN_FAMILY'
    : 'FAMILY_DUPLICATE_MOBILE';
}

/**
 * The fixed notice codes a successful write reports.
 *
 * Level-3 similarity never refuses a write, but it must not vanish either: a
 * warning nobody sees is the same as no warning. These codes are a closed
 * vocabulary precisely so the redirect that follows can carry one in a
 * `?notice=` parameter without putting a candidate's name in a URL.
 */
export function nonBlockingNotices(
  candidates: readonly DuplicateCandidate[],
): 'SIMILAR_FAMILY_EXISTS'[] {
  return candidates.some((candidate) => !candidate.blocking) ? ['SIMILAR_FAMILY_EXISTS'] : [];
}
