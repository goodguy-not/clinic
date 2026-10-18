import request from 'supertest';
import {
  clinicWideDashboardResponseSchema,
  familyAccountReportResponseSchema,
  familyAccountResponseSchema,
  familyBalanceSchema,
  familyDetailResponseSchema,
  paymentReportResponseSchema,
  promiseReportResponseSchema,
  type FamilyAccountReportResponse,
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
import { parseCsv } from './csv-support';
import { familyAccount } from './ledger-support';
import { clinicDay, createPromiseOverHttp, recordPaymentOverHttp } from './payment-support';
import { createHarness, resetDatabase, type Harness } from './harness';

/**
 * MONEY NEVER DISAPPEARS BECAUSE OF A FAMILY'S STATUS (Milestone 10, A6;
 * DECISION_LOG, 2026-10-01).
 *
 * EVERYTHING HERE IS SYNTHETIC, and every financial row was produced over HTTP
 * by the real booking, completion, payment and promise paths.
 *
 * Two halves. The DEACTIVATION GATE: a family that owes money or holds credit is
 * not deactivated until the person acknowledges the amount the server derives,
 * a stale acknowledgement is refused with the new amount, the acknowledgement is
 * audited, and a settled family is deactivated exactly as before. The
 * VISIBILITY: once deactivated, both families stay in the default family-balances
 * report and file, marked inactive, and every money summary — the report totals,
 * the payments and promises reports, the dashboard and the family account — is
 * unchanged by the deactivation.
 */
describe('deactivating a family that holds money (real PostgreSQL)', () => {
  let harness: Harness;
  let managerToken: string;
  let receptionistToken: string;
  let clinic: { serviceId: string; therapistId: string; roomId: string };
  let slots: string[];
  let nextSlot = 0;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    nextSlot = 0;

    managerToken = (await signIn(harness, 'MANAGER')).token;
    receptionistToken = (await signIn(harness, 'RECEPTIONIST')).token;

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
    slots = ['05:30', '06:15', '07:00', '07:45'].map((time) => `2026-09-05T${time}:00.000Z`);
  });

  /** A family with one 250,000-toman session charged through the real completion path. */
  const chargedFamily = async (firstName: string): Promise<string> => {
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

    return familyId;
  };

  const pay = async (familyId: string, amountToman: string) => {
    const response = await recordPaymentOverHttp(harness, receptionistToken, familyId, {
      amountToman,
      method: 'CASH',
      receivedOn: await clinicDay(harness, 0),
    });
    expect(response.status).toBe(200);
  };

  const deactivate = (familyId: string, body: Record<string, unknown> = {}, token?: string) =>
    request(harness.app.getHttpServer())
      .patch(`/families/${familyId}/status`)
      .set(asUser(token ?? receptionistToken))
      .send({ status: 'INACTIVE', ...body });

  const statusOf = async (familyId: string) =>
    (await harness.prisma.family.findUniqueOrThrow({ where: { id: familyId } })).status;

  const audits = (action: string, familyId: string) =>
    harness.prisma.auditLog.findMany({ where: { action, entityId: familyId } });

  /**
   * One owing family (250,000 due, with an overdue promise), one in credit
   * (150,000), one settled, and an active owing family that is never touched.
   */
  const seedClinic = async () => {
    const debtor = await chargedFamily('بدهکار');
    await createPromiseOverHttp(harness, managerToken, debtor, {
      amountToman: '50000',
      dueOn: await clinicDay(harness, -2),
    }).expect(200);

    const creditor = await chargedFamily('بستانکار');
    await pay(creditor, '400000');

    const { familyId: settled } = await makeFamilyWithChild(harness, managerToken, {
      firstName: 'بی‌حساب',
    });

    const control = await chargedFamily('فعال');

    return { debtor, creditor, settled, control };
  };

  describe('the gate', () => {
    it('refuses to deactivate a family that owes money, and says how much', async () => {
      const { debtor } = await seedClinic();

      const refused = await deactivate(debtor);

      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('FAMILY_BALANCE_UNACKNOWLEDGED');
      expect(familyBalanceSchema.parse(refused.body.error.details)).toEqual({
        amountDueToman: '250000',
        creditToman: '0',
      });
      // Nothing was written.
      expect(await statusOf(debtor)).toBe('ACTIVE');
      expect(await audits('family.status_changed', debtor)).toHaveLength(0);
    });

    it('refuses to deactivate a family that holds credit, and says how much', async () => {
      const { creditor } = await seedClinic();

      const refused = await deactivate(creditor);

      expect(refused.status).toBe(409);
      expect(refused.body.error.details).toEqual({ amountDueToman: '0', creditToman: '150000' });
      expect(await statusOf(creditor)).toBe('ACTIVE');
    });

    it('deactivates on the acknowledged amount, at the desk, and audits the acknowledgement', async () => {
      const { debtor } = await seedClinic();
      const shown = (await deactivate(debtor)).body.error.details;

      const done = await deactivate(debtor, { acknowledgedBalance: shown });

      expect(done.status).toBe(200);
      expect(familyDetailResponseSchema.parse(done.body).family.status).toBe('INACTIVE');

      const [changed] = await audits('family.status_changed', debtor);
      expect(changed?.after).toEqual({ status: 'INACTIVE' });
      const acknowledged = await audits('family.deactivated_with_balance', debtor);
      expect(acknowledged).toHaveLength(1);
      expect(acknowledged[0]?.metadata).toEqual({ amountDueToman: '250000', creditToman: '0' });
      expect(acknowledged[0]?.actorUserId).toBe(changed?.actorUserId);
    });

    it('refuses an acknowledgement that is no longer true, with the new amount', async () => {
      const { debtor } = await seedClinic();
      const shown = (await deactivate(debtor)).body.error.details;

      // Money arrives between the warning and the confirmation.
      await pay(debtor, '100000');
      const stale = await deactivate(debtor, { acknowledgedBalance: shown });

      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('FAMILY_BALANCE_UNACKNOWLEDGED');
      expect(stale.body.error.details).toEqual({ amountDueToman: '150000', creditToman: '0' });
      expect(await statusOf(debtor)).toBe('ACTIVE');
      expect(await audits('family.deactivated_with_balance', debtor)).toHaveLength(0);

      await deactivate(debtor, { acknowledgedBalance: stale.body.error.details }).expect(200);
    });

    it('deactivates a settled family exactly as before, with nothing to acknowledge', async () => {
      const { settled } = await seedClinic();

      await deactivate(settled).expect(200);

      expect(await statusOf(settled)).toBe('INACTIVE');
      expect(await audits('family.status_changed', settled)).toHaveLength(1);
      expect(await audits('family.deactivated_with_balance', settled)).toHaveLength(0);
    });

    it('refuses an acknowledgement on an activation, and reactivates without one', async () => {
      const { settled } = await seedClinic();
      await deactivate(settled).expect(200);

      const refused = await request(harness.app.getHttpServer())
        .patch(`/families/${settled}/status`)
        .set(asUser(receptionistToken))
        .send({ status: 'ACTIVE', acknowledgedBalance: { amountDueToman: '0', creditToman: '0' } });
      expect(refused.status).toBe(400);
      expect(refused.body.error.code).toBe('VALIDATION_FAILED');

      await request(harness.app.getHttpServer())
        .patch(`/families/${settled}/status`)
        .set(asUser(receptionistToken))
        .send({ status: 'ACTIVE' })
        .expect(200);
      expect(await statusOf(settled)).toBe('ACTIVE');
    });
  });

  describe('every money summary after the deactivation', () => {
    const familyReport = async (query: Record<string, string> = {}) => {
      const response = await request(harness.app.getHttpServer())
        .get('/reports/family-accounts')
        .query({ pageSize: 100, ...query })
        .set(asUser(managerToken))
        .expect(200);
      return familyAccountReportResponseSchema.parse(response.body);
    };

    const familyFile = async (query: Record<string, string> = {}) => {
      const response = await request(harness.app.getHttpServer())
        .get('/reports/family-accounts/export')
        .query(query)
        .set(asUser(managerToken))
        .expect(200);
      return parseCsv(response.text);
    };

    /** Everything a manager can read about the clinic's money, in one object. */
    const moneyEverywhere = async (ids: { debtor: string; creditor: string }) => {
      const today = await clinicDay(harness, 0);
      const range = { from: await clinicDay(harness, -60), to: await clinicDay(harness, 30) };
      const payments = paymentReportResponseSchema.parse(
        (
          await request(harness.app.getHttpServer())
            .get('/reports/payments')
            .query({ ...range, pageSize: 100 })
            .set(asUser(managerToken))
            .expect(200)
        ).body,
      );
      const promises = promiseReportResponseSchema.parse(
        (
          await request(harness.app.getHttpServer())
            .get('/reports/promises')
            .query({ ...range, pageSize: 100 })
            .set(asUser(managerToken))
            .expect(200)
        ).body,
      );
      const board = clinicWideDashboardResponseSchema.parse(
        (
          await request(harness.app.getHttpServer())
            .get('/dashboard')
            .query({ date: today })
            .set(asUser(managerToken))
            .expect(200)
        ).body,
      );
      const position = async (familyId: string) =>
        familyAccountResponseSchema.parse(
          (await familyAccount(harness, managerToken, familyId, {}).expect(200)).body,
        ).position;

      return {
        familyTotals: (await familyReport()).totals,
        familyTotalsWithInactive: (await familyReport({ includeInactive: 'true' })).totals,
        payments: { totals: payments.totals, rows: payments.payments.map((row) => row.id) },
        promises: { summary: promises.summary, rows: promises.promises.map((row) => row.id) },
        dashboard: { promises: board.promises, financial: board.clinicFinancial },
        debtor: await position(ids.debtor),
        creditor: await position(ids.creditor),
      };
    };

    const rowOf = (report: FamilyAccountReportResponse, familyId: string) =>
      report.families.find((row) => row.family.id === familyId);

    it('keeps both families in the default report, marked inactive, and changes no total', async () => {
      const { debtor, creditor, settled, control } = await seedClinic();
      const before = await moneyEverywhere({ debtor, creditor });

      for (const familyId of [debtor, creditor]) {
        const shown = (await deactivate(familyId)).body.error.details;
        await deactivate(familyId, { acknowledgedBalance: shown }).expect(200);
      }

      // Every money summary reads the same clinic it read before — down to the
      // number of families listed, because both still hold money.
      expect(await moneyEverywhere({ debtor, creditor })).toEqual(before);

      // A settled family leaves the default list and takes no toman with it.
      await deactivate(settled).expect(200);
      const afterSettled = await moneyEverywhere({ debtor, creditor });
      expect(afterSettled.familyTotals).toEqual({
        ...before.familyTotals,
        familyCount: before.familyTotals.familyCount - 1,
      });
      expect(afterSettled.familyTotalsWithInactive).toEqual(before.familyTotalsWithInactive);

      const byDefault = await familyReport();
      expect(rowOf(byDefault, debtor)?.family.status).toBe('INACTIVE');
      expect(rowOf(byDefault, debtor)?.position.amountDueToman).toBe('250000');
      expect(rowOf(byDefault, debtor)?.position.missedPromiseCount).toBe(1);
      expect(rowOf(byDefault, creditor)?.family.status).toBe('INACTIVE');
      expect(rowOf(byDefault, creditor)?.position.creditToman).toBe('150000');
      expect(rowOf(byDefault, control)?.family.status).toBe('ACTIVE');
      // A settled inactive family holds no money; the filter is how it is found.
      expect(rowOf(byDefault, settled)).toBeUndefined();
      expect(rowOf(await familyReport({ includeInactive: 'true' }), settled)?.family.status).toBe(
        'INACTIVE',
      );

      // The standings still find them.
      expect(rowOf(await familyReport({ standing: 'OWING' }), debtor)).toBeDefined();
      expect(rowOf(await familyReport({ standing: 'IN_CREDIT' }), creditor)).toBeDefined();
    });

    it('keeps both families in the default file, with the status in its own column', async () => {
      const { debtor, creditor, settled } = await seedClinic();
      for (const familyId of [debtor, creditor]) {
        const shown = (await deactivate(familyId)).body.error.details;
        await deactivate(familyId, { acknowledgedBalance: shown }).expect(200);
      }
      await deactivate(settled).expect(200);

      const { header, rows } = await familyFile();
      const cell = (familyId: string, heading: string) =>
        rows.find((row) => row[header.indexOf('شناسهٔ خانواده')] === familyId)?.[
          header.indexOf(heading)
        ];

      expect(cell(debtor, 'وضعیت پروندهٔ خانواده')).toBe('INACTIVE');
      expect(cell(debtor, 'مبلغ قابل پرداخت (تومان)')).toBe('250000');
      expect(cell(creditor, 'وضعیت پروندهٔ خانواده')).toBe('INACTIVE');
      expect(cell(creditor, 'اعتبار خانواده (تومان)')).toBe('150000');
      expect(cell(settled, 'وضعیت پروندهٔ خانواده')).toBeUndefined();

      // The file lists exactly what the screen lists.
      expect(rows.map((row) => row[header.indexOf('شناسهٔ خانواده')]).sort()).toEqual(
        (await familyReport()).families.map((row) => row.family.id).sort(),
      );
    });
  });
});
