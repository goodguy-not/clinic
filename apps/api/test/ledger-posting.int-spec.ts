import {
  appointmentResponseSchema,
  postSessionChargeResponseSchema,
  type SessionChargeDetail,
} from '@clinic/contracts';
import {
  cancel,
  complete,
  makeTariff,
  recordAttendance,
  reopen,
  signIn,
} from './appointments-support';
import { createHarness, resetDatabase, type Harness } from './harness';
import {
  chargeRowsFor,
  makeFreeTariff,
  postCharge,
  postedAuditRowsFor,
  seedBookedSession,
  voidCharge,
  voidChargeOverHttp,
  type BookedSession,
} from './ledger-support';

/**
 * Checkpoint A3: an eligible completed session produces its primary charge
 * automatically, and exactly once.
 *
 * THE RULE UNDER TEST IS A CONJUNCTION OF TWO FACTS RECORDED SEPARATELY —
 * `appointment.status = COMPLETED` and the seat's `attendance = ATTENDED` — and
 * the charge is created by whichever of them lands SECOND. Both orders are
 * therefore first-class here, because a clinic produces both: a receptionist
 * marks a child in on arrival and completes the session afterwards, or completes
 * the day in a batch and resolves attendance later. A suite that only tested
 * "attendance then completion" would pass against an implementation that charges
 * nobody whose attendance is recorded late.
 *
 * EVERYTHING RUNS AGAINST REAL POSTGRESQL AND OVER HTTP. The exactly-once
 * guarantee is a partial unique index, the clinic day is a PostgreSQL function,
 * the price precedence is one SQL fragment and the serialisation is a row lock —
 * none of which a mocked client can be wrong about in the same way the real one
 * can. Every fixture is synthetic: no real family, child, therapist, price or
 * amount appears anywhere in this project.
 */
describe('session charge posting (real PostgreSQL)', () => {
  let harness: Harness;
  let session: BookedSession;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
    session = await seedBookedSession(harness);
  });

  /** The ordinary price for the fixture's service, recorded before anything happens. */
  const priceIt = (priceToman = '250000'): Promise<string> =>
    makeTariff(harness, session.managerToken, {
      serviceId: session.serviceId,
      durationMinutes: 45,
      priceToman,
    });

  const attend = (attendance = 'ATTENDED') =>
    recordAttendance(
      harness,
      session.managerToken,
      session.appointmentId,
      session.participantId,
      attendance,
    );

  const finish = () => complete(harness, session.managerToken, session.appointmentId);

  const charges = () => chargeRowsFor(harness, session.participantId);

  describe('the two facts, in both orders', () => {
    it('charges the session when the attended child is completed', async () => {
      const tariffId = await priceIt();

      await attend().expect(200);
      await finish().expect(200);

      const rows = await charges();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        familyId: session.familyId,
        childId: session.childId,
        appointmentId: session.appointmentId,
        appointmentParticipantId: session.participantId,
        serviceId: session.serviceId,
        therapistId: session.therapistId,
        durationMinutes: 45,
        tariffId,
        priceMode: 'PAID',
        amountToman: 250000n,
        voidedAt: null,
      });
    });

    it('charges the session when attendance lands after the completion', async () => {
      await priceIt();

      // Completed first, with the seat still PENDING: nothing may be charged yet,
      // because a session that took place says nothing about who arrived for it.
      await finish().expect(200);
      expect(await charges()).toHaveLength(0);

      await attend().expect(200);

      const rows = await charges();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.amountToman).toBe(250000n);
    });

    it('charges nothing while the seat is still PENDING', async () => {
      await priceIt();
      await finish().expect(200);

      expect(await charges()).toHaveLength(0);
    });

    it('charges nothing for a NO_SHOW, in either order', async () => {
      await priceIt();

      await attend('NO_SHOW').expect(200);
      await finish().expect(200);
      expect(await charges()).toHaveLength(0);

      // And the other way round: a completed session whose seat is marked absent
      // afterwards is still no charge (CLAUDE.md — no-show policy is unresolved
      // and defaults to no charge).
      const other = await seedBookedSession(harness);
      await makeTariff(harness, other.managerToken, {
        serviceId: other.serviceId,
        durationMinutes: 45,
      });
      await complete(harness, other.managerToken, other.appointmentId).expect(200);
      await recordAttendance(
        harness,
        other.managerToken,
        other.appointmentId,
        other.participantId,
        'NO_SHOW',
      ).expect(200);

      expect(await chargeRowsFor(harness, other.participantId)).toHaveLength(0);
    });

    it('charges nothing for a cancelled session', async () => {
      await priceIt();
      await attend().expect(200);

      await cancel(harness, session.managerToken, session.appointmentId, {
        cancelledBy: 'CLINIC',
        reason: 'تعطیلی آزمایشی',
      }).expect(200);

      expect(await charges()).toHaveLength(0);

      // And it cannot be reached by completing afterwards: a cancelled booking
      // refuses the transition entirely.
      await finish().expect(409);
      expect(await charges()).toHaveLength(0);
    });
  });

  describe('what the charge snapshots', () => {
    it('records the clinic calendar day, not the reader’s', async () => {
      await priceIt();
      await attend().expect(200);
      await finish().expect(200);

      const rows = await charges();
      // 10:00 Tehran on 2026-09-05 is 06:30 UTC the same day, and
      // `clinic_date(starts_at)` is what decides it.
      expect(rows[0]?.serviceDate.toISOString().slice(0, 10)).toBe(session.serviceDate);
    });

    it('keeps the posted amount when the tariff is later replaced', async () => {
      const original = await priceIt('250000');
      await attend().expect(200);
      await finish().expect(200);

      // A price change is void-and-replace, exactly as the catalog models it.
      await makeTariff(harness, session.managerToken, {
        serviceId: session.serviceId,
        durationMinutes: 45,
        priceToman: '400000',
        effectiveStart: '2020-01-01',
        supersedesTariffId: original,
      });

      const rows = await charges();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.amountToman).toBe(250000n);
      expect(rows[0]?.tariffId).toBe(original);
    });

    it('creates a real zero charge for a genuinely FREE tariff', async () => {
      const tariffId = await makeFreeTariff(harness, session.managerToken, session.serviceId);

      await attend().expect(200);
      await finish().expect(200);

      const rows = await charges();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ tariffId, priceMode: 'FREE', amountToman: 0n });
    });
  });

  describe('a session nobody priced', () => {
    it('completes and records attendance without inventing a charge', async () => {
      await attend().expect(200);

      const completed = await finish().expect(200);
      expect(appointmentResponseSchema.parse(completed.body).appointment.status).toBe('COMPLETED');

      // The outcome stands and the session is visibly unpriced: no zero charge,
      // no rolled-back completion.
      expect(await charges()).toHaveLength(0);
    });

    it('charges the session once the pricing gap is corrected', async () => {
      await attend().expect(200);
      await finish().expect(200);

      const refused = await postCharge(harness, session.managerToken, session.participantId);
      expect(refused.status).toBe(404);
      expect(refused.body.error.code).toBe('TARIFF_MISSING');

      const tariffId = await priceIt('180000');

      const posted = await postCharge(harness, session.managerToken, session.participantId);
      expect(posted.status).toBe(200);

      const result = postSessionChargeResponseSchema.parse(posted.body);
      expect(result.outcome).toBe('POSTED');
      expect(result.charge.tariffId).toBe(tariffId);
      expect(result.charge.amountToman).toBe('180000');

      expect(await charges()).toHaveLength(1);
    });
  });

  describe('the explicit re-post', () => {
    it('refuses a session that was not completed, and one nobody attended', async () => {
      await priceIt();

      const pending = await postCharge(harness, session.managerToken, session.participantId);
      expect(pending.status).toBe(422);
      expect(pending.body.error.code).toBe('CHARGE_NOT_ELIGIBLE');

      await finish().expect(200);

      const unattended = await postCharge(harness, session.managerToken, session.participantId);
      expect(unattended.status).toBe(422);
      expect(unattended.body.error.code).toBe('CHARGE_NOT_ELIGIBLE');

      expect(await charges()).toHaveLength(0);
    });

    it('returns the same charge on a retry, and audits the posting once', async () => {
      await priceIt();
      await attend().expect(200);
      await finish().expect(200);

      const rows = await charges();
      expect(rows).toHaveLength(1);
      const chargeId = rows[0]?.id as string;

      const retry = await postCharge(harness, session.managerToken, session.participantId);
      expect(retry.status).toBe(200);

      const result = postSessionChargeResponseSchema.parse(retry.body);
      expect(result.outcome).toBe('ALREADY_POSTED');
      expect(result.charge.id).toBe(chargeId);

      // The retry is not a second act. One row, and one audit row describing it.
      expect(await charges()).toHaveLength(1);
      expect(await postedAuditRowsFor(harness, chargeId)).toHaveLength(1);
    });

    it('is idempotent across a double-click', async () => {
      await priceIt();
      await attend().expect(200);
      await finish().expect(200);

      const [first, second] = await Promise.all([
        postCharge(harness, session.managerToken, session.participantId),
        postCharge(harness, session.managerToken, session.participantId),
      ]);

      expect([first.status, second.status]).toEqual([200, 200]);
      expect(await charges()).toHaveLength(1);
    });

    it('raises a replacement after the wrong charge was voided', async () => {
      await priceIt();
      await attend().expect(200);
      await finish().expect(200);

      const [original] = await charges();
      const originalId = original?.id as string;

      // The A4 runtime does not exist yet; the void itself is written the way it
      // will be, which is all this test needs to prove that a withdrawn charge
      // leaves the partial unique index and lets a replacement take its place.
      await voidCharge(harness, { managerId: session.managerId }, originalId);

      const reposted = await postCharge(harness, session.managerToken, session.participantId);
      expect(reposted.status).toBe(200);

      const result = postSessionChargeResponseSchema.parse(reposted.body);
      expect(result.outcome).toBe('POSTED');
      expect(result.charge.id).not.toBe(originalId);

      const rows = await charges();
      expect(rows).toHaveLength(2);
      expect(rows.filter((row) => row.voidedAt === null)).toHaveLength(1);
    });

    it('refuses a participant that does not exist', async () => {
      const missing = '00000000-0000-7000-8000-000000000000';
      const response = await postCharge(harness, session.managerToken, missing);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('APPOINTMENT_PARTICIPANT_NOT_FOUND');
    });

    it('accepts no financial value from the caller', async () => {
      await priceIt();
      await attend().expect(200);
      await finish().expect(200);

      const response = await postCharge(harness, session.managerToken, session.participantId).send({
        amountToman: '1',
      });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('is held by the receptionist, who may raise a charge but not invent one', async () => {
      const receptionist = await signIn(harness, 'RECEPTIONIST');

      await priceIt();
      await attend().expect(200);
      await finish().expect(200);

      const response = await postCharge(harness, receptionist.token, session.participantId);
      expect(response.status).toBe(200);
      expect(postSessionChargeResponseSchema.parse(response.body).outcome).toBe('ALREADY_POSTED');
    });
  });

  describe('what the response and the audit trail carry', () => {
    it('reports the charge with its totals and no adjustments', async () => {
      await priceIt('250000');
      await attend().expect(200);
      await finish().expect(200);

      const response = await postCharge(harness, session.managerToken, session.participantId);
      const detail: SessionChargeDetail = postSessionChargeResponseSchema.parse(
        response.body,
      ).charge;

      expect(detail.adjustments).toEqual([]);
      expect(detail.activeAdjustmentTotalToman).toBe('0');
      expect(detail.effectiveAmountToman).toBe('250000');
      expect(detail.serviceDate).toBe(session.serviceDate);
      expect(detail.voidedAt).toBeNull();
    });

    it('records the financial fact and copies no personal data into it', async () => {
      await priceIt();
      await attend().expect(200);
      await finish().expect(200);

      const [charge] = await charges();
      const [row] = await postedAuditRowsFor(harness, charge?.id as string);

      expect(row?.entityType).toBe('session_charge');
      expect(row?.after).toMatchObject({
        familyId: session.familyId,
        childId: session.childId,
        appointmentParticipantId: session.participantId,
        priceMode: 'PAID',
        amountToman: '250000',
      });
      expect(row?.metadata).toMatchObject({ trigger: 'APPOINTMENT_COMPLETED' });

      // The payload names ids and money and nothing else: no name, no phone
      // number, no file number reaches this permanent, append-only table.
      const text = JSON.stringify(row?.after);
      expect(text).not.toContain('firstName');
      expect(text).not.toContain('fileNumber');
      expect(text).not.toContain('mobile');
    });

    it('names the act that raised the charge', async () => {
      await priceIt();
      await finish().expect(200);
      await attend().expect(200);

      const [charge] = await charges();
      const [row] = await postedAuditRowsFor(harness, charge?.id as string);

      expect(row?.metadata).toMatchObject({ trigger: 'ATTENDANCE_RECORDED' });
    });

    it('writes no posting row when nothing was posted', async () => {
      await priceIt();
      await attend('NO_SHOW').expect(200);
      await finish().expect(200);

      const rows = await harness.prisma.auditLog.findMany({
        where: { action: 'session_charge.posted' },
      });

      expect(rows).toHaveLength(0);
    });
  });

  describe('the Milestone 4 lifecycle is unchanged', () => {
    it('completes idempotently and still writes one completion audit row', async () => {
      await priceIt();
      await attend().expect(200);

      await finish().expect(200);
      await finish().expect(200);

      const completions = await harness.prisma.auditLog.findMany({
        where: { action: 'appointment.completed', entityId: session.appointmentId },
      });

      expect(completions).toHaveLength(1);
      expect(await charges()).toHaveLength(1);
    });

    it('never deletes or rewrites a posted charge when the completion is reversed', async () => {
      await priceIt();
      await attend().expect(200);
      await finish().expect(200);

      const chargeId = (await charges())[0]?.id ?? '';

      // The reversal is refused while the charge stands — checkpoint A4's guard —
      // and A3's own claim still holds on both sides of it: NOTHING silently
      // deletes or rewrites the charge. Not the refused reopen, and not the
      // successful one after the manager voids it by hand.
      await reopen(harness, session.managerToken, session.appointmentId, 'اصلاح آزمایشی').expect(
        409,
      );

      expect(await charges()).toHaveLength(1);
      expect((await charges())[0]?.voidedAt).toBeNull();

      await voidChargeOverHttp(harness, session.managerToken, chargeId, 'ابطال آزمایشی').expect(200);
      await reopen(harness, session.managerToken, session.appointmentId, 'اصلاح آزمایشی').expect(
        200,
      );

      const rows = await charges();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(chargeId);
      expect(rows[0]?.amountToman).toBe(250000n);
      // Voided by the manager's own explicit act, never as a side effect.
      expect(rows[0]?.voidedAt).not.toBeNull();
      expect(rows[0]?.voidReason).toBe('ابطال آزمایشی');
    });
  });
});
