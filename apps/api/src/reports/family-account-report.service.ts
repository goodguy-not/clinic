import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  FamilyAccountReportExportQuery,
  FamilyAccountReportQuery,
  FamilyAccountReportResponse,
  FamilyAccountReportRow,
  FamilyAccountReportTotals,
} from '@clinic/contracts';
import {
  familyPositionParts,
  readLastPayments,
  toFamilyPosition,
  type FamilyPositionPartsRow,
} from '../ledger/family-position';
import { PrismaService } from '../prisma/prisma.service';
import { pageWindow, windowClause, type ReportWindow } from './report-window';

/**
 * WHAT EVERY FAMILY OWES OR STANDS IN CREDIT FOR, ON ONE PAGE.
 *
 * The frozen `GET /reports/family-accounts` (Milestone 7, checkpoint C1),
 * implemented in C4. It writes nothing, locks nothing and stores nothing.
 *
 * IT CREATES NO SECOND DEFINITION OF "WHAT DOES THIS FAMILY OWE?", AND THAT IS
 * THE ENTIRE DESIGN OF THIS FILE. Not one charge predicate, payment predicate,
 * promise predicate or subtraction is written here: every row's `position` comes
 * out of `ledger/family-position.ts`, which is the same code — the same SQL, the
 * same mapping — that `GET /families/:id/account` answers with. The two reads
 * therefore reconcile by CONSTRUCTION rather than by agreement, and a correction
 * to what a void or a concession means lands on both at once. A reporting
 * service with its own charges-minus-payments statement would agree on the day
 * it was written and drift the first time one of the two was corrected; the
 * drift would be discovered by a family quoted two different balances by two
 * screens of one system.
 *
 * MANAGER-ONLY, UNDER `report.read_financial`. Every family's money on one
 * screen is the clinic-wide financial reporting the accepted decision keeps with
 * the manager; a receptionist reads one family at a time, through the route that
 * names that family. The authority is enforced by the controller's guard, in
 * NestJS.
 *
 * IT HAS NO DATE RANGE, AND THAT IS THE SEMANTIC POINT (frozen C1). A financial
 * position is not a period: it is every valid charge and every confirmed payment
 * a family has ever had, and it does not move when a reader narrows a filter.
 * `includeInactive` and `standing` decide WHICH FAMILIES are listed; neither
 * reaches a single financial statement, so no filter on this route can produce a
 * narrowed balance. That is the frozen Milestone 6 `totals`-versus-`position`
 * distinction, held across a second surface.
 *
 * NOTHING IS STORED. No balance column, no reporting table, no rollup, no
 * materialised view and no cache — every position is derived on the request that
 * asks for it, from `session_charge`, `charge_adjustment`, `payment` and
 * `payment_promise` as they stand (DECISION_LOG, 2026-08-15 — Credit is
 * derived).
 *
 * WHAT THESE NUMBERS KNOW IS ONLY WHAT THIS SYSTEM HOLDS. There is no opening
 * balance and no pre-system paper debt in them, because no such row exists.
 *
 * PROMISES ARE COUNTED AND CHANGE NO POSITION. A promise moves no money in any
 * state (CLAUDE.md); the counts ride on the frozen position and enter no
 * arithmetic and no total on this page.
 *
 * ONE SNAPSHOT. `REPEATABLE READ` pins the totals, the page and its last
 * payments to one database state, so the summary at the top of the page cannot
 * describe a different clinic from the rows beneath it — and so `clinic_date()`,
 * which the promise counts ask, answers once for the whole response.
 */

type TotalsRow = {
  family_count: number;
  owing_family_count: number;
  in_credit_family_count: number;
  total_amount_due: bigint;
  total_credit: bigint;
};

@Injectable()
export class FamilyAccountReportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The families this filter matched, largest amount due first.
   *
   * AN EMPTY RESULT IS A SUCCESSFUL READ (frozen C1) — a clinic where nobody owes
   * anything is the outcome the report is looking for.
   *
   * THE TOTALS COVER EVERY FAMILY THE FILTER MATCHED, NOT THE PAGE, so turning
   * the page cannot change what the clinic is owed. `page.total` is
   * `familyCount` from that same statement rather than a second `COUNT(*)` that
   * could disagree with it.
   */
  async report(query: FamilyAccountReportQuery): Promise<FamilyAccountReportResponse> {
    const selection = familySelection(query);
    const standing = standingFilter(query);
    const window = pageWindow(query);

    return this.prisma.$transaction(
      async (tx) => {
        const totals = await this.totals(tx, selection, standing);
        const families = await this.rows(tx, selection, standing, window);

        return {
          totals,
          families,
          page: {
            page: query.page,
            pageSize: query.pageSize,
            total: totals.familyCount,
            hasMore: window.offset + families.length < totals.familyCount,
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /**
   * EVERY MATCHING FAMILY, FOR THE CSV EXPORT (checkpoint C5).
   *
   * IT IS `rows` WITH NO WINDOW, so every position in the file is still
   * `toFamilyPosition` over `familyPositionParts` — the same code
   * `GET /families/:id/account` answers with. A family quoted a balance from a
   * spreadsheet and a balance from the screen is being quoted one number derived
   * once, which is the entire reason this service was written the way it was.
   *
   * NO DATE RANGE REACHES ANY OF IT. `standing` and `includeInactive` select
   * FAMILIES, exactly as on the screen; no filter on this route can produce a
   * narrowed balance, and there is no "as at" date in a file any more than there
   * is one in the report.
   *
   * WHAT THE FILE KNOWS IS ONLY WHAT THIS SYSTEM HOLDS. No opening balance and no
   * pre-system paper debt is in these numbers, because no such row exists — the
   * same disclosure the interface prints beside the report, and the one fact a
   * spreadsheet has nowhere to print (see the C5 report).
   */
  async exportRows(
    tx: Prisma.TransactionClient,
    query: FamilyAccountReportExportQuery,
  ): Promise<FamilyAccountReportRow[]> {
    return this.rows(tx, familySelection(query), standingFilter(query), null);
  }

  /**
   * WHAT THE FILTERED SET OF FAMILIES ADDS UP TO.
   *
   * THE TWO SUMS ARE NOT NETTED AGAINST EACH OTHER, AND THERE IS NO CLINIC
   * BALANCE (frozen C1). One family's credit does not reduce another family's
   * debt, and a single signed number that pretended otherwise would be a
   * clinic-wide balance this product does not recognise. Both are unsigned and
   * both are always present.
   *
   * THE COUNTS AND THE SUMS COME FROM THE SAME DERIVED POSITIONS THE ROWS DO,
   * because they are taken over `familyPositionParts` — the report never counts
   * "families in arrears" by a rule of its own.
   *
   * A SETTLED FAMILY IS IN NEITHER COUNT AND IN NEITHER SUM, and is still in
   * `familyCount`: the three standings partition the matched families, which is
   * what makes `familyCount` the number the pager is built on.
   */
  private async totals(
    tx: Prisma.TransactionClient,
    selection: Prisma.Sql,
    standing: Prisma.Sql,
  ): Promise<FamilyAccountReportTotals> {
    const rows = await tx.$queryRaw<TotalsRow[]>`
      WITH position AS (${familyPositionParts(selection)})
      SELECT
        count(*)::int AS family_count,
        count(*) FILTER (WHERE amount_due_total > 0)::int AS owing_family_count,
        count(*) FILTER (WHERE credit_total > 0)::int AS in_credit_family_count,
        coalesce(sum(amount_due_total), 0)::bigint AS total_amount_due,
        coalesce(sum(credit_total), 0)::bigint AS total_credit
      FROM position
      WHERE ${standing}
    `;

    const row = rows[0];
    // Unreachable: an ungrouped aggregate returns exactly one row, zeroed when
    // nothing matched.
    if (row === undefined) throw new Error('the family-accounts totals returned no row');

    return {
      familyCount: row.family_count,
      owingFamilyCount: row.owing_family_count,
      inCreditFamilyCount: row.in_credit_family_count,
      totalAmountDueToman: row.total_amount_due.toString(),
      totalCreditToman: row.total_credit.toString(),
    };
  }

  /**
   * The matched families, in the worklist order the server chooses — one page of
   * them for a screen, all of them for an export (windowClause).
   *
   * THE ORDER IS STATED BY THE SERVER RATHER THAN BY THE CALLER (frozen C1): the
   * report exists to answer "who should we call first?", and a sort parameter
   * would be a second way to ask one question. Largest amount due first; families
   * in credit and settled families follow, by name — which falls out of the
   * amount due being zero for both of them. The family name and then the id
   * settle every tie, so the order is total and a family cannot appear on two
   * pages or on neither.
   *
   * THE POSITION IS BUILT BY `toFamilyPosition`, NOT HERE. The row this statement
   * returns is `FamilyPositionPartsRow` — the same shape, from the same SQL, that
   * the single-family account read maps — and the mapping is the same function.
   * The only thing this file adds is the family summary beside it.
   *
   * `reportFamilySummary` IS THE ID AND THE NAME AND NOTHING ELSE: no guardian,
   * no mobile, no landline, no address. A report is a page that gets printed and
   * left on a desk.
   *
   * THE LAST PAYMENTS ARE ONE STATEMENT FOR THE WHOLE PAGE, not one per family:
   * `readLastPayments` is the position's own `DISTINCT ON`, so "the latest
   * payment" is the same row here as on the family's own account.
   */
  private async rows(
    tx: Prisma.TransactionClient,
    selection: Prisma.Sql,
    standing: Prisma.Sql,
    window: ReportWindow | null,
  ): Promise<FamilyAccountReportRow[]> {
    const rows = await tx.$queryRaw<FamilyPositionPartsRow[]>`
      WITH position AS (${familyPositionParts(selection)})
      SELECT * FROM position
      WHERE ${standing}
      ORDER BY amount_due_total DESC, family_name ASC, family_id ASC
      ${windowClause(window)}
    `;

    const lastPayments = await readLastPayments(
      tx,
      rows.map((row) => row.family_id),
    );

    return rows.map((row) => ({
      family: { id: row.family_id, familyName: row.family_name },
      position: toFamilyPosition(row, lastPayments.get(row.family_id) ?? null),
    }));
  }
}

/**
 * WHICH FAMILIES ARE LISTED, which is not a financial statement at all.
 *
 * `includeInactive` is about the family RECORD — a deactivated family that still
 * owes money is a real situation and the flag is how a manager finds it. It
 * narrows no charge, no payment and no promise, on the screen or in a file,
 * which is why the position each row carries is always the whole family's.
 *
 * Extracted so the report and the export state it once. Two copies of "which
 * families" would be two places for a later filter to reach one surface and not
 * the other.
 */
function familySelection(query: FamilyAccountReportExportQuery): Prisma.Sql {
  return query.includeInactive ? Prisma.sql`TRUE` : Prisma.sql`f.status = 'ACTIVE'::record_status`;
}

/**
 * WHERE A FAMILY STANDS, AS A CLOSED WORD RATHER THAN A THRESHOLD.
 *
 * The three words partition the matched families exactly, because the position
 * they select on guarantees at most one of `amount_due_total` and `credit_total`
 * is non-zero: `OWING` is one, `IN_CREDIT` is the other, and `SETTLED` is both at
 * zero. No family can match two of them and none can match none.
 *
 * IT SELECTS FAMILIES AND CHANGES NO NUMBER. The position each row carries was
 * derived over the whole family before this predicate ran, so a filtered list
 * never produces a filtered balance.
 *
 * A CLOSED ENUM RATHER THAN A `minAmountDueToman` (frozen C1): an amount
 * threshold in a query string is a number somebody invents on the spot, it makes
 * two managers quote two different "families in arrears" counts, and the
 * arithmetic behind it belongs to the server.
 */
function standingFilter(query: FamilyAccountReportExportQuery): Prisma.Sql {
  if (query.standing === 'OWING') return Prisma.sql`amount_due_total > 0`;
  if (query.standing === 'IN_CREDIT') return Prisma.sql`credit_total > 0`;
  if (query.standing === 'SETTLED') {
    return Prisma.sql`amount_due_total = 0 AND credit_total = 0`;
  }

  return Prisma.sql`TRUE`;
}
