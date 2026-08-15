import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { FamilyAccountQuery, FamilyAccountTotals, SessionChargeView } from '@clinic/contracts';
import { AppError } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import type { LegacyFamilyAccountResponse } from './family-account-legacy';
import {
  CHARGE_COLUMNS,
  toChargeDetail,
  type AdjustmentRow,
  type ChargeRow,
  type LedgerClient,
} from './charge-detail';

/**
 * The family account: what one family was charged, and for which child.
 *
 * A READ MODEL AND NOTHING ELSE. It takes no lock, writes no row and —
 * deliberately — writes no audit row either (see the controller). It is the
 * ledger's counterpart to `AppointmentReadService`, and the separation from the
 * classes that write is the same one: nothing here can become a financial
 * transition by accident. It DOES open a transaction, and only to pin a snapshot
 * (see `account`); it is the one read in this system whose statements must all
 * describe the same instant.
 *
 * THERE IS NO STORED BALANCE AND NO CACHE. Every number below is derived from
 * the immutable rows of `session_charge` and `charge_adjustment` on each request.
 * A maintained balance column is a second answer that drifts from the ledger the
 * first time a void or a concession is written by a path that forgot to update
 * it, and the ledger is the one that would be right.
 *
 * THE TOTALS ARE NOT COMPUTED FROM THE PAGE. They are one aggregate statement
 * over every charge the filter matches, so turning the page cannot change what
 * the family was charged. `includeVoided` narrows the LIST and is not applied to
 * that statement at all: a voided charge is excluded from the totals whether or
 * not it is shown, which is what makes hiding it a display choice rather than a
 * financial one.
 *
 * WHAT COUNTS, ONCE, IN SQL:
 * - a charge counts if it is not voided;
 * - an adjustment reduces if it is not voided AND its parent charge is not
 *   voided — a concession against a charge with no current financial effect
 *   reduces nothing, because there is nothing left to reduce.
 * Both predicates are `voided_at IS NULL`, the same one `sumActiveAdjustments`
 * and `enforce_charge_adjustment_bounds` are written against.
 *
 * A FIXED NUMBER OF STATEMENTS, NOT ONE PER ROW. One aggregate for the totals,
 * one for the page and the names it prints, one for that page's adjustments. The
 * alternative — resolving each charge's detail individually — is an N+1 on the
 * screen a receptionist opens for every family that calls.
 */

/** A charge row on the page, joined to the names an interface prints. */
type AccountRow = ChargeRow & {
  first_name: string;
  last_name: string;
  file_number: string;
  service_name: string;
  therapist_name: string;
};

type TotalsRow = {
  charged_total: bigint;
  adjustment_total: bigint;
  charge_count: number;
  voided_charge_count: number;
};

@Injectable()
export class FamilyAccountService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * ONE ACCOUNT, ONE MOMENT.
   *
   * `REPEATABLE READ` AND NOTHING STRONGER. This read is four statements — the
   * family, the totals, the page, its adjustments — and under the default
   * `READ COMMITTED` each of them takes its OWN snapshot. A manager voiding a
   * charge in the millisecond between the totals and the page would produce a
   * single response in which the sums describe one database and the rows
   * describe another: a family shown three charges under a total that counted
   * four, with nothing on the screen to say why. For a diary that is a stale
   * row; for an account it is a number that cannot be reconciled, so the
   * response is assembled from one snapshot taken at the first statement and
   * held to the last.
   *
   * IT TAKES NO LOCKS AND BLOCKS NO WRITER. `REPEATABLE READ` in PostgreSQL is
   * MVCC: concurrent voids, concessions and posts commit exactly as they would
   * otherwise and are simply not visible to a read that started before them.
   * `SERIALIZABLE` would add predicate tracking and the possibility of a
   * `40001` serialisation failure on a read that decides nothing, and
   * `FOR SHARE` would make a screen refresh block a manager's correction. The
   * requirement is a coherent answer, not a quiet one.
   *
   * NOTHING IS WRITTEN INSIDE IT. No row, no audit fact, no lock — the
   * transaction exists only to pin the snapshot, and a read-only transaction
   * that writes nothing cannot itself abort.
   *
   * The `tx` handle is threaded through every statement deliberately: a helper
   * that reached for `this.prisma` would open a second connection with a second
   * snapshot and silently undo all of this.
   */
  async account(familyId: string, query: FamilyAccountQuery): Promise<LegacyFamilyAccountResponse> {
    return this.prisma.$transaction(
      async (tx) => {
        await this.assertFamilyExists(tx, familyId);

        // Everything except `includeVoided`, which is a filter on the list alone.
        const narrowing = accountFilters(familyId, query);

        const totals = await this.totals(tx, narrowing);

        // The number of rows the LIST shows, taken from the two counts the
        // aggregate already produced rather than from a second `COUNT(*)`. One
        // statement fewer against the same snapshot, and page metadata that
        // could not disagree with the totals beside it even if it were taken
        // separately.
        const total = query.includeVoided
          ? totals.chargeCount + totals.voidedChargeCount
          : totals.chargeCount;

        const offset = (query.page - 1) * query.pageSize;
        const charges = await this.page(tx, narrowing, query, offset);

        return {
          familyId,
          totals,
          charges,
          page: {
            page: query.page,
            pageSize: query.pageSize,
            total,
            // Stated by the server, not re-derived by every consumer from the
            // three numbers above it (frozen F1 `pageInfo`).
            hasMore: offset + charges.length < total,
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /**
   * A family that does not exist is 404, not an empty account.
   *
   * A DEACTIVATED FAMILY IS READ NORMALLY. Deactivation retires a record from the
   * working lists; it does not retract what was charged, and an operator asking
   * what a closed family owed has to be able to see it.
   */
  private async assertFamilyExists(tx: LedgerClient, familyId: string): Promise<void> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM family WHERE id = ${familyId}::uuid
    `;

    if (rows[0] === undefined) throw new AppError('FAMILY_NOT_FOUND');
  }

  /**
   * What the family was charged over the WHOLE filtered account.
   *
   * `FILTER (WHERE c.voided_at IS NULL)` on both sums is the whole of "a voided
   * charge contributes nothing": it removes the charge from `charged_total` and,
   * because the lateral total rides on the same row, removes every concession
   * against it from `adjustment_total` in the same breath. There is no second
   * rule to keep in step.
   *
   * The lateral sums only unvoided adjustments, so a withdrawn concession stays
   * in the history the page returns and reduces nothing here.
   *
   * `netChargedTotalToman` IS NOT A BALANCE. Nothing in this milestone has been
   * paid, so this says what was asked for and not what is owed (frozen F1).
   * It cannot go negative: each charge's effective amount is floored at zero by
   * `enforce_charge_adjustment_bounds`, so a sum of them is too.
   *
   * Counted and summed in `BIGINT`, carried out as decimal strings: an amount
   * above 2^53 is storable and is not representable as a JavaScript number. The
   * two COUNTs are cast to `int` because they are row counts, not money.
   */
  private async totals(tx: LedgerClient, narrowing: Prisma.Sql): Promise<FamilyAccountTotals> {
    const rows = await tx.$queryRaw<TotalsRow[]>`
      SELECT
        coalesce(sum(c.amount_toman) FILTER (WHERE c.voided_at IS NULL), 0)::bigint
          AS charged_total,
        coalesce(sum(active.total) FILTER (WHERE c.voided_at IS NULL), 0)::bigint
          AS adjustment_total,
        count(*) FILTER (WHERE c.voided_at IS NULL)::int AS charge_count,
        count(*) FILTER (WHERE c.voided_at IS NOT NULL)::int AS voided_charge_count
      FROM session_charge c
      JOIN LATERAL (
        SELECT coalesce(sum(a.amount_toman), 0)::bigint AS total
        FROM charge_adjustment a
        WHERE a.session_charge_id = c.id AND a.voided_at IS NULL
      ) active ON TRUE
      WHERE ${narrowing}
    `;

    const row = rows[0] ?? {
      charged_total: 0n,
      adjustment_total: 0n,
      charge_count: 0,
      voided_charge_count: 0,
    };

    return {
      chargedTotalToman: row.charged_total.toString(),
      adjustmentTotalToman: row.adjustment_total.toString(),
      netChargedTotalToman: (row.charged_total - row.adjustment_total).toString(),
      chargeCount: row.charge_count,
      voidedChargeCount: row.voided_charge_count,
    };
  }

  /**
   * One page of history, newest session first, with its whole adjustment history.
   *
   * THE PAGE IS TAKEN BEFORE THE JOINS. `LIMIT`/`OFFSET` sit in the subquery, so
   * the three name lookups touch the rows being returned and not the family's
   * whole history. `CHARGE_COLUMNS` is reused unchanged inside it, which is what
   * keeps `service_date` a text day and `price_mode` a text enum here exactly as
   * everywhere else in the ledger.
   *
   * THE ORDER IS DETERMINISTIC TO THE LAST TIE-BREAK. `service_date` is the day
   * the session happened and is what a reader scans for; two sessions on one day
   * are then ordered by when they were charged, and the id settles the rest. Any
   * looser order would let a row appear on two pages or on neither.
   *
   * THE NAMES COME FROM THE CURRENT CATALOG ROWS, resolved against the ids the
   * charge snapshotted (frozen F1). The money, the day and the length are the
   * snapshot; a renamed therapist prints under the new name and still points at
   * the same person.
   *
   * GROUP SESSIONS ARE NOT COLLAPSED. A row is one charge for one child, keyed by
   * `appointment_participant_id`, so an appointment with several seats shows
   * several rows and each one is attributed to the child who was treated.
   */
  private async page(
    tx: LedgerClient,
    narrowing: Prisma.Sql,
    query: FamilyAccountQuery,
    offset: number,
  ): Promise<SessionChargeView[]> {
    const visible = query.includeVoided ? Prisma.empty : Prisma.sql`AND c.voided_at IS NULL`;

    const rows = await tx.$queryRaw<AccountRow[]>`
      SELECT c.*,
             ch.first_name, ch.last_name, ch.file_number,
             s.name AS service_name,
             t.full_name AS therapist_name
      FROM (
        SELECT ${CHARGE_COLUMNS}
        FROM session_charge c
        WHERE ${narrowing} ${visible}
        ORDER BY c.service_date DESC, c.created_at DESC, c.id DESC
        LIMIT ${query.pageSize} OFFSET ${offset}
      ) c
      JOIN child ch ON ch.id = c.child_id
      JOIN service s ON s.id = c.service_id
      JOIN therapist t ON t.id = c.therapist_id
      ORDER BY c.service_date DESC, c.created_at DESC, c.id DESC
    `;

    if (rows.length === 0) return [];

    // One statement for the page's whole adjustment history, voided rows
    // included: `sessionChargeDetail` carries them as history and states the two
    // sums separately, precisely because the array cannot be summed naively.
    const adjustments = await tx.$queryRaw<AdjustmentRow[]>`
      SELECT id, session_charge_id, amount_toman,
             therapist_discount_toman, clinic_discount_toman, reason,
             created_at, created_by_user_id, voided_at, voided_by_user_id, void_reason
      FROM charge_adjustment
      WHERE session_charge_id = ANY(${rows.map((row) => row.id)}::uuid[])
      ORDER BY created_at ASC, id ASC
    `;

    return rows.map((row) => toView(row, adjustments));
  }
}

/**
 * The filter every statement here shares, `includeVoided` excepted.
 *
 * ONE FRAGMENT FOR THE TOTALS AND FOR THE LIST, so a filter can never narrow one
 * and not the other. `includeVoided` is deliberately not in it: it is the one
 * part of the frozen query that changes what is shown without changing what is
 * owed.
 *
 * THE DATE BOUNDS ARE INCLUSIVE AND COMPARE AGAINST `service_date` — the clinic
 * day the session happened, never the day the charge was entered, so a charge
 * posted late lands in the month of the session it priced (frozen F1).
 *
 * `childId` NARROWS AND DOES NOT AUTHORISE. A child of another family simply
 * matches nothing, because the family predicate stands beside it: the response is
 * an empty account rather than a 404 that would confirm the child exists.
 */
function accountFilters(familyId: string, query: FamilyAccountQuery): Prisma.Sql {
  const filters: Prisma.Sql[] = [Prisma.sql`c.family_id = ${familyId}::uuid`];

  if (query.childId !== undefined) {
    filters.push(Prisma.sql`c.child_id = ${query.childId}::uuid`);
  }
  if (query.from !== undefined) {
    filters.push(Prisma.sql`c.service_date >= ${query.from}::date`);
  }
  if (query.to !== undefined) {
    filters.push(Prisma.sql`c.service_date <= ${query.to}::date`);
  }

  return Prisma.join(filters, ' AND ');
}

/**
 * One row of the account.
 *
 * `toChargeDetail` is the function every ledger WRITE answers with, used here
 * unchanged. "What does this family owe for this session" therefore has one
 * implementation in this system: a screen that adjusts a charge and a screen that
 * lists it cannot print two different effective amounts.
 */
function toView(row: AccountRow, adjustments: readonly AdjustmentRow[]): SessionChargeView {
  return {
    charge: toChargeDetail(
      row,
      adjustments.filter((one) => one.session_charge_id === row.id),
    ),
    child: {
      id: row.child_id,
      firstName: row.first_name,
      lastName: row.last_name,
      fileNumber: row.file_number,
    },
    service: { id: row.service_id, name: row.service_name },
    therapist: { id: row.therapist_id, fullName: row.therapist_name },
  };
}
