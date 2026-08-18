import request from 'supertest';
import {
  clinicWideDashboardResponseSchema,
  dashboardResponseSchema,
  ownScopedDashboardResponseSchema,
  type DashboardResponse,
} from '@clinic/contracts';
import {
  asUser,
  bookId,
  bookingPayload,
  cancel,
  complete,
  makeFamilyWithChild,
  makeTariff,
  recordAttendance,
  seedClinic,
  signIn,
  SATURDAY,
} from './appointments-support';
import { voidChargeOverHttp } from './ledger-support';
import { recordPaymentOverHttp, voidPaymentOverHttp } from './payment-support';
import { createHarness, resetDatabase, type Harness } from './harness';

/**
 * The dashboard: `GET /dashboard` (Milestone 7, checkpoint C2).
 *
 * WHAT THIS SUITE IS FOR. The dashboard is the one screen in this system whose
 * SHAPE depends on who is asking, and the whole point of the frozen contract is
 * that a receptionist's response does not merely hide the clinic's finances — it
 * does not contain them. That is a claim about what NestJS puts on the wire, so
 * it is proved at the HTTP boundary, against the real guard chain, with two real
 * sessions. A unit test of the service could not fail in the way that matters.
 *
 * EVERYTHING HERE IS SYNTHETIC. No real family, child, therapist, amount, bank
 * reference or note appears in any fixture in this project.
 *
 * TWO CLINIC DAYS ARE IN PLAY, DELIBERATELY, because the dashboard keys two of
 * its blocks on two different days:
 *
 *   * the appointment, charge and data-issue blocks are about the day being
 *     LOOKED AT, which the fixtures place on `SATURDAY`;
 *   * the reconciliation is about the day a payment was ENTERED, which is
 *     whatever clinic day the test itself is running on — so the payment tests
 *     ask the server for that date rather than assuming the host's.
 *
 * The suite therefore reads the clinic's own `clinic_date()` rather than
 * computing a day in Node: Tehran rolls over at 20:30 UTC, and a test that
 * derived "today" from the test runner's clock would pass for twenty and a half
 * hours a day and fail for the other three and a half.
 */
describe('the dashboard', () => {
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

  const dashboard = (token: string, query: Record<string, string> = {}) =>
    request(harness.app.getHttpServer()).get('/dashboard').query(query).set(asUser(token));

  /** The clinic's own calendar day, asked of PostgreSQL and never of Node. */
  const clinicToday = async (): Promise<string> => {
    const rows = await harness.prisma.$queryRaw<{ today: string }[]>`
      SELECT clinic_date()::text AS today
    `;

    return rows[0]!.today;
  };

  const okDashboard = async (token: string, query: Record<string, string> = {}) => {
    const response = await dashboard(token, query);
    expect(response.status).toBe(200);

    return dashboardResponseSchema.parse(response.body);
  };

  /**
   * A day of money at the counter, entered by one named user.
   *
   * Recorded over HTTP through the real Milestone 6 endpoint, so `created_at`
   * and `created_by_user_id` are written by PostgreSQL and by the session, which
   * is exactly what the reconciliation is scoped by.
   */
  const pay = async (
    token: string,
    familyId: string,
    body: { amountToman: string; method: string; receivedOn: string },
  ): Promise<string> => {
    const response = await recordPaymentOverHttp(harness, token, familyId, body);
    expect(response.status).toBe(200);

    return response.body.payment.id as string;
  };

  describe('the authority boundary, which is the reason the response has two shapes', () => {
    /**
     * THE CENTRAL CLAIM OF THE FROZEN CONTRACT, PROVED ON ONE DAY WITH ONE SET
     * OF ROWS. The same clinic day, the same payments, two authorities: the
     * receptionist is told `OWN_ENTRIES_ONLY` and the manager `CLINIC_WIDE`, and
     * the difference is in the SHAPE of the response rather than in a field a
     * screen is trusted to hide.
     */
    it('answers the same day in the authority-specific shape for each caller', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const receptionist = await signIn(harness, 'RECEPTIONIST');
      const { familyId } = await makeFamilyWithChild(harness, manager.token);
      const today = await clinicToday();

      await pay(receptionist.token, familyId, {
        amountToman: '120000',
        method: 'CASH',
        receivedOn: today,
      });

      const asReceptionist = await okDashboard(receptionist.token, { date: today });
      const asManager = await okDashboard(manager.token, { date: today });

      expect(asReceptionist.financialScope).toBe('OWN_ENTRIES_ONLY');
      expect(asManager.financialScope).toBe('CLINIC_WIDE');

      // Both variants parse ONLY as their own variant: the strict schemas are
      // what make a leak a parse failure in both tiers rather than a field
      // somebody forgot to check.
      expect(ownScopedDashboardResponseSchema.safeParse(asReceptionist).success).toBe(true);
      expect(clinicWideDashboardResponseSchema.safeParse(asReceptionist).success).toBe(false);
      expect(clinicWideDashboardResponseSchema.safeParse(asManager).success).toBe(true);

      // The two describe the same day and the same diary.
      expect(asManager.date).toBe(today);
      expect(asReceptionist.date).toBe(today);
      expect(asManager.appointments).toEqual(asReceptionist.appointments);
    });

    /**
     * ABSENT, NOT NULL AND NOT EMPTY (the corrected C1 decision). A response
     * carrying a null or zeroed `clinicFinancial` would be indistinguishable
     * from an authorised one to a consumer that forgot to branch, so the key is
     * not on the object at all.
     */
    it('leaves clinic-wide financial content out of an own-scoped response entirely', async () => {
      const receptionist = await signIn(harness, 'RECEPTIONIST');

      const response = await dashboard(receptionist.token);
      expect(response.status).toBe(200);

      // Asserted on the raw JSON, before any schema has had a chance to strip a
      // key: this is a claim about the bytes NestJS sent.
      expect(Object.keys(response.body)).not.toContain('clinicFinancial');
      expect(JSON.stringify(response.body)).not.toContain('clinicFinancial');
      expect(response.body.financialScope).toBe('OWN_ENTRIES_ONLY');
    });

    /**
     * THE PER-USER ATTRIBUTION IS THE REASON THE BLOCK IS MANAGER-ONLY. A
     * receptionist's response names no other user at all; a manager's names
     * everybody who entered money that day.
     */
    it('delivers per-user financial attribution only under the financial authority', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const receptionist = await signIn(harness, 'RECEPTIONIST');
      const { familyId } = await makeFamilyWithChild(harness, manager.token);
      const today = await clinicToday();

      await pay(receptionist.token, familyId, {
        amountToman: '50000',
        method: 'CARD',
        receivedOn: today,
      });
      await pay(manager.token, familyId, {
        amountToman: '70000',
        method: 'CASH',
        receivedOn: today,
      });

      const own = await dashboard(receptionist.token, { date: today });
      expect(JSON.stringify(own.body)).not.toContain(manager.id);

      const wide = await okDashboard(manager.token, { date: today });
      if (wide.financialScope !== 'CLINIC_WIDE')
        throw new Error('expected the clinic-wide variant');

      expect(wide.clinicFinancial.payments.confirmedCount).toBe(2);
      expect(wide.clinicFinancial.payments.confirmedTotalToman).toBe('120000');
      expect(wide.clinicFinancial.payments.byUser.map((entry) => entry.user.id).sort()).toEqual(
        [manager.id, receptionist.id].sort(),
      );
    });

    /**
     * The route itself is the operational authority a receptionist already
     * holds, and the strict query is what makes "ask for somebody else's till" a
     * refused request rather than an ignored parameter.
     */
    it('refuses a parameter the frozen query does not carry', async () => {
      const receptionist = await signIn(harness, 'RECEPTIONIST');
      const other = await signIn(harness, 'MANAGER');

      await dashboard(receptionist.token, { userId: other.id }).expect(400);
    });
  });

  describe('the reconciliation block, which is always the caller’s own', () => {
    /**
     * SCOPED TO THE AUTHENTICATED ACTOR, IN BOTH VARIANTS. A manager balancing
     * their own till reads the same block a receptionist does — their own
     * entries, not the clinic's.
     */
    it('contains only the payments this caller recorded', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const receptionist = await signIn(harness, 'RECEPTIONIST');
      const { familyId } = await makeFamilyWithChild(harness, manager.token);
      const today = await clinicToday();

      const mine = await pay(receptionist.token, familyId, {
        amountToman: '40000',
        method: 'CASH',
        receivedOn: today,
      });
      const theirs = await pay(manager.token, familyId, {
        amountToman: '900000',
        method: 'TRANSFER',
        receivedOn: today,
      });

      const own = await okDashboard(receptionist.token, { date: today });

      expect(own.reconciliation.scope).toBe('RECORDED_BY_ME');
      expect(own.reconciliation.dateBasis).toBe('PAYMENT_RECORDED_AT');
      expect(own.reconciliation.confirmedCount).toBe(1);
      expect(own.reconciliation.confirmedTotalToman).toBe('40000');
      expect(own.reconciliation.entries.map((entry) => entry.payment.id)).toEqual([mine]);

      // The manager's own block is theirs alone too, even though their response
      // additionally carries the clinic's whole day.
      const wide = await okDashboard(manager.token, { date: today });
      expect(wide.reconciliation.entries.map((entry) => entry.payment.id)).toEqual([theirs]);
      expect(wide.reconciliation.confirmedTotalToman).toBe('900000');
    });

    /**
     * THE BASIS IS THE RECORDING INSTANT, AND THIS IS THE TEST THAT PINS IT.
     * Money handed over last week and entered this morning is in this morning's
     * drawer. A payments report keyed on `receivedOn` will put the same payment
     * under the earlier day, and neither reading is a correction of the other.
     */
    it('counts a back-dated payment on the day it was recorded, not on the day it arrived', async () => {
      const receptionist = await signIn(harness, 'RECEPTIONIST');
      const manager = await signIn(harness, 'MANAGER');
      const { familyId } = await makeFamilyWithChild(harness, manager.token);

      const today = await clinicToday();
      const lastWeek = new Date(`${today}T00:00:00.000Z`);
      lastWeek.setUTCDate(lastWeek.getUTCDate() - 7);
      const receivedOn = lastWeek.toISOString().slice(0, 10);

      const paymentId = await pay(receptionist.token, familyId, {
        amountToman: '250000',
        method: 'CARD',
        receivedOn,
      });

      const onToday = await okDashboard(receptionist.token, { date: today });
      expect(onToday.reconciliation.entries.map((entry) => entry.payment.id)).toEqual([paymentId]);
      expect(onToday.reconciliation.confirmedTotalToman).toBe('250000');
      // The entry still states the day the money actually arrived.
      expect(onToday.reconciliation.entries[0]?.payment.receivedOn).toBe(receivedOn);

      const onArrivalDay = await okDashboard(receptionist.token, { date: receivedOn });
      expect(onArrivalDay.reconciliation.entries).toEqual([]);
      expect(onArrivalDay.reconciliation.confirmedTotalToman).toBe('0');
    });

    /**
     * VOIDED MONEY IS COUNTED SEPARATELY AND SUMMED NOWHERE, and the entry that
     * was reversed still appears — saying, itself, that it was.
     */
    it('states a reversal without letting it into any total', async () => {
      const receptionist = await signIn(harness, 'RECEPTIONIST');
      const manager = await signIn(harness, 'MANAGER');
      const { familyId } = await makeFamilyWithChild(harness, manager.token);
      const today = await clinicToday();

      const kept = await pay(receptionist.token, familyId, {
        amountToman: '60000',
        method: 'CASH',
        receivedOn: today,
      });
      const withdrawn = await pay(receptionist.token, familyId, {
        amountToman: '80000',
        method: 'CASH',
        receivedOn: today,
      });

      await voidPaymentOverHttp(harness, manager.token, withdrawn).expect(200);

      const own = await okDashboard(receptionist.token, { date: today });

      expect(own.reconciliation.confirmedCount).toBe(1);
      expect(own.reconciliation.confirmedTotalToman).toBe('60000');
      expect(own.reconciliation.voidedCount).toBe(1);

      // The reversal is still one of this caller's entries for the day, and it
      // says so; it is the manager who voided it, and the entry stays here.
      expect(own.reconciliation.entries.map((entry) => entry.payment.id)).toEqual([
        kept,
        withdrawn,
      ]);
      expect(own.reconciliation.entries.map((entry) => entry.payment.status)).toEqual([
        'CONFIRMED',
        'VOIDED',
      ]);

      const cash = own.reconciliation.byMethod.find((total) => total.method === 'CASH');
      expect(cash).toEqual({ method: 'CASH', count: 1, totalToman: '60000' });
    });

    /** Three lines every day, so a reader never has to notice an absent method. */
    it('states every payment method, zero-filled and in the contract’s order', async () => {
      const receptionist = await signIn(harness, 'RECEPTIONIST');
      const own = await okDashboard(receptionist.token);

      expect(own.reconciliation.byMethod.map((total) => total.method)).toEqual([
        'CASH',
        'CARD',
        'TRANSFER',
      ]);
      expect(own.reconciliation.byMethod.every((total) => total.totalToman === '0')).toBe(true);
    });
  });

  describe('the two data-issue conditions, which are not the same condition', () => {
    /**
     * A PRICE THAT CANNOT BE RESOLVED IS A WARNING, NOT AN UNBILLED SESSION. The
     * session is still scheduled: completing it would raise no charge at all, so
     * counting it as uncharged would tell a manager to re-post something that
     * cannot be posted.
     */
    it('counts a session with no price as a missing tariff and not as unbilled', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const clinic = await seedClinic(harness, manager.token);
      await bookId(harness, manager.token, bookingPayload(clinic));

      const day = await okDashboard(manager.token, { date: SATURDAY });

      expect(day.dataIssues.missingTariffCount).toBe(1);
      expect(day.dataIssues.unchargedCompletedSessionCount).toBe(0);
    });

    /**
     * AND THE OTHER DIRECTION, WHICH IS THE ONE A SINGLE COUNT WOULD HIDE. The
     * price list resolves perfectly, the session is completed and attended, and
     * the manager has voided the charge: nothing is missing, and the clinic has
     * earned money it is not recording. `findValidChargeForParticipant` ignores
     * voided rows, which is exactly what makes the re-post idempotent rather
     * than blocked.
     */
    it('counts a voided charge on a completed, attended seat as unbilled with no tariff missing', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const clinic = await seedClinic(harness, manager.token);
      const appointmentId = await bookId(harness, manager.token, bookingPayload(clinic));

      const participant = await harness.prisma.appointmentParticipant.findFirstOrThrow({
        where: { appointmentId },
      });

      await makeTariff(harness, manager.token, { serviceId: clinic.serviceId });
      await recordAttendance(
        harness,
        manager.token,
        appointmentId,
        participant.id,
        'ATTENDED',
      ).expect(200);
      await complete(harness, manager.token, appointmentId).expect(200);

      const charged = await okDashboard(manager.token, { date: SATURDAY });
      expect(charged.dataIssues).toEqual({
        missingTariffCount: 0,
        unchargedCompletedSessionCount: 0,
      });

      const charge = await harness.prisma.sessionCharge.findFirstOrThrow({
        where: { appointmentParticipantId: participant.id, voidedAt: null },
      });
      await voidChargeOverHttp(harness, manager.token, charge.id).expect(200);

      const afterVoid = await okDashboard(manager.token, { date: SATURDAY });
      expect(afterVoid.dataIssues.unchargedCompletedSessionCount).toBe(1);
      expect(afterVoid.dataIssues.missingTariffCount).toBe(0);
    });

    /**
     * A CANCELLED SESSION IS NEITHER. It will never be priced and can never be
     * charged, so counting it would put a permanent number on a screen whose
     * whole purpose is a list of things somebody can act on.
     */
    it('counts neither condition for a cancelled session', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const clinic = await seedClinic(harness, manager.token);
      const appointmentId = await bookId(harness, manager.token, bookingPayload(clinic));

      await cancel(harness, manager.token, appointmentId, {
        cancelledBy: 'FAMILY',
        reason: 'لغو آزمایشی',
      }).expect(200);

      const day = await okDashboard(manager.token, { date: SATURDAY });

      expect(day.dataIssues).toEqual({
        missingTariffCount: 0,
        unchargedCompletedSessionCount: 0,
      });
      expect(day.appointments.cancelled).toBe(1);
    });
  });

  describe('the derived readings it reuses rather than restates', () => {
    /**
     * `MISSED` IS DERIVED AND IS NEVER STORED, and it is deliberately NOT scoped
     * to the dashboard's day: an overdue promise from last week is still overdue
     * this morning, which is the whole reason the count is on this screen.
     */
    it('reads promises the way the family position reads them', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const receptionist = await signIn(harness, 'RECEPTIONIST');
      const { familyId } = await makeFamilyWithChild(harness, manager.token);
      const today = await clinicToday();

      const day = new Date(`${today}T00:00:00.000Z`);
      day.setUTCDate(day.getUTCDate() - 3);
      const overdue = day.toISOString().slice(0, 10);

      const promise = (body: Record<string, unknown>) =>
        request(harness.app.getHttpServer())
          .post(`/families/${familyId}/promises`)
          .set(asUser(receptionist.token))
          .send(body);

      await promise({ amountToman: '100000', dueOn: today }).expect(200);
      await promise({ amountToman: '200000', dueOn: overdue }).expect(200);

      const own = await okDashboard(receptionist.token, { date: today });

      expect(own.promises).toEqual({ dueTodayCount: 1, missedCount: 1 });

      // The overdue promise stays on the screen when an earlier day is reviewed:
      // `missedCount` is keyed on the clinic's today, not on the day being read.
      const yesterday = new Date(`${today}T00:00:00.000Z`);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const earlier = await okDashboard(receptionist.token, {
        date: yesterday.toISOString().slice(0, 10),
      });
      expect(earlier.promises.missedCount).toBe(1);
      expect(earlier.promises.dueTodayCount).toBe(0);
    });

    /**
     * THE BADGE AND THE LIST BENEATH IT ARE ONE READING. The dashboard's
     * appointment counts are `AppointmentReadService`'s own summary, so the
     * screen and `GET /appointment-day` cannot disagree about the day — including
     * about `unresolvedOutcomes`, which is computed against the database clock.
     */
    it('states the same appointment counts as the day view it is a summary of', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const clinic = await seedClinic(harness, manager.token);
      const appointmentId = await bookId(harness, manager.token, bookingPayload(clinic));
      await complete(harness, manager.token, appointmentId).expect(200);

      const dayView = await request(harness.app.getHttpServer())
        .get('/appointment-day')
        .query({ date: SATURDAY })
        .set(asUser(manager.token))
        .expect(200);

      const board = await okDashboard(manager.token, { date: SATURDAY });

      expect(board.appointments).toEqual(dayView.body.summary);
      expect(board.appointments.completed).toBe(1);
    });

    /**
     * THE CLINIC'S CHARGES ARE KEYED ON THE SESSION'S DAY, and the payments
     * beside them on the day they were entered. Two blocks, two bases, and
     * nothing subtracts one from the other.
     */
    it('keys the clinic-wide charge block on the session date', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const clinic = await seedClinic(harness, manager.token);
      const appointmentId = await bookId(harness, manager.token, bookingPayload(clinic));

      const participant = await harness.prisma.appointmentParticipant.findFirstOrThrow({
        where: { appointmentId },
      });

      await makeTariff(harness, manager.token, {
        serviceId: clinic.serviceId,
        priceToman: '250000',
      });
      await recordAttendance(
        harness,
        manager.token,
        appointmentId,
        participant.id,
        'ATTENDED',
      ).expect(200);
      await complete(harness, manager.token, appointmentId).expect(200);

      const onSessionDay = await okDashboard(manager.token, { date: SATURDAY });
      if (onSessionDay.financialScope !== 'CLINIC_WIDE') throw new Error('expected CLINIC_WIDE');

      expect(onSessionDay.clinicFinancial.charges).toEqual({
        dateBasis: 'SESSION_DATE',
        chargeCount: 1,
        netChargedTotalToman: '250000',
        voidedChargeCount: 0,
      });

      // The charge was POSTED today and belongs to the session's day, not to
      // this one.
      const onPostingDay = await okDashboard(manager.token, { date: await clinicToday() });
      if (onPostingDay.financialScope !== 'CLINIC_WIDE') throw new Error('expected CLINIC_WIDE');
      expect(onPostingDay.clinicFinancial.charges.chargeCount).toBe(0);
    });
  });

  describe('a quiet day', () => {
    /**
     * AN EMPTY DASHBOARD IS A SUCCESSFUL READ, in both variants. A day the
     * clinic did nothing in is an answer, not a missing resource — there is no
     * `REPORT_NOT_FOUND` anywhere in `ERROR_CODES`, deliberately.
     */
    it('is a valid successful response for both authorities', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const receptionist = await signIn(harness, 'RECEPTIONIST');
      const quiet = '2019-01-05';

      const own = await okDashboard(receptionist.token, { date: quiet });
      const wide = await okDashboard(manager.token, { date: quiet });

      const emptyish = (response: DashboardResponse) => {
        expect(response.date).toBe(quiet);
        expect(response.appointments.total).toBe(0);
        expect(response.dataIssues).toEqual({
          missingTariffCount: 0,
          unchargedCompletedSessionCount: 0,
        });
        expect(response.reconciliation.confirmedCount).toBe(0);
        expect(response.reconciliation.confirmedTotalToman).toBe('0');
        expect(response.reconciliation.entries).toEqual([]);
      };

      emptyish(own);
      emptyish(wide);

      if (wide.financialScope !== 'CLINIC_WIDE') throw new Error('expected CLINIC_WIDE');
      expect(wide.clinicFinancial.payments.confirmedTotalToman).toBe('0');
      expect(wide.clinicFinancial.payments.byUser).toEqual([]);
      expect(wide.clinicFinancial.charges.netChargedTotalToman).toBe('0');
    });

    /**
     * THE SERVER DECIDES TODAY. `date` is optional, and the day the server used
     * is echoed — a screen that cannot say which day it is showing is a screen
     * that will eventually show yesterday without saying so.
     */
    it('defaults to the clinic’s own calendar day and echoes it', async () => {
      const receptionist = await signIn(harness, 'RECEPTIONIST');

      const response = await okDashboard(receptionist.token);

      expect(response.date).toBe(await clinicToday());
    });
  });
});
