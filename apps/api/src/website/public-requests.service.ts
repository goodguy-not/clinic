import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PublicRequestSubmission } from '@clinic/contracts';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import type { RequestContext } from '../common/request-context';
import { logSecurityRejection } from '../common/security-log';
import { uuidv7 } from '../common/uuid';
import { API_ENV } from '../config/config.module';
import type { ApiEnv } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { anonymousWebsiteAuditContext } from './anonymous-audit';
import { dedupeKey, submitterFingerprint } from './request-fingerprint';

/**
 * The only write an anonymous stranger may make.
 *
 * Milestone 9, checkpoint A3.
 *
 * =========================== WHAT THIS IS NOT ==============================
 *
 * It is not a registration. It creates no family, no child, no guardian and no
 * appointment, and it CANNOT: `website_request` has no column naming any of
 * them, so the guarantee is structural rather than a rule this file remembers.
 *
 * It decides nothing about the person submitting. There is no eligibility
 * check, no age gate, no demographic rejection, no capacity match, no service
 * availability test and no screening of any kind. The only reasons a submission
 * is refused are that the form is malformed, that the named service is not one
 * the clinic publishes, or that too many submissions have come from one place
 * too fast — and none of those is a judgement about the family.
 *
 * ======================== THE THREE ORDERED STEPS ==========================
 *
 * Everything below happens inside ONE transaction, under advisory locks taken
 * in a fixed order, and the ordering is what makes concurrent submissions
 * behave:
 *
 *   1. THE LOCKS. Two transaction-scoped advisory keys — one for the submitter,
 *      one for the deduplication subject — acquired in ascending key order, the
 *      convention `families/duplicate-detection.ts` established and for the same
 *      reason: two requests that need the same pair in opposite orders would
 *      otherwise wait on each other forever. Sorting by the derived key gives
 *      every transaction in the system one global order to follow.
 *
 *   2. THE THROTTLE, read under the lock. Too many recent rows from this
 *      submitter is `PUBLIC_REQUEST_THROTTLED`. Reading it under the lock is
 *      what stops a burst of simultaneous requests each seeing a count of zero.
 *
 *   3. THE DUPLICATE, read under the lock. A matching recent row means this
 *      submission is a resend, and the transaction ends having written NOTHING —
 *      no request row, no audit row — and returns the ordinary success.
 *
 * ======================== WHY THE CALLER LEARNS NOTHING ====================
 *
 * A duplicate-suppressed submission and a stored one return THE SAME BODY with
 * THE SAME STATUS. That is not politeness, it is the privacy rule: any
 * observable difference would turn this endpoint into an oracle answering "has
 * this mobile number already contacted the clinic?" for anybody who cared to
 * ask, which is a disclosure about a real family made to a stranger.
 *
 * The refusals are shaped the same way. A service slug that is private,
 * retired or fictional is `SERVICE_NOT_FOUND` — the identical answer
 * `PublicSiteService.getService` gives, so the form cannot be used to enumerate
 * the clinic's internal catalogue either.
 *
 * ============================ WHY NO CAPTCHA ================================
 *
 * The accepted M9 posture. A CAPTCHA is a third-party dependency, a
 * privacy-relevant beacon on a page that has none, and an accessibility barrier
 * on the one form a distressed parent is trying to use. The controls here are
 * proportionate to a small clinic's contact form and are entirely self-contained:
 * no Redis, no queue, no external anti-bot service, and no verdict stored about
 * anybody.
 */

/**
 * How many submissions one submitter may make in the window before being told to
 * come back later.
 *
 * SIX IS AN ORDINARY-USE BOUND, NOT AN ANTI-ABUSE BOUND, and the distinction is
 * the whole calibration. It has to be impossible for a real family to reach by
 * accident — a household behind one connection, a parent who resubmits after a
 * typo, a school or clinic waiting room where several people share an address —
 * and low enough that a script cannot fill the inbox faster than a person can
 * read it. Note that a resend is deduplicated BEFORE it is counted, so the
 * commonest innocent cause of repeats never touches this number at all.
 */
const THROTTLE_MAX_SUBMISSIONS = 6;

/** The window the count above is taken over. */
const THROTTLE_WINDOW = '1 hour';

/**
 * How long a submission suppresses an equivalent resend.
 *
 * TWENTY-FOUR HOURS, AND IT IS ROLLING RATHER THAN BUCKETED. A parent who has
 * heard nothing back by tomorrow and writes in again is not making a duplicate
 * request: they are making a second one, and the clinic should see it. A
 * calendar-day bucket would have kept the same message twice at either side of
 * midnight and swallowed a genuine second message sent twenty-three hours later,
 * which is precisely backwards.
 *
 * A rolling window is not expressible as a unique index, which is why
 * deduplication here is a read taken under an advisory lock rather than an
 * `ON CONFLICT`. The lock is what makes the read-then-insert atomic; the
 * database is still the only arbiter, and no in-process state is involved.
 */
const DEDUPE_WINDOW = '24 hours';

@Injectable()
export class PublicRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async submit(input: PublicRequestSubmission, context: RequestContext): Promise<void> {
    const serviceId = await this.resolvePublishedService(input.serviceSlug);

    const submitter = submitterFingerprint(this.env.INTERNAL_API_KEY, context.clientIp);
    const duplicateKey = dedupeKey(this.env.INTERNAL_API_KEY, {
      contactMobile: input.contactMobile,
      requestedServiceId: serviceId,
      childAgeYears: input.childAgeYears,
      childSex: input.childSex,
    });

    const throttled = await this.prisma.$transaction(async (tx) => {
      await acquireSubmissionLocks(tx, submitter, duplicateKey);

      if (submitter !== null && (await this.isThrottled(tx, submitter))) return true;

      // A resend. Nothing is written — not the row, and not an audit entry,
      // because no state changed and there is no act to record.
      if (await this.isDuplicate(tx, duplicateKey)) return false;

      const id = uuidv7();

      await tx.$executeRaw`
        INSERT INTO website_request (
          id, received_at,
          contact_name, contact_mobile, requested_service_id,
          child_name, child_age_years, child_sex,
          preferred_contact_time, note,
          consent_given, consent_version, consent_recorded_at,
          submitter_fingerprint, dedupe_key
        ) VALUES (
          ${id}::uuid, transaction_timestamp(),
          ${input.contactName}, ${input.contactMobile}, ${serviceId}::uuid,
          ${input.childName ?? null}, ${input.childAgeYears}, ${input.childSex}::child_sex,
          ${input.preferredContactTime ?? null}::website_request_contact_time,
          ${input.note ?? null},
          -- The consent instant is the transaction's, not a value the caller
          -- supplied: a submitter-chosen timestamp is not evidence of anything.
          TRUE, ${input.consentVersion}, transaction_timestamp(),
          ${submitter}, ${duplicateKey}
        )
      `;

      // The act, and nothing about it. No `before`, no `after`, no `metadata`,
      // no IP and no user agent — see `anonymousWebsiteAuditContext` and the
      // `website_request.received` entry in `audit-actions.ts`.
      await this.audit.record(tx, anonymousWebsiteAuditContext(context), {
        action: 'website_request.received',
        entityType: 'website_request',
        entityId: id,
      });

      return false;
    });

    if (throttled) {
      // Logged, never audited — the `SessionGuard` treatment of a forged cookie,
      // for the identical reason: an unauthenticated caller who could write to
      // an append-only, unprunable table simply by asking is a caller who can
      // grow it without bound.
      //
      // The line carries the raw address, exactly as every other rejection in
      // `security-log.ts` does, and that is consistent rather than contradictory:
      // the security log is a ROTATABLE, PRUNABLE operational artefact, which is
      // the whole reason rejections go there. The rule this checkpoint adds is
      // about `audit_log`, which is neither.
      logSecurityRejection({
        event: 'website.request.throttled',
        reason: 'SUBMISSION_RATE_EXCEEDED',
        requestId: context.requestId,
        clientIp: context.clientIp,
      });

      throw new AppError('PUBLIC_REQUEST_THROTTLED');
    }
  }

  /**
   * The named service, or `null` for the accepted "not sure".
   *
   * THE PREDICATE IS THE PUBLIC ONE, WORD FOR WORD. A visitor may only name a
   * service the website actually offers them, and a private, retired or
   * fictional slug gets `SERVICE_NOT_FOUND` — the same answer, from the same
   * three conditions, that `PublicSiteService.getService` gives. Anything else
   * would let the contact form be used to enumerate the clinic's internal
   * catalogue, which is the leak A1 wrote that predicate to prevent.
   *
   * It is repeated here rather than shared with `PublicSiteService` for A1's
   * stated reason: four written-out predicates are four places a reader can see
   * what is considered publishable, where a shared helper would be one place to
   * forget a condition and four that inherited the omission.
   */
  private async resolvePublishedService(slug: string | null): Promise<string | null> {
    if (slug === null) return null;

    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT s.id
      FROM service s
      WHERE s.public_slug = ${slug}
        AND s.is_public IS TRUE
        AND s.status = 'ACTIVE'::catalog_status
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('SERVICE_NOT_FOUND');

    return row.id;
  }

  /** MUST be called with the submitter's advisory lock already held. */
  private async isThrottled(tx: Prisma.TransactionClient, submitter: string): Promise<boolean> {
    const rows = await tx.$queryRaw<{ recent: bigint }[]>`
      SELECT count(*) AS recent
      FROM website_request r
      WHERE r.submitter_fingerprint = ${submitter}
        AND r.received_at > transaction_timestamp() - ${THROTTLE_WINDOW}::interval
    `;

    return (rows[0]?.recent ?? 0n) >= BigInt(THROTTLE_MAX_SUBMISSIONS);
  }

  /** MUST be called with the deduplication advisory lock already held. */
  private async isDuplicate(tx: Prisma.TransactionClient, key: string): Promise<boolean> {
    const rows = await tx.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM website_request r
        WHERE r.dedupe_key = ${key}
          AND r.received_at > transaction_timestamp() - ${DEDUPE_WINDOW}::interval
      ) AS "exists"
    `;

    return rows[0]?.exists === true;
  }
}

/** Namespaces this checkpoint's half of the advisory key space. */
const SUBMISSION_LOCK_NAMESPACE = 'website-request:';

/**
 * Takes the submission's advisory locks in ascending key order.
 *
 * TWO KEYS, AND THE ORDER IS THE DEADLOCK ARGUMENT. Two concurrent submissions
 * can share a submitter and differ in subject, or share a subject and differ in
 * submitter; taken in argument order, one pair of transactions would eventually
 * take them in opposite orders and wait on each other forever. Sorting by the
 * derived 64-bit key — not by which one is "the submitter" — gives every
 * transaction one global order, exactly as `acquireFamilyMobileLocks` does.
 *
 * The keys are fetched sorted and acquired one at a time rather than in a single
 * set-returning projection, because nothing obliges the planner to evaluate one
 * in a subquery's ORDER BY.
 *
 * A 64-bit collision costs only unnecessary serialisation between two unrelated
 * submissions: the authoritative answers are the two SQL reads performed under
 * the locks.
 */
async function acquireSubmissionLocks(
  tx: Prisma.TransactionClient,
  submitter: string | null,
  duplicateKey: string,
): Promise<void> {
  const subjects = submitter === null ? [duplicateKey] : [submitter, duplicateKey];

  const keys = await tx.$queryRaw<{ key: bigint }[]>`
    SELECT DISTINCT hashtextextended(${SUBMISSION_LOCK_NAMESPACE} || s, 0) AS key
    FROM unnest(${subjects}::text[]) AS s
    ORDER BY key
  `;

  for (const { key } of keys) {
    // `$executeRaw`, not `$queryRaw`: `pg_advisory_xact_lock` returns `void`,
    // which Prisma's query path cannot deserialize. The lock is the effect.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key}::bigint)`;
  }
}
