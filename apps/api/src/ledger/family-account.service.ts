import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  FamilyAccountQuery,
  FamilyAccountResponse,
  FamilyAccountTotals,
  SessionChargeView,
} from '@clinic/contracts';
import { AppError } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import {
  CHARGE_COLUMNS,
  readChargeTotals,
  toChargeDetail,
  type AdjustmentRow,
  type ChargeRow,
  type LedgerClient,
} from './charge-detail';
import { readFamilyPosition } from './family-position';

/**
 * The family account: what one family was charged, for which child, and — from
 * Milestone 6 — where the family stands.
 *
 * TWO KINDS OF NUMBER LIVE IN ONE RESPONSE, AND CONFUSING THEM IS THE DEFECT
 * THIS FILE IS ORGANISED AGAINST. `totals` describes the CHARGE VIEW the query
 * asked for and moves when the reader narrows to one child or one month;
 * `position` answers "what does this family owe?" and is computed over EVERY
 * valid charge and EVERY confirmed payment of the family, whatever `childId`,
 * `from`, `to` or `includeVoided` say (frozen F1). They are derived by two
 * separate calls with two separate narrowings for exactly that reason, and the
 * filtered one is never reused as the whole-family one.
 *
 * A READ MODEL AND NOTHING ELSE. It takes no lock, writes no row and —
 * deliberately — writes no audit row either (see the controller). It is the
 * ledger's counterpart to `AppointmentReadService`, and the separation from the
 * classes that write is the same one: nothing here can become a financial
 * transition by accident. It DOES open a transaction, and only to pin a snapshot
 * (see `account`); it is the one read in this system whose statements must all
 * describe the same instant.
 *
 * THERE IS NO STORED BALANCE, NO CREDIT COLUMN AND NO CACHE. Every number below
 * is derived from the immutable rows of `session_charge`, `charge_adjustment`,
 * `payment` and `payment_promise` on each request (DECISION_LOG, 2026-08-15 —
 * Credit is derived). A maintained balance column is a second answer that drifts
 * from the ledger the first time a void, a concession or a payment is written by
 * a path that forgot to update it, and the ledger is the one that would be right.
 *
 * IT READS `payment` AND `payment_promise` AND WRITES NEITHER. `PaymentsModule`
 * owns those tables and keeps owning them; this is the same one-way, read-only
 * reach the ledger already has into `appointment`, `child` and `tariff`. What it
 * does NOT do is re-derive a payment: the summary mapping and the status
 * derivation are imported from `payment-detail.ts`, so `CONFIRMED` means the same
 * thing on the account as it does on the payment the receptionist just recorded.
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
 * A FIXED NUMBER OF STATEMENTS, NOT ONE PER ROW. One aggregate for the filtered
 * totals, one for the page and the names it prints, one for that page's
 * adjustments, and two more for the position: the family's parts, and its latest
 * payment. The alternative — resolving each charge's detail or each promise's
 * status individually — is an N+1 on the screen a receptionist opens for every
 * family that calls.
 *
 * THE POSITION IS NO LONGER DERIVED IN THIS FILE (Milestone 7, checkpoint C4).
 * It moved WHOLE to `family-position.ts` when the clinic-wide family-accounts
 * report needed the same answer for every family at once: two derivations of
 * "what does this family owe?" would agree on the day they were written and
 * drift the first time one of them was corrected, and the drift would be
 * discovered by a family quoted two different balances by two screens of one
 * system. Nothing about the frozen response changed.
 */

/** A charge row on the page, joined to the names an interface prints. */
type AccountRow = ChargeRow & {
  first_name: string;
  last_name: string;
  file_number: string;
  service_name: string;
  therapist_name: string;
};

@Injectable()
export class FamilyAccountService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * ONE ACCOUNT, ONE MOMENT.
   *
   * `REPEATABLE READ` AND NOTHING STRONGER. This read is six statements — the
   * family, the filtered totals, the page, its adjustments, and the two the
   * position is derived from — and under the default
   * `READ COMMITTED` each of them takes its OWN snapshot. A manager voiding a
   * charge in the millisecond between the totals and the page would produce a
   * single response in which the sums describe one database and the rows
   * describe another: a family shown three charges under a total that counted
   * four, with nothing on the screen to say why. For a diary that is a stale
   * row; for an account it is a number that cannot be reconciled, so the
   * response is assembled from one snapshot taken at the first statement and
   * held to the last.
   *
   * THE POSITION MAKES THAT REQUIREMENT SHARPER, NOT DIFFERENT. It is charges
   * MINUS payments, read in separate statements, so a payment committing between
   * the two would let one response state an amount due that follows from neither
   * the charges nor the payments beside it. A stale list is a row a reader
   * refreshes; a balance that does not follow from its own parts is a number a
   * family is quoted.
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
  async account(familyId: string, query: FamilyAccountQuery): Promise<FamilyAccountResponse> {
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

        // WHERE THE FAMILY STANDS: the whole family, always, and never the
        // filter. `childId`, `from`, `to` and `includeVoided` reach no statement
        // this call makes — `readFamilyPosition` takes a family id and admits no
        // other narrowing, so the frozen Milestone 6 distinction between a
        // filtered `totals` and a whole-family `position` is something a caller
        // cannot get wrong rather than something they must remember. It is the
        // same derivation `GET /reports/family-accounts` runs over every family
        // (C4), which is what makes the two reads reconcile by construction.
        const position = await readFamilyPosition(tx, familyId);

        return {
          familyId,
          totals,
          position,
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
   * THE SQL IS `readChargeTotals` AND LIVES IN `charge-detail.ts`. It moved
   * there when the Milestone 7 dashboard needed the same arithmetic over a
   * clinic day: "which charges count, and which concessions reduce them" has one
   * statement in this system, and this method is the mapping of its answer onto
   * the frozen family-account shape. The narrowing — everything except
   * `includeVoided`, which filters the list alone — is still this file's.
   *
   * `netChargedTotalToman` IS NOT A BALANCE. Nothing in this milestone has been
   * paid, so this says what was asked for and not what is owed (frozen F1).
   * It cannot go negative: each charge's effective amount is floored at zero by
   * `enforce_charge_adjustment_bounds`, so a sum of them is too.
   */
  private async totals(tx: LedgerClient, narrowing: Prisma.Sql): Promise<FamilyAccountTotals> {
    const row = await readChargeTotals(tx, narrowing);

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
