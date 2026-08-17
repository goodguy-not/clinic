import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PaymentPromise, PromiseListQuery, PromiseListResponse } from '@clinic/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { assertFamilyExists, type PaymentClient } from './payment-detail';
import {
  PROMISE_COLUMNS,
  PROMISE_FROM,
  PROMISE_ORDER,
  toPromise,
  type PromiseRow,
} from './promise-detail';

/**
 * A family's promises: what was said, and what became of each one.
 *
 * A READ MODEL AND NOTHING ELSE, separated from `PromisesService` for the reason
 * `PaymentHistoryService` is separated from the writes: nothing here takes a
 * lock, writes a row or records an audit fact, so nothing here can become a
 * financial transition by accident. NOTHING IS AUDITED — `audit_log` is
 * append-only and permanent, and copying a read into it would build a second,
 * undeletable store of what a family promised, growing with every screen
 * refresh. Audit records financial ACTS, and this route performs none.
 *
 * TERMINAL PROMISES STAY VISIBLE. There is no `includeResolved` flag and no
 * default that hides them: a fulfilled, rescheduled or cancelled promise is the
 * history the record exists for, and the whole point of preserving the
 * predecessor of a reschedule is that somebody can read it afterwards. The
 * status filter narrows on request; nothing narrows by default.
 *
 * THE FIVE WIRE STATUSES PARTITION A FAMILY'S PROMISES (frozen F1), which is what
 * makes `status` a filter rather than a flag. `MISSED` is asked for by name even
 * though PostgreSQL has no such value, and `OPEN` excludes the overdue ones — so
 * "how many are still on time?" is answerable without subtracting, and the two
 * counts on the family position are exactly these two filters.
 *
 * NO N+1 AND NO TOTALS BLOCK. The fulfilling payment and the predecessor of a
 * reschedule are joined in the page statement itself (`promise-detail.ts`), so a
 * page costs two statements whatever it contains; and there is no sum of promised
 * money anywhere, because a promise moves no money in any state (CLAUDE.md) and a
 * total here would be the second number people quote as the balance.
 */
@Injectable()
export class PromiseHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * ONE LIST, ONE MOMENT, ONE CLINIC DAY.
   *
   * `REPEATABLE READ`, EXACTLY AS THE PAYMENT HISTORY AND THE ACCOUNT READ ARE.
   * This is three statements — the family, the count, the page — and under the
   * default `READ COMMITTED` each takes its own snapshot, so a promise created
   * or resolved between the count and the page produces a response whose page
   * metadata describes one database and whose rows describe another.
   *
   * IT ALSO PINS `clinic_date()`, WHICH MATTERS MORE HERE THAN ANYWHERE ELSE.
   * That function is `STABLE` and reads `transaction_timestamp()`, so both
   * statements ask it inside one transaction and get one answer. Without the
   * transaction, a request crossing 00:00 in Tehran could count a promise as
   * `MISSED` and then list it as `OPEN` — a response that contradicts itself
   * about the one derivation this endpoint exists to make.
   *
   * It takes no lock and blocks no writer: a concurrent create or resolution
   * commits exactly as it would otherwise and is simply not visible to a read
   * that started before it.
   *
   * The `tx` handle is threaded through every statement deliberately: a helper
   * that reached for `this.prisma` would open a second connection with a second
   * snapshot and silently undo this.
   */
  async list(familyId: string, query: PromiseListQuery): Promise<PromiseListResponse> {
    return this.prisma.$transaction(
      async (tx) => {
        await assertFamilyExists(tx, familyId);

        const filters = historyFilters(familyId, query);

        const total = await this.count(tx, filters);
        const offset = (query.page - 1) * query.pageSize;
        const promises = await this.page(tx, filters, query, offset);

        return {
          familyId,
          promises,
          page: {
            page: query.page,
            pageSize: query.pageSize,
            total,
            // Stated by the server, not re-derived by every consumer from the
            // three numbers above it (frozen F1 `pageInfo`).
            hasMore: offset + promises.length < total,
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /**
   * How many rows this filter matches.
   *
   * IT COUNTS THE PROMISE TABLE ALONE, with no join: the fulfilling payment and
   * the predecessor cannot change how many promises a family has, and joining
   * them into a count would be work that answers nothing. The filter fragment is
   * written against the `p` alias so the count and the page can never narrow
   * differently.
   */
  private async count(tx: PaymentClient, filters: Prisma.Sql): Promise<number> {
    const rows = await tx.$queryRaw<{ total: number }[]>`
      SELECT count(*)::int AS total FROM payment_promise p WHERE ${filters}
    `;

    return rows[0]?.total ?? 0;
  }

  /**
   * One page: unresolved promises first, soonest due date first, then the history.
   *
   * `PROMISE_ORDER` IS TOTAL, so a promise cannot appear on two pages or on
   * neither, and `PROMISE_COLUMNS`/`PROMISE_FROM` are the same fragments every
   * promise write answers with — `MISSED` is therefore derived in exactly one
   * place in this system, and the promise a receptionist just created reads
   * identically here.
   */
  private async page(
    tx: PaymentClient,
    filters: Prisma.Sql,
    query: PromiseListQuery,
    offset: number,
  ): Promise<PaymentPromise[]> {
    const rows = await tx.$queryRaw<PromiseRow[]>`
      SELECT ${PROMISE_COLUMNS}
      ${PROMISE_FROM}
      WHERE ${filters}
      ORDER BY ${PROMISE_ORDER}
      LIMIT ${query.pageSize} OFFSET ${offset}
    `;

    return rows.map(toPromise);
  }
}

/**
 * The filter the count and the page share, so one can never narrow and not the
 * other.
 *
 * `status=MISSED` IS NOT A LOOKUP FOR A STORED VALUE — there is none. It is
 * "stored `OPEN`, and due before today at the clinic", and `status=OPEN` is the
 * complement of exactly that predicate over exactly the same rows. The two are
 * written here as one pair for that reason: stating them apart is how they drift
 * into overlapping or leaving a gap, and either would break the partition the
 * frozen contract promises.
 *
 * `clinic_date()` AND NOT THE NODE CLOCK, for the reason stated on the read model:
 * Tehran rolls over at 20:30 UTC, and a promise's overdueness is a fact about the
 * clinic's calendar rather than about the server's.
 *
 * THE OTHER THREE ARE PLAIN ENUM COMPARISONS. `FULFILLED`, `RESCHEDULED` and
 * `CANCELLED` are stored words, and a promise in one of them is terminal, so no
 * date enters the predicate.
 */
function historyFilters(familyId: string, query: PromiseListQuery): Prisma.Sql {
  const filters: Prisma.Sql[] = [Prisma.sql`p.family_id = ${familyId}::uuid`];

  if (query.status === 'OPEN') {
    filters.push(Prisma.sql`p.status = 'OPEN' AND p.due_on >= clinic_date()`);
  } else if (query.status === 'MISSED') {
    filters.push(Prisma.sql`p.status = 'OPEN' AND p.due_on < clinic_date()`);
  } else if (query.status !== undefined) {
    filters.push(Prisma.sql`p.status = ${query.status}::payment_promise_status`);
  }

  return Prisma.join(filters, ' AND ');
}
