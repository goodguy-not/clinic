import { Prisma } from '@prisma/client';
import type { FamilyFinancialPosition, PaymentSummary, RecordStatus } from '@clinic/contracts';
import {
  PAYMENT_ORDER,
  PAYMENT_SUMMARY_COLUMNS,
  PAYMENT_TOTALS_COLUMNS,
  toPaymentSummary,
  type PaymentSummaryRow,
} from '../payments/payment-detail';
import { PROMISE_COUNT_COLUMNS } from '../payments/promise-detail';
import { CHARGE_TOTALS_COLUMNS, CHARGE_TOTALS_SOURCE, type LedgerClient } from './charge-detail';

/**
 * WHERE A FAMILY STANDS — THE ONE DERIVATION, FOR ONE FAMILY OR FOR MANY.
 *
 * WHY THIS FILE EXISTS. Milestone 6 froze `familyFinancialPosition` and
 * `FamilyAccountService` derived it for the one family a receptionist had open.
 * Milestone 7 C4 asks the SAME question of every family at once, and the obvious
 * implementation — a reporting service with its own charges-minus-payments SQL —
 * would be a SECOND definition of "what does this family owe?". The two would
 * agree on the day they were written and would drift the first time one of them
 * was corrected, and the drift would be discovered by a family quoted two
 * different balances by two screens of one system.
 *
 * SO THE DERIVATION MOVED HERE AND NEITHER CALLER OWNS IT. `GET
 * /families/:id/account` asks for one family and `GET /reports/family-accounts`
 * asks for a page of them; both run `FAMILY_POSITION_PARTS`, both map the answer
 * with `toFamilyPosition`, and the reconciliation between them is a property of
 * there being one implementation rather than a fact a test happens to confirm.
 * The test confirms it anyway, because "there is only one of these" is exactly
 * the kind of claim that stops being true quietly.
 *
 * THE ARITHMETIC IS IN SQL, ONCE, AND NOT IN TYPESCRIPT AT ALL. `net_charged`,
 * `amount_due` and `credit` are computed by the statement below and carried out
 * of it; `toFamilyPosition` renames columns and stringifies bigints and performs
 * no subtraction. That is deliberate: the clinic-wide report has to ORDER and
 * FILTER families by what they owe, which PostgreSQL must do to page correctly,
 * so the amounts had to exist in SQL regardless — and computing them a second
 * time in Node afterwards would be the drift this file was written to prevent.
 *
 * EVERY PREDICATE IS BORROWED, NOT RESTATED. `CHARGE_TOTALS_COLUMNS` and
 * `CHARGE_TOTALS_SOURCE` are the ledger's own statement of which charges count
 * and which concessions reduce them; `PAYMENT_TOTALS_COLUMNS` is the payments
 * module's statement of "a voided payment counts for nothing";
 * `PROMISE_COUNT_COLUMNS` is its statement of the derived `MISSED`; and
 * `PAYMENT_ORDER` with `voided_at IS NULL` is what "the last payment" has always
 * meant. Nothing in this file decides what a void means.
 *
 * NOTHING IS STORED AND NOTHING IS CACHED (DECISION_LOG, 2026-08-15 — Credit is
 * derived). There is no balance column, no reporting table, no rollup and no
 * materialised view; every number is read from `session_charge`,
 * `charge_adjustment`, `payment` and `payment_promise` on the request that asks
 * for it.
 *
 * WHAT THESE NUMBERS KNOW IS ONLY WHAT THIS SYSTEM HOLDS. There is no opening
 * balance and no pre-system paper debt anywhere in the statement below, because
 * no such row exists to read.
 */

/**
 * The parts a position is made of, per family, as PostgreSQL returns them.
 *
 * `family_name` and `family_status` ride along because the clinic-wide report
 * prints them, orders by the name and decides by the status which settled
 * families to list; the single-family account simply ignores them — one
 * statement is cheaper than a statement plus a join the other caller does not
 * need. The status selects nothing here and changes no amount.
 */
export type FamilyPositionPartsRow = {
  family_id: string;
  family_name: string;
  family_status: RecordStatus;
  net_charged_total: bigint;
  paid_total: bigint;
  amount_due_total: bigint;
  credit_total: bigint;
  payment_count: number;
  voided_payment_count: number;
  open_count: number;
  missed_count: number;
};

/**
 * EVERY FAMILY THE NARROWING MATCHES, WITH ITS WHOLE POSITION — ONE STATEMENT,
 * WHATEVER THE NUMBER OF FAMILIES.
 *
 * `narrowing` SELECTS FAMILIES AND NOTHING ELSE. It is written against the alias
 * `f` on `family`, and it is the only degree of freedom this fragment has: a
 * caller may choose WHICH families, never which of their charges or payments
 * count. That is the frozen Milestone 6 invariant — a position is whole-family,
 * always, and no `childId`, date bound or `includeVoided` narrows it — expressed
 * as something a caller cannot get wrong rather than as something they must
 * remember.
 *
 * THREE LATERALS, ONE PER TABLE, EACH AN UNGROUPED AGGREGATE. An ungrouped
 * aggregate returns exactly one row over an empty set, so a family with no
 * charges, no payments and no promises produces a fully zeroed position rather
 * than dropping out of the result — which is what makes "a family with no
 * activity" a row of zeroes on the report and not an absence. `JOIN LATERAL ...
 * ON TRUE` rather than a `LEFT JOIN` for exactly that reason: there is nothing
 * to be missing.
 *
 * THE ALIAS `p` IS ESTABLISHED TWICE, IN TWO SEPARATE SUBQUERIES, and that is
 * legal and deliberate: `PAYMENT_TOTALS_COLUMNS` and `PROMISE_COUNT_COLUMNS` are
 * both written for `p` by the modules that own those tables, and each lateral is
 * its own scope. Renaming either fragment here would be this file restating
 * somebody else's predicate.
 *
 * THE TWO AMOUNTS ARE UNSIGNED AND FLOORED AT ZERO, so at most one of them is
 * non-zero and the frozen refinement — a family owes money or is owed money,
 * never both — cannot be violated by any state of the tables. A prepayment, an
 * overpayment and a credit left standing after a later charge are all the same
 * subtraction; nothing is allocated and nothing is consumed, because there is
 * nothing stored to consume.
 *
 * NO PROMISE AMOUNT IS READ. A promise moves no money in any state (CLAUDE.md).
 */
export function familyPositionParts(narrowing: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    SELECT
      f.id AS family_id,
      f.family_name,
      f.status::text AS family_status,
      (charges.charged_total - charges.adjustment_total)::bigint AS net_charged_total,
      payments.paid_total,
      greatest(
        (charges.charged_total - charges.adjustment_total) - payments.paid_total, 0
      )::bigint AS amount_due_total,
      greatest(
        payments.paid_total - (charges.charged_total - charges.adjustment_total), 0
      )::bigint AS credit_total,
      payments.payment_count,
      payments.voided_payment_count,
      promises.open_count,
      promises.missed_count
    FROM family f
    JOIN LATERAL (
      SELECT ${CHARGE_TOTALS_COLUMNS}
      ${CHARGE_TOTALS_SOURCE}
      WHERE c.family_id = f.id
    ) charges ON TRUE
    JOIN LATERAL (
      SELECT ${PAYMENT_TOTALS_COLUMNS}
      FROM payment p
      WHERE p.family_id = f.id
    ) payments ON TRUE
    JOIN LATERAL (
      SELECT ${PROMISE_COUNT_COLUMNS}
      FROM payment_promise p
      WHERE p.family_id = f.id
    ) promises ON TRUE
    WHERE ${narrowing}
  `;
}

/** The parts for a known set of families, in no particular order. */
export async function readFamilyPositionParts(
  client: LedgerClient,
  familyIds: readonly string[],
): Promise<FamilyPositionPartsRow[]> {
  if (familyIds.length === 0) return [];

  return client.$queryRaw<FamilyPositionPartsRow[]>(
    familyPositionParts(Prisma.sql`f.id = ANY(${[...familyIds]}::uuid[])`),
  );
}

/**
 * THE MOST RECENT CONFIRMED PAYMENT OF EACH OF THESE FAMILIES.
 *
 * `voided_at IS NULL` IS THE POINT OF THIS STATEMENT. The frozen contract calls
 * this the most recent CONFIRMED payment, and a receptionist reads it to answer
 * "when did they last pay?" — so a payment recorded in error this morning and
 * withdrawn this afternoon must not be offered as the money that arrived. The
 * reversal is not hidden: it is counted in `voidedPaymentCount` and shown in full
 * by the payment history, which is where a correction belongs.
 *
 * `DISTINCT ON` RATHER THAN A `LIMIT 1` PER FAMILY, so a page of families costs
 * one statement instead of one per row. The leading `family_id` is required by
 * `DISTINCT ON`; `PAYMENT_ORDER` follows it unchanged, so "the latest payment" is
 * still the first confirmed row of that family's history and not a second
 * opinion about which row that is. The order is total — received day, then entry
 * instant, then id — so two payments received on one day resolve to the one
 * entered later rather than to whichever PostgreSQL returned first.
 *
 * A FAMILY THAT HAS NEVER PAID IS SIMPLY ABSENT, and the caller reads that as
 * the frozen `null`.
 */
export async function readLastPayments(
  client: LedgerClient,
  familyIds: readonly string[],
): Promise<Map<string, PaymentSummary>> {
  if (familyIds.length === 0) return new Map();

  const rows = await client.$queryRaw<(PaymentSummaryRow & { family_id: string })[]>`
    SELECT DISTINCT ON (family_id) family_id, ${PAYMENT_SUMMARY_COLUMNS}
    FROM payment
    WHERE family_id = ANY(${[...familyIds]}::uuid[]) AND voided_at IS NULL
    ORDER BY family_id, ${PAYMENT_ORDER}
  `;

  return new Map(rows.map((row) => [row.family_id, toPaymentSummary(row)]));
}

/**
 * The parts, as the frozen `familyFinancialPosition` carries them.
 *
 * A MAPPING AND NOT A CALCULATION. Every amount here was decided by PostgreSQL;
 * this function renames columns and turns `BIGINT` into the canonical decimal
 * string money crosses this boundary as, because an amount above 2^53 is
 * storable and is not representable as a JavaScript number.
 *
 * `toPaymentSummary` MAPS THE LAST PAYMENT, so its `status` is produced by the
 * one derivation every payment read in this system uses. Selected on
 * `voided_at IS NULL`, it is always `CONFIRMED` — derived, not asserted.
 */
export function toFamilyPosition(
  parts: FamilyPositionPartsRow,
  lastPayment: PaymentSummary | null,
): FamilyFinancialPosition {
  return {
    netChargedTotalToman: parts.net_charged_total.toString(),
    confirmedPaymentTotalToman: parts.paid_total.toString(),
    creditToman: parts.credit_total.toString(),
    amountDueToman: parts.amount_due_total.toString(),
    paymentCount: parts.payment_count,
    voidedPaymentCount: parts.voided_payment_count,
    lastPayment,
    openPromiseCount: parts.open_count,
    missedPromiseCount: parts.missed_count,
  };
}

/**
 * The whole position of one family, in two statements.
 *
 * WHAT `GET /families/:id/account` ANSWERS WITH, and the same two statements the
 * clinic-wide report runs over a page of families. The caller supplies the
 * transaction handle so both run inside its snapshot.
 *
 * A FAMILY WITH NO FINANCIAL HISTORY IS A ZEROED POSITION, NOT AN ERROR. The
 * caller has already established that the family exists — `FAMILY_NOT_FOUND` is
 * the account read's own precondition — and a family that has never been charged
 * and never paid genuinely stands at zero.
 */
export async function readFamilyPosition(
  client: LedgerClient,
  familyId: string,
): Promise<FamilyFinancialPosition> {
  const parts = await readFamilyPositionParts(client, [familyId]);
  const lastPayments = await readLastPayments(client, [familyId]);

  const row = parts[0];
  // Unreachable through the account read, whose caller has already asserted the
  // family exists; a zeroed position is still the honest answer to "what does a
  // family with no rows owe?".
  if (row === undefined) {
    return toFamilyPosition(
      {
        family_id: familyId,
        family_name: '',
        family_status: 'ACTIVE',
        net_charged_total: 0n,
        paid_total: 0n,
        amount_due_total: 0n,
        credit_total: 0n,
        payment_count: 0,
        voided_payment_count: 0,
        open_count: 0,
        missed_count: 0,
      },
      null,
    );
  }

  return toFamilyPosition(row, lastPayments.get(familyId) ?? null);
}
