import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PAYMENT_METHODS,
  type AppointmentView,
  type DashboardClinicCharges,
  type DashboardClinicPayments,
  type DashboardDataIssues,
  type DashboardMethodTotal,
  type DashboardPaymentEntry,
  type DashboardPromiseSummary,
  type DashboardQuery,
  type DashboardReconciliation,
  type DashboardResponse,
  type DashboardUserTotal,
  type PaymentMethod,
} from '@clinic/contracts';
import { AppointmentReadService } from '../appointments/appointment-read.service';
import type { ResolvedSession } from '../common/request-context';
import { findParticipantsWithValidCharge, readChargeTotals } from '../ledger/charge-detail';
import { toPaymentSummary, type PaymentSummaryRow } from '../payments/payment-detail';
import { PrismaService } from '../prisma/prisma.service';

/**
 * THE CLINIC DAY AT A GLANCE, DERIVED ON EVERY REQUEST AND STORED NOWHERE.
 *
 * The frozen `GET /dashboard` (Milestone 7, checkpoint C1), implemented in C2.
 * It creates no financial fact, writes no row — not even an audit row — and
 * takes no lock. Every count, sum and flag below is computed from rows
 * Milestones 4, 5 and 6 already own: there is no stored balance, no reporting
 * aggregate, no materialised view and no cached total anywhere behind it.
 *
 * IT REUSES THE AUTHORITATIVE READS RATHER THAN RESTATING THEM. This class holds
 * no second reading of anything the clinic already means:
 *
 *   * the appointment counts and the `MISSING` tariff verdict are
 *     `AppointmentReadService.day` — the same rows, the same
 *     `outcome_unresolved` SQL and the same `resolveTariffSql` — so the badge
 *     and the day view beneath it cannot disagree;
 *   * "does this seat carry money?" is `findParticipantsWithValidCharge`, the
 *     ledger's own `voided_at IS NULL` predicate;
 *   * "what is a day of charges worth?" is `readChargeTotals`, the same SQL the
 *     family account's totals and whole-family position are computed with;
 *   * a payment on the wire is `toPaymentSummary`, so `CONFIRMED` means here
 *     what it means on the payment a receptionist just recorded;
 *   * derived `MISSED` is `status = 'OPEN' AND due_on < clinic_date()`, written
 *     exactly as `FamilyAccountService` writes it.
 *
 * ONE DAY, ONE SNAPSHOT. `REPEATABLE READ`, for the reason the family account
 * takes one: this response is up to nine statements, and under `READ COMMITTED`
 * each would take its own. A payment voided between the reconciliation totals
 * and the entry list would produce one screen whose sums describe one database
 * and whose rows describe another — and a receptionist balancing a till against
 * it would be chasing a difference that never existed. It takes no locks and
 * blocks no writer: PostgreSQL MVCC means a concurrent void commits exactly as
 * it would otherwise and is simply not visible to a read that started before it.
 * Nothing is written inside the transaction, so it cannot itself abort.
 *
 * THE AUTHORITY DECISION IS MADE HERE, IN NESTJS, AND NOWHERE ELSE. Which
 * variant a caller receives is read off the session's resolved permissions, and
 * the clinic-wide statements are not merely hidden from a caller without
 * `report.read_financial` — THEY ARE NEVER RUN. An unauthorised caller's
 * clinic-wide totals and per-user attribution do not exist in this process to be
 * serialised by mistake, which is the runtime half of what the frozen
 * discriminated union makes structurally impossible on the wire.
 *
 * THE RECONCILIATION SCOPE IS THE AUTHENTICATED ACTOR'S AND IS NEVER TAKEN FROM
 * THE REQUEST. `dashboardQuery` carries a date and nothing else — it is a strict
 * object, so a caller that invents a `userId` is refused rather than obeyed —
 * and the id below comes from the session `SessionGuard` resolved out of
 * PostgreSQL.
 */

/** The `payment` rows a clinic day's reconciliation is computed over. */
type PaymentTotalsRow = {
  confirmed_count: number;
  confirmed_total: bigint;
  voided_count: number;
};

type MethodTotalRow = { method: PaymentMethod; count: number; total_toman: bigint };

type UserTotalRow = PaymentTotalsRow & { user_id: string; display_name: string };

type EntryRow = PaymentSummaryRow & { family_id: string; family_name: string };

type PromiseCountsRow = { due_today_count: number; missed_count: number };

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appointments: AppointmentReadService,
  ) {}

  /**
   * One clinic day, in whichever of the two shapes the caller's authority
   * allows.
   *
   * ONE REQUEST, ONE DAY, ONE ANSWER (frozen C1). The dashboard is a single
   * aggregation NestJS performs rather than four reads a browser stitches
   * together — which is also the only way the badge and the list beneath it can
   * be guaranteed to agree.
   */
  async dashboard(query: DashboardQuery, session: ResolvedSession): Promise<DashboardResponse> {
    // Asked BEFORE the snapshot opens, deliberately. `clinic_date()` defaults to
    // `transaction_timestamp()`, which inside a transaction is the instant that
    // transaction began; asking first keeps "which day is it?" a question about
    // now. Either way the answer is fixed once and echoed on the response, so a
    // screen can always say which day it is showing.
    const date = query.date ?? (await this.clinicToday());

    return this.prisma.$transaction(
      async (tx) => {
        const day = await this.appointments.day({ date }, tx);

        const common = {
          date,
          // The existing day summary, reused rather than restated: one place
          // counts the total, the scheduled, the completed, the cancelled, the
          // unresolved outcomes and the no-shows for a clinic date.
          appointments: day.summary,
          promises: await this.promises(tx, date),
          dataIssues: await this.dataIssues(tx, day.appointments),
          reconciliation: await this.reconciliation(tx, date, session.userId),
        };

        if (!session.permissions.includes('report.read_financial')) {
          return { financialScope: 'OWN_ENTRIES_ONLY', ...common };
        }

        return {
          financialScope: 'CLINIC_WIDE',
          ...common,
          clinicFinancial: {
            payments: await this.clinicPayments(tx, date),
            charges: await this.clinicCharges(tx, date),
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /**
   * WHICH DAY THE CLINIC IS IN, ASKED OF POSTGRESQL.
   *
   * `date` is optional on the frozen query and the SERVER decides the default: a
   * receptionist opening the screen at 00:30 must see the day the clinic is in,
   * not the day their laptop's timezone is in. Tehran rolls over at 20:30 UTC,
   * so the host clock, the session timezone and UTC each disagree with the
   * clinic for three and a half hours of every day.
   *
   * `clinic_date()` is the same `STABLE` function the payment date rule and the
   * derived `MISSED` reading ask. It is read `::text` for the reason every
   * `DATE` in this system is: Prisma maps a PostgreSQL `DATE` onto a JavaScript
   * `Date` at UTC midnight, and every conversion back through a local timezone
   * is a chance for the day to move by one. The digits are the value.
   */
  private async clinicToday(): Promise<string> {
    const rows = await this.prisma.$queryRaw<{ today: string }[]>`
      SELECT clinic_date()::text AS today
    `;

    const row = rows[0];
    // Unreachable: a bare SELECT of one expression returns exactly one row.
    if (row === undefined) throw new Error('clinic_date() returned no row');

    return row.today;
  }

  /**
   * WHAT THE CLINIC HAS PROMISED ITSELF TO CHASE. Counted, never summed — a
   * promise moves no money in any state (CLAUDE.md), so no promise amount is
   * read anywhere in this file.
   *
   * THE TWO COUNTS ARE KEYED ON TWO DIFFERENT DAYS, AND THAT IS THE FROZEN
   * CONTRACT RATHER THAN AN INCONSISTENCY. `dueTodayCount` is the DASHBOARD's
   * day, because it is the work of the day being looked at. `missedCount` is
   * every open promise anywhere in the clinic whose due date is earlier than the
   * CLINIC's today — not the dashboard's day — because an overdue promise from
   * three weeks ago is still overdue this morning and is exactly what the screen
   * exists to surface.
   *
   * `MISSED` IS DERIVED AND IS NEVER STORED (DECISION_LOG, 2026-08-15 — A
   * promise is a calendar fact). The database enum has four values and the wire
   * has five; this is the same `status = 'OPEN' AND due_on < clinic_date()` the
   * family position counts with, not a second reading of it.
   *
   * TERMINAL PROMISES COUNT AS NEITHER. `FULFILLED`, `RESCHEDULED` and
   * `CANCELLED` are resolved, and a rescheduled promise's successor is a row of
   * its own counted on its own due date.
   */
  private async promises(
    tx: Prisma.TransactionClient,
    date: string,
  ): Promise<DashboardPromiseSummary> {
    const rows = await tx.$queryRaw<PromiseCountsRow[]>`
      SELECT
        count(*) FILTER (WHERE status = 'OPEN' AND due_on = ${date}::date)::int
          AS due_today_count,
        count(*) FILTER (WHERE status = 'OPEN' AND due_on < clinic_date())::int
          AS missed_count
      FROM payment_promise
    `;

    const row = rows[0] ?? { due_today_count: 0, missed_count: 0 };

    return { dueTodayCount: row.due_today_count, missedCount: row.missed_count };
  }

  /**
   * THE TWO DATA CONDITIONS, AND THEY ARE NOT ONE CONDITION COUNTED TWICE.
   *
   * A state can be in either, both or neither, and NOTHING SUMS THEM. A missing
   * price is a session that cannot be charged yet; an uncharged completed seat is
   * money the clinic has earned and not recorded. Recording the tariff clears the
   * first and leaves the second standing, because nothing re-posts
   * retrospectively; voiding a charge produces the second with no tariff ever
   * missing. Two problems, two fixes, two counts.
   *
   * THIS IS NOT A DATA-QUALITY SUBSYSTEM. Two counts over existing facts: no
   * severity, no category vocabulary, no rule engine, no stored issue record.
   *
   * BOTH ARE DERIVED FROM THE DAY THE DASHBOARD HAS ALREADY READ, which is what
   * makes them the facts the day view shows rather than a parallel
   * interpretation:
   *
   *   * `missingTariffCount` counts APPOINTMENTS whose tariff suggestion reads
   *     `MISSING` and which are not cancelled — literally the badge
   *     `/appointment-day` prints, resolved by `resolveTariffSql` against the
   *     appointment's own clinic date, therapist, service and duration. A
   *     cancelled session is excluded because it will never be priced.
   *   * `unchargedCompletedSessionCount` counts SEATS. The eligibility pair —
   *     appointment `COMPLETED` and attendance `ATTENDED` — is read off the same
   *     rows `ChargePostingService` establishes it from, and the one question
   *     those rows cannot answer, "does this seat carry a charge that has not
   *     been voided?", is asked of the ledger's own predicate in one statement.
   *
   * THE APPOINTMENT/SEAT DISTINCTION IS THE POINT OF COUNTING THEM SEPARATELY.
   * An individual appointment has exactly one participant, but nothing in
   * PostgreSQL constrains an appointment to one, and it is a SEAT that a re-post
   * fixes.
   */
  private async dataIssues(
    tx: Prisma.TransactionClient,
    appointments: readonly AppointmentView[],
  ): Promise<DashboardDataIssues> {
    const missingTariffCount = appointments.filter(
      (view) =>
        !view.appointment.status.startsWith('CANCELLED_') &&
        view.tariffSuggestion.status === 'MISSING',
    ).length;

    const chargeable = appointments
      .filter((view) => view.appointment.status === 'COMPLETED')
      .flatMap((view) => view.participants)
      .filter((seat) => seat.participant.attendance === 'ATTENDED')
      .map((seat) => seat.participant.id);

    const charged = await findParticipantsWithValidCharge(tx, chargeable);

    return {
      missingTariffCount,
      unchargedCompletedSessionCount: chargeable.filter((id) => !charged.has(id)).length,
    };
  }

  /**
   * THE CALLER'S OWN DAY AT THE COUNTER — the block that is scoped to the
   * authenticated actor in BOTH variants of the response.
   *
   * SCOPED BY `created_by_user_id`, TAKEN FROM THE SESSION. A manager reading the
   * dashboard sees their own entries here exactly as a receptionist does; what a
   * manager additionally receives is the clinic-wide block, under an authority of
   * its own. No request parameter can move this scope, and no other user's
   * payment row can reach this list.
   *
   * KEYED ON `PAYMENT_RECORDED_AT`, NOT ON `receivedOn`, AND THAT IS THE WHOLE
   * POINT OF THE BLOCK. It answers "what did I enter today?" — the question a
   * till is balanced against — so a payment received last Thursday and entered
   * this morning belongs to this morning's reconciliation. The payments report
   * answers "what did the clinic take in?" on the other basis, and neither is a
   * correction of the other.
   *
   * VOIDED ENTRIES ARE COUNTED SEPARATELY AND SUMMED NOWHERE. `confirmedTotal`
   * and `byMethod` count `voided_at IS NULL` only — voided money is money the
   * clinic says it never received — while `voidedCount` is stated beside them so
   * a reversal is visible without switching a filter. A payment entered today and
   * voided today is still one of this day's entries, and is counted as the void
   * it is.
   */
  private async reconciliation(
    tx: Prisma.TransactionClient,
    date: string,
    userId: string,
  ): Promise<DashboardReconciliation> {
    const scope = Prisma.sql`p.created_by_user_id = ${userId}::uuid AND ${recordedOn(date)}`;

    const totals = await this.paymentTotals(tx, scope);

    return {
      scope: 'RECORDED_BY_ME',
      dateBasis: 'PAYMENT_RECORDED_AT',
      confirmedCount: totals.confirmed_count,
      confirmedTotalToman: totals.confirmed_total.toString(),
      voidedCount: totals.voided_count,
      byMethod: await this.byMethod(tx, scope),
      entries: await this.entries(tx, scope),
    };
  }

  /**
   * THE CLINIC'S WHOLE DAY OF ENTRIES. Reached only by a caller holding
   * `report.read_financial`; for anybody else these statements never run.
   *
   * THE SAME BASIS AS EVERY USER'S OWN BLOCK, so the clinic total reconciles
   * against the sum of the individual tills rather than against a different day.
   *
   * `byUser` IS THE PER-USER FINANCIAL ATTRIBUTION the accepted Milestone 7 plan
   * keeps with the manager, and it is the reason this whole block sits behind an
   * authority of its own rather than behind `payment.read`, which a receptionist
   * holds.
   */
  private async clinicPayments(
    tx: Prisma.TransactionClient,
    date: string,
  ): Promise<DashboardClinicPayments> {
    const scope = recordedOn(date);

    const totals = await this.paymentTotals(tx, scope);

    return {
      dateBasis: 'PAYMENT_RECORDED_AT',
      confirmedCount: totals.confirmed_count,
      confirmedTotalToman: totals.confirmed_total.toString(),
      voidedCount: totals.voided_count,
      byMethod: await this.byMethod(tx, scope),
      byUser: await this.byUser(tx, scope),
    };
  }

  /**
   * WHAT THE CLINIC CHARGED FOR THE SESSIONS OF THIS DAY.
   *
   * KEYED ON `SESSION_DATE`, DELIBERATELY A DIFFERENT BASIS FROM THE PAYMENTS
   * BESIDE IT. A charge belongs to the session it prices and not to the day
   * somebody posted it, so a charge raised this morning for last Tuesday's
   * session sits in last Tuesday's figure. NOTHING HERE SUBTRACTS ONE FROM THE
   * OTHER: charged and received are different facts about different days, what a
   * family owes is the family account's answer, and no clinic-wide balance is
   * stated anywhere in Milestone 7.
   *
   * `netChargedTotalToman` IS `readChargeTotals`, the ledger's own arithmetic —
   * charges less the concessions still active against them, with voided charges
   * counting for nothing and voided adjustments reducing nothing. One meaning per
   * name, across every response in this system.
   *
   * NO THERAPIST SHARE AND NO SETTLEMENT. Nothing here reads a percentage or
   * splits a discount; a settlement rule not explicitly approved remains
   * unresolved (CLAUDE.md).
   *
   * `service_date` IS COMPARED AS A `DATE` AGAINST THE PLAIN COLUMN, which uses
   * `session_charge_service_date_idx` (C1). The charge already snapshotted the
   * clinic day of its session, so no timezone arithmetic is needed at all.
   */
  private async clinicCharges(
    tx: Prisma.TransactionClient,
    date: string,
  ): Promise<DashboardClinicCharges> {
    const totals = await readChargeTotals(tx, Prisma.sql`c.service_date = ${date}::date`);

    return {
      dateBasis: 'SESSION_DATE',
      chargeCount: totals.charge_count,
      netChargedTotalToman: (totals.charged_total - totals.adjustment_total).toString(),
      voidedChargeCount: totals.voided_charge_count,
    };
  }

  /**
   * The confirmed money, the confirmed count and the reversals, over whatever
   * `scope` narrows to.
   *
   * ONE STATEMENT FOR BOTH THE CALLER'S BLOCK AND THE CLINIC'S, because they are
   * the same question asked of different rows — which is what makes it
   * impossible for the two to disagree about what a void means.
   * `FILTER (WHERE voided_at IS NULL)` is the whole of "a voided payment counts
   * for nothing", the same predicate the family position sums with: a void is an
   * absence from the total rather than an entry against it.
   *
   * Summed in `BIGINT` and carried out as a decimal string, because an amount
   * above 2^53 is storable and is not representable as a JavaScript number. The
   * counts are cast to `int` because they are row counts, not money.
   */
  private async paymentTotals(
    tx: Prisma.TransactionClient,
    scope: Prisma.Sql,
  ): Promise<PaymentTotalsRow> {
    const rows = await tx.$queryRaw<PaymentTotalsRow[]>`
      SELECT
        count(*) FILTER (WHERE p.voided_at IS NULL)::int AS confirmed_count,
        coalesce(sum(p.amount_toman) FILTER (WHERE p.voided_at IS NULL), 0)::bigint
          AS confirmed_total,
        count(*) FILTER (WHERE p.voided_at IS NOT NULL)::int AS voided_count
      FROM payment p
      WHERE ${scope}
    `;

    return rows[0] ?? { confirmed_count: 0, confirmed_total: 0n, voided_count: 0 };
  }

  /**
   * ALWAYS ALL THREE METHODS, IN `PAYMENT_METHODS` ORDER, ZERO-FILLED.
   *
   * A method with no payments is a zero row rather than an absent one, so a
   * reconciliation screen has the same three lines every day and a reader
   * counting the cash drawer never has to notice that "cash" is missing rather
   * than empty. The zero-filling is done in TypeScript rather than with a
   * `LEFT JOIN unnest(...)` because the order on the wire is the contract's own
   * `PAYMENT_METHODS` order, not PostgreSQL's enum order — one list, and it is
   * the one the web tier renders from.
   *
   * CONFIRMED ONLY. The voided entries are counted once, in `voidedCount`, and
   * appear in no per-method sum: a drawer is balanced against the money that
   * stands.
   */
  private async byMethod(
    tx: Prisma.TransactionClient,
    scope: Prisma.Sql,
  ): Promise<DashboardMethodTotal[]> {
    const rows = await tx.$queryRaw<MethodTotalRow[]>`
      SELECT p.method::text AS method,
             count(*)::int AS count,
             coalesce(sum(p.amount_toman), 0)::bigint AS total_toman
      FROM payment p
      WHERE ${scope} AND p.voided_at IS NULL
      GROUP BY p.method
    `;

    return PAYMENT_METHODS.map((method) => {
      const row = rows.find((candidate) => candidate.method === method);

      return {
        method,
        count: row?.count ?? 0,
        totalToman: (row?.total_toman ?? 0n).toString(),
      };
    });
  }

  /**
   * The caller's own entries, confirmed and voided, each saying which it is.
   *
   * UNPAGED, DELIBERATELY (frozen C1). It is one person's entries on one day —
   * bounded by how many payments a human can take at a counter — and paging a
   * reconciliation list would let somebody balance a till against page one.
   *
   * ORDERED BY THE INSTANT THEY WERE ENTERED, ASCENDING, WITH THE ID SETTLING
   * TIES. This block is keyed on `PAYMENT_RECORDED_AT`, so its list reads in the
   * order the work was done, which is the order a person retraces when a till
   * does not balance. It is deliberately NOT `PAYMENT_ORDER`: that order leads
   * with `received_on` because every other payment read is a family's history
   * keyed on the day the money arrived, and using it here would sort one day's
   * entries by a column that has nothing to do with the day being reconciled.
   * The id is a uuidv7, so the last tie-break is still creation order.
   *
   * THE FAMILY IS NAMED SO THE ENTRY CAN BE RECOGNISED, and it is
   * `reportFamilySummary` — an id and a name, with no guardian, mobile, landline
   * or address. A reconciliation list is a page that gets printed and left on a
   * desk.
   *
   * `toPaymentSummary` MAPS THE ROW, so `status` is produced by the one
   * derivation every payment read in this system uses rather than by a second
   * reading of `voided_at`.
   */
  private async entries(
    tx: Prisma.TransactionClient,
    scope: Prisma.Sql,
  ): Promise<DashboardPaymentEntry[]> {
    const rows = await tx.$queryRaw<EntryRow[]>`
      SELECT p.id, p.amount_toman, p.method::text AS method,
             p.received_on::text AS received_on, p.voided_at,
             f.id AS family_id, f.family_name
      FROM payment p
      JOIN family f ON f.id = p.family_id
      WHERE ${scope}
      ORDER BY p.created_at ASC, p.id ASC
    `;

    return rows.map((row) => ({
      payment: toPaymentSummary(row),
      family: { id: row.family_id, familyName: row.family_name },
    }));
  }

  /**
   * WHO ENTERED THE CLINIC'S MONEY ON THIS DAY. Manager-only, and reached only
   * from the clinic-wide block.
   *
   * EVERY USER WHO RECORDED A PAYMENT ON THIS DAY APPEARS, including one whose
   * entries were all voided: that row is a zero `confirmedCount` beside a
   * `voidedCount`, which is precisely the attribution a manager is looking for. A
   * user who recorded nothing does not appear, because there is nothing to
   * attribute to them — the list is the day's entries grouped, not a staff
   * directory.
   *
   * `reportUserSummary` IS THE DISPLAY NAME AND THE ID, with no username, role or
   * account state: a report says who took the money, not who they are in the user
   * administration surface.
   *
   * ORDERED BY DISPLAY NAME WITH THE ID SETTLING TIES, so two users sharing a
   * display name never swap places between two identical requests.
   */
  private async byUser(
    tx: Prisma.TransactionClient,
    scope: Prisma.Sql,
  ): Promise<DashboardUserTotal[]> {
    const rows = await tx.$queryRaw<UserTotalRow[]>`
      SELECT u.id AS user_id, u.display_name,
             count(*) FILTER (WHERE p.voided_at IS NULL)::int AS confirmed_count,
             coalesce(sum(p.amount_toman) FILTER (WHERE p.voided_at IS NULL), 0)::bigint
               AS confirmed_total,
             count(*) FILTER (WHERE p.voided_at IS NOT NULL)::int AS voided_count
      FROM payment p
      JOIN app_user u ON u.id = p.created_by_user_id
      WHERE ${scope}
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
}

/**
 * THE CLINIC DAY A PAYMENT WAS ENTERED ON, AS A HALF-OPEN INSTANT RANGE.
 *
 * Written once and used by the caller's own block and by the clinic's, so the
 * two can never key on different instants. `clinic_day_start` keeps
 * `Asia/Tehran` written in the database beside `clinic_date`, and the half-open
 * `[)` bound is the one every range in this system uses: midnight belongs to the
 * day that starts, so a payment entered at exactly 00:00 is counted once.
 *
 * A RANGE OVER THE PLAIN COLUMN, NOT `clinic_date(p.created_at) = $1`. The two
 * ask the same question, but this form uses `payment_created_at_idx` (C1) while
 * the function form is applied per row and reads every payment the clinic has
 * ever taken. `clinic_date` is `STABLE` rather than `IMMUTABLE` — timezone
 * definitions can change — so it may not appear in an index expression at all,
 * which is exactly why the question is asked from this side. It is the pattern
 * the Milestone 4 day view established.
 *
 * The column is qualified `p.` because one of the statements above joins
 * `app_user`, which has a `created_at` of its own; every payment statement here
 * aliases the table `p` so this one fragment fits all of them.
 */
function recordedOn(date: string): Prisma.Sql {
  return Prisma.sql`
    p.created_at >= clinic_day_start(${date}::date)
    AND p.created_at < clinic_day_start((${date}::date + 1))
  `;
}
