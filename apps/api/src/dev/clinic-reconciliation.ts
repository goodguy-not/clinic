import type { INestApplicationContext } from '@nestjs/common';
import {
  dashboardQuerySchema,
  familyAccountQuerySchema,
  familyAccountReportQuerySchema,
  paymentReportQuerySchema,
  promiseReportQuerySchema,
  sessionReportQuerySchema,
  settlementStatementQuerySchema,
} from '@clinic/contracts';
import { AvailabilityService } from '../availability/availability.service';
import type { ResolvedSession } from '../common/request-context';
import { FamilyAccountService } from '../ledger/family-account.service';
import { PrismaService } from '../prisma/prisma.service';
import { DashboardService } from '../reports/dashboard.service';
import { FamilyAccountReportService } from '../reports/family-account-report.service';
import { PaymentReportService } from '../reports/payment-report.service';
import { PromiseReportService } from '../reports/promise-report.service';
import { SessionReportService } from '../reports/session-report.service';
import { SettlementCloseService } from '../settlement/close/settlement-close.service';
import { SettlementStatementService } from '../settlement/statement/settlement-statement.service';
import type { BookCharge, ExpectedSettlementLine, SimulationBook } from './clinic-simulation';
import { addDays } from './synthetic-clinic';

/**
 * THE INDEPENDENT RECONCILIATION OF A SIMULATED CLINIC (Milestone 10, A5).
 *
 * THREE SOURCES, AND ONLY ONE OF THEM IS THE APPLICATION'S REPORT CODE.
 *
 *   1. THE BOOK — what `clinic-simulation.ts` intended, with every amount
 *      derived from its own price list and share rules. This is the expected
 *      side of every comparison.
 *   2. THE BASE ROWS — `session_charge`, `charge_adjustment`, `payment`,
 *      `payment_promise`, `session_settlement`, `settlement_line`, `audit_log`,
 *      read here with plain SELECTs that import no query from `src/`.
 *   3. THE APPLICATION'S ANSWERS — the family account, the family-account,
 *      payment and dashboard reports, the settlement statement and the closed
 *      period detail, exactly as a manager's screen receives them.
 *
 * Every figure must agree three ways. The model below re-derives the money
 * rules from CLAUDE.md and the frozen contracts — round-half-up on the
 * therapist's side, the clinic absorbing the remainder, concessions split by an
 * explicit therapist portion, a withdrawn charge worth nothing — and deliberately
 * imports nothing from `ledger/`, `settlement/` or `reports/` to compute them.
 *
 * A DISCREPANCY IS A STRING, NOT A THROW, so one run reports every disagreement
 * rather than the first; the caller decides that any is a failure.
 */

export type ReconciliationCheck = { name: string; compared: number; discrepancies: string[] };

export type ReconciliationReport = {
  checks: ReconciliationCheck[];
  discrepancyCount: number;
};

// ---------------------------------------------------------------------------
// The independent model
// ---------------------------------------------------------------------------

const BASIS = 10_000n;

const activeAdjustments = (charge: BookCharge) =>
  charge.adjustments.filter((adjustment) => !adjustment.voided);

/** What the family owes for one charge now: nothing if withdrawn. */
export function effectiveAmount(charge: BookCharge): bigint {
  if (charge.voided) return 0n;
  return (
    charge.expectedAmountToman -
    activeAdjustments(charge).reduce((sum, adjustment) => sum + adjustment.amountToman, 0n)
  );
}

/**
 * What one rated session is worth to each side now.
 *
 * therapistGross = round_half_up(base × bp / 10000); clinicGross = base − that.
 * A concession's therapist portion is as granted and the clinic bears the rest.
 * A withdrawn charge zeroes every figure. `undefined` for an unrated session —
 * which is the absence of a value, never zero.
 */
export function expectedSessionValue(charge: BookCharge): ExpectedSettlementLine | undefined {
  if (charge.rating === null) return undefined;
  const bp = BigInt(charge.rating.basisPoints);
  const base = charge.voided ? 0n : charge.expectedAmountToman;
  const therapistGross = (base * bp + BASIS / 2n) / BASIS;
  const clinicGross = base - therapistGross;
  const active = charge.voided ? [] : activeAdjustments(charge);
  const therapistDiscount = active.reduce((sum, one) => sum + one.therapistPortionToman, 0n);
  const clinicDiscount = active.reduce(
    (sum, one) => sum + one.amountToman - one.therapistPortionToman,
    0n,
  );

  return {
    sessionChargeId: charge.id,
    serviceDate: charge.serviceDate,
    basisPoints: charge.rating.basisPoints,
    baseAmountToman: base,
    therapistGrossToman: therapistGross,
    therapistDiscountToman: therapistDiscount,
    therapistNetToman: therapistGross - therapistDiscount,
    clinicGrossToman: clinicGross,
    clinicDiscountToman: clinicDiscount,
    clinicNetToman: clinicGross - clinicDiscount,
  };
}

function familyPosition(book: SimulationBook, familyId: string) {
  const charged = [...book.charges.values()]
    .filter((charge) => charge.familyId === familyId)
    .reduce((sum, charge) => sum + effectiveAmount(charge), 0n);
  const payments = book.payments.filter((payment) => payment.familyId === familyId);
  const paid = payments
    .filter((payment) => !payment.voided)
    .reduce((sum, payment) => sum + payment.amountToman, 0n);
  const balance = charged - paid;
  const promises = book.promises.filter(
    (one) => one.familyId === familyId && one.status === 'OPEN',
  );

  return {
    netChargedTotalToman: charged,
    confirmedPaymentTotalToman: paid,
    amountDueToman: balance > 0n ? balance : 0n,
    creditToman: balance < 0n ? -balance : 0n,
    paymentCount: payments.filter((payment) => !payment.voided).length,
    voidedPaymentCount: payments.filter((payment) => payment.voided).length,
    openPromiseCount: promises.filter((one) => one.dueOn >= book.calendar.today).length,
    missedPromiseCount: promises.filter((one) => one.dueOn < book.calendar.today).length,
  };
}

function priced(book: SimulationBook, session: SimulationBook['sessions'][number]): boolean {
  return book.tariffs.some(
    (tariff) =>
      tariff.serviceId === session.serviceId &&
      tariff.durationMinutes === session.durationMinutes &&
      (tariff.therapistId === null || tariff.therapistId === session.therapistId) &&
      tariff.from <= session.date &&
      (tariff.to === null || session.date <= tariff.to),
  );
}

// ---------------------------------------------------------------------------
// The reconciliation
// ---------------------------------------------------------------------------

export async function reconcileClinic(
  app: INestApplicationContext,
  book: SimulationBook,
  manager: ResolvedSession,
): Promise<ReconciliationReport> {
  const prisma = app.get(PrismaService);
  const accounts = app.get(FamilyAccountService);
  const accountReport = app.get(FamilyAccountReportService);
  const paymentReport = app.get(PaymentReportService);
  const promiseReport = app.get(PromiseReportService);
  const sessionReport = app.get(SessionReportService);
  const dashboard = app.get(DashboardService);
  const statements = app.get(SettlementStatementService);
  const periods = app.get(SettlementCloseService);

  const checks: ReconciliationCheck[] = [];
  const check = (name: string) => {
    const created: ReconciliationCheck = { name, compared: 0, discrepancies: [] };
    checks.push(created);
    return created;
  };
  const expectEqual = (
    into: ReconciliationCheck,
    what: string,
    expected: unknown,
    actual: unknown,
  ) => {
    into.compared += 1;
    const a = typeof expected === 'bigint' ? expected.toString() : JSON.stringify(expected);
    const b = typeof actual === 'bigint' ? actual.toString() : JSON.stringify(actual);
    if (a !== b) into.discrepancies.push(`${what}: expected ${a}, found ${b}`);
  };

  const charges = [...book.charges.values()];
  const { calendar } = book;
  const inactive = new Set(book.deactivations.map((one) => one.familyId));
  /** Whether the default family-accounts report must list a family: money is never hidden. */
  const listedByDefault = (familyId: string) => {
    const position = familyPosition(book, familyId);
    return !inactive.has(familyId) || position.amountDueToman > 0n || position.creditToman > 0n;
  };

  // ---- 1. Charges: every one the book expects, exactly as expected ----------

  {
    const into = check('charges match the price list and the session they bill');
    const rows = await prisma.$queryRaw<
      {
        id: string;
        participant: string;
        family_id: string;
        child_id: string;
        therapist_id: string;
        service_id: string;
        duration_minutes: number;
        service_date: string;
        price_mode: string;
        amount_toman: bigint;
        voided: boolean;
      }[]
    >`
      SELECT id, appointment_participant_id AS participant, family_id, child_id, therapist_id,
             service_id, duration_minutes, service_date::text AS service_date,
             price_mode::text AS price_mode, amount_toman, voided_at IS NOT NULL AS voided
      FROM session_charge ORDER BY id
    `;
    expectEqual(into, 'charge ids', charges.map((c) => c.id).sort(), rows.map((r) => r.id).sort());
    for (const row of rows) {
      const expected = book.charges.get(row.id);
      if (expected === undefined) continue;
      expectEqual(
        into,
        `charge ${row.id}`,
        {
          participant: expected.participantId,
          family: expected.familyId,
          child: expected.childId,
          therapist: expected.therapistId,
          service: expected.serviceId,
          minutes: expected.durationMinutes,
          date: expected.serviceDate,
          mode: expected.priceMode,
          amount: expected.expectedAmountToman.toString(),
          voided: expected.voided,
        },
        {
          participant: row.participant,
          family: row.family_id,
          child: row.child_id,
          therapist: row.therapist_id,
          service: row.service_id,
          minutes: row.duration_minutes,
          date: row.service_date,
          mode: row.price_mode,
          amount: row.amount_toman.toString(),
          voided: row.voided,
        },
      );
    }
  }

  // ---- 2. One valid charge per completed, attended, priced seat -------------

  {
    const into = check('one valid primary charge per completed attended session, under retries');
    const rows = await prisma.$queryRaw<{ participant: string; valid: bigint; ids: string[] }[]>`
      SELECT ap.id AS participant,
             count(sc.id) FILTER (WHERE sc.voided_at IS NULL) AS valid,
             coalesce(array_agg(sc.id) FILTER (WHERE sc.voided_at IS NULL), '{}') AS ids
      FROM appointment_participant ap
      LEFT JOIN session_charge sc ON sc.appointment_participant_id = ap.id
      GROUP BY ap.id
    `;
    const byParticipant = new Map(rows.map((row) => [row.participant, row]));
    expectEqual(into, 'seats', book.sessions.length, rows.length);
    for (const session of book.sessions) {
      // A seat whose charge the manager withdrew, and which was not re-raised,
      // is legitimately uncharged: the void is the explicit act that says so.
      const withdrawn =
        session.chargeId === null &&
        charges.some((c) => c.participantId === session.participantId && c.voided);
      const chargeable =
        session.status === 'COMPLETED' &&
        session.attendance === 'ATTENDED' &&
        priced(book, session) &&
        !withdrawn;
      const row = byParticipant.get(session.participantId);
      expectEqual(
        into,
        `valid charges for seat ${session.participantId}`,
        chargeable ? 1 : 0,
        Number(row?.valid ?? 0n),
      );
      if (chargeable) {
        expectEqual(
          into,
          `charge id for seat ${session.participantId}`,
          [session.chargeId],
          row?.ids ?? [],
        );
      }
    }
  }

  // ---- 3. Appointments and attendance ---------------------------------------

  {
    const into = check('appointment status and attendance');
    const rows = await prisma.$queryRaw<
      { participant: string; status: string; attendance: string; minutes: number }[]
    >`
      SELECT ap.id AS participant, a.status::text AS status, ap.attendance::text AS attendance,
             a.duration_minutes AS minutes
      FROM appointment_participant ap JOIN appointment a ON a.id = ap.appointment_id
    `;
    const byParticipant = new Map(rows.map((row) => [row.participant, row]));
    for (const session of book.sessions) {
      const row = byParticipant.get(session.participantId);
      expectEqual(
        into,
        `seat ${session.participantId}`,
        {
          status: session.status,
          attendance: session.attendance,
          minutes: session.durationMinutes,
        },
        { status: row?.status, attendance: row?.attendance, minutes: row?.minutes },
      );
    }
  }

  // ---- 4. Concessions and their allocation ------------------------------------

  {
    const into = check('concessions: amount, explicit allocation, withdrawal');
    const rows = await prisma.$queryRaw<
      {
        id: string;
        charge: string;
        amount: bigint;
        therapist: bigint;
        clinic: bigint;
        voided: boolean;
      }[]
    >`
      SELECT id, session_charge_id AS charge, amount_toman AS amount,
             therapist_discount_toman AS therapist, clinic_discount_toman AS clinic,
             voided_at IS NOT NULL AS voided
      FROM charge_adjustment
    `;
    const expected = charges.flatMap((charge) =>
      charge.adjustments.map((adjustment) => ({ charge: charge.id, ...adjustment })),
    );
    expectEqual(
      into,
      'concession ids',
      expected.map((e) => e.id).sort(),
      rows.map((r) => r.id).sort(),
    );
    for (const row of rows) {
      const one = expected.find((e) => e.id === row.id);
      if (one === undefined) continue;
      expectEqual(
        into,
        `concession ${row.id}`,
        [
          one.charge,
          one.amountToman,
          one.therapistPortionToman,
          one.amountToman - one.therapistPortionToman,
          one.voided,
        ].map(String),
        [row.charge, row.amount, row.therapist, row.clinic, row.voided].map(String),
      );
      into.compared += 1;
      if (row.therapist + row.clinic !== row.amount) {
        into.discrepancies.push(
          `concession ${row.id}: the two portions do not add up to the concession`,
        );
      }
    }
    for (const charge of charges) {
      into.compared += 1;
      if (effectiveAmount(charge) < 0n)
        into.discrepancies.push(`charge ${charge.id}: negative effective amount`);
    }
  }

  // ---- 5. Ratings: the applied percentage, frozen -----------------------------

  {
    const into = check('applied share snapshot per session');
    const rows = await prisma.$queryRaw<
      { charge: string; bp: number; via: string; base: bigint; tg: bigint; cg: bigint }[]
    >`
      SELECT session_charge_id AS charge, applied_share_basis_points AS bp, rated_via::text AS via,
             base_amount_toman AS base, therapist_gross_toman AS tg, clinic_gross_toman AS cg
      FROM session_settlement WHERE voided_at IS NULL
    `;
    const byCharge = new Map(rows.map((row) => [row.charge, row]));
    for (const charge of charges) {
      const row = byCharge.get(charge.id);
      const expected = expectedSessionValue({ ...charge, voided: false });
      expectEqual(
        into,
        `rating of ${charge.id}`,
        charge.rating === null
          ? null
          : {
              bp: charge.rating.basisPoints,
              via: charge.rating.via,
              base: expected!.baseAmountToman.toString(),
              therapistGross: expected!.therapistGrossToman.toString(),
              clinicGross: expected!.clinicGrossToman.toString(),
            },
        row === undefined
          ? null
          : {
              bp: row.bp,
              via: row.via,
              base: row.base.toString(),
              therapistGross: row.tg.toString(),
              clinicGross: row.cg.toString(),
            },
      );
    }
  }

  // ---- 6. Payments and promises ------------------------------------------------

  {
    const into = check('payments as recorded and voided');
    const rows = await prisma.$queryRaw<
      {
        id: string;
        family_id: string;
        amount: bigint;
        method: string;
        received_on: string;
        by: string;
        voided: boolean;
      }[]
    >`
      SELECT id, family_id, amount_toman AS amount, method::text AS method,
             received_on::text AS received_on, created_by_user_id AS by, voided_at IS NOT NULL AS voided
      FROM payment
    `;
    expectEqual(
      into,
      'payment ids',
      book.payments.map((p) => p.id).sort(),
      rows.map((r) => r.id).sort(),
    );
    for (const row of rows) {
      const payment = book.payments.find((p) => p.id === row.id);
      if (payment === undefined) continue;
      expectEqual(
        into,
        `payment ${row.id}`,
        [
          payment.familyId,
          payment.amountToman,
          payment.method,
          payment.receivedOn,
          payment.recordedByUserId,
          payment.voided,
        ].map(String),
        [row.family_id, row.amount, row.method, row.received_on, row.by, row.voided].map(String),
      );
    }

    const promises = check('payment promises and their resolution');
    const promiseRows = await prisma.$queryRaw<
      { id: string; family_id: string; amount: bigint; due_on: string; status: string }[]
    >`
      SELECT id, family_id, amount_toman AS amount, due_on::text AS due_on, status::text AS status
      FROM payment_promise
    `;
    expectEqual(
      promises,
      'promise ids',
      book.promises.map((p) => p.id).sort(),
      promiseRows.map((r) => r.id).sort(),
    );
    for (const row of promiseRows) {
      const one = book.promises.find((p) => p.id === row.id);
      if (one === undefined) continue;
      expectEqual(
        promises,
        `promise ${row.id}`,
        [one.familyId, one.amountToman, one.dueOn, one.status].map(String),
        [row.family_id, row.amount, row.due_on, row.status].map(String),
      );
    }
  }

  // ---- 7. Every family balance, three ways -------------------------------------

  {
    const into = check('family balances: book, base rows, family account, family-account report');
    // THE DEFAULT FILTER, after the deactivations: it must list every family that
    // holds money, whatever its status (DECISION_LOG, 2026-10-01).
    const report = await accountReport.report(
      familyAccountReportQuerySchema.parse({ pageSize: 100 }),
    );
    const sql = await prisma.$queryRaw<{ family_id: string; charged: bigint; paid: bigint }[]>`
      SELECT f.id AS family_id,
             coalesce((SELECT sum(sc.amount_toman) - coalesce(sum((
                 SELECT coalesce(sum(ca.amount_toman), 0) FROM charge_adjustment ca
                 WHERE ca.session_charge_id = sc.id AND ca.voided_at IS NULL)), 0)
               FROM session_charge sc WHERE sc.family_id = f.id AND sc.voided_at IS NULL), 0)::bigint AS charged,
             coalesce((SELECT sum(p.amount_toman) FROM payment p
               WHERE p.family_id = f.id AND p.voided_at IS NULL), 0)::bigint AS paid
      FROM family f
    `;
    expectEqual(
      into,
      'families in the report',
      book.families.filter((family) => listedByDefault(family.id)).length,
      report.families.length,
    );

    let due = 0n;
    let credit = 0n;
    for (const family of book.families) {
      const expected = familyPosition(book, family.id);
      due += expected.amountDueToman;
      credit += expected.creditToman;
      const shape = (position: {
        netChargedTotalToman: string | bigint;
        confirmedPaymentTotalToman: string | bigint;
        amountDueToman: string | bigint;
        creditToman: string | bigint;
        paymentCount: number;
        voidedPaymentCount: number;
        openPromiseCount: number;
        missedPromiseCount: number;
      }) => ({
        charged: String(position.netChargedTotalToman),
        paid: String(position.confirmedPaymentTotalToman),
        due: String(position.amountDueToman),
        credit: String(position.creditToman),
        payments: position.paymentCount,
        voided: position.voidedPaymentCount,
        open: position.openPromiseCount,
        missed: position.missedPromiseCount,
      });

      const account = await accounts.account(family.id, familyAccountQuerySchema.parse({}));
      expectEqual(into, `family ${family.label} account`, shape(expected), shape(account.position));

      const row = report.families.find((one) => one.family.id === family.id);
      expectEqual(
        into,
        `family ${family.label} report row`,
        listedByDefault(family.id) ? shape(expected) : null,
        row === undefined ? null : shape(row.position),
      );
      if (row !== undefined) {
        expectEqual(
          into,
          `family ${family.label} status in the report`,
          inactive.has(family.id) ? 'INACTIVE' : 'ACTIVE',
          row.family.status,
        );
      }

      const base = sql.find((one) => one.family_id === family.id);
      expectEqual(
        into,
        `family ${family.label} base rows`,
        [expected.netChargedTotalToman, expected.confirmedPaymentTotalToman].map(String),
        [base?.charged ?? 0n, base?.paid ?? 0n].map(String),
      );
    }
    expectEqual(into, 'clinic total due', due, BigInt(report.totals.totalAmountDueToman));
    expectEqual(into, 'clinic total credit', credit, BigInt(report.totals.totalCreditToman));
    expectEqual(
      into,
      'owing and in-credit family counts',
      [
        book.families.filter((f) => familyPosition(book, f.id).amountDueToman > 0n).length,
        book.families.filter((f) => familyPosition(book, f.id).creditToman > 0n).length,
      ],
      [report.totals.owingFamilyCount, report.totals.inCreditFamilyCount],
    );
  }

  // ---- 8. Clinic totals per day and per month ----------------------------------

  const chargesOn = (from: string, to: string) => {
    const inRange = charges.filter((c) => c.serviceDate >= from && c.serviceDate <= to);
    return {
      count: inRange.filter((c) => !c.voided).length,
      net: inRange.reduce((sum, c) => sum + effectiveAmount(c), 0n).toString(),
      voided: inRange.filter((c) => c.voided).length,
    };
  };
  const paymentsOn = (from: string, to: string) => {
    const inRange = book.payments.filter((p) => p.receivedOn >= from && p.receivedOn <= to);
    const confirmed = inRange.filter((p) => !p.voided);
    const methods = [...new Set(confirmed.map((p) => p.method))].sort();
    return {
      count: confirmed.length,
      total: confirmed.reduce((sum, p) => sum + p.amountToman, 0n).toString(),
      voided: inRange.filter((p) => p.voided).length,
      byMethod: methods.map((method) => ({
        method,
        total: confirmed
          .filter((p) => p.method === method)
          .reduce((sum, p) => sum + p.amountToman, 0n)
          .toString(),
      })),
    };
  };
  const sqlChargesOn = async (from: string, to: string) => {
    const rows = await prisma.$queryRaw<{ count: bigint; net: bigint; voided: bigint }[]>`
      SELECT count(*) FILTER (WHERE sc.voided_at IS NULL) AS count,
             coalesce(sum(sc.amount_toman - coalesce((SELECT sum(ca.amount_toman) FROM charge_adjustment ca
               WHERE ca.session_charge_id = sc.id AND ca.voided_at IS NULL), 0))
               FILTER (WHERE sc.voided_at IS NULL), 0)::bigint AS net,
             count(*) FILTER (WHERE sc.voided_at IS NOT NULL) AS voided
      FROM session_charge sc
      WHERE sc.service_date BETWEEN ${from}::date AND ${to}::date
    `;
    const row = rows[0]!;
    return { count: Number(row.count), net: row.net.toString(), voided: Number(row.voided) };
  };
  const reportPayments = async (from: string, to: string) => {
    const report = await paymentReport.report(
      paymentReportQuerySchema.parse({ from, to, pageSize: 100 }),
    );
    return {
      count: report.totals.confirmedCount,
      total: report.totals.confirmedTotalToman,
      voided: report.totals.voidedCount,
      byMethod: report.totals.byMethod
        .filter((m) => m.confirmedCount > 0)
        .map((m) => ({ method: m.method, total: m.confirmedTotalToman }))
        .sort((a, b) => a.method.localeCompare(b.method)),
    };
  };

  {
    const into = check('clinic totals per day: charges by session date, payments by received date');
    for (let day = calendar.windowStart; day <= calendar.lastHistoryDay; day = addDays(day, 1)) {
      const board = await dashboard.dashboard(dashboardQuerySchema.parse({ date: day }), manager);
      if (board.financialScope !== 'CLINIC_WIDE') {
        into.discrepancies.push(`${day}: the manager's dashboard is not clinic-wide`);
        continue;
      }
      const fromBoard = board.clinicFinancial.charges;
      expectEqual(into, `${day} charges (dashboard)`, chargesOn(day, day), {
        count: fromBoard.chargeCount,
        net: fromBoard.netChargedTotalToman,
        voided: fromBoard.voidedChargeCount,
      });
      expectEqual(
        into,
        `${day} charges (base rows)`,
        chargesOn(day, day),
        await sqlChargesOn(day, day),
      );
      expectEqual(
        into,
        `${day} payments (payment report)`,
        paymentsOn(day, day),
        await reportPayments(day, day),
      );
    }
  }

  {
    const into = check('clinic totals per Jalali month');
    for (const month of calendar.months) {
      expectEqual(
        into,
        `${month.label} charges (base rows)`,
        chargesOn(month.from, month.to),
        await sqlChargesOn(month.from, month.to),
      );
      expectEqual(
        into,
        `${month.label} payments (payment report)`,
        paymentsOn(month.from, month.to),
        await reportPayments(month.from, month.to),
      );
    }
    const whole = { from: calendar.windowStart, to: calendar.lastHistoryDay };
    expectEqual(
      into,
      'whole history payments',
      paymentsOn(whole.from, whole.to),
      await reportPayments(whole.from, whole.to),
    );
  }

  // ---- 9. Settlement: the closed period, frozen, and the live statement ---------

  {
    const into = check('closed settlement period: every line as expected, and unchanged since');
    for (const period of book.periods) {
      const sorted = <T extends { sessionChargeId: string }>(lines: T[]) =>
        [...lines].sort((a, b) => a.sessionChargeId.localeCompare(b.sessionChargeId));
      const lineShape = (line: {
        sessionChargeId: string;
        baseAmountToman: string | bigint;
        therapistGrossToman: string | bigint;
        therapistDiscountToman: string | bigint;
        therapistNetToman: string | bigint;
        clinicGrossToman: string | bigint;
        clinicDiscountToman: string | bigint;
        clinicNetToman: string | bigint;
      }) =>
        [
          line.sessionChargeId,
          line.baseAmountToman,
          line.therapistGrossToman,
          line.therapistDiscountToman,
          line.therapistNetToman,
          line.clinicGrossToman,
          line.clinicDiscountToman,
          line.clinicNetToman,
        ].map(String);

      const label = `period ${period.from}..${period.to} of ${period.therapistId}`;
      expectEqual(
        into,
        `${label} lines at close`,
        sorted(period.expectedLines).map(lineShape),
        sorted(period.linesAtClose.filter((line) => line.lineType === 'PRIMARY')).map(lineShape),
      );
      expectEqual(
        into,
        `${label} basis points at close`,
        sorted(period.expectedLines).map((line) => line.basisPoints),
        sorted(period.linesAtClose).map((line) => line.appliedShareBasisPoints),
      );
      expectEqual(
        into,
        `${label} corrections at close`,
        0,
        period.linesAtClose.filter((l) => l.lineType !== 'PRIMARY').length,
      );

      const now = await periods.detail(period.id);
      expectEqual(
        into,
        `${label} lines today equal the lines at close`,
        period.linesAtClose,
        now.lines,
      );
      const sum = (pick: (line: ExpectedSettlementLine) => bigint) =>
        period.expectedLines.reduce((total, line) => total + pick(line), 0n).toString();
      expectEqual(
        into,
        `${label} totals`,
        {
          sessions: period.expectedLines.length,
          excludedUnrated: period.expectedUnrated,
          gross: sum((l) => l.therapistGrossToman),
          discount: sum((l) => l.therapistDiscountToman),
          settled: sum((l) => l.therapistNetToman),
          carriedIn: '0',
        },
        {
          sessions: now.period.settledSessionCount,
          excludedUnrated: now.period.excludedUnratedSessionCount,
          gross: now.period.therapistGrossToman,
          discount: now.period.therapistDiscountToman,
          settled: now.period.settledToman,
          carriedIn: now.period.carriedInCorrectionToman,
        },
      );
    }

    const raw = check(
      'closed settlement rows: therapist net never negative, clinic subsidy visible',
    );
    const rows = await prisma.$queryRaw<
      {
        id: string;
        tn: bigint;
        cn: bigint;
        td: bigint;
        cd: bigint;
        base: bigint;
        tg: bigint;
        cg: bigint;
      }[]
    >`
      SELECT id, therapist_net_toman AS tn, clinic_net_toman AS cn, therapist_discount_toman AS td,
             clinic_discount_toman AS cd, base_amount_toman AS base, therapist_gross_toman AS tg,
             clinic_gross_toman AS cg
      FROM settlement_line
    `;
    for (const row of rows) {
      raw.compared += 1;
      if (row.tn < 0n) raw.discrepancies.push(`line ${row.id}: negative therapist net`);
      if (row.tg + row.cg !== row.base)
        raw.discrepancies.push(`line ${row.id}: gross shares do not add up to the base`);
      if (row.tg - row.td !== row.tn || row.cg - row.cd !== row.cn) {
        raw.discrepancies.push(`line ${row.id}: net is not gross less the borne discount`);
      }
    }
    raw.compared += 1;
    if (!rows.some((row) => row.cn < 0n)) {
      raw.discrepancies.push('no closed line shows the clinic subsidy the simulation granted');
    }
  }

  {
    const into = check('settlement statement per therapist: lines, settled, pending, unsettled');
    const closedNet = new Map<string, bigint>();
    for (const period of book.periods) {
      for (const line of period.linesAtClose) {
        closedNet.set(
          line.sessionChargeId,
          (closedNet.get(line.sessionChargeId) ?? 0n) + BigInt(line.therapistNetToman),
        );
      }
    }
    const ranges = [
      { label: 'closed month', from: calendar.closedMonth.from, to: calendar.closedMonth.to },
      { label: 'whole history', from: calendar.windowStart, to: calendar.lastHistoryDay },
    ];
    for (const therapist of book.therapists) {
      for (const range of ranges) {
        const statement = await statements.statement(
          settlementStatementQuerySchema.parse({
            therapistId: therapist.id,
            from: range.from,
            to: range.to,
          }),
        );
        const inRange = charges.filter(
          (c) =>
            c.therapistId === therapist.id &&
            c.serviceDate >= range.from &&
            c.serviceDate <= range.to,
        );
        const listed = inRange.filter(
          (c) => c.rating !== null && (!c.voided || closedNet.has(c.id)),
        );
        const label = `therapist ${therapist.label}, ${range.label}`;
        const expectedLines = listed
          .map((c) => {
            const value = expectedSessionValue(c)!;
            return {
              charge: c.id,
              bp: value.basisPoints,
              net: value.therapistNetToman.toString(),
              clinicNet: value.clinicNetToman.toString(),
              settled: (closedNet.get(c.id) ?? 0n).toString(),
            };
          })
          .sort((a, b) => a.charge.localeCompare(b.charge));
        const actualLines = statement.lines
          .map((line) => ({
            charge: line.sessionChargeId,
            bp: line.appliedShareBasisPoints,
            net: line.therapistNetToman,
            clinicNet: line.clinicNetToman,
            settled: line.settledToman,
          }))
          .sort((a, b) => a.charge.localeCompare(b.charge));
        expectEqual(into, `${label} lines`, expectedLines, actualLines);

        const net = expectedLines.reduce((sum, line) => sum + BigInt(line.net), 0n);
        const settled = expectedLines.reduce((sum, line) => sum + BigInt(line.settled), 0n);
        const pending = expectedLines
          .filter((line) => closedNet.has(line.charge))
          .reduce((sum, line) => sum + BigInt(line.net) - BigInt(line.settled), 0n);
        expectEqual(
          into,
          `${label} totals`,
          {
            net: net.toString(),
            settled: settled.toString(),
            unsettled: (net - settled).toString(),
            pending: pending.toString(),
            unrated: inRange.filter((c) => !c.voided && c.rating === null).length,
          },
          {
            net: statement.totals.therapistNetToman,
            settled: statement.totals.settledToman,
            unsettled: statement.totals.earnedUnsettledToman,
            pending: statement.totals.pendingCorrectionToman,
            unrated: statement.exceptions.unratedSessionCount,
          },
        );
      }
    }
  }

  // ---- 10. Exports ------------------------------------------------------------

  {
    const into = check('exported files carry the same money');
    for (const file of book.exports) {
      const { header, rows } = parseCsv(file.csv);
      expectEqual(into, `${file.label} row count`, rows.length, file.rowCount);
      if (file.label === 'payments' && file.range !== null) {
        const amount = header.indexOf('مبلغ (تومان)');
        const status = header.indexOf('وضعیت');
        const id = header.indexOf('شناسهٔ پرداخت');
        const inRange = book.payments.filter(
          (p) => p.receivedOn >= file.range!.from && p.receivedOn <= file.range!.to,
        );
        expectEqual(
          into,
          'payments export ids',
          inRange.map((p) => p.id).sort(),
          rows.map((r) => r[id]).sort(),
        );
        expectEqual(
          into,
          'payments export confirmed total',
          inRange.filter((p) => !p.voided).reduce((sum, p) => sum + p.amountToman, 0n),
          rows
            .filter((r) => r[status] !== 'VOIDED')
            .reduce((sum, r) => sum + BigInt(r[amount]!), 0n),
        );
      }
      if (file.label === 'family-accounts') {
        const id = header.indexOf('شناسهٔ خانواده');
        const statusColumn = header.indexOf('وضعیت پروندهٔ خانواده');
        const dueColumn = header.indexOf('مبلغ قابل پرداخت (تومان)');
        const creditColumn = header.indexOf('اعتبار خانواده (تومان)');
        for (const family of book.families) {
          const row = rows.find((r) => r[id] === family.id);
          const expected = familyPosition(book, family.id);
          expectEqual(
            into,
            `family ${family.label} in the export`,
            listedByDefault(family.id)
              ? [
                  inactive.has(family.id) ? 'INACTIVE' : 'ACTIVE',
                  ...[expected.amountDueToman, expected.creditToman].map(String),
                ]
              : null,
            row === undefined ? null : [row[statusColumn], row[dueColumn], row[creditColumn]],
          );
        }
      }
      if (file.label === 'promises' && file.range !== null) {
        const id = header.indexOf('شناسهٔ قول');
        expectEqual(
          into,
          'promises export ids',
          book.promises
            .filter((p) => p.dueOn >= file.range!.from && p.dueOn <= file.range!.to)
            .map((p) => p.id)
            .sort(),
          rows.map((r) => r[id]).sort(),
        );
      }
    }
  }

  // ---- 10b. Families deactivated holding money stay in every summary -----------
  //
  // Milestone 10, A6 (DECISION_LOG, 2026-10-01). The default family-accounts
  // report and file are covered above with the status; this is everything else
  // that summarises a family's money or obligations, read per family so a hidden
  // row cannot be masked by a total that happens to agree.

  {
    const into = check(
      'families deactivated holding money: acknowledged, visible, totals unchanged',
    );
    const owing = book.deactivations.filter(
      (one) => familyPosition(book, one.familyId).amountDueToman > 0n,
    );
    const inCredit = book.deactivations.filter(
      (one) => familyPosition(book, one.familyId).creditToman > 0n,
    );
    expectEqual(into, 'deactivated owing and in credit', [1, 1], [owing.length, inCredit.length]);

    const statuses = await prisma.$queryRaw<{ id: string; status: string }[]>`
      SELECT id, status::text AS status FROM family
    `;
    const acknowledgements = await prisma.$queryRaw<
      { entity_id: string; metadata: { amountDueToman?: string; creditToman?: string } }[]
    >`
      SELECT entity_id, metadata FROM audit_log WHERE action = 'family.deactivated_with_balance'
    `;
    expectEqual(
      into,
      'family statuses (base rows)',
      book.families.map((f) => [f.id, inactive.has(f.id) ? 'INACTIVE' : 'ACTIVE']).sort(),
      statuses.map((row) => [row.id, row.status]).sort(),
    );

    for (const { familyId, acknowledged } of book.deactivations) {
      const label = book.families.find((f) => f.id === familyId)?.label ?? familyId;
      const expected = familyPosition(book, familyId);
      expectEqual(
        into,
        `family ${label} acknowledged balance`,
        [expected.amountDueToman.toString(), expected.creditToman.toString()],
        [acknowledged.amountDueToman, acknowledged.creditToman],
      );
      expectEqual(
        into,
        `family ${label} acknowledgement audited`,
        // As pairs: jsonb does not keep the order the keys were written in.
        [[acknowledged.amountDueToman, acknowledged.creditToman]],
        acknowledgements
          .filter((row) => row.entity_id === familyId)
          .map((row) => [row.metadata.amountDueToman, row.metadata.creditToman]),
      );

      const range = { from: calendar.windowStart, to: calendar.lastHistoryDay };
      const payments = await paymentReport.report(
        paymentReportQuerySchema.parse({ ...range, familyId, pageSize: 100 }),
      );
      expectEqual(
        into,
        `family ${label} in the payments report`,
        book.payments
          .filter((p) => p.familyId === familyId && p.receivedOn >= range.from)
          .filter((p) => p.receivedOn <= range.to)
          .map((p) => p.id)
          .sort(),
        payments.payments.map((p) => p.id).sort(),
      );

      const promiseRange = {
        from: addDays(calendar.windowStart, -30),
        to: addDays(calendar.today, 60),
      };
      const promises = await promiseReport.report(
        promiseReportQuerySchema.parse({ ...promiseRange, familyId, pageSize: 100 }),
      );
      expectEqual(
        into,
        `family ${label} in the promises report`,
        book.promises
          .filter((p) => p.familyId === familyId)
          .map((p) => [p.id, p.status === 'OPEN' && p.dueOn < calendar.today ? 'MISSED' : p.status])
          .sort(),
        promises.promises.map((p) => [p.id, p.status]).sort(),
      );

      const sessions = book.sessions.filter((one) => one.familyId === familyId);
      const dates = sessions.map((one) => one.date).sort();
      if (dates.length > 0) {
        const report = await sessionReport.report(
          sessionReportQuerySchema.parse({
            from: dates[0],
            to: dates[dates.length - 1],
            familyId,
            pageSize: 100,
          }),
        );
        expectEqual(
          into,
          `family ${label} in the sessions report`,
          sessions.map((one) => one.participantId).sort(),
          report.sessions.map((one) => one.participantId).sort(),
        );
      }
    }

    // Nothing the deactivations did moved a total: the default report reads the
    // same clinic it read before them, and the same clinic the unfiltered one does.
    const after = await accountReport.report(familyAccountReportQuerySchema.parse({}));
    const unfiltered = await accountReport.report(
      familyAccountReportQuerySchema.parse({ includeInactive: 'true' }),
    );
    expectEqual(
      into,
      'family-accounts totals before and after the deactivations',
      book.familyAccountTotalsBeforeDeactivation,
      after.totals,
    );
    expectEqual(
      into,
      'family-accounts totals with and without inactive families',
      unfiltered.totals,
      after.totals,
    );
  }

  // ---- 11. Audit: every financial act, and no financial row without one -----------

  {
    const into = check('an audit entry for every financial act');
    const rows = await prisma.$queryRaw<{ entity_id: string; acts: bigint }[]>`
      SELECT entity_id, count(*) AS acts FROM audit_log WHERE entity_id IS NOT NULL GROUP BY entity_id
    `;
    const acts = new Map(rows.map((row) => [row.entity_id, Number(row.acts)]));
    for (const [entityId, expected] of book.audited) {
      into.compared += 1;
      const found = acts.get(entityId) ?? 0;
      if (found < expected)
        into.discrepancies.push(`${entityId}: ${expected} acts, ${found} audit entries`);
    }

    const unaudited = await prisma.$queryRaw<{ kind: string; id: string }[]>`
      SELECT kind, id FROM (
        SELECT 'session_charge' AS kind, id FROM session_charge
        UNION ALL SELECT 'session_charge.void', id FROM session_charge WHERE voided_at IS NOT NULL
        UNION ALL SELECT 'charge_adjustment', id FROM charge_adjustment
        UNION ALL SELECT 'charge_adjustment.void', id FROM charge_adjustment WHERE voided_at IS NOT NULL
        UNION ALL SELECT 'payment', id FROM payment
        UNION ALL SELECT 'payment.void', id FROM payment WHERE voided_at IS NOT NULL
        -- A rescheduled promise's successor is born inside the reschedule,
        -- whose entry names it.
        UNION ALL SELECT 'payment_promise', id FROM payment_promise
          WHERE id NOT IN (SELECT (after->>'successorPromiseId')::uuid FROM audit_log
                           WHERE action = 'payment_promise.rescheduled')
        UNION ALL SELECT 'session_settlement', id FROM session_settlement
        UNION ALL SELECT 'settlement_period', id FROM settlement_period
        UNION ALL SELECT 'therapist_share_rule', id FROM therapist_share_rule
        UNION ALL SELECT 'tariff', id FROM tariff
      ) financial
      WHERE (SELECT count(*) FROM audit_log l WHERE l.entity_id = financial.id)
            < CASE WHEN kind LIKE '%.void' THEN 2 ELSE 1 END
    `;
    into.compared += 1;
    for (const row of unaudited)
      into.discrepancies.push(`${row.kind} ${row.id} has no audit entry for the act`);
  }

  // ---- 12. Website requests -------------------------------------------------------

  {
    const into = check('website requests: lifecycle and conversion');
    const rows = await prisma.$queryRaw<
      { id: string; mobile: string | null; status: string; family: string | null }[]
    >`
      SELECT id, contact_mobile AS mobile, status::text AS status, linked_family_id AS family
      FROM website_request
    `;
    expectEqual(into, 'requests received', book.websiteRequests.length, rows.length);
    for (const request of book.websiteRequests) {
      const row = rows.find((one) => one.mobile === request.contactMobile);
      expectEqual(
        into,
        `request from ${request.contactMobile}`,
        { status: request.status, family: request.linkedFamilyId },
        row === undefined ? null : { status: row.status, family: row.family },
      );
    }
  }

  // ---- 13. The partial-day closure (M10-A9) ----------------------------------

  {
    const into = check('partial-day closure: resolved hours and the sessions it surfaced');
    const closure = book.partialClosure;
    expectEqual(into, 'a partial closure was recorded', true, closure !== null);
    if (closure !== null) {
      const availability = app.get(AvailabilityService);
      const day = await availability.resolve({
        therapistId: closure.therapistId,
        date: closure.date,
      });
      // The therapist's 09:00–18:00 day, less the closed afternoon.
      expectEqual(
        into,
        `hours on ${closure.date}`,
        {
          isClosed: false,
          closedRanges: [{ startTime: closure.startTime, endTime: closure.endTime }],
          windows: [{ startTime: '09:00', endTime: closure.startTime }],
        },
        {
          isClosed: day.isClosed,
          closedRanges: day.closedRanges.map(({ startTime, endTime }) => ({ startTime, endTime })),
          windows: day.windows,
        },
      );
      expectEqual(
        into,
        'sessions surfaced when the closure was written',
        closure.expectedAffected,
        closure.reportedAffected,
      );
      const read = await availability.listClosureConflicts(closure.therapistId, {
        from: closure.date,
        to: closure.date,
      });
      expectEqual(
        into,
        'sessions surfaced by the conflict read',
        closure.expectedAffected,
        read.map((one) => one.appointmentId).sort(),
      );
    }
  }

  return {
    checks,
    discrepancyCount: checks.reduce((sum, one) => sum + one.discrepancies.length, 0),
  };
}

/** RFC 4180 with the UTF-8 byte order mark every export starts with. */
function parseCsv(csv: string): { header: string[]; rows: string[][] } {
  const body = csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv;
  const lines: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (quoted) {
      if (character === '"' && body[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\r' && body[index + 1] === '\n') {
      row.push(field);
      lines.push(row);
      row = [];
      field = '';
      index += 1;
    } else field += character;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    lines.push(row);
  }
  const [header, ...rows] = lines;
  return { header: header ?? [], rows };
}
