import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  RatedVia,
  SettlementStatementExceptions,
  SettlementStatementLine,
  SettlementStatementQuery,
  SettlementStatementResponse,
  SettlementStatementTotals,
  TariffPriceMode,
} from '@clinic/contracts';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * THE SETTLEMENT STATEMENT: what the currently valid recorded facts say one
 * therapist earned over one explicit range of clinic days.
 *
 * The frozen `settlementStatementResponseSchema` (Milestone 8, checkpoint C1),
 * implemented in C5. It is a READ. It writes no row, no aggregate, no audit
 * entry and no cached total, takes no lock, and stores nothing anywhere.
 *
 * ------------------------------------------------------------------------
 * IT REPORTS SNAPSHOTS AND NEVER RESOLVES A PERCENTAGE.
 *
 * Every money figure below is derived from three kinds of row that already
 * exist, and from nothing else:
 *
 *   * `session_settlement` — the APPLIED share, frozen onto the session when
 *     somebody rated it (C3). `applied_share_basis_points`,
 *     `base_amount_toman`, `therapist_gross_toman` and `clinic_gross_toman` are
 *     read off this row as stored. `therapist_share_rule` IS NOT JOINED IN THIS
 *     FILE AT ALL, and `resolveShareRuleRow` is not imported: a statement that
 *     consulted today's configuration would restate last month's earnings the
 *     first time a rule was corrected, which is the single failure this
 *     milestone exists to make impossible.
 *   * `session_charge` — which sessions still count. A voided charge carries no
 *     current settlement value, so it drops out of every figure here while its
 *     rating stays in the table exactly as it was written.
 *   * `charge_adjustment` — the family's concessions and how each was allocated
 *     between the two sides (C4). Only ACTIVE rows reduce anything; withdrawing
 *     a concession gives the share back by the read, with no compensating row
 *     written anywhere.
 *
 * NO PAYMENT, PROMISE OR BALANCE IS READ. Settlement is based on
 * completed-session value and is independent of whether or when a family pays
 * (CLAUDE.md), so `payment`, `payment_promise` and every family position are
 * absent from this file. Nothing here allocates a payment to a session, and
 * there is deliberately no way to ask this service which sessions have been paid
 * for.
 * ------------------------------------------------------------------------
 * THE IDENTITIES THIS FILE IS RESPONSIBLE FOR, per included session:
 *
 *     therapistNet = therapistGross - therapistDiscount     (never negative)
 *     clinicNet    = clinicGross    - clinicDiscount        (may be negative)
 *     therapistNet + clinicNet = base - totalDiscount
 *                              = the family's effective charge
 *
 * The third line holds because `charge_adjustment_split_chk` makes the two
 * portions of every concession sum to its amount, and
 * `session_settlement_split_chk` makes the two gross shares sum to the basis.
 * Neither identity is reconciled here — both are consequences of constraints the
 * database already enforces, and this service merely subtracts.
 *
 * THERAPIST NET IS NOT CLAMPED, IT IS UNCLAMPABLE.
 * `charge_adjustment_therapist_net_floor` refuses a therapist-borne portion that
 * would take the cumulative allocation past the applied gross, under a lock on
 * the parent charge, and `session_settlement_has_therapist_allocations` refuses
 * the withdrawal of a rating that still bears one. So the subtraction above
 * cannot go below zero, and a `Math.max(0, …)` here would hide a broken
 * invariant rather than uphold one.
 *
 * CLINIC NET IS SIGNED AND IS NEVER CLAMPED EITHER. A therapist who does not
 * participate in a concession leaves the clinic bearing all of it, and a
 * concession larger than the clinic's own gross share therefore makes the clinic
 * net negative. CLAUDE.md requires that subsidy to be VISIBLE, so it is reported
 * as the negative number it is, on the line and in the total.
 * ------------------------------------------------------------------------
 * WHAT THIS CHECKPOINT DOES NOT HAVE, AND THEREFORE DOES NOT INVENT.
 *
 * No settlement period exists in this database — no table, no row, no close —
 * and C5 does not create one. The frozen response carries fields that anticipate
 * C6, and each is answered with the truth about a system in which nothing has
 * ever been closed:
 *
 *   * `lineType` is `PRIMARY` on every line and `correctsSessionSettlementId` is
 *     null on every line. A `CORRECTION` line is by definition the delta of a
 *     rating corrected AFTER the period it belonged to had been CLOSED; with no
 *     closed period, no such line can exist. A rating corrected before any close
 *     is simply the standing rating of its own session, on its own day, and it
 *     appears as the `PRIMARY` line it is — the withdrawn rating it supersedes is
 *     history and is not a second line.
 *   * `correctionCount` is therefore always zero here, and no placeholder
 *     financial row is created to make the field look busy.
 *   * `settledToman` is `0`, because "settled" means "closed off in a period" and
 *     no period covers anything yet.
 *   * `earnedUnsettledToman` is the whole of `totals.therapistNetToman`, for the
 *     same reason, and `netSettlementToman` is the two together.
 *
 * When C6 lands, the first two stop being constants and the third keeps its
 * meaning unchanged. Nothing here has to be unwound to get there.
 */

/** One rated, still-valid session, and the active concessions standing against it. */
type StatementRow = {
  session_settlement_id: string;
  session_charge_id: string;
  service_date: string;
  service_id: string;
  service_name: string;
  duration_minutes: number;
  price_mode: TariffPriceMode;
  applied_share_basis_points: number;
  rated_via: RatedVia;
  base_amount_toman: bigint;
  therapist_gross_toman: bigint;
  clinic_gross_toman: bigint;
  therapist_discount_toman: bigint;
  clinic_discount_toman: bigint;
};

type TherapistRow = { id: string; full_name: string };

@Injectable()
export class SettlementStatementService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One therapist's statement over one range.
   *
   * ONE SNAPSHOT FOR THE LINES, THE TOTALS AND THE THREE EXCEPTION COUNTS.
   * `REPEATABLE READ`, for the reason the session report and the family account
   * take it: this response is four statements, and under `READ COMMITTED` a
   * charge voided or a session rated between them would produce lines describing
   * one database and exception counts describing another — a statement that does
   * not add up, produced from a database that always did. It takes no lock and
   * blocks no writer; a write that commits mid-read is simply the next refresh's
   * answer.
   *
   * AN EMPTY RANGE IS A SUCCESSFUL READ, as every ranged report's is: a fortnight
   * this therapist did nothing in returns `200`, no lines, zeroed totals and
   * zeroed exceptions. A therapist id that names nobody is a `404`, because the
   * response has to state WHOSE statement it is and there is no honest name to
   * put on it.
   *
   * IT IS NOT PAGED (frozen C1). A therapist's month is read against its own
   * total, and a page two would hide the comparison the reader came for.
   */
  async statement(query: SettlementStatementQuery): Promise<SettlementStatementResponse> {
    return this.prisma.$transaction(
      async (tx) => {
        const therapist = await this.therapist(tx, query.therapistId);
        const rows = await this.rows(tx, query);
        const lines = rows.map(toLine);

        return {
          range: { from: query.from, to: query.to, dateBasis: 'SESSION_DATE' as const },
          therapist,
          lines,
          totals: totalsOf(lines),
          exceptions: await this.exceptions(tx, query, rows),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /**
   * WHOSE STATEMENT THIS IS — read inside the snapshot, and by id alone.
   *
   * NOTHING FILTERS ON `therapist.status`. A therapist who has left the clinic
   * earned what they earned, and a statement for the month they worked their
   * notice is exactly the document somebody needs after they go; refusing it
   * would make a departed colleague's settlement unreadable at the moment it
   * matters most. The same reasoning `ShareRulesService.lockTherapist` records.
   *
   * NO LOCK IS TAKEN. This decides nothing and writes nothing; a `FOR SHARE`
   * here would block a rename for the length of a report.
   */
  private async therapist(
    tx: Prisma.TransactionClient,
    therapistId: string,
  ): Promise<{ id: string; fullName: string }> {
    const rows = await tx.$queryRaw<TherapistRow[]>`
      SELECT id, full_name FROM therapist WHERE id = ${therapistId}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('THERAPIST_NOT_FOUND');

    return { id: row.id, fullName: row.full_name };
  }

  /**
   * EVERY SESSION THAT COUNTS, AND THE TEST OF "COUNTS" IS TWO `voided_at IS
   * NULL`s AND NOTHING ELSE.
   *
   *   * `ss.voided_at IS NULL` — the APPLIED rating that stands today. Withdrawn
   *     ratings stay in the table as the record of what was applied while they
   *     stood, and a statement asks what the facts say NOW.
   *   * `c.voided_at IS NULL` — the charge still stands. A withdrawn charge is a
   *     session the clinic has taken back; it carries no current settlement
   *     value, and its rating is left untouched rather than rewritten.
   *
   * `session_settlement_one_valid_per_charge_uq` makes the first predicate yield
   * at most one row per charge, so no `DISTINCT` and no de-duplication is needed
   * and a therapist cannot appear twice for one session.
   *
   * THE RANGE IS OVER `ss.service_date`, WHICH IS THE CHARGE'S OWN
   * `service_date`. It cannot be anything else: the composite foreign key
   * `session_settlement_charge_snapshot_fkey` includes both, so a rating whose
   * clinic day disagreed with its charge's is unrepresentable rather than merely
   * unlikely. Reading it from the rating is what lets
   * `session_settlement_therapist_id_service_date_idx` — exactly this pair —
   * answer the range, and `SESSION_DATE` is the basis the response echoes.
   *
   * BOTH ENDS ARE INCLUSIVE, spelled as a plain `BETWEEN` on a `DATE` column,
   * which is a closed interval over discrete days and needs no half-open instant
   * form. THERE IS NO MAXIMUM SPAN (`reports/common.ts`), and none is invented
   * here.
   *
   * THE ACTIVE CONCESSIONS ARE ONE LATERAL PER CHARGE rather than a join and a
   * `GROUP BY`: it keeps the two sums beside the row they reduce, and it returns
   * a zeroed pair for a session with no concessions instead of dropping the line.
   * `voided_at IS NULL` inside it is the same predicate
   * `sumActiveTherapistAllocations` and `enforce_charge_adjustment_bounds` use,
   * so what a withdrawn concession means cannot differ between the write path's
   * bound and this read.
   *
   * `price_mode` IS READ FROM THE CHARGE and never inferred from an amount. A
   * `FREE` session and a `PAID` session waived to nothing are different facts,
   * and telling them apart from `base_amount_toman = 0` would be a re-inference
   * of the one distinction `priceMode` exists to keep at source.
   *
   * THE SERVICE NAME IS THE CURRENT CATALOG ROW, as it is on every other report
   * in this system; the id is the fact.
   *
   * NO FAMILY, CHILD OR GUARDIAN IS SELECTED (frozen C1). A settlement statement
   * is about work and money between the clinic and one therapist, and the
   * arithmetic is checkable without a roster of children on it.
   *
   * THE ORDER IS TOTAL: the clinic day, then the charge id, which is a uuidv7 and
   * therefore breaks the tie by the order the charges were posted.
   */
  private async rows(
    tx: Prisma.TransactionClient,
    query: SettlementStatementQuery,
  ): Promise<StatementRow[]> {
    return tx.$queryRaw<StatementRow[]>`
      SELECT
        ss.id AS session_settlement_id,
        ss.session_charge_id,
        ss.service_date::text AS service_date,
        c.service_id,
        s.name AS service_name,
        c.duration_minutes,
        c.price_mode::text AS price_mode,
        ss.applied_share_basis_points,
        ss.rated_via::text AS rated_via,
        ss.base_amount_toman,
        ss.therapist_gross_toman,
        ss.clinic_gross_toman,
        active.therapist_discount_toman,
        active.clinic_discount_toman
      FROM session_settlement ss
      JOIN session_charge c ON c.id = ss.session_charge_id
      JOIN service s ON s.id = c.service_id
      JOIN LATERAL (
        SELECT
          coalesce(sum(a.therapist_discount_toman), 0)::bigint AS therapist_discount_toman,
          coalesce(sum(a.clinic_discount_toman), 0)::bigint AS clinic_discount_toman
        FROM charge_adjustment a
        WHERE a.session_charge_id = c.id AND a.voided_at IS NULL
      ) active ON TRUE
      WHERE ss.therapist_id = ${query.therapistId}::uuid
        AND ss.voided_at IS NULL
        AND c.voided_at IS NULL
        AND ss.service_date BETWEEN ${query.from}::date AND ${query.to}::date
      ORDER BY ss.service_date ASC, ss.session_charge_id ASC
    `;
  }

  /**
   * THE THREE THINGS THE RANGE CONTAINED THAT NO MONEY TOTAL MOVED FOR — three
   * different facts, three different fixes, and deliberately three numbers.
   *
   * THEY ARE NEVER SUMMED INTO ONE ANOTHER OR INTO A "PROBLEM COUNT", and none
   * of them is folded into a zero amount. Folding an unrated session into the
   * money as a zero is the one confusion that quietly under-pays somebody: a
   * session nobody has decided the share for is not a session worth nothing.
   *
   *   * `unratedSessionCount` — a VALID charge in this range for this therapist
   *     with NO standing rating. There is a basis to settle from and nobody has
   *     decided the share; the fix is to rate it. A charge exists only for a
   *     completed, attended seat, so "charged" carries "completed and attended"
   *     with it and no second predicate re-states them.
   *   * `freeSessionCount` — how many of the LINES ABOVE came from a `FREE`
   *     tariff. These sessions ARE rated and ARE settled, at zero; they are
   *     counted rather than removed, which is what stops a reader from reading a
   *     page of zero lines as an error and what explains why `sessionCount` and
   *     the money do not track. Complimentary work is work.
   *   * `unchargedCompletedSessionCount` — a completed, attended seat carrying no
   *     valid charge at all, so there is no basis to settle from and nothing to
   *     rate. The fix is to post the charge. It is the same fact the Milestone 7
   *     dashboard names.
   *
   * A SESSION IS COUNTED IN AT MOST ONE OF THEM. An uncharged seat has no charge
   * and therefore cannot be unrated, which is a statement about a charge; a free
   * session is rated and therefore is not unrated either. The three can be read
   * side by side without a reader wondering whether they overlap.
   *
   * THE FREE COUNT IS TAKEN FROM THE ROWS ALREADY READ rather than by a fourth
   * statement, so it cannot describe a different set from the lines it explains.
   */
  private async exceptions(
    tx: Prisma.TransactionClient,
    query: SettlementStatementQuery,
    rows: readonly StatementRow[],
  ): Promise<SettlementStatementExceptions> {
    return {
      unratedSessionCount: await this.unratedCount(tx, query),
      freeSessionCount: rows.filter((row) => row.price_mode === 'FREE').length,
      unchargedCompletedSessionCount: await this.unchargedCount(tx, query),
    };
  }

  /**
   * Valid charges in the range that no standing rating covers.
   *
   * `NOT EXISTS` OVER THE SAME PARTIAL-UNIQUE PREDICATE the lines are drawn from,
   * so "unrated" here is exactly "absent from the statement above for want of a
   * rating" and cannot drift from it. A charge whose only rating has been
   * withdrawn is unrated again, which is the truth: the withdrawal removed the
   * decision, and nobody has taken a new one.
   */
  private async unratedCount(
    tx: Prisma.TransactionClient,
    query: SettlementStatementQuery,
  ): Promise<number> {
    const rows = await tx.$queryRaw<{ total: number }[]>`
      SELECT count(*)::int AS total
      FROM session_charge c
      WHERE c.therapist_id = ${query.therapistId}::uuid
        AND c.voided_at IS NULL
        AND c.service_date BETWEEN ${query.from}::date AND ${query.to}::date
        AND NOT EXISTS (
          SELECT 1 FROM session_settlement ss
          WHERE ss.session_charge_id = c.id AND ss.voided_at IS NULL
        )
    `;

    return rows[0]?.total ?? 0;
  }

  /**
   * Completed, attended seats in the range that carry no valid charge.
   *
   * THE ELIGIBILITY PAIR IS THE LEDGER'S OWN: an appointment `COMPLETED` and a
   * seat `ATTENDED` is what permits a primary session charge at all (CLAUDE.md),
   * and it is the same pair the dashboard counts this fact by.
   *
   * KEYED ON THE APPOINTMENT'S CLINIC DAY, because a seat with no charge has no
   * `service_date` to be keyed on — the charge is where that column lives. The
   * two agree by construction: a charge snapshots the clinic day of the session
   * it prices, so a seat that later gets charged moves from this count into the
   * lines above without changing day.
   *
   * A RANGE OVER `starts_at`, NOT `clinic_date(a.starts_at) BETWEEN …`. The
   * function form is applied per row and reads every appointment the clinic has
   * ever booked; `clinic_date` is `STABLE` and may not appear in an index
   * expression at all. Both ends stay inclusive by running to the start of the
   * day AFTER `to` — the pattern Milestone 4's day view established and every
   * ranged report since has used.
   *
   * `NOT EXISTS` OVER `findParticipantsWithValidCharge`'s PREDICATE — the same
   * `voided_at IS NULL` that `session_charge_one_valid_per_participant_uq` is
   * partial on — asked of a range instead of a day.
   */
  private async unchargedCount(
    tx: Prisma.TransactionClient,
    query: SettlementStatementQuery,
  ): Promise<number> {
    const rows = await tx.$queryRaw<{ total: number }[]>`
      SELECT count(*)::int AS total
      FROM appointment_participant ap
      JOIN appointment a ON a.id = ap.appointment_id
      WHERE a.therapist_id = ${query.therapistId}::uuid
        AND a.status = 'COMPLETED'
        AND ap.attendance = 'ATTENDED'
        AND a.starts_at >= clinic_day_start(${query.from}::date)
        AND a.starts_at < clinic_day_start((${query.to}::date + 1))
        AND NOT EXISTS (
          SELECT 1 FROM session_charge c
          WHERE c.appointment_participant_id = ap.id AND c.voided_at IS NULL
        )
    `;

    return rows[0]?.total ?? 0;
  }
}

/**
 * ONE ROW, AND THE ONLY PLACE IN THIS APPLICATION WHERE A SETTLEMENT NET IS
 * SUBTRACTED.
 *
 * The two gross figures and the applied percentage are copied from the snapshot
 * verbatim — not recomputed from `base × bp`, which `share-split.ts` did once
 * when the row was written and `session_settlement_split_chk` has re-checked in
 * SQL ever since. Recomputing them here would be a second answer to a question
 * that has one, and the second answer would be today's rounding rule applied to
 * a session somebody has already been shown.
 *
 * `bigint` END TO END, `toString()` AT THE WIRE. Every amount in this system
 * crosses as a canonical decimal string, unsigned except `clinicNetToman`, and
 * `bigint.toString()` produces exactly that form with no negative zero.
 */
function toLine(row: StatementRow): SettlementStatementLine {
  const therapistNet = row.therapist_gross_toman - row.therapist_discount_toman;
  const clinicNet = row.clinic_gross_toman - row.clinic_discount_toman;

  return {
    sessionSettlementId: row.session_settlement_id,
    sessionChargeId: row.session_charge_id,
    serviceDate: row.service_date,
    serviceId: row.service_id,
    serviceName: row.service_name,
    durationMinutes: row.duration_minutes,
    // PRE-C6, AND HONESTLY SO: no settlement period exists, so no line can be
    // the carried-in delta of one that was closed.
    lineType: 'PRIMARY',
    correctsSessionSettlementId: null,
    appliedShareBasisPoints: row.applied_share_basis_points,
    ratedVia: row.rated_via,
    baseAmountToman: row.base_amount_toman.toString(),
    therapistGrossToman: row.therapist_gross_toman.toString(),
    therapistDiscountToman: row.therapist_discount_toman.toString(),
    therapistNetToman: therapistNet.toString(),
    clinicGrossToman: row.clinic_gross_toman.toString(),
    clinicDiscountToman: row.clinic_discount_toman.toString(),
    clinicNetToman: clinicNet.toString(),
  };
}

/**
 * WHAT THE RANGE CAME TO — THE COLUMN SUM OF THE LINES THAT WERE RETURNED.
 *
 * ADDED UP FROM THOSE LINES, NOT BY A SECOND AGGREGATE STATEMENT. The frozen
 * contract has the backend state every total precisely so a browser never adds
 * money up; computing them from a separate `SELECT sum(…)` would let the two
 * describe different snapshots and would be the one number nobody notices
 * drifting. Summing the rows makes "the total is the sum of the lines" true by
 * construction rather than by test.
 *
 * SUMMED IN `bigint`. A month of sessions is nowhere near 2^53, but the day a
 * figure here is quietly wrong is the day somebody's earnings are quietly wrong,
 * and `number` is the only reason that could happen.
 *
 * THE THREE SETTLEMENT FIGURES, PRE-C6. Nothing has ever been closed, so every
 * line in this range is unsettled, `settledToman` is zero, and
 * `netSettlementToman` is the two together — which is `therapistNetToman`. They
 * are the accepted names and they are not a ledger: no `owed`, no `payable`, no
 * `due` and no `balance` appears here, because this milestone records nothing
 * that could ever decrease such a figure.
 *
 * `correctionCount` IS ZERO AND `sessionCount` IS THE NUMBER OF LINES, for the
 * same reason: every line is `PRIMARY` until a period can be closed.
 */
function totalsOf(lines: readonly SettlementStatementLine[]): SettlementStatementTotals {
  const sum = (pick: (line: SettlementStatementLine) => string): bigint =>
    lines.reduce((running, line) => running + BigInt(pick(line)), 0n);

  const therapistNet = sum((line) => line.therapistNetToman);

  return {
    sessionCount: lines.length,
    correctionCount: 0,
    baseAmountToman: sum((line) => line.baseAmountToman).toString(),
    therapistGrossToman: sum((line) => line.therapistGrossToman).toString(),
    therapistDiscountToman: sum((line) => line.therapistDiscountToman).toString(),
    therapistNetToman: therapistNet.toString(),
    clinicGrossToman: sum((line) => line.clinicGrossToman).toString(),
    clinicDiscountToman: sum((line) => line.clinicDiscountToman).toString(),
    clinicNetToman: sum((line) => line.clinicNetToman).toString(),
    earnedUnsettledToman: therapistNet.toString(),
    settledToman: '0',
    netSettlementToman: therapistNet.toString(),
  };
}
