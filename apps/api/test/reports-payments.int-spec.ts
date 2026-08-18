import request from 'supertest';
import {
  loginResponseSchema,
  paymentReportResponseSchema,
  type PaymentReportResponse,
} from '@clinic/contracts';
import { asUser, makeFamilyWithChild, signIn } from './appointments-support';
import { clinicDay, recordPaymentOverHttp, voidPaymentOverHttp } from './payment-support';
import {
  createHarness,
  internalHeaders,
  resetDatabase,
  seedUser,
  TEST_PASSWORD,
  type Harness,
} from './harness';

/**
 * The clinic-wide payments report: `GET /reports/payments` (Milestone 7,
 * checkpoint C4).
 *
 * EVERYTHING HERE IS SYNTHETIC. No real family, guardian, amount, note or bank
 * reference appears in any fixture in this project.
 *
 * WHAT THIS SUITE IS FOR. Four claims the frozen contract makes, all of which
 * are NestJS's to keep:
 *
 *   * the report is manager-only, and a receptionist is refused by the guard on
 *     a DIRECT call — not by a hidden menu item and not by a thinner response;
 *   * it is keyed on `receivedOn`, the clinic business day the money ARRIVED,
 *     which is deliberately not the dashboard reconciliation's basis: a
 *     back-dated payment belongs to the day it was received and never to the day
 *     it was typed in;
 *   * a voided payment contributes to no financial total, whether or not the
 *     list is showing it, so `includeVoided` moves rows and moves no number;
 *   * the summaries describe the whole filtered result and not the page, so
 *     paging cannot change what the clinic took in.
 *
 * EVERY DAY COMES FROM `clinic_date()`, never from the runner's clock: Tehran
 * rolls over at 20:30 UTC, and a test that built its own "yesterday" would pass
 * for twenty and a half hours a day and fail for the other three and a half.
 */
describe('the payments report (real PostgreSQL)', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
  });

  const payments = (token: string, query: Record<string, string | number>) =>
    request(harness.app.getHttpServer()).get('/reports/payments').query(query).set(asUser(token));

  const okPayments = async (
    token: string,
    query: Record<string, string | number>,
  ): Promise<PaymentReportResponse> => {
    const response = await payments(token, query);
    expect(response.status).toBe(200);

    return paymentReportResponseSchema.parse(response.body);
  };

  /** A named operator, so the per-user attribution has somebody to attribute to. */
  const operator = async (
    role: 'MANAGER' | 'RECEPTIONIST',
    displayName: string,
  ): Promise<{ id: string; token: string; displayName: string }> => {
    const user = await seedUser(harness, { role, displayName });
    const response = await request(harness.app.getHttpServer())
      .post('/auth/login')
      .set(internalHeaders())
      .send({ username: user.username, password: TEST_PASSWORD });

    return {
      id: user.id,
      token: loginResponseSchema.parse(response.body).sessionToken,
      displayName,
    };
  };

  /** Money over the counter, the way an operator records it. */
  const pay = async (
    token: string,
    familyId: string,
    body: { amountToman: string; method?: string; receivedOn: string },
  ): Promise<string> => {
    const response = await recordPaymentOverHttp(harness, token, familyId, {
      amountToman: body.amountToman,
      method: body.method ?? 'CASH',
      receivedOn: body.receivedOn,
    });

    expect(response.status).toBe(200);
    return response.body.payment.id as string;
  };

  describe('authority: clinic-wide money is the manager’s', () => {
    it('answers a manager and refuses a receptionist calling the route directly', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const receptionist = await signIn(harness, 'RECEPTIONIST');
      const today = await clinicDay(harness, 0);

      // The receptionist holds `payment.read` — they record money and read one
      // family's history with it — and that authority deliberately does not
      // extend to every family's money in one page, nor to what a colleague took
      // in. The refusal is the guard's, before any statement runs.
      const refused = await payments(receptionist.token, { from: today, to: today });
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe('AUTH_FORBIDDEN');

      const allowed = await okPayments(manager.token, { from: today, to: today });
      expect(allowed.totals.confirmedCount).toBe(0);
    });

    it('refuses a receptionist even when the period is empty and the answer would be nothing', async () => {
      const receptionist = await signIn(harness, 'RECEPTIONIST');
      const today = await clinicDay(harness, 0);

      // A 403 rather than an empty 200: the authority is over the QUESTION, not
      // over the rows that happen to answer it this week.
      const refused = await payments(receptionist.token, { from: today, to: today });
      expect(refused.status).toBe(403);
    });
  });

  describe('the date basis, which is the day the money arrived', () => {
    it('states its basis and includes both ends of the range', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const { familyId } = await makeFamilyWithChild(harness, manager.token);

      const before = await clinicDay(harness, -3);
      const from = await clinicDay(harness, -2);
      const middle = await clinicDay(harness, -1);
      const to = await clinicDay(harness, 0);

      await pay(manager.token, familyId, { amountToman: '10000', receivedOn: before });
      const first = await pay(manager.token, familyId, { amountToman: '20000', receivedOn: from });
      const mid = await pay(manager.token, familyId, { amountToman: '30000', receivedOn: middle });
      const last = await pay(manager.token, familyId, { amountToman: '40000', receivedOn: to });

      const report = await okPayments(manager.token, { from, to });

      expect(report.range).toEqual({ from, to, dateBasis: 'PAYMENT_RECEIVED_ON' });

      // Both ends are inside, and the day before the range is outside.
      expect(report.payments.map((row) => row.id).sort()).toEqual([first, mid, last].sort());
      expect(report.totals.confirmedTotalToman).toBe('90000');

      // Newest received day first.
      expect(report.payments.map((row) => row.receivedOn)).toEqual([to, middle, from]);
    });

    it('reports a back-dated payment under the day it was received, not the day it was entered', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const { familyId } = await makeFamilyWithChild(harness, manager.token);

      const arrived = await clinicDay(harness, -4);
      const today = await clinicDay(harness, 0);

      // Received four days ago and typed in just now, which is the ordinary
      // "catching up on the receipts" case.
      const id = await pay(manager.token, familyId, { amountToman: '55000', receivedOn: arrived });

      const onTheDayItArrived = await okPayments(manager.token, { from: arrived, to: arrived });
      expect(onTheDayItArrived.payments.map((row) => row.id)).toEqual([id]);
      expect(onTheDayItArrived.totals.confirmedTotalToman).toBe('55000');

      // And it is NOT in today's report, though it was entered today. The
      // dashboard's reconciliation answers that other question, on the other
      // basis, through a different route.
      const today0 = await okPayments(manager.token, { from: today, to: today });
      expect(today0.payments).toHaveLength(0);
      expect(today0.totals.confirmedTotalToman).toBe('0');

      // The entry instant travels with the row anyway, so a back-dated payment
      // is visible AS one and the person who entered it is named.
      const row = onTheDayItArrived.payments[0];
      if (row === undefined) throw new Error('the back-dated payment was not reported');
      expect(row.receivedOn).toBe(arrived);
      expect(row.recordedAt.slice(0, 10) >= arrived).toBe(true);
    });
  });

  describe('what a void means, and what it never means', () => {
    it('counts a voided payment and sums it nowhere, shown or hidden', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const { familyId } = await makeFamilyWithChild(harness, manager.token);
      const today = await clinicDay(harness, 0);

      await pay(manager.token, familyId, { amountToman: '100000', receivedOn: today });
      const reversed = await pay(manager.token, familyId, {
        amountToman: '70000',
        receivedOn: today,
      });
      await voidPaymentOverHttp(harness, manager.token, reversed).expect(200);

      const shown = await okPayments(manager.token, { from: today, to: today });

      // Money the clinic says it never received is in no total, and the
      // reversal is counted so a manager can see that a correction happened.
      expect(shown.totals.confirmedCount).toBe(1);
      expect(shown.totals.confirmedTotalToman).toBe('100000');
      expect(shown.totals.voidedCount).toBe(1);
      expect(shown.payments).toHaveLength(2);
      expect(shown.payments.find((row) => row.id === reversed)?.status).toBe('VOIDED');

      // `includeVoided` is a filter on the LIST alone: every number above is
      // identical with the row hidden.
      const hidden = await okPayments(manager.token, {
        from: today,
        to: today,
        includeVoided: 'false',
      });

      expect(hidden.totals).toEqual(shown.totals);
      expect(hidden.payments).toHaveLength(1);
      expect(hidden.page.total).toBe(1);
    });

    it('attributes a wholly voided user to a zero confirmed count beside their reversals', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const desk = await operator('RECEPTIONIST', 'Synthetic Desk');
      const { familyId } = await makeFamilyWithChild(harness, manager.token);
      const today = await clinicDay(harness, 0);

      const wrong = await pay(desk.token, familyId, { amountToman: '90000', receivedOn: today });
      await voidPaymentOverHttp(harness, manager.token, wrong).expect(200);

      const report = await okPayments(manager.token, { from: today, to: today });
      const attributed = report.totals.byUser.find((row) => row.user.id === desk.id);

      expect(attributed).toEqual({
        user: { id: desk.id, displayName: desk.displayName },
        confirmedCount: 0,
        confirmedTotalToman: '0',
        voidedCount: 1,
      });
    });
  });

  describe('the filters and the summaries the server states', () => {
    it('breaks a period down by method and by the person who entered it', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const deskA = await operator('RECEPTIONIST', 'Synthetic Desk A');
      const deskB = await operator('RECEPTIONIST', 'Synthetic Desk B');
      const { familyId } = await makeFamilyWithChild(harness, manager.token);
      const today = await clinicDay(harness, 0);

      await pay(deskA.token, familyId, {
        amountToman: '100000',
        method: 'CASH',
        receivedOn: today,
      });
      await pay(deskA.token, familyId, {
        amountToman: '200000',
        method: 'CARD',
        receivedOn: today,
      });
      await pay(deskB.token, familyId, {
        amountToman: '300000',
        method: 'CARD',
        receivedOn: today,
      });

      const report = await okPayments(manager.token, { from: today, to: today });

      // All three methods, in the contract's order, zero-filled: a card
      // terminal reconciled against a bank statement has the same three lines
      // every period.
      expect(report.totals.byMethod.map((row) => row.method)).toEqual(['CASH', 'CARD', 'TRANSFER']);
      expect(report.totals.byMethod).toEqual([
        { method: 'CASH', confirmedCount: 1, confirmedTotalToman: '100000' },
        { method: 'CARD', confirmedCount: 2, confirmedTotalToman: '500000' },
        { method: 'TRANSFER', confirmedCount: 0, confirmedTotalToman: '0' },
      ]);

      // The per-user rows are the same money, grouped by the actor the WRITE
      // recorded, and they add up to the period total.
      expect(report.totals.byUser.map((row) => row.user.displayName)).toEqual([
        deskA.displayName,
        deskB.displayName,
      ]);

      const perUser = report.totals.byUser.reduce(
        (total, row) => total + BigInt(row.confirmedTotalToman),
        0n,
      );
      expect(perUser.toString()).toBe(report.totals.confirmedTotalToman);
      expect(report.totals.confirmedTotalToman).toBe('600000');

      const perMethod = report.totals.byMethod.reduce(
        (total, row) => total + BigInt(row.confirmedTotalToman),
        0n,
      );
      expect(perMethod.toString()).toBe(report.totals.confirmedTotalToman);
    });

    it('narrows by method and by recording user, and the summary follows the filter', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const desk = await operator('RECEPTIONIST', 'Synthetic Desk');
      const { familyId } = await makeFamilyWithChild(harness, manager.token);
      const today = await clinicDay(harness, 0);

      await pay(desk.token, familyId, { amountToman: '100000', method: 'CASH', receivedOn: today });
      await pay(manager.token, familyId, {
        amountToman: '200000',
        method: 'CARD',
        receivedOn: today,
      });

      const byMethod = await okPayments(manager.token, { from: today, to: today, method: 'CASH' });
      expect(byMethod.totals.confirmedTotalToman).toBe('100000');
      expect(byMethod.totals.byMethod).toEqual([
        { method: 'CASH', confirmedCount: 1, confirmedTotalToman: '100000' },
        { method: 'CARD', confirmedCount: 0, confirmedTotalToman: '0' },
        { method: 'TRANSFER', confirmedCount: 0, confirmedTotalToman: '0' },
      ]);
      expect(byMethod.totals.byUser.map((row) => row.user.id)).toEqual([desk.id]);

      const byUser = await okPayments(manager.token, {
        from: today,
        to: today,
        recordedByUserId: desk.id,
      });
      expect(byUser.payments.map((row) => row.recordedBy.id)).toEqual([desk.id]);
      expect(byUser.totals.confirmedTotalToman).toBe('100000');
    });

    it('refuses a filter that would put a colleague’s name in a query string', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const today = await clinicDay(harness, 0);

      // The strict frozen query refuses what it does not name, which is what
      // keeps free text out of browser history and access logs.
      const byName = await payments(manager.token, {
        from: today,
        to: today,
        recordedByUsername: 'synthetic',
      });
      expect(byName.status).toBe(400);

      const inverted = await payments(manager.token, {
        from: await clinicDay(harness, 0),
        to: await clinicDay(harness, -1),
      });
      expect(inverted.status).toBe(400);
    });
  });

  describe('paging, which moves rows and never moves a total', () => {
    it('states the same summary on every page', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const { familyId } = await makeFamilyWithChild(harness, manager.token);
      const today = await clinicDay(harness, 0);

      for (const amount of ['10000', '20000', '30000', '40000', '50000']) {
        await pay(manager.token, familyId, { amountToman: amount, receivedOn: today });
      }

      const first = await okPayments(manager.token, {
        from: today,
        to: today,
        page: 1,
        pageSize: 2,
      });
      const last = await okPayments(manager.token, {
        from: today,
        to: today,
        page: 3,
        pageSize: 2,
      });

      expect(first.totals).toEqual(last.totals);
      expect(first.totals.confirmedTotalToman).toBe('150000');
      expect(first.page).toEqual({ page: 1, pageSize: 2, total: 5, hasMore: true });
      expect(last.page).toEqual({ page: 3, pageSize: 2, total: 5, hasMore: false });
      expect(last.payments).toHaveLength(1);

      // No row appears twice and none is lost: the order is total.
      const walked = [...first.payments, ...last.payments].map((row) => row.id);
      expect(new Set(walked).size).toBe(walked.length);
    });

    it('reads a quiet period as a successful, zeroed answer', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const quiet = await clinicDay(harness, -30);

      const report = await okPayments(manager.token, { from: quiet, to: quiet });

      expect(report.payments).toEqual([]);
      expect(report.totals.confirmedCount).toBe(0);
      expect(report.totals.confirmedTotalToman).toBe('0');
      expect(report.totals.voidedCount).toBe(0);
      expect(report.totals.byUser).toEqual([]);
      expect(report.totals.byMethod.every((row) => row.confirmedTotalToman === '0')).toBe(true);
      expect(report.page.total).toBe(0);
    });
  });
});
