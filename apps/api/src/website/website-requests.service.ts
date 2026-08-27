import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  WEBSITE_REQUEST_STATUSES,
  isLegalWebsiteRequestTransition,
  type ChangeWebsiteRequestStatusRequest,
  type ChildSex,
  type PublicRequestContactTime,
  type LinkWebsiteRequestRequest,
  type WebsiteRequestDetail,
  type WebsiteRequestInboxQuery,
  type WebsiteRequestInboxResponse,
  type WebsiteRequestStatus,
  type WebsiteRequestSummary,
} from '@clinic/contracts';
import { AuditService } from '../audit/audit.service';
import { actorContext } from '../catalog/catalog-support';
import { AppError } from '../common/app-error';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The internal inbox: what the clinic does with a message a stranger left.
 *
 * Milestone 9, checkpoint A4. A3 accepted the message and deliberately built no
 * workflow over it; this is the workflow, and it is five statuses, one family
 * link, and nothing else.
 *
 * ========================= WHAT THIS IS NOT ================================
 *
 * IT IS NOT A CRM (PROJECT_SPEC.md 11 says so in the sentence after the five
 * statuses). There is no assignment, no owner, no reminder, no due date, no
 * priority, no lead score, no pipeline, no activity feed, no reply, no thread
 * and no template. Nothing here schedules anything, sends anything, or measures
 * anybody's response time.
 *
 * IT IS NOT A SECOND WAY TO CREATE A FAMILY, AND IT CANNOT BECOME ONE. `link`
 * takes the id of a family that ALREADY EXISTS and refuses to do anything else.
 * The other half of the accepted conversion path — "this is a new family" — is
 * the ordinary registration workflow, under `family.create`, with its ordinary
 * duplicate detection and its ordinary confirmation step; the request is linked
 * afterwards, through this same method. There is no route in this file that
 * writes a family, a guardian or a child, and no one-click conversion anywhere
 * in the product.
 *
 * IT IS NOT REACHABLE BY ANYBODY WHO IS NOT SIGNED IN. Every method here is
 * behind `website_request.read` or `website_request.process`, and no public
 * projection in `PublicSiteService` reads this table at all. The submission
 * response an anonymous caller receives carries no identifier, so there is not
 * even a handle with which to guess at one of these routes.
 *
 * ====================== WHAT IT REFUSES TO REMEMBER ========================
 *
 * NO INTAKE CONTENT REACHES `audit_log`, EVER. The audit rows this file writes
 * carry a status pair and a family id, and no name, no telephone number, no
 * child, no age, no sex, no service, no note and no contact preference. That is
 * the A3 boundary preserved rather than a new rule: this table's content is
 * erased after ninety days and `audit_log` is append-only and unprunable, so
 * anything copied across would make the erasure a fiction. A status is what the
 * CLINIC decided and not what the visitor said, which is why it may be recorded.
 *
 * NO FREE-TEXT REASON ON A STATUS CHANGE — the frozen M9 rule, and the reason
 * for it is the same one. A reason box is where a colleague would write what the
 * parent told them on the telephone, which is clinical detail about a real
 * child, into exactly the two stores that must not hold it.
 */

/** Everything the inbox reads off a request row. */
type RequestRow = {
  id: string;
  received_at: Date;
  status: WebsiteRequestStatus;
  status_changed_at: Date | null;
  closed_at: Date | null;
  purged_at: Date | null;
  contact_name: string | null;
  contact_mobile: string | null;
  child_name: string | null;
  child_age_years: number | null;
  child_sex: ChildSex | null;
  preferred_contact_time: PublicRequestContactTime | null;
  note: string | null;
  service_id: string | null;
  service_name: string | null;
  linked_family_id: string | null;
  linked_family_name: string | null;
  linked_at: Date | null;
};

/**
 * ONE PROJECTION, USED BY BOTH READS, AND `note` IS IN IT.
 *
 * The list drops the note when it maps a row to the wire and the detail keeps
 * it; the SQL is shared because two column lists is two places for the inbox to
 * start meaning slightly different things. Reading a column and declining to
 * serve it costs one string per row and keeps the projection auditable in one
 * place — which matters more here than anywhere else in this application,
 * because every column named below is somebody's personal data.
 *
 * THE ABUSE-CONTROL DIGESTS ARE NOT IN IT, AND NEVER WILL BE.
 * `submitter_fingerprint` and `dedupe_key` are keyed hashes of a visitor's IP
 * address and of their submission; they exist to bound a flooder and to absorb a
 * resend, and no colleague has any use for either. Serving them would put a
 * stable per-visitor identifier on a screen and, from there, into a screenshot.
 */
const REQUEST_COLUMNS = Prisma.sql`
  r.id,
  r.received_at,
  r.status::text AS status,
  r.status_changed_at,
  r.closed_at,
  r.purged_at,
  r.contact_name,
  r.contact_mobile,
  r.child_name,
  r.child_age_years,
  r.child_sex::text AS child_sex,
  r.preferred_contact_time::text AS preferred_contact_time,
  r.note,
  s.id AS service_id,
  s.name AS service_name,
  f.id AS linked_family_id,
  f.family_name AS linked_family_name,
  r.linked_at
`;

const REQUEST_JOINS = Prisma.sql`
  FROM website_request r
  LEFT JOIN service s ON s.id = r.requested_service_id
  LEFT JOIN family f ON f.id = r.linked_family_id
`;

@Injectable()
export class WebsiteRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * A page of the inbox, newest first, with the whole-inbox status counts beside
   * it.
   *
   * ONE SNAPSHOT, `REPEATABLE READ`, for the reason the dashboard and the family
   * account take one: the page and the counts are two statements, and a request
   * closed between them would produce a screen whose tab says twelve and whose
   * list shows eleven. It takes no locks and blocks no writer.
   *
   * NEWEST FIRST, WITH THE ID AS THE TIE-BREAK. Arrival is a
   * `transaction_timestamp()`, so two requests submitted in the same transaction
   * — impossible today, but the ordering must be total regardless — would
   * otherwise be free to swap places between pages and hide a row.
   *
   * NOTHING IS AUDITED. Reading an inbox changes nothing, and `audit_log` records
   * acts; a read copied into it would grow an unprunable table every time
   * somebody refreshed the screen the front desk keeps open all morning.
   */
  async inbox(query: WebsiteRequestInboxQuery): Promise<WebsiteRequestInboxResponse> {
    const statuses = query.statuses ?? null;
    const offset = (query.page - 1) * query.pageSize;

    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<RequestRow[]>`
          SELECT ${REQUEST_COLUMNS}
          ${REQUEST_JOINS}
          WHERE ${
            statuses === null
              ? Prisma.sql`TRUE`
              : Prisma.sql`r.status = ANY(${statuses}::website_request_status[])`
          }
          ORDER BY r.received_at DESC, r.id DESC
          LIMIT ${query.pageSize} OFFSET ${offset}
        `;

        const totals = await tx.$queryRaw<{ status: WebsiteRequestStatus; count: bigint }[]>`
          SELECT status::text AS status, count(*) AS count
          FROM website_request
          GROUP BY status
        `;

        const byStatus = new Map(totals.map((row) => [row.status, Number(row.count)]));
        const matched =
          statuses === null
            ? [...byStatus.values()].reduce((sum, count) => sum + count, 0)
            : statuses.reduce((sum, status) => sum + (byStatus.get(status) ?? 0), 0);

        return {
          requests: rows.map(toSummary),
          page: {
            page: query.page,
            pageSize: query.pageSize,
            total: matched,
            hasMore: offset + rows.length < matched,
          },
          // Every status, zero-filled and in the frozen order, so a screen has
          // the same five tabs every morning and a quiet week reads as a zero
          // rather than as a missing row.
          statusCounts: WEBSITE_REQUEST_STATUSES.map((status) => ({
            status,
            count: byStatus.get(status) ?? 0,
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /**
   * One request, opened: the summary plus the note the visitor wrote.
   *
   * A PURGED REQUEST STILL ANSWERS, AND ANSWERS TRUTHFULLY. It returns the
   * lifecycle row and says `contentPurged: true`. Refusing it with a 404 would
   * be the wrong answer twice over — the row exists, and a colleague looking at
   * an inbox entry is entitled to be told that the content was erased rather
   * than left to conclude the record has been lost.
   */
  async get(id: string): Promise<WebsiteRequestDetail> {
    const rows = await this.prisma.$queryRaw<RequestRow[]>`
      SELECT ${REQUEST_COLUMNS} ${REQUEST_JOINS} WHERE r.id = ${id}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('WEBSITE_REQUEST_NOT_FOUND');

    return toDetail(row);
  }

  /**
   * Moving a request along the accepted lifecycle.
   *
   * THE LEGAL MOVES ARE `WEBSITE_REQUEST_LEGAL_TRANSITIONS`, STATED IN THE
   * CONTRACT AND ENFORCED IN THREE PLACES ON PURPOSE: the screen offers exactly
   * those moves, this method refuses the rest with a code somebody can read, and
   * a PostgreSQL trigger refuses them again underneath. The trigger is the
   * guarantee — a status a data fix could set to anything would make `closed_at`,
   * and therefore the ninety-day retention deadline, meaningless — and this check
   * is what turns a constraint violation into an explanation.
   *
   * `CONVERTED_TO_FAMILY` IS UNREACHABLE FROM HERE, and the contract's request
   * schema excludes it before this method is ever called. Conversion means a
   * family, and a status claiming one without naming it is a row the database
   * refuses anyway.
   *
   * THE ROW IS LOCKED BEFORE IT IS READ. Two colleagues acting on the same
   * request at the same moment would otherwise both read `NEW`, both find their
   * move legal, and the second would overwrite the first with no record that
   * anything had been raced. `FOR UPDATE` makes the read-decide-write sequence
   * one act, exactly as every other lifecycle transition in this application
   * does it.
   */
  async changeStatus(
    id: string,
    input: ChangeWebsiteRequestStatusRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<WebsiteRequestDetail> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await lockRequest(tx, id);

      if (!isLegalWebsiteRequestTransition(before.status, input.status)) {
        throw new AppError('WEBSITE_REQUEST_TRANSITION_INVALID');
      }

      await tx.$executeRaw`
        UPDATE website_request
        SET status = ${input.status}::website_request_status,
            status_changed_at = transaction_timestamp(),
            closed_at = ${
              input.status === 'CLOSED' ? Prisma.sql`transaction_timestamp()` : Prisma.sql`NULL`
            }
        WHERE id = ${id}::uuid
      `;

      // The act, and the two statuses. No reason, no actor detail beyond the
      // audit row's own actor columns, and nothing the visitor wrote.
      await this.audit.record(tx, actorContext(actor, context), {
        action: 'website_request.status_changed',
        entityType: 'website_request',
        entityId: id,
        before: { status: before.status },
        after: { status: input.status },
      });

      return readLocked(tx, id);
    });

    return toDetail(updated);
  }

  /**
   * Tying a message to a family that already exists.
   *
   * ONE TRANSACTION, TWO FACTS, AND THEY BELONG TOGETHER. The link and the move
   * to `CONVERTED_TO_FAMILY` are one act: `website_request_link_chk` refuses a
   * converted request with no family and a linked request in any other status, so
   * there is no order in which these could be two statements. Somebody reading
   * the inbox in the gap between them would see a request that had become a
   * family and did not say so — which is precisely the row the retention run must
   * never purge and would be looking straight at.
   *
   * AT MOST ONE FAMILY, EVER, AND THE SECOND ATTEMPT IS THE SAME ANSWER
   * WHOEVER IT NAMES. Re-pointing a link at a different family would rewrite a
   * claim about whose message this was; confirming "yes, it is already that
   * family" would turn this route into a way of testing family membership against
   * a request id. So both are `WEBSITE_REQUEST_ALREADY_LINKED`, and a trigger
   * refuses the write underneath in either case.
   *
   * THE FAMILY MUST EXIST AND BE ACTIVE. A deactivated family is
   * `FAMILY_INACTIVE`, the existing code for the existing rule: attaching new
   * history to a record somebody has retired is how a deactivation quietly stops
   * meaning anything. `family.read` is demanded alongside
   * `website_request.process` (`WEBSITE_REQUEST_LINK_PERMISSIONS`) because this
   * method names a family and returns its name.
   *
   * NOTHING ABOUT THE FAMILY IS WRITTEN. No guardian gains the visitor's
   * telephone number, no child gains a birth date computed from an age somebody
   * typed into a public form, and no note is copied anywhere. What a colleague
   * decides to keep, they enter in the family record deliberately.
   */
  async link(
    id: string,
    input: LinkWebsiteRequestRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<WebsiteRequestDetail> {
    const updated = await this.prisma.$transaction(async (tx) => {
      // The family first, then the request: the global lock order in this
      // application is family before its dependants, and a link takes both.
      const family = await tx.$queryRaw<{ id: string; status: string }[]>`
        SELECT id, status::text AS status FROM family WHERE id = ${input.familyId}::uuid FOR SHARE
      `;

      const familyRow = family[0];
      if (familyRow === undefined) throw new AppError('FAMILY_NOT_FOUND');
      if (familyRow.status !== 'ACTIVE') throw new AppError('FAMILY_INACTIVE');

      const before = await lockRequest(tx, id);

      if (before.linked_family_id !== null) throw new AppError('WEBSITE_REQUEST_ALREADY_LINKED');
      if (!isLegalWebsiteRequestTransition(before.status, 'CONVERTED_TO_FAMILY')) {
        throw new AppError('WEBSITE_REQUEST_TRANSITION_INVALID');
      }

      await tx.$executeRaw`
        UPDATE website_request
        SET status = 'CONVERTED_TO_FAMILY'::website_request_status,
            status_changed_at = transaction_timestamp(),
            linked_family_id = ${input.familyId}::uuid,
            linked_at = transaction_timestamp(),
            linked_by_user_id = ${actor.userId}::uuid
        WHERE id = ${id}::uuid
      `;

      // The family id is the one identifier any website-request audit row
      // carries, and it has to be: the whole point of the act is that this
      // message became that family. It is a clinic record's own identifier, not
      // a stranger's personal data, and a linked request is never purged.
      await this.audit.record(tx, actorContext(actor, context), {
        action: 'website_request.linked_to_family',
        entityType: 'website_request',
        entityId: id,
        before: { status: before.status },
        after: { status: 'CONVERTED_TO_FAMILY', familyId: input.familyId },
      });

      return readLocked(tx, id);
    });

    return toDetail(updated);
  }

  /**
   * How many requests nobody has looked at yet — the dashboard's one website
   * fact (PROJECT_SPEC.md 10).
   *
   * `NEW` AND ONLY `NEW`, AND THE NAME ON THE WIRE SAYS SO. It is the count of
   * requests in the arrival state: messages that have arrived and that nobody at
   * the clinic has touched. Nothing returns to `NEW`, so the number can only fall
   * as the morning's work is done, which is the property that makes it worth
   * putting on a dashboard at all.
   *
   * IT IS NOT SCOPED TO THE DASHBOARD'S DAY, and it is the only count on that
   * screen that is not. A request that arrived three weeks ago and has never been
   * looked at is exactly what this exists to surface; counting only today's would
   * hide the backlog behind a quiet morning — the same reasoning the dashboard's
   * `missedCount` already applies to overdue promises.
   *
   * IT IS A COUNT AND NEVER A LIST. The requests themselves are read in the
   * inbox, under the same authority.
   */
  async newRequestCount(tx: Prisma.TransactionClient): Promise<number> {
    const rows = await tx.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM website_request WHERE status = 'NEW'
    `;

    return rows[0]?.count ?? 0;
  }
}

/** MUST be called inside a transaction: the row is held until it commits. */
async function lockRequest(tx: Prisma.TransactionClient, id: string): Promise<RequestRow> {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM website_request WHERE id = ${id}::uuid FOR UPDATE
  `;

  if (locked[0] === undefined) throw new AppError('WEBSITE_REQUEST_NOT_FOUND');

  return readLocked(tx, id);
}

async function readLocked(tx: Prisma.TransactionClient, id: string): Promise<RequestRow> {
  const rows = await tx.$queryRaw<RequestRow[]>`
    SELECT ${REQUEST_COLUMNS} ${REQUEST_JOINS} WHERE r.id = ${id}::uuid
  `;

  const row = rows[0];
  if (row === undefined) throw new AppError('WEBSITE_REQUEST_NOT_FOUND');
  return row;
}

/**
 * The lifecycle half of a row: what survives the ninety-day erasure.
 *
 * Stated once and spread into both arms of the union below, so that a purged
 * request and a live one cannot drift into describing their lifecycles
 * differently.
 */
function lifecycleOf(row: RequestRow) {
  return {
    id: row.id,
    receivedAt: row.received_at.toISOString(),
    status: row.status,
    statusChangedAt: row.status_changed_at?.toISOString() ?? null,
    closedAt: row.closed_at?.toISOString() ?? null,
    linkedFamily:
      row.linked_family_id === null || row.linked_family_name === null
        ? null
        : { id: row.linked_family_id, familyName: row.linked_family_name },
    linkedAt: row.linked_at?.toISOString() ?? null,
  };
}

/**
 * A row on the wire, in whichever of the two shapes the retention rule has left
 * it.
 *
 * THE DISCRIMINATOR IS READ OFF `purged_at` AND NOT OFF A NULL FIELD, because
 * `purged_at` is what the database's own constraint keys on: while it is NULL
 * the four required intake columns are guaranteed present, and once it is set
 * every purgeable column is guaranteed absent. Deciding from, say, a null
 * `contact_name` would be deciding from a consequence rather than from the fact.
 *
 * The non-null assertions on the live arm are that database guarantee, not an
 * optimism: `website_request_purge_chk` refuses a live row missing any of them.
 */
function toSummary(row: RequestRow): WebsiteRequestSummary {
  if (row.purged_at !== null) {
    return { contentPurged: true, purgedAt: row.purged_at.toISOString(), ...lifecycleOf(row) };
  }

  const { contact_name, contact_mobile, child_age_years, child_sex } = row;

  if (
    contact_name === null ||
    contact_mobile === null ||
    child_age_years === null ||
    child_sex === null
  ) {
    // Unreachable: `website_request_purge_chk` requires all four to be present
    // for as long as `purged_at` is NULL. Stated rather than defaulted, because
    // an empty name or a zero age invented here would be a fact nobody gave.
    throw new Error('website_request holds content and is incomplete');
  }

  return {
    contentPurged: false,
    purgedAt: null,
    ...lifecycleOf(row),
    contactName: contact_name,
    contactMobile: contact_mobile,
    childName: row.child_name,
    childAgeYears: child_age_years,
    childSex: child_sex,
    preferredContactTime: row.preferred_contact_time,
    requestedService:
      row.service_id === null || row.service_name === null
        ? null
        : { id: row.service_id, name: row.service_name },
    // The note is READ and not SERVED here. A list of twenty-five rows is
    // skimmed, and two thousand characters of what a distressed parent wrote is
    // not something to skim; `hasNote` says a paragraph is waiting.
    hasNote: row.note !== null,
  };
}

function toDetail(row: RequestRow): WebsiteRequestDetail {
  const summary = toSummary(row);
  if (summary.contentPurged) return summary;

  return { ...summary, note: row.note };
}
