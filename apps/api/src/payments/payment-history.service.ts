import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Payment, PaymentListQuery, PaymentListResponse } from '@clinic/contracts';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertFamilyExists,
  PAYMENT_COLUMNS,
  PAYMENT_ORDER,
  toPayment,
  type PaymentClient,
  type PaymentRow,
} from './payment-detail';

/**
 * A family's payment history: money in, as it was recorded.
 *
 * A READ MODEL AND NOTHING ELSE, separated from `PaymentsService` for the reason
 * `FamilyAccountService` is separated from the classes that write the ledger:
 * nothing here takes a lock, writes a row or records an audit fact, so nothing
 * here can become a financial transition by accident. Both classes read the same
 * `payment` table through the same mapping (`payment-detail.ts`), so a payment
 * cannot mean one thing on the write's response and another on the list.
 *
 * IT IS FAMILY-SCOPED, AND THAT IS THE WHOLE OF ITS SCOPE. A payment names no
 * charge, no session and no child (DECISION_LOG, 2026-08-15 — A payment is a
 * family fact), so there is no child filter and no session filter to offer: the
 * question "which of this child's sessions did this money pay for?" has no
 * answer in this system, and a filter that implied one would be inventing an
 * allocation nobody approved.
 *
 * NO TOTALS BLOCK (frozen F1). What the family has paid in total is a
 * whole-family number and lives on the account position, where this list's date
 * window does not narrow it. A filter-scoped payment total beside it would be
 * the second number people quote as the balance.
 *
 * VOIDED PAYMENTS ARE HISTORY AND ARE SHOWN BY DEFAULT. `includeVoided` narrows
 * the list and nothing else — there is no total here for it to change — which is
 * what makes hiding a reversal a display choice rather than a financial one.
 */
@Injectable()
export class PaymentHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * ONE HISTORY, ONE MOMENT.
   *
   * `REPEATABLE READ`, EXACTLY AS THE ACCOUNT READ IS. This is three statements
   * — the family, the count, the page — and under the default `READ COMMITTED`
   * each takes its own snapshot, so a payment recorded between the count and the
   * page produces a response whose page metadata describes one database and
   * whose rows describe another. It takes no lock and blocks no writer: a
   * concurrent record or void commits exactly as it would otherwise and is
   * simply not visible to a read that started before it.
   *
   * The `tx` handle is threaded through every statement deliberately: a helper
   * that reached for `this.prisma` would open a second connection with a second
   * snapshot and silently undo this.
   */
  async list(familyId: string, query: PaymentListQuery): Promise<PaymentListResponse> {
    return this.prisma.$transaction(
      async (tx) => {
        await assertFamilyExists(tx, familyId);

        const filters = historyFilters(familyId, query);

        const total = await this.count(tx, filters);
        const offset = (query.page - 1) * query.pageSize;
        const payments = await this.page(tx, filters, query, offset);

        return {
          familyId,
          payments,
          page: {
            page: query.page,
            pageSize: query.pageSize,
            total,
            // Stated by the server, not re-derived by every consumer from the
            // three numbers above it (frozen F1 `pageInfo`).
            hasMore: offset + payments.length < total,
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /**
   * How many rows this filter matches — the LIST's count, `includeVoided`
   * included.
   *
   * It counts what the reader is paging through, which is why the visibility
   * filter belongs in it here and deliberately does not on the account totals:
   * there the number is money and hiding a row must not change it, while this
   * one is page metadata and would be wrong if it counted rows the list will
   * never show.
   */
  private async count(tx: PaymentClient, filters: Prisma.Sql): Promise<number> {
    const rows = await tx.$queryRaw<{ total: number }[]>`
      SELECT count(*)::int AS total FROM payment WHERE ${filters}
    `;

    return rows[0]?.total ?? 0;
  }

  /**
   * One page of history, newest received day first.
   *
   * `PAYMENT_ORDER` IS SHARED WITH THE FAMILY POSITION'S LAST PAYMENT, so the
   * newest confirmed row on this list is the same row the position calls the
   * latest. It is total to the last tie-break — day, then entry instant, then id
   * — because any looser order would let a payment appear on two pages or on
   * neither.
   *
   * `toPayment` is the mapping every payment write answers with, used unchanged:
   * `status` is derived in one place in this system, so the row a receptionist
   * just recorded reads identically here.
   */
  private async page(
    tx: PaymentClient,
    filters: Prisma.Sql,
    query: PaymentListQuery,
    offset: number,
  ): Promise<Payment[]> {
    const rows = await tx.$queryRaw<PaymentRow[]>`
      SELECT ${PAYMENT_COLUMNS}
      FROM payment
      WHERE ${filters}
      ORDER BY ${PAYMENT_ORDER}
      LIMIT ${query.pageSize} OFFSET ${offset}
    `;

    return rows.map(toPayment);
  }
}

/**
 * The filter the count and the page share, so one can never narrow and not the
 * other.
 *
 * THE DATE BOUNDS ARE INCLUSIVE AND COMPARE AGAINST `received_on` — the clinic
 * day the money arrived, never the day it was entered (frozen F1) — so a
 * back-dated payment lands in the month it arrived in, exactly as a late-posted
 * charge lands in the month of the session it priced.
 *
 * `includeVoided` IS IN HERE, UNLIKE ON THE ACCOUNT. Both statements it feeds
 * describe the list; neither is money.
 */
function historyFilters(familyId: string, query: PaymentListQuery): Prisma.Sql {
  const filters: Prisma.Sql[] = [Prisma.sql`family_id = ${familyId}::uuid`];

  if (query.from !== undefined) filters.push(Prisma.sql`received_on >= ${query.from}::date`);
  if (query.to !== undefined) filters.push(Prisma.sql`received_on <= ${query.to}::date`);
  if (!query.includeVoided) filters.push(Prisma.sql`voided_at IS NULL`);

  return Prisma.join(filters, ' AND ');
}
