import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  SettlementStatementExceptions,
  SettlementStatementExportQuery,
  SettlementStatementLine,
  SettlementStatementQuery,
  SettlementStatementResponse,
  SettlementStatementTotals,
} from '@clinic/contracts';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../prisma/prisma.service';
import { currentAmounts, readSettlementFacts, type SettlementFactRow } from '../settlement-facts';
import { exceptionRows, type SettlementStatementExportRow } from './settlement-export-columns';

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
 * WHAT CHECKPOINT C6 CHANGED HERE, AND WHAT IT DELIBERATELY DID NOT.
 *
 * Closed settlement periods now exist, so the three settlement figures stop
 * being constants. They keep their meanings exactly:
 *
 *   * `settledToman` — how much of this range a closed period already carries.
 *     Summed from the session's materialised `settlement_line` rows: its one
 *     `PRIMARY` plus every later `CORRECTION`.
 *   * `earnedUnsettledToman` — the rest, and it is signed. It is the movement no
 *     closed period carries yet, which is BOTH new work waiting for its first
 *     close AND corrections to work already closed. The two are separated by
 *     `pendingCorrectionToman`, which is a breakdown of this figure and not a
 *     third addend.
 *   * `netSettlementToman` — the two together, which is still
 *     `totals.therapistNetToman`: what this range came to.
 *
 * EVERY LINE IS STILL `PRIMARY` AND `correctsSessionSettlementId` IS STILL NULL,
 * AND THAT IS A DECISION RATHER THAN AN UNFINISHED FIELD. This read is keyed on
 * `SESSION_DATE` while a `CORRECTION` is a movement carried into a LATER PERIOD;
 * a correction to a session in this range is not work belonging to some other
 * range of days, it is a change to THIS session, and stating it as a second line
 * beside its own would report one session twice in one column. So a line states
 * the session's CURRENT authoritative position, and how much of it is closed is
 * stated ON THE LINE as `settledToman`. The materialised `CORRECTION` rows are
 * facts of the PERIOD that carried them and are summarised on the closed period
 * record, which is the period-keyed surface where a period-keyed fact belongs.
 *
 * A SESSION APPEARS IF IT CURRENTLY EARNS SOMETHING **OR** IF IT HAS EVER BEEN
 * SETTLED. The second half is new in C6. A session whose charge was withdrawn
 * after its period closed is worth nothing now — every money field on its line
 * is zero — but a closed period still carries it, and dropping the line would
 * hide the negative correction the next close has to make.
 *
 * THERE IS STILL NO SECOND CALCULATION. Both halves of every line come from
 * `settlement-facts.ts`, which is the same statement `SettlementCloseService`
 * materialises from; if the two ever disagreed, a correction would be written
 * for an amount nobody could account for.
 */

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
          totals: totalsOf(rows),
          exceptions: await this.exceptions(tx, query, rows),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /**
   * THE SAME STATEMENT, AS THE ROWS OF A FILE (Milestone 8, checkpoint C8).
   *
   * IT IS THE SCREEN'S OWN READ AND NOT A SECOND ONE. The same therapist check,
   * the same scope predicate, the same shared derivation, the same order, the
   * same `toLine` mapping — the statement read is not paged, so there is not
   * even a paging window to remove. Every money figure in the exported file is
   * therefore the figure the screen states, by construction rather than by test.
   *
   * IT TAKES THE TRANSACTION CLIENT rather than opening one, so the rows are read
   * in the same transaction that writes the export's audit row and the count in
   * that row is provably the count of the lines the caller received
   * (`reports/csv-export.ts`). The screen keeps its own `REPEATABLE READ`
   * transaction; the export's runner takes the same isolation level.
   *
   * THE EXCEPTION COUNTS ARE RETURNED TOO, AS ROWS OF THEIR OWN KIND, and they
   * come from `this.exceptions` — the screen's own counts, read inside the same
   * snapshot as the lines. A file is read months later beside no screen at all,
   * and a file of settlement lines alone would be read as COMPLETE by a manager
   * whose month contains sessions nobody has rated: the money would add up and
   * the sessions would simply not be there. So the file states what it excluded
   * (`settlement-export-columns.ts`), and it states it as a COUNT on a row that
   * carries no money — never as a zero-valued settlement row, which would say
   * somebody had decided the session was worth nothing.
   *
   * THE TOTALS ARE STILL NOT RETURNED. A CSV carries no totals row (the accepted
   * M7 rule): a total is a sum of the rows above it, which a spreadsheet does for
   * itself and which strands a row the moment somebody sorts the sheet. An
   * exception count is not a sum of anything in the file — it is a fact that
   * appears nowhere else in it.
   *
   * AN UNKNOWN THERAPIST IS STILL A `404`, AND STILL BEFORE THE AUDIT ROW. The
   * check runs first inside the transaction, so a failed export rolls back
   * without recording that data left the building.
   *
   * THIS SERVICE STILL WRITES NOTHING. The audit row belongs to the export
   * runner; nothing on this path takes a lock, stores a total or creates a
   * settlement fact.
   */
  async exportRows(
    tx: Prisma.TransactionClient,
    query: SettlementStatementExportQuery,
  ): Promise<SettlementStatementExportRow[]> {
    // Looked up ONCE, exactly as the screen looks it up, and copied onto every
    // row: a flat file has no header to state whose statement it is, and an
    // unknown therapist must still be the `404` the screen gives rather than an
    // empty file with a valid-looking name on it.
    const therapist = await this.therapist(tx, query.therapistId);
    const rows = await this.rows(tx, query);

    return [
      ...rows.map((row): SettlementStatementExportRow => ({
        kind: 'SETTLEMENT_LINE',
        therapist,
        line: toLine(row),
      })),
      // LAST, and always both: the sessions this range could not settle, counted
      // from the same snapshot the lines came from, so the file cannot describe
      // one state of the clinic in its rows and another in its exclusions.
      ...exceptionRows(therapist, await this.exceptions(tx, query, rows)),
    ];
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
   * EVERY SESSION THIS RANGE HAS TO ACCOUNT FOR, WHICH IS TWO SETS AND NOT ONE.
   *
   * The derivation itself lives in `settlement-facts.ts` and is shared with the
   * close, so "what is this session worth, and how much of it is closed?" has
   * one answer in this application. What this method states is the SCOPE:
   *
   *   * `service_date BETWEEN from AND to` — the range, on the rating's own
   *     clinic day, which is the charge's own by the composite foreign key
   *     `session_settlement_charge_snapshot_fkey`. Both ends inclusive, spelled
   *     as a plain `BETWEEN` on a `DATE` column, which is a closed interval over
   *     discrete days. THERE IS NO MAXIMUM SPAN (`reports/common.ts`).
   *   * `charge_voided = false OR primary_line_id IS NOT NULL` — a session still
   *     standing, OR one a closed period already carries. The first half is C5's
   *     rule unchanged: a withdrawn charge carries no current settlement value.
   *     The second is C6's addition, and it is why a voided charge no longer
   *     simply disappears — once a period has settled a session, the statement
   *     has to keep showing it so the pending negative correction is visible
   *     rather than silently absent.
   *
   * The rating predicate is inside the shared derivation and is unchanged:
   * `ss.voided_at IS NULL`, the same predicate
   * `session_settlement_one_valid_per_charge_uq` is partial on, so at most one
   * row comes back per charge and no de-duplication is needed.
   *
   * NO FAMILY, CHILD OR GUARDIAN IS SELECTED (frozen C1). A settlement statement
   * is about work and money between the clinic and one therapist, and the
   * arithmetic is checkable without a roster of children on it.
   */
  private async rows(
    tx: Prisma.TransactionClient,
    query: SettlementStatementQuery,
  ): Promise<SettlementFactRow[]> {
    return readSettlementFacts(
      tx,
      query.therapistId,
      Prisma.sql`
        fact.service_date::date BETWEEN ${query.from}::date AND ${query.to}::date
        AND (fact.charge_voided = false OR fact.primary_line_id IS NOT NULL)
      `,
    );
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
    rows: readonly SettlementFactRow[],
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
 * ONE ROW: what this session is worth now, and how much of that a closed period
 * already carries.
 *
 * THE TWO NETS ARE SUBTRACTED IN `settlement-facts.ts` AND NOWHERE ELSE, by the
 * one routine the close materialises from. The gross figures and the applied
 * percentage are copied from the C3 snapshot verbatim — not recomputed from
 * `base × bp`, which `share-split.ts` did once when the row was written and
 * `session_settlement_split_chk` has re-checked in SQL ever since. Recomputing
 * them here would be a second answer to a question that has one, and the second
 * answer would be today's rounding rule applied to a session somebody has
 * already been shown.
 *
 * A SESSION WHOSE CHARGE HAS BEEN WITHDRAWN SHOWS ZEROES AND A NON-ZERO
 * `settledToman`. That pair is the whole point of keeping the line: it says the
 * session is worth nothing now and that a closed period nevertheless carries
 * some of it, which is exactly the movement the next close will carry as a
 * negative `CORRECTION`.
 *
 * `lineType` IS `PRIMARY` AND `correctsSessionSettlementId` IS NULL, for the
 * reason set out in the file header: a correction to a session in this range is
 * a change to THIS session rather than work belonging to another range of days,
 * and stating it as a second line would report one session twice in one column.
 *
 * `bigint` END TO END, `toString()` AT THE WIRE. Every amount in this system
 * crosses as a canonical decimal string, and `bigint.toString()` produces
 * exactly that form with no negative zero.
 */
function toLine(row: SettlementFactRow): SettlementStatementLine {
  const current = currentAmounts(row);

  return {
    sessionSettlementId: row.session_settlement_id,
    sessionChargeId: row.session_charge_id,
    serviceDate: row.service_date,
    serviceId: row.service_id,
    serviceName: row.service_name,
    durationMinutes: row.duration_minutes,
    // The charge's own tariff price mode, carried through untouched. It is the
    // ONLY thing that makes a `FREE` session distinguishable from a priced one
    // discounted to nothing, both of which render as a row of zeroes.
    priceMode: row.price_mode,
    lineType: 'PRIMARY',
    correctsSessionSettlementId: null,
    appliedShareBasisPoints: row.applied_share_basis_points,
    ratedVia: row.rated_via,
    baseAmountToman: current.baseAmountToman.toString(),
    therapistGrossToman: current.therapistGrossToman.toString(),
    therapistDiscountToman: current.therapistDiscountToman.toString(),
    therapistNetToman: current.therapistNetToman.toString(),
    clinicGrossToman: current.clinicGrossToman.toString(),
    clinicDiscountToman: current.clinicDiscountToman.toString(),
    clinicNetToman: current.clinicNetToman.toString(),
    settledToman: row.settled_therapist_net_toman.toString(),
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
 * THE THREE SETTLEMENT FIGURES, AND THE ONE IDENTITY THAT TIES THEM:
 *
 *     settledToman         = Σ what closed periods already carry
 *     earnedUnsettledToman = netSettlementToman − settledToman
 *     netSettlementToman   = therapistNetToman = Σ what the sessions are worth now
 *
 * The middle line is a SUBTRACTION rather than a second sum, which is what makes
 * the three provably consistent: there is no arrangement of rows in which they
 * fail to add up, because two of them are defined from the third. It is signed,
 * and it goes negative for a range whose closed sessions have since lost value —
 * a charge withdrawn after its period closed is the ordinary way that happens.
 *
 * `pendingCorrectionToman` IS THE PART OF `earnedUnsettledToman` THAT BELONGS TO
 * SESSIONS ALREADY CLOSED, and the remainder is new work waiting for its first
 * close. A breakdown, not a third addend: the identity above is untouched.
 *
 * THEY ARE THE ACCEPTED NAMES AND THEY ARE NOT A LEDGER: no `owed`, no
 * `payable`, no `due` and no `balance` appears here, because this milestone
 * records nothing that could ever decrease such a figure.
 *
 * `correctionCount` COUNTS SESSIONS, NOT MOVEMENTS, so it reads against
 * `sessionCount`: how many sessions in this range have moved since a closed
 * period carried them, whether that movement has already been carried into a
 * later close or is still pending.
 */
function totalsOf(rows: readonly SettlementFactRow[]): SettlementStatementTotals {
  const lines = rows.map(toLine);

  const sum = (pick: (line: SettlementStatementLine) => string): bigint =>
    lines.reduce((running, line) => running + BigInt(pick(line)), 0n);

  const therapistNet = sum((line) => line.therapistNetToman);
  const settled = sum((line) => line.settledToman);

  const pendingCorrection = rows.reduce(
    (running, row) =>
      row.primary_line_id === null
        ? running
        : running + (currentAmounts(row).therapistNetToman - row.settled_therapist_net_toman),
    0n,
  );

  const correctionCount = rows.filter(
    (row) =>
      row.primary_line_id !== null &&
      (row.correction_line_count > 0 ||
        currentAmounts(row).therapistNetToman !== row.settled_therapist_net_toman),
  ).length;

  return {
    sessionCount: lines.length,
    correctionCount,
    baseAmountToman: sum((line) => line.baseAmountToman).toString(),
    therapistGrossToman: sum((line) => line.therapistGrossToman).toString(),
    therapistDiscountToman: sum((line) => line.therapistDiscountToman).toString(),
    therapistNetToman: therapistNet.toString(),
    clinicGrossToman: sum((line) => line.clinicGrossToman).toString(),
    clinicDiscountToman: sum((line) => line.clinicDiscountToman).toString(),
    clinicNetToman: sum((line) => line.clinicNetToman).toString(),
    earnedUnsettledToman: (therapistNet - settled).toString(),
    pendingCorrectionToman: pendingCorrection.toString(),
    settledToman: settled.toString(),
    netSettlementToman: therapistNet.toString(),
  };
}
