import request from 'supertest';
import { adjustmentPortionsDetailsSchema, sessionChargeResponseSchema } from '@clinic/contracts';
import { asUser, complete, makeTariff, recordAttendance, signIn } from './appointments-support';
import { uuidv7 } from '../src/common/uuid';
import { createHarness, resetDatabase, type Harness } from './harness';
import {
  adjustmentAuditRowsFor,
  adjustmentRowsFor,
  adjustOverHttp,
  makeFreeTariff,
  postCharge,
  seedBookedSession,
  seedPostedSession,
  sqlStateOf,
  voidAdjustmentOverHttp,
  voidChargeOverHttp,
  type PostedSession,
} from './ledger-support';

/**
 * A genuinely complimentary session, charged through the real completion path.
 *
 * The tariff is `FREE` from the start rather than replacing a paid one, because
 * that is what the fact means: this programme was never priced. The resulting
 * charge is a real row of zero with `priceMode = FREE` (DECISION_LOG, 2026-08-06).
 */
async function seedFreeCharge(
  harness: Harness,
): Promise<{ token: string; chargeId: string; participantId: string }> {
  const booked = await seedBookedSession(harness);
  await makeFreeTariff(harness, booked.managerToken, booked.serviceId);

  await recordAttendance(
    harness,
    booked.managerToken,
    booked.appointmentId,
    booked.participantId,
    'ATTENDED',
  ).expect(200);
  await complete(harness, booked.managerToken, booked.appointmentId).expect(200);

  const charge = await harness.prisma.sessionCharge.findFirstOrThrow({
    where: { appointmentParticipantId: booked.participantId, voidedAt: null },
  });

  return { token: booked.managerToken, chargeId: charge.id, participantId: booked.participantId };
}

/**
 * Granting a concession on a session that happened, and taking one back.
 *
 * THE PREMISE THIS SUITE PROTECTS. An adjustment says three things at once: the
 * session happened, the charge stands, and the family owes less for it. Every
 * assertion below is about keeping those three true together — which means the
 * charge's own amount, its tariff and its snapshot must be exactly as raised
 * afterwards, and the reduction must be visible only as a separate row and the
 * two server-computed totals.
 *
 * EVERY CHARGE HERE WAS RAISED BY THE APPLICATION through the real completion
 * path, and every concession below goes through the real endpoint. The raw-SQL
 * fixtures stay in `ledger-schema.int-spec.ts`, where the question is what the
 * database refuses; here the question is what the service does.
 */
describe('charge adjustments: clinic-funded concessions and their void', () => {
  let harness: Harness;
  let session: PostedSession;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    session = await seedPostedSession(harness);
  });

  const adjust = (amountToman: string, reason?: string) =>
    adjustOverHttp(harness, session.managerToken, session.chargeId, amountToman, reason);

  const chargeRow = () =>
    harness.prisma.sessionCharge.findUniqueOrThrow({ where: { id: session.chargeId } });

  const adjustments = () => adjustmentRowsFor(harness, session.chargeId);

  describe('POST /session-charges/:chargeId/adjustments', () => {
    it('records a clinic-funded concession and returns the recomputed charge', async () => {
      const before = await chargeRow();

      const response = await adjust('50000', 'تخفیف مناسبتی');
      expect(response.status).toBe(200);

      const charge = sessionChargeResponseSchema.parse(response.body).charge;

      // The reduction is reported, and the server did the arithmetic.
      expect(charge.activeAdjustmentTotalToman).toBe('50000');
      expect(charge.effectiveAmountToman).toBe('200000');

      // NOT ONE FIELD OF THE CHARGE MOVED. A concession reduces what is owed; it
      // does not rewrite what the session was or what it was priced at.
      expect(charge.amountToman).toBe('250000');
      expect(charge.priceMode).toBe('PAID');
      expect(charge.tariffId).toBe(before.tariffId);
      expect(charge.serviceId).toBe(before.serviceId);
      expect(charge.therapistId).toBe(before.therapistId);
      expect(charge.createdAt).toBe(before.createdAt.toISOString());
      expect(charge.voidedAt).toBeNull();

      const stored = await chargeRow();
      expect(stored.amountToman).toBe(250000n);
      expect(stored.tariffId).toBe(before.tariffId);

      // The adjustment, as the frozen read carries it.
      expect(charge.adjustments).toHaveLength(1);
      const one = charge.adjustments[0];
      expect(one?.sessionChargeId).toBe(session.chargeId);
      expect(one?.amountToman).toBe('50000');
      expect(one?.reason).toBe('تخفیف مناسبتی');
      expect(one?.createdByUserId).toBe(session.managerId);
      expect(one?.voidedAt).toBeNull();
      expect(one?.voidedByUserId).toBeNull();
      expect(one?.voidReason).toBeNull();
    });

    it('writes the therapist portion as exactly zero and the clinic portion as the whole amount', async () => {
      const response = await adjust('50000');
      const charge = sessionChargeResponseSchema.parse(response.body).charge;

      expect(charge.adjustments[0]?.therapistDiscountToman).toBe('0');
      expect(charge.adjustments[0]?.clinicDiscountToman).toBe('50000');

      // The stored row, not just the response: every Milestone 5 concession is
      // genuinely borne in full by the clinic (DECISION_LOG, 2026-08-14).
      const rows = await adjustments();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.therapistDiscountToman).toBe(0n);
      expect(rows[0]?.clinicDiscountToman).toBe(50000n);
      expect(rows[0]?.amountToman).toBe(50000n);
    });

    /**
     * NO SUBMITTED THERAPIST PORTION IS EVER SILENTLY DROPPED. This is the C1/C2
     * regression, and it survives C4 unchanged in what it forbids while changing
     * why the refusal happens.
     *
     * Through Milestone 5 the request had no therapist portion at all, so the
     * schema refused one as `VALIDATION_FAILED`. C1 made the field submittable
     * ahead of the runtime that honours it and C2 refused every non-zero portion
     * outright. C4 honours a portion — but only where an authoritative applied
     * share exists to bear it, and `seedPostedSession` seeds no share rule, so
     * this session is UNRATED and the answer is still `ADJUSTMENT_SPLIT_INVALID`.
     *
     * What must NEVER hold is the state this test was written to prevent and
     * which briefly existed: a 200 whose stored row says the clinic bore
     * everything, when the manager submitted a shared concession.
     */
    it('refuses a therapist portion it cannot honour, rather than dropping it', async () => {
      const response = await request(harness.app.getHttpServer())
        .post(`/session-charges/${session.chargeId}/adjustments`)
        .set(asUser(session.managerToken))
        .send({
          amountToman: '50000',
          reason: 'تخفیف',
          therapistDiscountToman: '20000',
          clinicDiscountToman: '30000',
        });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('ADJUSTMENT_SPLIT_INVALID');

      // Nothing was written, and no audit row claims a concession was granted.
      expect(await adjustments()).toHaveLength(0);
      expect(
        await harness.prisma.auditLog.count({ where: { entityType: 'charge_adjustment' } }),
      ).toBe(0);
    });

    /**
     * The other half of the same rule. A caller stating a therapist portion of
     * ZERO and the clinic's as the whole is stating the clinic-borne concession
     * the server records, so what is stored is exactly what was submitted.
     */
    it('accepts an explicit therapist portion of zero, which loses nothing', async () => {
      const response = await request(harness.app.getHttpServer())
        .post(`/session-charges/${session.chargeId}/adjustments`)
        .set(asUser(session.managerToken))
        .send({
          amountToman: '50000',
          reason: 'تخفیف',
          therapistDiscountToman: '0',
          clinicDiscountToman: '50000',
        });

      expect(response.status).toBe(200);

      const rows = await adjustments();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.therapistDiscountToman).toBe(0n);
      expect(rows[0]?.clinicDiscountToman).toBe(50000n);
    });

    /**
     * M10.5 D10 (owner, R1-1): the manager states BOTH portions. An omitted one
     * is no longer "the clinic bears all" — it is refused, and nothing is written.
     */
    it('refuses a concession that omits either portion', async () => {
      for (const body of [
        { amountToman: '50000', reason: 'تخفیف' },
        { amountToman: '50000', reason: 'تخفیف', therapistDiscountToman: '0' },
        { amountToman: '50000', reason: 'تخفیف', clinicDiscountToman: '50000' },
      ]) {
        const response = await request(harness.app.getHttpServer())
          .post(`/session-charges/${session.chargeId}/adjustments`)
          .set(asUser(session.managerToken))
          .send(body);

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      }
      expect(await adjustments()).toHaveLength(0);
    });

    /** Portions that do not add up are refused with the three amounts, never reinterpreted. */
    it('refuses portions that do not add up to the concession, naming all three', async () => {
      const response = await request(harness.app.getHttpServer())
        .post(`/session-charges/${session.chargeId}/adjustments`)
        .set(asUser(session.managerToken))
        .send({
          amountToman: '50000',
          reason: 'تخفیف',
          therapistDiscountToman: '0',
          clinicDiscountToman: '40000',
        });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('ADJUSTMENT_PORTIONS_DO_NOT_ADD_UP');
      expect(adjustmentPortionsDetailsSchema.parse(response.body.error.details)).toEqual({
        amountToman: '50000',
        therapistDiscountToman: '0',
        clinicDiscountToman: '40000',
      });
      expect(await adjustments()).toHaveLength(0);
      expect(
        await harness.prisma.auditLog.count({ where: { entityType: 'charge_adjustment' } }),
      ).toBe(0);
    });

    it('refuses a receptionist with 403 and records nothing', async () => {
      const receptionist = await signIn(harness, 'RECEPTIONIST');

      const response = await adjustOverHttp(harness, receptionist.token, session.chargeId, '50000');

      expect(response.status).toBe(403);
      expect(await adjustments()).toHaveLength(0);
    });

    it('allows a full-value waiver, which is zero owed and still a PAID charge', async () => {
      const response = await adjust('250000', 'بخشش کامل جلسه');
      expect(response.status).toBe(200);

      const charge = sessionChargeResponseSchema.parse(response.body).charge;
      expect(charge.effectiveAmountToman).toBe('0');
      expect(charge.activeAdjustmentTotalToman).toBe('250000');

      // A PAID session waived to nothing is NOT a free session. The mode is what
      // says which it was, and the adjustment says who decided it and why — a
      // FREE charge has neither.
      expect(charge.priceMode).toBe('PAID');
      expect(charge.amountToman).toBe('250000');
      expect(charge.adjustments[0]?.reason).toBe('بخشش کامل جلسه');
      expect(charge.adjustments[0]?.createdByUserId).toBe(session.managerId);
    });

    it('keeps a waived PAID charge distinguishable from a genuinely free one', async () => {
      const waived = sessionChargeResponseSchema.parse(
        (await adjust('250000', 'بخشش کامل جلسه').expect(200)).body,
      ).charge;

      // A separate session that was never priced, charged through the real path.
      // Re-posting is the idempotent read of it: the charge comes back unchanged
      // as `ALREADY_POSTED`.
      const free = await seedFreeCharge(harness);
      const reposted = await postCharge(harness, free.token, free.participantId).expect(200);
      expect(reposted.body.outcome).toBe('ALREADY_POSTED');
      const complimentary = sessionChargeResponseSchema.parse({
        charge: reposted.body.charge,
      }).charge;

      // Both display zero owed.
      expect(waived.effectiveAmountToman).toBe('0');
      expect(complimentary.effectiveAmountToman).toBe('0');

      // And nothing else about them is the same.
      expect(waived.priceMode).toBe('PAID');
      expect(waived.amountToman).toBe('250000');
      expect(waived.adjustments).toHaveLength(1);

      expect(complimentary.priceMode).toBe('FREE');
      expect(complimentary.amountToman).toBe('0');
      expect(complimentary.adjustments).toHaveLength(0);
    });

    it('refuses any concession on a FREE charge, because there is nothing priced to reduce', async () => {
      const free = await seedFreeCharge(harness);

      const response = await adjustOverHttp(harness, free.token, free.chargeId, '1');

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('ADJUSTMENT_EXCEEDS_CHARGE');
      expect(await adjustmentRowsFor(harness, free.chargeId)).toHaveLength(0);
    });

    it('accumulates concessions up to the charge and refuses the one that would pass it', async () => {
      await adjust('100000', 'تخفیف اول').expect(200);
      const second = await adjust('150000', 'تخفیف دوم');

      expect(second.status).toBe(200);
      const charge = sessionChargeResponseSchema.parse(second.body).charge;
      expect(charge.activeAdjustmentTotalToman).toBe('250000');
      expect(charge.effectiveAmountToman).toBe('0');
      expect(charge.adjustments).toHaveLength(2);

      // Exactly at the charge is allowed; one toman past it is not.
      const third = await adjust('1', 'یک تومان بیشتر');
      expect(third.status).toBe(422);
      expect(third.body.error.code).toBe('ADJUSTMENT_EXCEEDS_CHARGE');
      expect(await adjustments()).toHaveLength(2);
    });

    it('counts only active adjustments against the remaining amount', async () => {
      const first = sessionChargeResponseSchema.parse((await adjust('200000')).body).charge;
      const firstId = first.adjustments[0]?.id ?? '';

      // 100,000 does not fit alongside 200,000.
      expect((await adjust('100000')).status).toBe(422);

      // Withdraw the first, and the same request now fits.
      await voidAdjustmentOverHttp(harness, session.managerToken, session.chargeId, firstId).expect(
        200,
      );

      const retry = await adjust('100000', 'پس از ابطال تخفیف نخست');
      expect(retry.status).toBe(200);

      const charge = sessionChargeResponseSchema.parse(retry.body).charge;
      expect(charge.activeAdjustmentTotalToman).toBe('100000');
      expect(charge.effectiveAmountToman).toBe('150000');
      // The voided one is still in the history, and still says what it said.
      expect(charge.adjustments).toHaveLength(2);
      expect(charge.adjustments.find((one) => one.id === firstId)?.amountToman).toBe('200000');
    });

    it('refuses a concession against a voided charge', async () => {
      await voidChargeOverHttp(harness, session.managerToken, session.chargeId, 'اصلاح').expect(
        200,
      );

      const response = await adjust('50000');

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CHARGE_VOIDED');
      expect(await adjustments()).toHaveLength(0);
    });

    it('refuses an unexplained or non-positive concession, and a charge that does not exist', async () => {
      const noReason = await request(harness.app.getHttpServer())
        .post(`/session-charges/${session.chargeId}/adjustments`)
        .set(asUser(session.managerToken))
        .send({ amountToman: '50000' });
      expect(noReason.status).toBe(400);

      const zero = await adjust('0');
      expect(zero.status).toBe(400);

      const missing = await adjustOverHttp(harness, session.managerToken, uuidv7(), '50000');
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('CHARGE_NOT_FOUND');

      expect(await adjustments()).toHaveLength(0);
    });

    it('writes exactly one charge_adjustment.created row, carrying no personal data', async () => {
      const response = await adjust('50000', 'تخفیف مناسبتی').expect(200);
      const adjustmentId = response.body.charge.adjustments[0].id as string;

      const rows = await adjustmentAuditRowsFor(harness, 'charge_adjustment.created', adjustmentId);
      expect(rows).toHaveLength(1);

      const row = rows[0];
      expect(row?.actorUserId).toBe(session.managerId);
      expect(row?.entityType).toBe('charge_adjustment');
      expect(row?.after).toEqual({
        sessionChargeId: session.chargeId,
        amountToman: '50000',
        therapistDiscountToman: '0',
        clinicDiscountToman: '50000',
        reason: 'تخفیف مناسبتی',
      });

      // Identifiers and amounts only — no name, no file number, no phone.
      expect(row?.metadata).toEqual({
        sessionChargeId: session.chargeId,
        familyId: session.familyId,
        childId: session.childId,
        appointmentId: session.appointmentId,
        appointmentParticipantId: session.participantId,
        chargeAmountToman: '250000',
      });

      // The audit row and the financial row share one instant.
      const stored = await adjustments();
      expect(row?.occurredAt).toEqual(stored[0]?.createdAt);
    });

    it('writes no audit row for a refused concession', async () => {
      await adjust('250001').expect(422);
      expect(
        await harness.prisma.auditLog.count({ where: { action: 'charge_adjustment.created' } }),
      ).toBe(0);
    });
  });

  describe('POST /session-charges/:chargeId/adjustments/:adjustmentId/void', () => {
    let adjustmentId: string;

    beforeEach(async () => {
      const response = await adjust('50000', 'تخفیف اولیه').expect(200);
      adjustmentId = response.body.charge.adjustments[0].id as string;
    });

    const voidIt = (token = session.managerToken, reason?: string) =>
      voidAdjustmentOverHttp(harness, token, session.chargeId, adjustmentId, reason);

    it('restores the amount the concession had removed, without deleting it', async () => {
      const response = await voidIt(session.managerToken, 'تخفیف اشتباه ثبت شده بود');
      expect(response.status).toBe(200);

      const charge = sessionChargeResponseSchema.parse(response.body).charge;
      expect(charge.activeAdjustmentTotalToman).toBe('0');
      expect(charge.effectiveAmountToman).toBe('250000');

      // NO DELETE. The row is still there, still says what it said, and now says
      // who withdrew it and why.
      const one = charge.adjustments[0];
      expect(charge.adjustments).toHaveLength(1);
      expect(one?.id).toBe(adjustmentId);
      expect(one?.amountToman).toBe('50000');
      expect(one?.therapistDiscountToman).toBe('0');
      expect(one?.clinicDiscountToman).toBe('50000');
      expect(one?.reason).toBe('تخفیف اولیه');
      expect(one?.voidedAt).not.toBeNull();
      expect(one?.voidedByUserId).toBe(session.managerId);
      expect(one?.voidReason).toBe('تخفیف اشتباه ثبت شده بود');

      const rows = await adjustments();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.amountToman).toBe(50000n);
      expect(rows[0]?.reason).toBe('تخفیف اولیه');
    });

    it('refuses a receptionist with 403 and changes nothing', async () => {
      const receptionist = await signIn(harness, 'RECEPTIONIST');

      const response = await voidIt(receptionist.token);

      expect(response.status).toBe(403);
      expect((await adjustments())[0]?.voidedAt).toBeNull();
      expect(
        await adjustmentAuditRowsFor(harness, 'charge_adjustment.voided', adjustmentId),
      ).toHaveLength(0);
    });

    it('refuses a second void without rewriting the first reason or actor', async () => {
      await voidIt(session.managerToken, 'دلیل اول').expect(200);
      const first = (await adjustments())[0];

      const other = await signIn(harness, 'MANAGER');
      const second = await voidIt(other.token, 'دلیل دوم');

      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('ADJUSTMENT_ALREADY_VOIDED');

      const after = (await adjustments())[0];
      expect(after?.voidedAt).toEqual(first?.voidedAt);
      expect(after?.voidedByUserId).toBe(session.managerId);
      expect(after?.voidReason).toBe('دلیل اول');
      expect(
        await adjustmentAuditRowsFor(harness, 'charge_adjustment.voided', adjustmentId),
      ).toHaveLength(1);
    });

    it('refuses an unexplained void, an unknown adjustment, and one belonging to another charge', async () => {
      const noReason = await request(harness.app.getHttpServer())
        .post(`/session-charges/${session.chargeId}/adjustments/${adjustmentId}/void`)
        .set(asUser(session.managerToken))
        .send({});
      expect(noReason.status).toBe(400);

      const unknown = await voidAdjustmentOverHttp(
        harness,
        session.managerToken,
        session.chargeId,
        uuidv7(),
      );
      expect(unknown.status).toBe(404);
      expect(unknown.body.error.code).toBe('ADJUSTMENT_NOT_FOUND');

      // The adjustment exists, but not against THIS charge. Not "found and
      // refused" — it is not this charge's adjustment.
      const other = await seedPostedSession(harness);
      const wrongParent = await voidAdjustmentOverHttp(
        harness,
        session.managerToken,
        other.chargeId,
        adjustmentId,
      );
      expect(wrongParent.status).toBe(404);
      expect(wrongParent.body.error.code).toBe('ADJUSTMENT_NOT_FOUND');

      expect((await adjustments())[0]?.voidedAt).toBeNull();
    });

    it('writes exactly one charge_adjustment.voided row, carrying no personal data', async () => {
      await voidIt(session.managerToken, 'اصلاح تخفیف').expect(200);

      const rows = await adjustmentAuditRowsFor(harness, 'charge_adjustment.voided', adjustmentId);
      expect(rows).toHaveLength(1);

      const row = rows[0];
      expect(row?.actorUserId).toBe(session.managerId);
      expect(row?.entityType).toBe('charge_adjustment');
      expect(row?.before).toEqual({ voidedAt: null });
      expect(row?.after).toMatchObject({ voidReason: 'اصلاح تخفیف' });
      expect(row?.metadata).toEqual({
        sessionChargeId: session.chargeId,
        familyId: session.familyId,
        childId: session.childId,
        appointmentId: session.appointmentId,
        appointmentParticipantId: session.participantId,
        chargeAmountToman: '250000',
        amountToman: '50000',
        therapistDiscountToman: '0',
        clinicDiscountToman: '50000',
      });

      const stored = (await adjustments())[0];
      expect(row?.occurredAt).toEqual(stored?.voidedAt);
    });

    it('cannot be used to rewrite the original amount or reason, even by the database', async () => {
      // The service has no path that edits these columns, and neither has anyone
      // else: the immutability trigger refuses the statement outright.
      expect(
        await sqlStateOf(
          harness.prisma.$executeRaw`
            UPDATE charge_adjustment SET amount_toman = 10000 WHERE id = ${adjustmentId}::uuid
          `,
        ),
      ).toBe('23001');

      expect(
        await sqlStateOf(
          harness.prisma.$executeRaw`
            UPDATE charge_adjustment SET reason = 'دلیل بازنویسی‌شده' WHERE id = ${adjustmentId}::uuid
          `,
        ),
      ).toBe('23001');

      // And a therapist-borne or incoherent allocation is still refused on
      // insert, whoever writes it.
      expect(
        await sqlStateOf(
          harness.prisma.$executeRaw`
            INSERT INTO charge_adjustment (
              id, session_charge_id, amount_toman, therapist_discount_toman,
              clinic_discount_toman, reason, created_at, created_by_user_id
            ) VALUES (
              ${uuidv7()}::uuid, ${session.chargeId}::uuid, 20000, 20000, 0,
              'سهم درمانگر', transaction_timestamp(), ${session.managerId}::uuid
            )
          `,
        ),
      ).toBe('23514');

      expect(
        await sqlStateOf(
          harness.prisma.$executeRaw`
            INSERT INTO charge_adjustment (
              id, session_charge_id, amount_toman, therapist_discount_toman,
              clinic_discount_toman, reason, created_at, created_by_user_id
            ) VALUES (
              ${uuidv7()}::uuid, ${session.chargeId}::uuid, 20000, 0, 5000,
              'تخصیص ناسازگار', transaction_timestamp(), ${session.managerId}::uuid
            )
          `,
        ),
      ).toBe('23514');

      const rows = await adjustments();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.amountToman).toBe(50000n);
      expect(rows[0]?.reason).toBe('تخفیف اولیه');
    });
  });

  describe('a charge and its adjustments when the charge is withdrawn', () => {
    it('leaves historical adjustments attached, unvoided and without financial effect', async () => {
      await adjust('50000', 'تخفیف پیش از ابطال').expect(200);

      const response = await voidChargeOverHttp(
        harness,
        session.managerToken,
        session.chargeId,
        'اصلاح مالی',
      );
      expect(response.status).toBe(200);

      const charge = sessionChargeResponseSchema.parse(response.body).charge;
      expect(charge.voidedAt).not.toBeNull();

      // NOT cleaned up, NOT auto-voided, NOT rewritten. The concession was
      // genuinely granted, and a voided charge contributes to no account total
      // whatever its arithmetic says.
      expect(charge.adjustments).toHaveLength(1);
      expect(charge.adjustments[0]?.voidedAt).toBeNull();
      expect(charge.adjustments[0]?.reason).toBe('تخفیف پیش از ابطال');
      expect(charge.activeAdjustmentTotalToman).toBe('50000');
      expect(charge.effectiveAmountToman).toBe('200000');

      const rows = await adjustments();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.voidedAt).toBeNull();

      // No adjustment void was recorded, because none happened.
      expect(
        await harness.prisma.auditLog.count({ where: { action: 'charge_adjustment.voided' } }),
      ).toBe(0);
    });

    it('lets a re-posted charge be adjusted from a clean slate', async () => {
      await adjust('250000', 'بخشش کامل').expect(200);
      await voidChargeOverHttp(
        harness,
        session.managerToken,
        session.chargeId,
        'قیمت اشتباه',
      ).expect(200);

      // A new price, a new charge, and none of the old charge's concessions.
      await makeTariff(harness, session.managerToken, {
        serviceId: session.serviceId,
        durationMinutes: 45,
        priceToman: '300000',
        effectiveStart: '2020-01-01',
        supersedesTariffId: session.tariffId,
      });

      const reposted = await postCharge(harness, session.managerToken, session.participantId);
      expect(reposted.status).toBe(200);
      expect(reposted.body.outcome).toBe('POSTED');

      const replacement = reposted.body.charge;
      expect(replacement.id).not.toBe(session.chargeId);
      expect(replacement.adjustments).toHaveLength(0);
      expect(replacement.effectiveAmountToman).toBe(replacement.amountToman);

      // The old charge keeps its own history, untouched.
      expect(await adjustments()).toHaveLength(1);
    });
  });
});
