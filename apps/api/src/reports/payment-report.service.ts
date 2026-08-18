import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PAYMENT_METHODS,
  type PaymentMethod,
  type PaymentReportExportQuery,
  type PaymentReportMethodTotal,
  type PaymentReportQuery,
  type PaymentReportResponse,
  type PaymentReportRow,
  type PaymentReportTotals,
  type PaymentReportUserTotal,
} from '@clinic/contracts';
import { PAYMENT_ORDER, paymentStatus } from '../payments/payment-detail';
import { PrismaService } from '../prisma/prisma.service';
import { pageWindow, windowClause, type ReportWindow } from './report-window';

/**
 * WHAT THE CLINIC TOOK IN OVER A PERIOD, BY METHOD AND BY THE PERSON WHO
 * ENTERED IT.
 *
 * The frozen `GET /reports/payments` (Milestone 7, checkpoint C1), implemented
 * in C4. It writes nothing, locks nothing and stores nothing: no financial row,
 * no aggregate, no reporting table and no cache. Every figure is derived from
 * `payment` on the request that asks for it.
 *
 * MANAGER-ONLY, UNDER `report.read_financial`. This is clinic-wide financial
 * reporting AND per-user financial attribution, which are the two things the
 * accepted Milestone 7 decision keeps with the manager. The authority is
 * enforced by the controller's guard, in NestJS, and a receptionist calling this
 * route directly is refused there — no statement in this file ever runs for
 * them.
 *
 * KEYED ON `PAYMENT_RECEIVED_ON` — THE CLINIC BUSINESS DAY THE MONEY ARRIVED —
 * AND DELIBERATELY NOT ON THE DAY IT WAS ENTERED. A payment received on Thursday
 * and entered on Saturday appears in this report under Thursday and in
 * Saturday's dashboard reconciliation. One answers "what did the clinic take in
 * that week?"; the other "what did I enter today?". Neither is a correction of
 * the other, and nothing here reinterprets a back-dated payment according to its
 * entry time. The response echoes its basis so no consumer has to remember which
 * is which.
 *
 * VOIDED MONEY IS COUNTED, NEVER SUMMED. `FILTER (WHERE p.voided_at IS NULL)` is
 * the whole of "a voided payment contributes to no financial total" — the same
 * predicate the family position sums with. `voidedCount` says how many reversals
 * fall in the period so a manager can see that corrections happened; the amounts
 * are not totalled, because a "total voided" figure beside a total received is an
 * invitation to subtract one from the other.
 *
 * `includeVoided` IS A FILTER ON THE LIST ALONE. It changes which rows are
 * printed and changes no number in `totals` — a voided payment is excluded from
 * every confirmed sum whether or not it is shown, exactly as `includeVoided`
 * behaves on the family account and on the payment history.
 *
 * NO ALLOCATION, BECAUSE NONE EXISTS. A payment names no charge, no session and
 * no child (DECISION_LOG, 2026-08-15 — A payment is a family fact), so no row
 * here says what a payment settled and no total here is a balance. No promise is
 * inferred either: a payment landing near a due date is not a promise kept, and
 * the promise workflow says so explicitly through its own route.
 *
 * NO BANK REFERENCE AND NO NOTE (frozen C1). The reference is a banking
 * identifier and the note is free text a family may be described in; both are
 * read on the payment itself, and neither is needed to reconcile a day's
 * takings on a page that gets printed and left on a desk.
 *
 * ONE SNAPSHOT. `REPEATABLE READ` pins the totals, the two breakdowns and the
 * page to one database state, so a void committing mid-request cannot produce a
 * response whose summary counts a payment its list shows as confirmed.
 */

type TotalsRow = {
  confirmed_count: number;
  confirmed_total: bigint;
  voided_count: number;
};

type MethodTotalRow = {
  method: PaymentMethod;
  confirmed_count: number;
  confirmed_total: bigint;
};

type UserTotalRow = TotalsRow & {
  user_id: string;
  display_name: string;
};

type ReportRow = {
  id: string;
  family_id: string;
  family_name: string;
  amount_toman: bigint;
  method: PaymentMethod;
  received_on: string;
  voided_at: Date | null;
  created_at: Date;
  user_id: string;
  display_name: string;
};

@Injectable()
export class PaymentReportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The payments this filter matched, newest received date first.
   *
   * AN EMPTY RESULT IS A SUCCESSFUL READ (frozen C1): a quiet week returns `200`
   * with an empty array and zeroed totals, never a `404`.
   *
   * THE TOTALS DESCRIBE THE WHOLE FILTERED RESULT AND NOT THE PAGE, so turning
   * the page cannot change what the clinic took in. `page.total` is the confirmed
   * and voided rows the LIST shows — which is what `includeVoided` narrows — and
   * is therefore taken from the same two counts rather than from a second
   * `COUNT(*)` that could disagree with them.
   */
  async report(query: PaymentReportQuery): Promise<PaymentReportResponse> {
    const filters = paymentFilters(query);
    const window = pageWindow(query);

    return this.prisma.$transaction(
      async (tx) => {
        const totals = await this.totals(tx, filters);

        const listed = query.includeVoided
          ? totals.confirmedCount + totals.voidedCount
          : totals.confirmedCount;

        const payments = await this.rows(tx, filters, query, window);

        return {
          range: { from: query.from, to: query.to, dateBasis: 'PAYMENT_RECEIVED_ON' },
          totals,
          payments,
          page: {
            page: query.page,
            pageSize: query.pageSize,
            total: listed,
            hasMore: window.offset + payments.length < listed,
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /**
   * EVERY MATCHING PAYMENT, FOR THE CSV EXPORT (checkpoint C5).
   *
   * IT IS `rows` WITH NO WINDOW. The same `received_on` range — the clinic
   * business day the money ARRIVED, never the day it was typed in — the same
   * `PAYMENT_ORDER`, the same `paymentStatus` derivation and the same
   * `includeVoided` meaning, so a file and the screen it was taken from cannot
   * place a back-dated payment in two different weeks or disagree about which
   * rows are reversals.
   *
   * THE FILE CARRIES ROWS AND NO TOTALS, which is how "a voided payment is
   * summed nowhere" survives the format: there is no sum in the file to protect.
   * A voided row prints its own amount beside `status = VOIDED`, exactly as the
   * screen shows it, and any figure a reader adds up in the spreadsheet is one
   * they built themselves from rows whose status is on the same line.
   *
   * NO BANK REFERENCE AND NO NOTE, HERE EITHER (frozen C1). The columns are the
   * frozen report row, and nothing is added because the destination is a file.
   */
  async exportRows(
    tx: Prisma.TransactionClient,
    query: PaymentReportExportQuery,
  ): Promise<PaymentReportRow[]> {
    return this.rows(tx, paymentFilters(query), query, null);
  }

  /**
   * WHAT THE FILTERED PERIOD TOOK IN — over the whole result, not the page, and
   * never over the rows `includeVoided` happens to be showing.
   *
   * FILTER-SCOPED, ALWAYS. Every number describes the rows this query matched —
   * this method, this fortnight, this user — and none of them is a
   * whole-clinic-forever figure. There is deliberately no lifetime total anywhere
   * in Milestone 7.
   */
  private async totals(
    tx: Prisma.TransactionClient,
    filters: Prisma.Sql,
  ): Promise<PaymentReportTotals> {
    const rows = await tx.$queryRaw<TotalsRow[]>`
      SELECT ${CONFIRMED_TOTALS_COLUMNS}
      FROM payment p
      WHERE ${filters}
    `;

    const row = rows[0];
    // Unreachable: an ungrouped aggregate returns exactly one row, zeroed when
    // nothing matched.
    if (row === undefined) throw new Error('the payment report totals returned no row');

    return {
      confirmedCount: row.confirmed_count,
      confirmedTotalToman: row.confirmed_total.toString(),
      voidedCount: row.voided_count,
      byMethod: await this.byMethod(tx, filters),
      byUser: await this.byUser(tx, filters),
    };
  }

  /**
   * ALWAYS ALL THREE METHODS, IN `PAYMENT_METHODS` ORDER, ZERO-FILLED (frozen
   * C1).
   *
   * A method with no payments is a zero row rather than an absent one, so the
   * report has the same three lines every period and a reader reconciling a card
   * terminal against a bank statement never has to notice that "card" is missing
   * rather than empty. The zero-filling is done in TypeScript because the order
   * on the wire is the contract's own list, not PostgreSQL's enum order — the
   * same reasoning, and the same list, as the dashboard's reconciliation block.
   *
   * CONFIRMED ONLY. The reversals are counted once, in `voidedCount`, and appear
   * in no per-method sum.
   */
  private async byMethod(
    tx: Prisma.TransactionClient,
    filters: Prisma.Sql,
  ): Promise<PaymentReportMethodTotal[]> {
    const rows = await tx.$queryRaw<MethodTotalRow[]>`
      SELECT p.method::text AS method,
             count(*)::int AS confirmed_count,
             coalesce(sum(p.amount_toman), 0)::bigint AS confirmed_total
      FROM payment p
      WHERE ${filters} AND p.voided_at IS NULL
      GROUP BY p.method
    `;

    return PAYMENT_METHODS.map((method) => {
      const row = rows.find((candidate) => candidate.method === method);

      return {
        method,
        confirmedCount: row?.confirmed_count ?? 0,
        confirmedTotalToman: (row?.confirmed_total ?? 0n).toString(),
      };
    });
  }

  /**
   * WHO TOOK THE CLINIC'S MONEY IN THIS PERIOD: the per-user attribution the
   * accepted Milestone 7 decision keeps with the manager, and the reason this
   * whole report sits behind `report.read_financial` rather than behind
   * `payment.read`.
   *
   * THE ATTRIBUTION IS THE SERVER'S OWN, taken from `payment.created_by_user_id`
   * — the actor the write recorded — and never from anything a caller sent.
   *
   * EVERY USER WHO RECORDED A MATCHING PAYMENT APPEARS, including one whose
   * entries were all subsequently voided: that row is a zero `confirmedCount`
   * beside a `voidedCount`, which is precisely the attribution a manager is
   * looking for. A user who recorded nothing in the period does not appear — the
   * list is the period's payments grouped, not a staff directory.
   *
   * `reportUserSummary` IS THE DISPLAY NAME AND THE ID, with no username, role or
   * account state: a report says who took the money, not who they are in the user
   * administration surface. Ordered by display name with the id settling ties, so
   * two users sharing a name never swap places between two identical requests.
   */
  private async byUser(
    tx: Prisma.TransactionClient,
    filters: Prisma.Sql,
  ): Promise<PaymentReportUserTotal[]> {
    const rows = await tx.$queryRaw<UserTotalRow[]>`
      SELECT u.id AS user_id, u.display_name, ${CONFIRMED_TOTALS_COLUMNS}
      FROM payment p
      JOIN app_user u ON u.id = p.created_by_user_id
      WHERE ${filters}
      GROUP BY u.id, u.display_name
      ORDER BY u.display_name ASC, u.id ASC
    `;

    return rows.map((row) => ({
      user: { id: row.user_id, displayName: row.display_name },
      confirmedCount: row.confirmed_count,
      confirmedTotalToman: row.confirmed_total.toString(),
      voidedCount: row.voided_count,
    }));
  }

  /**
   * The matched payments, newest received day first — one page of them for a
   * screen, all of them for an export (windowClause).
   *
   * THE PAGE IS TAKEN BEFORE THE JOINS, as the family account's is: `LIMIT` and
   * `OFFSET` sit in the subquery, so the family and user lookups touch the rows
   * being returned rather than every payment the clinic has ever taken. Inside
   * that subquery `payment` is the only table, `received_on` is still the `DATE`
   * column, and `PAYMENT_ORDER` is therefore reused verbatim — the same total
   * order the family payment history and the position's `lastPayment` use, so
   * "newest" means one thing across every payment read in this system.
   *
   * THE ORDER IS TOTAL — received day, then entry instant, then the id, which is
   * a uuidv7 — so a payment cannot appear on two pages or on neither.
   *
   * `includeVoided` NARROWS THIS LIST AND NOTHING ELSE. The totals above were
   * taken without it.
   *
   * `paymentStatus` DERIVES THE WORD, so a row says `VOIDED` through the one
   * derivation every payment read uses rather than through a second reading of
   * `voided_at`. `received_on` is carried as `::text` because the digits are the
   * value, and the amount as a decimal string because a Toman value above 2^53 is
   * storable and is not representable as a JSON number.
   */
  private async rows(
    tx: Prisma.TransactionClient,
    filters: Prisma.Sql,
    query: PaymentReportExportQuery,
    window: ReportWindow | null,
  ): Promise<PaymentReportRow[]> {
    const visible = query.includeVoided ? Prisma.empty : Prisma.sql`AND p.voided_at IS NULL`;

    const rows = await tx.$queryRaw<ReportRow[]>`
      SELECT p.id, p.family_id, p.amount_toman,
             p.method::text AS method,
             p.received_on::text AS received_on,
             p.voided_at, p.created_at,
             f.family_name,
             u.id AS user_id, u.display_name
      FROM (
        SELECT id, family_id, amount_toman, method, received_on,
               voided_at, created_at, created_by_user_id
        FROM payment p
        WHERE ${filters} ${visible}
        ORDER BY ${PAYMENT_ORDER}
        ${windowClause(window)}
      ) p
      JOIN family f ON f.id = p.family_id
      JOIN app_user u ON u.id = p.created_by_user_id
      ORDER BY p.received_on DESC, p.created_at DESC, p.id DESC
    `;

    return rows.map((row) => ({
      id: row.id,
      family: { id: row.family_id, familyName: row.family_name },
      amountToman: row.amount_toman.toString(),
      method: row.method,
      receivedOn: row.received_on,
      status: paymentStatus(row),
      recordedAt: row.created_at.toISOString(),
      recordedBy: { id: row.user_id, displayName: row.display_name },
    }));
  }
}

/**
 * The confirmed money, the confirmed count and the reversals, over whatever the
 * caller narrows to.
 *
 * ONE FRAGMENT FOR THE PERIOD'S TOTALS AND FOR EACH USER'S SHARE OF IT, because
 * they are the same question asked of different groupings — which is what makes
 * it impossible for the two to disagree about what a void means, and what makes
 * the per-user rows add up to the period total by construction.
 */
const CONFIRMED_TOTALS_COLUMNS = Prisma.sql`
  count(*) FILTER (WHERE p.voided_at IS NULL)::int AS confirmed_count,
  coalesce(sum(p.amount_toman) FILTER (WHERE p.voided_at IS NULL), 0)::bigint AS confirmed_total,
  count(*) FILTER (WHERE p.voided_at IS NOT NULL)::int AS voided_count
`;

/**
 * The predicate the totals, both breakdowns and the page share.
 *
 * `includeVoided` IS DELIBERATELY NOT IN IT. It is the one part of the frozen
 * query that changes what is shown without changing what the clinic took in, so
 * it is applied to the list alone — exactly as it is on the family account.
 *
 * THE RANGE IS MANDATORY AND INCLUSIVE AT BOTH ENDS, compared against
 * `received_on` — the clinic business day the money ARRIVED. It is a `DATE`
 * rather than an instant, so inclusivity is two closed comparisons against the
 * plain column with no timezone arithmetic at all, and the comparison uses
 * `payment_received_on_idx` (C1). A payment back-dated to the start of the range
 * is inside it; a payment entered inside the range but received before it is
 * not, and reinterpreting either by entry time would make this report the
 * dashboard's reconciliation under a different name.
 *
 * THERE IS NO MAXIMUM SPAN (frozen C1). The schema's only range rule — a range
 * may not end before it starts — has already been enforced by the time this
 * runs.
 *
 * EVERY OTHER FILTER IS AN OPAQUE ID OR A CLOSED ENUM. `recordedByUserId` is an
 * id and never a username or a display name, which are personal data and would
 * put a colleague's name in a query string, a browser history and every access
 * log. No free text of any kind reaches this query.
 */
function paymentFilters(query: PaymentReportExportQuery): Prisma.Sql {
  const filters: Prisma.Sql[] = [
    Prisma.sql`p.received_on >= ${query.from}::date`,
    Prisma.sql`p.received_on <= ${query.to}::date`,
  ];

  if (query.familyId !== undefined) {
    filters.push(Prisma.sql`p.family_id = ${query.familyId}::uuid`);
  }
  if (query.method !== undefined) {
    filters.push(Prisma.sql`p.method = ${query.method}::payment_method`);
  }
  if (query.recordedByUserId !== undefined) {
    filters.push(Prisma.sql`p.created_by_user_id = ${query.recordedByUserId}::uuid`);
  }

  return Prisma.join(filters, ' AND ');
}
