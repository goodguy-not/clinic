import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { uuidv7 } from '../common/uuid';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The ninety-day erasure: the one operation in this product that DESTROYS
 * something on purpose.
 *
 * Milestone 9, checkpoint A4.
 *
 * ============================ WHAT IT ERASES ================================
 *
 * A request the clinic has FINISHED WITH and that NEVER BECAME A FAMILY, ninety
 * days after it was closed. All three conditions, and none of them is optional:
 *
 *   * ONLY `CLOSED`. A request still being worked on keeps its content, because
 *     the colleague who is going to ring back needs the telephone number.
 *   * ONLY NEVER-LINKED. A converted request is part of a family's history. The
 *     promise the clinic made was about strangers it never heard from again, not
 *     about the families they turned out to be.
 *   * ONLY AFTER NINETY DAYS, measured from `closed_at`. Erasing sooner is not a
 *     privacy win: it destroys a record the clinic may still need in order to
 *     explain what it did, on a schedule nobody approved.
 *
 * THE SAME THREE CONDITIONS ARE A DATABASE CONSTRAINT
 * (`website_request_purge_eligibility_chk`). The predicate below is how the run
 * FINDS its work; the constraint is what makes a mistake in that predicate a
 * loud failure instead of a quiet destruction. Neither is redundant: without the
 * predicate the run would try to erase everything, and without the constraint a
 * future edit to the predicate would succeed.
 *
 * ============================== WHAT SURVIVES ===============================
 *
 * THE ROW. Always. `website_request` carries the same `no_delete` and
 * `no_truncate` triggers every other historical table in this schema carries,
 * and this operation is an UPDATE — a real DELETE is refused by the database and
 * no code path in this application asks for one.
 *
 * What is left is the minimal lifecycle row A3 defined and A4 extends: the id,
 * when the request arrived, the consent evidence, the status, when it was last
 * moved, when it was closed, and now `purged_at`. Enough to say that a consented
 * request arrived on a day and was dealt with rather than quietly dropped, and
 * not enough to say anything about anybody.
 *
 * ============================ HOW IT BEHAVES ================================
 *
 * IDEMPOTENT, BY CONSTRUCTION RATHER THAN BY A FLAG. `purged_at IS NULL` is in
 * the predicate, and the column is stamped by the same statement that clears the
 * content, so a second run finds nothing and a re-run after a crash resumes
 * exactly where the first stopped. Running it twice an hour and running it twice
 * a year produce the same database.
 *
 * ONE TRANSACTION PER REQUEST, AND THAT IS THE SAFE END OF THE TRADE. A single
 * transaction over the whole batch would be marginally faster and would mean
 * that a failure on request nine hundred undid the eight hundred and
 * ninety-nine erasures already performed — work that must then be redone, on a
 * table where the whole point is that the erasure eventually happens. Per-row
 * transactions make partial progress permanent, which is the correct outcome
 * here; each row's clearing and its audit entry remain atomic together, which is
 * the part that must never split.
 *
 * NO SCHEDULER, NO QUEUE, NO CRON SERVICE AND NO JOB FRAMEWORK. This is a method
 * an operator command calls (`purge-website-requests`), for the reason
 * `bootstrap-manager` is: a scheduled runner is deployment machinery, it belongs
 * to Milestone 10, and shipping it here would mean an unattended process holding
 * a destructive grant against a table of personal data before anybody had
 * decided how it is monitored.
 *
 * THE ACTOR IS `SYSTEM`. No user performs this, no session exists, and the audit
 * row's payload is EMPTY — it says the content of this row was destroyed and,
 * by its own timestamp, when. It names no field it cleared and no value it
 * cleared, because a list of what was deleted is a description of what was
 * there.
 */

/**
 * The accepted retention window.
 *
 * IT IS ALSO IN THE DATABASE, in `website_request_purge_eligibility_chk`, and
 * the duplication is deliberate: shortening it here alone would produce a
 * constraint violation rather than an early erasure. Changing the policy is
 * therefore a migration somebody reviews, in both directions.
 */
export const WEBSITE_REQUEST_RETENTION_DAYS = 90;

/** What one run did. Counted, never listed — the ids are audit's business. */
export type WebsiteRequestPurgeResult = {
  readonly eligible: number;
  readonly purged: number;
};

@Injectable()
export class WebsiteRequestRetentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Erases every eligible request, and says how many.
   *
   * `requestId` IS THE RUN'S OWN IDENTIFIER, generated here and shared by every
   * audit row the run writes. It is what ties one operator's invocation together
   * afterwards: "these four hundred erasures were one command", which is the
   * question anybody reading the audit log after a retention run actually asks.
   *
   * THE ELIGIBILITY IS RE-READ INSIDE EACH TRANSACTION, under `FOR UPDATE`. The
   * scan that finds the work runs outside any transaction, so a request could be
   * linked to a family — or, in a future checkpoint, moved — between being listed
   * and being erased. Re-checking under the row lock is what makes the decision
   * and the erasure one act; the constraint underneath would catch it anyway,
   * but as a crash rather than as a skip.
   */
  async purge(): Promise<WebsiteRequestPurgeResult> {
    const requestId = uuidv7();

    const eligible = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM website_request
      WHERE ${eligibilityPredicate}
      ORDER BY closed_at ASC
    `;

    let purged = 0;

    for (const { id } of eligible) {
      const done = await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM website_request
          WHERE id = ${id}::uuid AND ${eligibilityPredicate}
          FOR UPDATE
        `;

        // Somebody linked it, or another run got there first. Not an error: the
        // whole design of this operation is that it is safe to repeat.
        if (locked[0] === undefined) return false;

        await tx.$executeRaw`
          UPDATE website_request SET
            contact_name = NULL,
            contact_mobile = NULL,
            requested_service_id = NULL,
            child_name = NULL,
            child_age_years = NULL,
            child_sex = NULL,
            preferred_contact_time = NULL,
            note = NULL,
            submitter_fingerprint = NULL,
            dedupe_key = NULL,
            purged_at = transaction_timestamp()
          WHERE id = ${id}::uuid
        `;

        // The act, and nothing about it. See the class comment, and
        // `website_request.purged` in `audit-actions.ts`.
        await this.audit.record(
          tx,
          { actor: { type: 'SYSTEM' }, requestId },
          {
            action: 'website_request.purged',
            entityType: 'website_request',
            entityId: id,
          },
        );

        return true;
      });

      if (done) purged += 1;
    }

    return { eligible: eligible.length, purged };
  }

  /**
   * What a run WOULD erase, without erasing it.
   *
   * A destructive operation an operator cannot inspect first is one they will
   * eventually run at the wrong moment. It writes nothing — no row, no audit
   * entry — and it returns a COUNT rather than a list, because the answer to
   * "which requests?" is a page of strangers' names and this is a terminal.
   */
  async countEligible(): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM website_request WHERE ${eligibilityPredicate}
    `;

    return rows[0]?.count ?? 0;
  }
}

/**
 * THE THREE CONDITIONS, WRITTEN ONCE.
 *
 * Used by the scan, by the re-check under the row lock and by the dry run, so
 * that "eligible" cannot come to mean three slightly different things. It is the
 * same predicate `website_request_purge_eligibility_chk` states, deliberately —
 * see the class comment for why both exist.
 *
 * `purged_at IS NULL` is what makes the whole operation idempotent.
 */
const eligibilityPredicate = Prisma.sql`
  status = 'CLOSED'::website_request_status
  AND linked_family_id IS NULL
  AND purged_at IS NULL
  AND closed_at <= transaction_timestamp()
      - ${`${WEBSITE_REQUEST_RETENTION_DAYS} days`}::interval
`;
