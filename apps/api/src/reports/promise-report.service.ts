import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  PromiseReportQuery,
  PromiseReportResponse,
  PromiseReportRow,
  PromiseReportSummary,
  PromiseStatus,
} from '@clinic/contracts';
import { PROMISE_WIRE_STATUS, promiseStatusFilter } from '../payments/promise-detail';
import { PrismaService } from '../prisma/prisma.service';

/**
 * PROMISES ACROSS THE WHOLE CLINIC: who said they would pay, when, and what
 * became of it.
 *
 * The frozen `GET /reports/promises` (Milestone 7, checkpoint C1), implemented
 * in C3. It writes nothing, locks nothing and stores nothing.
 *
 * READABLE BY BOTH ROLES, UNDER `promise.read`. Chasing an overdue promise is
 * the receptionist's own work — the whole promise workflow is theirs
 * (DECISION_LOG, 2026-08-15) — and this report tells them which families to
 * telephone. It is not clinic-wide financial reporting, and the shape is what
 * keeps that true.
 *
 * PROMISES ARE COUNTED, NEVER SUMMED, AND THAT RULE SURVIVES INTO REPORTING. A
 * promise never alters a family's financial position in any state (CLAUDE.md),
 * so no statement in this file sums `amount_toman`. A clinic-wide promised total
 * would be a number that looks like money the clinic is owed, sits one line from
 * the amounts that really are owed, and would be added to them. Each ROW carries
 * its own promised amount, which is a fact of that promise and already visible to
 * anybody holding `promise.read`.
 *
 * `MISSED` IS DERIVED, IN POSTGRESQL, AND NOWHERE ELSE. Both the row's word and
 * the summary's five counts come from `payments/promise-detail` —
 * `PROMISE_WIRE_STATUS` labels and `promiseStatusFilter` selects — which is the
 * same pair the family promise list and every promise write answer with. Nothing
 * here compares a date in Node, and the web tier is never asked to: Tehran rolls
 * over at 20:30 UTC, so a derivation in a browser would be this answer computed
 * in the wrong timezone. There is no `MISSED` column, no nightly job and no
 * stored flag.
 *
 * NO `follow_up_date` AND NO FOLLOW-UP WORKFLOW. The frozen row is the family to
 * call, the amount agreed, the day it was agreed for and what became of it;
 * anything else is the family promise list's or a later decision.
 *
 * ONE SNAPSHOT, WHICH MATTERS MORE HERE THAN ANYWHERE ELSE. `REPEATABLE READ`
 * pins `clinic_date()` across the summary and the page — the function is
 * `STABLE` and reads `transaction_timestamp()` — so a request crossing midnight
 * in Tehran cannot count a promise as `MISSED` and then list it as `OPEN`.
 */

type SummaryRow = {
  total: number;
  open: number;
  missed: number;
  fulfilled: number;
  rescheduled: number;
  cancelled: number;
};

type ReportRow = {
  id: string;
  family_id: string;
  family_name: string;
  amount_toman: bigint;
  due_on: string;
  status: PromiseStatus;
  created_at: Date;
  resolved_at: Date | null;
};

@Injectable()
export class PromiseReportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The promises this filter matched, soonest due date first.
   *
   * AN EMPTY RESULT IS A SUCCESSFUL READ (frozen C1): a fortnight in which
   * nobody promised anything is an answer, not a `404`.
   */
  async report(query: PromiseReportQuery): Promise<PromiseReportResponse> {
    const filters = promiseFilters(query);

    return this.prisma.$transaction(
      async (tx) => {
        const summary = await this.summary(tx, filters);
        const offset = (query.page - 1) * query.pageSize;
        const promises = await this.page(tx, filters, query, offset);

        return {
          range: { from: query.from, to: query.to, dateBasis: 'PROMISE_DUE_ON' },
          summary,
          promises,
          page: {
            page: query.page,
            pageSize: query.pageSize,
            total: summary.total,
            hasMore: offset + promises.length < summary.total,
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /**
   * HOW THE FILTERED PROMISES FALL ACROSS THE FIVE STATUSES — over the whole
   * result, not the page.
   *
   * THE FIVE PARTITION THE RESULT, AND THAT IS TRUE BY CONSTRUCTION RATHER THAN
   * BY INSPECTION. Each `FILTER` is `promiseStatusFilter` for one word: `OPEN`
   * and `MISSED` are the complement pair over the stored `OPEN` rows, and the
   * other three are the terminal stored words. They therefore sum to `total`
   * exactly, and a reader asking "how many are still on time?" reads a number
   * rather than subtracting two.
   *
   * COUNTS ONLY. There is no amount in this block and no `sum` in this statement.
   *
   * THE SUMMARY IS FILTER-SCOPED, so `status=MISSED` returns a summary whose
   * `missed` equals its `total` and whose other four are zero. That is the same
   * meaning `totals` has everywhere else in this directory: it describes exactly
   * the rows this query matches, not the whole clinic.
   */
  private async summary(
    tx: Prisma.TransactionClient,
    filters: Prisma.Sql,
  ): Promise<PromiseReportSummary> {
    const rows = await tx.$queryRaw<SummaryRow[]>`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE ${promiseStatusFilter('OPEN')})::int AS open,
        count(*) FILTER (WHERE ${promiseStatusFilter('MISSED')})::int AS missed,
        count(*) FILTER (WHERE ${promiseStatusFilter('FULFILLED')})::int AS fulfilled,
        count(*) FILTER (WHERE ${promiseStatusFilter('RESCHEDULED')})::int AS rescheduled,
        count(*) FILTER (WHERE ${promiseStatusFilter('CANCELLED')})::int AS cancelled
      FROM payment_promise p
      WHERE ${filters}
    `;

    const row = rows[0];
    // Unreachable: an ungrouped aggregate returns exactly one row, zeroed when
    // nothing matched.
    if (row === undefined) throw new Error('the promise summary returned no row');

    return {
      total: row.total,
      open: row.open,
      missed: row.missed,
      fulfilled: row.fulfilled,
      rescheduled: row.rescheduled,
      cancelled: row.cancelled,
    };
  }

  /**
   * One page of promises, soonest due date first.
   *
   * DELIBERATELY NOT `PROMISE_ORDER`. That order is a family worklist — the
   * unresolved promises hoisted above the terminal ones — and it is the right
   * order for the screen it serves. This report is keyed on `PROMISE_DUE_ON` and
   * ordered by it plainly (frozen C1), because the reader is working down a
   * calendar of a period rather than triaging one family; hoisting a segment
   * here would interleave the dates the report is sorted by.
   *
   * THE ORDER IS TOTAL, so a promise cannot appear on two pages or on neither:
   * the due day, then creation, then the id, which is a uuidv7.
   *
   * NO JOIN BUT THE FAMILY, and the family is `reportFamilySummary` — an id and a
   * name, with no guardian, mobile, landline or address. The reschedule chain,
   * the fulfilling payment, the resolution actor and the note are the family
   * promise list's; carrying them here would put a payment id and a resolution
   * reason on every row of a page that gets printed and left on a desk.
   *
   * `amount_toman` is carried out as a decimal string, because a Toman value
   * above 2^53 is storable and is not representable as a JSON number. `due_on` is
   * read `::text`, because the digits are the value.
   */
  private async page(
    tx: Prisma.TransactionClient,
    filters: Prisma.Sql,
    query: PromiseReportQuery,
    offset: number,
  ): Promise<PromiseReportRow[]> {
    const rows = await tx.$queryRaw<ReportRow[]>`
      SELECT
        p.id,
        f.id AS family_id, f.family_name,
        p.amount_toman,
        p.due_on::text AS due_on,
        ${PROMISE_WIRE_STATUS} AS status,
        p.created_at,
        p.resolved_at
      FROM payment_promise p
      JOIN family f ON f.id = p.family_id
      WHERE ${filters}
      ORDER BY p.due_on ASC, p.created_at ASC, p.id ASC
      LIMIT ${query.pageSize} OFFSET ${offset}
    `;

    return rows.map((row) => ({
      id: row.id,
      family: { id: row.family_id, familyName: row.family_name },
      amountToman: row.amount_toman.toString(),
      dueOn: row.due_on,
      status: row.status,
      createdAt: row.created_at.toISOString(),
      resolvedAt: row.resolved_at?.toISOString() ?? null,
    }));
  }
}

/**
 * The predicate the summary and the page share.
 *
 * KEYED ON `PROMISE_DUE_ON` — the day the family said it would pay — and NOT on
 * the day the promise was recorded: a report of what falls due next week is the
 * question this surface answers.
 *
 * BOTH ENDS ARE INCLUSIVE. `due_on` is a `DATE` rather than an instant, so
 * inclusivity is spelled with two closed comparisons against the plain column
 * and no timezone arithmetic is needed at all — the family named a calendar day
 * and the report asks about calendar days. `payment_promise_status_due_on_idx`
 * leads with the status and then this column, which is why C1 added no promise
 * index.
 *
 * THERE IS NO MAXIMUM SPAN. The schema's only range rule — a range may not end
 * before it starts — has already been enforced by the time this runs.
 *
 * `status` FILTERS THE DERIVED WORD, NOT THE STORED COLUMN, through the shared
 * `promiseStatusFilter`. `MISSED` is accepted and means "stored `OPEN`, and due
 * before today at the clinic"; `OPEN` is the complement — still on time.
 *
 * `familyId` IS THE ONLY OTHER FILTER, and it is an opaque id. No name, no
 * mobile number and no free text of any kind reaches this query string.
 */
function promiseFilters(query: PromiseReportQuery): Prisma.Sql {
  const filters: Prisma.Sql[] = [
    Prisma.sql`p.due_on >= ${query.from}::date`,
    Prisma.sql`p.due_on <= ${query.to}::date`,
  ];

  if (query.familyId !== undefined) {
    filters.push(Prisma.sql`p.family_id = ${query.familyId}::uuid`);
  }
  if (query.status !== undefined) {
    filters.push(promiseStatusFilter(query.status));
  }

  return Prisma.join(filters, ' AND ');
}
