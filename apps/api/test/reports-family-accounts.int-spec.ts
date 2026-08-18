import request from 'supertest';
import {
  familyAccountReportResponseSchema,
  familyAccountResponseSchema,
  type FamilyAccountReportResponse,
  type FamilyAccountReportRow,
  type FamilyFinancialPosition,
} from '@clinic/contracts';
import {
  asUser,
  bookId,
  bookingPayload,
  complete,
  makeFamilyWithChild,
  makeRoom,
  makeService,
  makeTariff,
  makeTherapist,
  putWindows,
  recordAttendance,
  signIn,
  SATURDAY_MORNING,
} from './appointments-support';
import { adjustOverHttp, familyAccount, voidChargeOverHttp, NEXT_SATURDAY } from './ledger-support';
import {
  clinicDay,
  createPromiseOverHttp,
  recordPaymentOverHttp,
  voidPaymentOverHttp,
} from './payment-support';
import { createHarness, resetDatabase, type Harness } from './harness';

/**
 * The clinic-wide family-accounts report: `GET /reports/family-accounts`
 * (Milestone 7, checkpoint C4).
 *
 * EVERYTHING HERE IS SYNTHETIC. No real family, guardian, child, price or amount
 * appears in any fixture in this project. Every financial row below was produced
 * by the application over HTTP — the sessions are booked, attended and completed,
 * the charges raised by the real posting path, and the concessions, voids,
 * payments and promises written through the real Milestone 5 and 6 endpoints. A
 * read model tested against hand-inserted rows would prove only that the SQL
 * matched the SQL.
 *
 * THE CENTRAL CLAIM OF THIS SUITE IS THE RECONCILIATION. The highest risk in C4
 * is that a clinic-wide report becomes a SECOND definition of "what does this
 * family owe?" — one that agrees with `GET /families/:id/account` on the day it
 * is written and drifts the first time either is corrected. So the reconciliation
 * test below compares the report's row for every family against the authoritative
 * single-family account, FIELD BY FIELD across the whole frozen position, over
 * families in every state the ledger can reach: ordinary debt, part payment,
 * overpayment, an exact settlement, active and withdrawn concessions, a withdrawn
 * charge, a withdrawn payment, promises, and a family with no financial history
 * at all. Comparing one grand total would pass while every row was wrong.
 *
 * THE OTHER CLAIMS ARE THE FROZEN CONTRACT'S. The report is manager-only; it has
 * no date range and its filters select FAMILIES rather than narrowing anybody's
 * balance; the three standings partition the result; the two clinic sums are
 * never netted against each other; and paging moves rows without moving a total.
 */
describe('the family-accounts report (real PostgreSQL)', () => {
  let harness: Harness;
  let managerToken: string;

  /** One clinic — one service, one therapist, one room, one price — and two Saturdays of slots. */
  let clinic: { serviceId: string; therapistId: string; roomId: string };
  let slots: string[];

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);

    const manager = await signIn(harness, 'MANAGER');
    managerToken = manager.token;

    const serviceId = await makeService(harness, managerToken);
    const therapistId = await makeTherapist(harness, managerToken, [serviceId]);
    const roomId = await makeRoom(harness, managerToken);
    await putWindows(harness, managerToken, therapistId, [SATURDAY_MORNING]).expect(200);
    await makeTariff(harness, managerToken, {
      serviceId,
      durationMinutes: 45,
      priceToman: '250000',
    });

    clinic = { serviceId, therapistId, roomId };

    // 09:00, 09:45, 10:30, 11:15 and 12:00 Tehran, on each of two Saturdays.
    // Distinct slots because one therapist and one room cannot be in two places.
    slots = ['05:30', '06:15', '07:00', '07:45', '08:30'].flatMap((time) => [
      `2026-09-05T${time}:00.000Z`,
      `2026-09-12T${time}:00.000Z`,
    ]);
  });

  const report = (token: string, query: Record<string, string | number> = {}) =>
    request(harness.app.getHttpServer())
      .get('/reports/family-accounts')
      .query(query)
      .set(asUser(token));

  const okReport = async (
    query: Record<string, string | number> = {},
    token = managerToken,
  ): Promise<FamilyAccountReportResponse> => {
    const response = await report(token, query);
    expect(response.status).toBe(200);

    return familyAccountReportResponseSchema.parse(response.body);
  };

  /** Every row of the report, walked page by page at the contract's own maximum. */
  const allRows = async (
    query: Record<string, string | number> = {},
  ): Promise<FamilyAccountReportRow[]> => {
    const rows: FamilyAccountReportRow[] = [];

    for (let page = 1; ; page += 1) {
      const one = await okReport({ ...query, page, pageSize: 100 });
      rows.push(...one.families);

      if (!one.page.hasMore) return rows;
      if (page > 20) throw new Error('paging did not terminate');
    }
  };

  /** The authoritative single-family read, which the report must agree with. */
  const accountPosition = async (familyId: string): Promise<FamilyFinancialPosition> => {
    const response = await familyAccount(harness, managerToken, familyId, {}).expect(200);
    return familyAccountResponseSchema.parse(response.body).position;
  };

  let nextSlot = 0;

  /** A family with one charged session, through the real completion-posts-the-charge path. */
  const chargedFamily = async (
    firstName: string,
  ): Promise<{ familyId: string; chargeId: string }> => {
    const { familyId, childId } = await makeFamilyWithChild(harness, managerToken, { firstName });
    const startsAt = slots[nextSlot];
    nextSlot += 1;
    if (startsAt === undefined) throw new Error('the fixture ran out of booking slots');

    const appointmentId = await bookId(
      harness,
      managerToken,
      bookingPayload({ ...clinic, childId }, { startsAt }),
    );

    const participant = await harness.prisma.appointmentParticipant.findFirstOrThrow({
      where: { appointmentId },
    });

    await recordAttendance(harness, managerToken, appointmentId, participant.id, 'ATTENDED').expect(
      200,
    );
    await complete(harness, managerToken, appointmentId).expect(200);

    const charge = await harness.prisma.sessionCharge.findFirstOrThrow({
      where: { appointmentParticipantId: participant.id, voidedAt: null },
    });

    return { familyId, chargeId: charge.id };
  };

  const pay = async (familyId: string, amountToman: string): Promise<string> => {
    const response = await recordPaymentOverHttp(harness, managerToken, familyId, {
      amountToman,
      method: 'CASH',
      receivedOn: await clinicDay(harness, 0),
    });

    expect(response.status).toBe(200);
    return response.body.payment.id as string;
  };

  beforeEach(() => {
    nextSlot = 0;
  });

  /**
   * EVERY FINANCIAL STATE THE LEDGER CAN REACH, ONE FAMILY EACH.
   *
   * One family per state rather than one family in several, so a row that is
   * wrong names the state that broke it.
   */
  const seedEveryStanding = async (): Promise<Record<string, string>> => {
    // Plain outstanding debt: charged and never paid.
    const debt = await chargedFamily('بدهکار');

    // Part paid.
    const partial = await chargedFamily('پرداخت جزئی');
    await pay(partial.familyId, '100000');

    // Paid beyond what was charged: credit, which is derived and never stored.
    const credit = await chargedFamily('بستانکار');
    await pay(credit.familyId, '400000');

    // Square to the toman.
    const settled = await chargedFamily('تسویه');
    await pay(settled.familyId, '250000');

    // A concession that still stands, and one that was withdrawn: the first
    // reduces the position, the second reduces nothing.
    const adjusted = await chargedFamily('تخفیف');
    await adjustOverHttp(harness, managerToken, adjusted.chargeId, '50000').expect(200);
    await pay(adjusted.familyId, '100000');

    // A withdrawn charge and a withdrawn payment, on one family: neither counts,
    // and both are visible as reversals.
    const reversed = await chargedFamily('ابطال');
    const wrongPayment = await pay(reversed.familyId, '60000');
    await voidPaymentOverHttp(harness, managerToken, wrongPayment).expect(200);
    await voidChargeOverHttp(harness, managerToken, reversed.chargeId).expect(200);

    // Promises, which move no money in any state.
    const promising = await chargedFamily('قول پرداخت');
    const overdue = await clinicDay(harness, -2);
    const ahead = await clinicDay(harness, 9);
    await createPromiseOverHttp(harness, managerToken, promising.familyId, {
      amountToman: '50000',
      dueOn: overdue,
    }).expect(200);
    await createPromiseOverHttp(harness, managerToken, promising.familyId, {
      amountToman: '50000',
      dueOn: ahead,
    }).expect(200);

    // A family with no financial history at all: registered, never charged,
    // never paid. A row of zeroes, not an absence.
    const { familyId: quiet } = await makeFamilyWithChild(harness, managerToken, {
      firstName: 'بدون سابقه',
    });

    return {
      debt: debt.familyId,
      partial: partial.familyId,
      credit: credit.familyId,
      settled: settled.familyId,
      adjusted: adjusted.familyId,
      reversed: reversed.familyId,
      promising: promising.familyId,
      quiet,
    };
  };

  describe('authority: every family’s money is the manager’s', () => {
    it('answers a manager and refuses a receptionist calling the route directly', async () => {
      const receptionist = await signIn(harness, 'RECEPTIONIST');

      // A receptionist reads ONE family's account at a time, through the route
      // that names that family — an authority they hold and keep. Reading every
      // family's position in one page is not a bulk version of that screen, and
      // the refusal is the guard's, before any statement runs.
      const refused = await report(receptionist.token);
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe('AUTH_FORBIDDEN');

      const allowed = await okReport();
      expect(allowed.totals.familyCount).toBe(0);
    });

    it('is not a period, and refuses a date range', async () => {
      // A financial position is every valid charge and every confirmed payment a
      // family has ever had. "The balance as at last month" is a different
      // concept nobody has approved, and the strict frozen query says so.
      const ranged = await report(managerToken, { from: '2026-08-01', to: '2026-08-31' });
      expect(ranged.status).toBe(400);

      // Nor a free-text search: a family is found by search, which is a POST.
      const searched = await report(managerToken, { term: 'نمونه' });
      expect(searched.status).toBe(400);
    });
  });

  describe('the reconciliation against the authoritative family account', () => {
    it('agrees field for field with GET /families/:id/account for every family', async () => {
      const families = await seedEveryStanding();
      const rows = await allRows({ includeInactive: 'true' });

      // Every seeded family is on the report, including the one with no
      // financial history: a family with nothing is a row of zeroes, not an
      // absence.
      expect(rows).toHaveLength(Object.keys(families).length);

      for (const [state, familyId] of Object.entries(families)) {
        const row = rows.find((candidate) => candidate.family.id === familyId);
        if (row === undefined) throw new Error(`the report omitted the ${state} family`);

        // THE WHOLE FROZEN POSITION, NOT A GRAND TOTAL. Net charged, confirmed
        // payments, credit, amount due, the two payment counts, the last payment
        // and both promise counts.
        expect(row.position).toEqual(await accountPosition(familyId));
      }
    });

    it('states each standing the way the single-family account does', async () => {
      const families = await seedEveryStanding();
      const rows = await allRows({ includeInactive: 'true' });

      const positionOf = (familyId: string): FamilyFinancialPosition => {
        const row = rows.find((candidate) => candidate.family.id === familyId);
        if (row === undefined) throw new Error('the report omitted a seeded family');
        return row.position;
      };

      // Charged 250000, paid nothing.
      expect(positionOf(families['debt'] ?? '')).toMatchObject({
        netChargedTotalToman: '250000',
        confirmedPaymentTotalToman: '0',
        amountDueToman: '250000',
        creditToman: '0',
        lastPayment: null,
      });

      // Charged 250000, paid 100000.
      expect(positionOf(families['partial'] ?? '')).toMatchObject({
        amountDueToman: '150000',
        creditToman: '0',
        paymentCount: 1,
      });

      // Paid 400000 against 250000: the excess is credit, derived and unsigned.
      expect(positionOf(families['credit'] ?? '')).toMatchObject({
        amountDueToman: '0',
        creditToman: '150000',
      });

      expect(positionOf(families['settled'] ?? '')).toMatchObject({
        amountDueToman: '0',
        creditToman: '0',
      });

      // 250000 less a standing 50000 concession, less 100000 paid.
      expect(positionOf(families['adjusted'] ?? '')).toMatchObject({
        netChargedTotalToman: '200000',
        amountDueToman: '100000',
      });

      // A withdrawn charge counts for nothing and a withdrawn payment counts for
      // nothing — and the reversals are visible rather than erased. `lastPayment`
      // is null because the only payment was withdrawn: the family position
      // never offers withdrawn money as money received.
      expect(positionOf(families['reversed'] ?? '')).toMatchObject({
        netChargedTotalToman: '0',
        confirmedPaymentTotalToman: '0',
        amountDueToman: '0',
        creditToman: '0',
        paymentCount: 0,
        voidedPaymentCount: 1,
        lastPayment: null,
      });

      // Promises are counted and change nothing: still the whole charge owed.
      expect(positionOf(families['promising'] ?? '')).toMatchObject({
        amountDueToman: '250000',
        openPromiseCount: 1,
        missedPromiseCount: 1,
      });

      // No history at all, and no opening balance invented to fill it.
      expect(positionOf(families['quiet'] ?? '')).toEqual({
        netChargedTotalToman: '0',
        confirmedPaymentTotalToman: '0',
        creditToman: '0',
        amountDueToman: '0',
        paymentCount: 0,
        voidedPaymentCount: 0,
        lastPayment: null,
        openPromiseCount: 0,
        missedPromiseCount: 0,
      });
    });
  });

  describe('the totals, the standings and the order', () => {
    it('sums what the filter matched, and never nets one family against another', async () => {
      await seedEveryStanding();

      const all = await okReport({ includeInactive: 'true', pageSize: 100 });
      const rows = all.families;

      const owing = rows.filter((row) => row.position.amountDueToman !== '0');
      const inCredit = rows.filter((row) => row.position.creditToman !== '0');

      expect(all.totals.familyCount).toBe(rows.length);
      expect(all.totals.owingFamilyCount).toBe(owing.length);
      expect(all.totals.inCreditFamilyCount).toBe(inCredit.length);

      const due = owing.reduce((total, row) => total + BigInt(row.position.amountDueToman), 0n);
      const credit = inCredit.reduce((total, row) => total + BigInt(row.position.creditToman), 0n);

      expect(all.totals.totalAmountDueToman).toBe(due.toString());
      expect(all.totals.totalCreditToman).toBe(credit.toString());

      // Both unsigned, both present, and no single netted clinic balance
      // anywhere in the response: one family's credit does not reduce another
      // family's debt.
      expect(BigInt(all.totals.totalAmountDueToman) > 0n).toBe(true);
      expect(BigInt(all.totals.totalCreditToman) > 0n).toBe(true);
    });

    it('partitions the families across the three standings', async () => {
      await seedEveryStanding();

      const all = await okReport({ includeInactive: 'true', pageSize: 100 });
      const owing = await okReport({ includeInactive: 'true', standing: 'OWING', pageSize: 100 });
      const credit = await okReport({
        includeInactive: 'true',
        standing: 'IN_CREDIT',
        pageSize: 100,
      });
      const settled = await okReport({
        includeInactive: 'true',
        standing: 'SETTLED',
        pageSize: 100,
      });

      // The three add up to the whole, because the position guarantees at most
      // one of amount due and credit is non-zero.
      expect(
        owing.totals.familyCount + credit.totals.familyCount + settled.totals.familyCount,
      ).toBe(all.totals.familyCount);

      expect(owing.families.every((row) => row.position.amountDueToman !== '0')).toBe(true);
      expect(credit.families.every((row) => row.position.creditToman !== '0')).toBe(true);
      expect(
        settled.families.every(
          (row) => row.position.amountDueToman === '0' && row.position.creditToman === '0',
        ),
      ).toBe(true);

      // A FILTERED LIST IS NOT A FILTERED BALANCE. The rows a standing filter
      // returns carry exactly the positions the unfiltered report carried.
      for (const row of owing.families) {
        const unfiltered = all.families.find((candidate) => candidate.family.id === row.family.id);
        expect(row.position).toEqual(unfiltered?.position);
      }
    });

    it('orders the worklist by what is owed, largest first', async () => {
      await seedEveryStanding();

      const rows = (await okReport({ includeInactive: 'true', pageSize: 100 })).families;
      const due = rows.map((row) => BigInt(row.position.amountDueToman));

      for (const [index, amount] of due.entries()) {
        if (index === 0) continue;
        expect((due[index - 1] ?? 0n) >= amount).toBe(true);
      }

      // The report exists to answer "who should we call first?", so the largest
      // debt leads and the families who owe nothing follow.
      expect(due[0]).toBe(250000n);
      expect(due[due.length - 1]).toBe(0n);
    });

    it('leaves a deactivated family out by default and finds it on request', async () => {
      const debtor = await chargedFamily('بدهکار غیرفعال');

      await request(harness.app.getHttpServer())
        .patch(`/families/${debtor.familyId}/status`)
        .set(asUser(managerToken))
        .send({ status: 'INACTIVE' })
        .expect(200);

      const byDefault = await okReport();
      expect(byDefault.families.map((row) => row.family.id)).not.toContain(debtor.familyId);
      expect(byDefault.totals.totalAmountDueToman).toBe('0');

      // A deactivated family that still owes money is a real situation, and the
      // flag is how a manager finds it. What it never does is hide a charge, a
      // payment or a void from a position it is included in.
      const included = await okReport({ includeInactive: 'true' });
      const row = included.families.find((one) => one.family.id === debtor.familyId);

      expect(row?.position.amountDueToman).toBe('250000');
      expect(row?.position).toEqual(await accountPosition(debtor.familyId));
    });
  });

  describe('paging, which moves rows and never moves a total', () => {
    it('states the same summary on every page', async () => {
      await seedEveryStanding();

      const first = await okReport({ includeInactive: 'true', page: 1, pageSize: 3 });
      const second = await okReport({ includeInactive: 'true', page: 2, pageSize: 3 });
      const third = await okReport({ includeInactive: 'true', page: 3, pageSize: 3 });

      expect(second.totals).toEqual(first.totals);
      expect(third.totals).toEqual(first.totals);
      expect(first.page.total).toBe(first.totals.familyCount);
      expect(first.page.hasMore).toBe(true);
      expect(third.page.hasMore).toBe(false);

      const walked = [...first.families, ...second.families, ...third.families].map(
        (row) => row.family.id,
      );
      expect(new Set(walked).size).toBe(walked.length);
      expect(walked).toHaveLength(first.totals.familyCount);
    });

    it('reads a clinic where nobody owes anything as a successful, zeroed answer', async () => {
      const report = await okReport();

      expect(report.families).toEqual([]);
      expect(report.totals).toEqual({
        familyCount: 0,
        owingFamilyCount: 0,
        inCreditFamilyCount: 0,
        totalAmountDueToman: '0',
        totalCreditToman: '0',
      });
      expect(report.page).toEqual({ page: 1, pageSize: 25, total: 0, hasMore: false });
    });
  });

  // Referenced so the fixture's second Saturday reads as deliberate rather than
  // as a magic string in the slot list above.
  it('books its fixtures across two Saturdays of the clinic diary', () => {
    expect(slots.some((slot) => slot.startsWith(NEXT_SATURDAY))).toBe(true);
  });
});
