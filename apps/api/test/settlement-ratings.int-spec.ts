import request from 'supertest';
import { sessionSettlementResponseSchema, shareRuleResponseSchema } from '@clinic/contracts';
import { uuidv7 } from '../src/common/uuid';
import { asUser, signIn } from './appointments-support';
import { createHarness, resetDatabase, type Harness, ownerPrisma } from './harness';
import { adjustOverHttp, voidChargeOverHttp } from './ledger-support';
import {
  correctRatingOverHttp,
  makeShareRule,
  ratingAuditRows,
  ratingRowsFor,
  rateOverHttp,
  readRatingOverHttp,
  seedChargedSession,
  shareRuleId,
  voidRatingOverHttp,
  voidShareRule,
} from './settlement-support';

/**
 * The applied therapist share snapshot, over real HTTP against real PostgreSQL.
 *
 * Everything is synthetic. No real family, child, therapist, price, percentage
 * or agreement appears in any fixture.
 *
 * THE ONE THING EVERY TEST BELOW IS ABOUT: a rated session records what it
 * EARNED, once, and no later change to the configuration, the rounding rule or
 * the therapist's current agreement may restate it — while an UNRATED session is
 * the ABSENCE of that record and is never a zero.
 */
describe('session settlement ratings (real PostgreSQL)', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  const settlementOf = (body: unknown) => sessionSettlementResponseSchema.parse(body).settlement;

  // -------------------------------------------------------------------------
  // Authorization
  // -------------------------------------------------------------------------

  describe('authorization', () => {
    /**
     * The receptionist's refusal is total, INCLUDING THE READ. They may post the
     * charge for a session that happened — diary work that cannot duplicate
     * money — and what the therapist takes home from it is not theirs to see
     * (PROJECT_SPEC.md 4).
     */
    it.each([
      ['rate', 'post', `/settlement/session-charges/${uuidv7()}/rating`, { reason: 'x' }],
      ['read', 'get', `/settlement/session-charges/${uuidv7()}/rating`, undefined],
      ['void', 'post', `/settlement/session-ratings/${uuidv7()}/void`, { reason: 'x' }],
      ['correct', 'post', '/settlement/rating-corrections', {}],
    ])('refuses a receptionist %s', async (_label, method, path, body) => {
      const { token } = await signIn(harness, 'RECEPTIONIST');

      const call =
        method === 'get'
          ? request(harness.app.getHttpServer()).get(path).set(asUser(token))
          : request(harness.app.getHttpServer()).post(path).set(asUser(token)).send(body);

      const response = await call;
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('writes no rating and no audit row for a refused receptionist rating', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: null });
      const receptionist = await signIn(harness, 'RECEPTIONIST');

      const refused = await rateOverHttp(harness, receptionist.token, fixture.chargeId);

      expect(refused.status).toBe(403);
      expect(await ratingRowsFor(harness, fixture.chargeId)).toHaveLength(0);
      expect(await ratingAuditRows(harness)).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Automatic rating at charge creation
  // -------------------------------------------------------------------------

  describe('automatic rating when the charge is posted', () => {
    it('snapshots the applied share beside the charge, and audits it', async () => {
      const fixture = await seedChargedSession(harness, {
        shareBasisPoints: 4250,
        priceToman: '250000',
      });

      const rows = await ratingRowsFor(harness, fixture.chargeId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        sessionChargeId: fixture.chargeId,
        appointmentParticipantId: fixture.participantId,
        therapistId: fixture.therapistId,
        appliedShareBasisPoints: 4250,
        ratedVia: 'AUTOMATIC',
        baseAmountToman: 250000n,
        // 250000 * 42.5% = 106250 exactly; the clinic takes the residual.
        therapistGrossToman: 106250n,
        clinicGrossToman: 143750n,
        reason: null,
        supersedesSessionSettlementId: null,
        voidedAt: null,
      });
      expect(rows[0]?.appliedShareRuleId).not.toBeNull();
      expect(rows[0]?.createdByUserId).toBe(fixture.managerId);

      const audit = await ratingAuditRows(harness);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        action: 'session_settlement.rated',
        entityType: 'session_settlement',
        entityId: rows[0]?.id,
        actorUserId: fixture.managerId,
      });
      expect(audit[0]?.after).toMatchObject({
        therapistId: fixture.therapistId,
        appliedShareBasisPoints: 4250,
        ratedVia: 'AUTOMATIC',
        baseAmountToman: '250000',
        therapistGrossToman: '106250',
        clinicGrossToman: '143750',
      });
      expect(audit[0]?.metadata).toMatchObject({ trigger: 'CHARGE_POSTED' });
      // A settlement fact is about a therapist and a session. Who was treated is
      // the LEDGER's fact and is already on `session_charge.posted`; copying it
      // here would be a second undeletable store of who was seen.
      expect(JSON.stringify(audit[0])).not.toContain(fixture.familyId);
      expect(JSON.stringify(audit[0])).not.toContain(fixture.childId);
    });

    it('rounds the therapist half up and gives the clinic the exact residual', async () => {
      const fixture = await seedChargedSession(harness, {
        shareBasisPoints: 5000,
        priceToman: '12345',
      });

      const rows = await ratingRowsFor(harness, fixture.chargeId);
      // 6172.5 -> 6173. Half-even or truncation would both give 6172.
      expect(rows[0]?.therapistGrossToman).toBe(6173n);
      expect(rows[0]?.clinicGrossToman).toBe(6172n);
      expect((rows[0]?.therapistGrossToman ?? 0n) + (rows[0]?.clinicGrossToman ?? 0n)).toBe(12345n);
    });

    it('rates a FREE session at zero, which is a fact and not an absence', async () => {
      const fixture = await seedChargedSession(harness, {
        priceMode: 'FREE',
        shareBasisPoints: 4000,
      });

      const rows = await ratingRowsFor(harness, fixture.chargeId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        baseAmountToman: 0n,
        therapistGrossToman: 0n,
        clinicGrossToman: 0n,
        appliedShareBasisPoints: 4000,
      });

      // FREE and UNRATED are structurally different: this session HAS a rating
      // and it reads back; an unrated one refuses.
      const read = await readRatingOverHttp(harness, fixture.managerToken, fixture.chargeId);
      expect(read.status).toBe(200);
      expect(settlementOf(read.body).therapistGrossToman).toBe('0');
    });

    it('accepts a zero share as a real agreement, not as an unconfigured one', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: 0 });

      const rows = await ratingRowsFor(harness, fixture.chargeId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        appliedShareBasisPoints: 0,
        therapistGrossToman: 0n,
        clinicGrossToman: 250000n,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Unrated
  // -------------------------------------------------------------------------

  describe('a session with no applicable share rule', () => {
    it('still gets its charge, and gets no rating of any kind', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: null });

      const charge = await harness.prisma.sessionCharge.findUniqueOrThrow({
        where: { id: fixture.chargeId },
      });
      expect(charge.voidedAt).toBeNull();
      expect(charge.amountToman).toBe(250000n);

      // The absence IS the state. Not a zero row, not a row with a null share.
      expect(await ratingRowsFor(harness, fixture.chargeId)).toHaveLength(0);
      expect(await ratingAuditRows(harness)).toHaveLength(0);
    });

    it('reports the absence as a refusal rather than as a zero', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: null });

      const read = await readRatingOverHttp(harness, fixture.managerToken, fixture.chargeId);
      expect(read.status).toBe(422);
      expect(read.body.error.code).toBe('SESSION_NOT_RATED');
      expect(JSON.stringify(read.body)).not.toMatch(/"(therapistGross|appliedShare)/);
    });

    it('is NOT backfilled by a share rule recorded afterwards', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: null });

      // A rule that covers the session date perfectly, created after the fact.
      await shareRuleId(harness, fixture.managerToken, fixture.therapistId, {
        shareBasisPoints: 4000,
        effectiveStart: '2020-01-01',
      });

      expect(await ratingRowsFor(harness, fixture.chargeId)).toHaveLength(0);

      // Reading it again does not create one either — no read path may write.
      const read = await readRatingOverHttp(harness, fixture.managerToken, fixture.chargeId);
      expect(read.status).toBe(422);
      expect(await ratingRowsFor(harness, fixture.chargeId)).toHaveLength(0);
      expect(await ratingAuditRows(harness)).toHaveLength(0);
    });

    it('leaves the session unrated when the rule covers only later dates', async () => {
      // Resolution is by the SERVICE DATE and by nothing else. A rule that began
      // after the session is not this session's agreement, however current it is.
      const fixture = await seedChargedSession(harness, {
        shareBasisPoints: 4000,
        ruleStart: '2027-01-01',
      });

      expect(await ratingRowsFor(harness, fixture.chargeId)).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Explicit rating of an unrated historical session
  // -------------------------------------------------------------------------

  describe('explicit rating', () => {
    it('resolves the rate against the session date, not against today', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: null });

      // Two agreements: one that covered the session's day and ended, and the
      // one in force now. Rating the session must apply the FIRST.
      await shareRuleId(harness, fixture.managerToken, fixture.therapistId, {
        shareBasisPoints: 3000,
        effectiveStart: '2020-01-01',
        effectiveEnd: '2026-09-30',
      });
      const current = await shareRuleId(harness, fixture.managerToken, fixture.therapistId, {
        shareBasisPoints: 6000,
        effectiveStart: '2026-10-01',
      });

      const response = await rateOverHttp(harness, fixture.managerToken, fixture.chargeId);
      expect(response.status).toBe(201);

      const settlement = settlementOf(response.body);
      expect(settlement).toMatchObject({
        appliedShareBasisPoints: 3000,
        ratedVia: 'EXPLICIT',
        serviceDate: fixture.serviceDate,
        baseAmountToman: '250000',
        therapistGrossToman: '75000',
        clinicGrossToman: '175000',
      });
      // Provenance is the rule that covered the SERVICE DATE, never today's.
      expect(settlement.appliedShareRuleId).not.toBe(current);
      expect(settlement.reason).toBe('قاعده سهم پس از ثبت هزینه وارد شد');
    });

    it('names the rule it resolved, so the percentage is never a figure from nowhere', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: null });
      const ruleId = await shareRuleId(harness, fixture.managerToken, fixture.therapistId, {
        shareBasisPoints: 4000,
      });

      const response = await rateOverHttp(harness, fixture.managerToken, fixture.chargeId);

      expect(response.status).toBe(201);
      expect(settlementOf(response.body).appliedShareRuleId).toBe(ruleId);
    });

    /**
     * THE RULE THIS CHECKPOINT REVISION EXISTS FOR. A share rule is the only
     * source of settlement policy: a percentage typed onto one session would
     * have no effective date, no supersession history and no void trail, and two
     * sessions on the same day for the same therapist could settle differently
     * with nothing in the record saying why.
     */
    it('refuses a directly supplied percentage, whatever it is called', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: null });
      await shareRuleId(harness, fixture.managerToken, fixture.therapistId, {
        shareBasisPoints: 4000,
      });

      for (const field of ['shareBasisPoints', 'appliedShareBasisPoints', 'sharePercent']) {
        const response = await rateOverHttp(harness, fixture.managerToken, fixture.chargeId, {
          reason: 'توافق موردی برای این جلسه',
          [field]: 9000,
        });

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      }

      expect(await ratingRowsFor(harness, fixture.chargeId)).toHaveLength(0);
      expect(await ratingAuditRows(harness)).toHaveLength(0);
    });

    it('refuses a submitted provenance, so the act cannot be misreported', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: null });
      await shareRuleId(harness, fixture.managerToken, fixture.therapistId, {
        shareBasisPoints: 4000,
      });

      for (const ratedVia of ['AUTOMATIC', 'EXPLICIT']) {
        const response = await rateOverHttp(harness, fixture.managerToken, fixture.chargeId, {
          reason: 'دلیل آزمایشی',
          ratedVia,
        });

        expect(response.status).toBe(400);
      }

      expect(await ratingRowsFor(harness, fixture.chargeId)).toHaveLength(0);
    });

    it('refuses when no rule covers the service date, and writes nothing', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: null });

      const response = await rateOverHttp(harness, fixture.managerToken, fixture.chargeId);
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('SHARE_RULE_MISSING');

      expect(await ratingRowsFor(harness, fixture.chargeId)).toHaveLength(0);
      expect(await ratingAuditRows(harness)).toHaveLength(0);
    });

    it('records the manager, the instant and the required reason', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: null });
      await shareRuleId(harness, fixture.managerToken, fixture.therapistId, {
        shareBasisPoints: 5500,
      });

      const response = await rateOverHttp(harness, fixture.managerToken, fixture.chargeId, {
        reason: 'قاعده سهم دیرتر ثبت شد',
      });

      expect(response.status).toBe(201);
      expect(settlementOf(response.body)).toMatchObject({
        ratedVia: 'EXPLICIT',
        appliedShareBasisPoints: 5500,
        reason: 'قاعده سهم دیرتر ثبت شد',
        therapistGrossToman: '137500',
        clinicGrossToman: '112500',
      });

      const audit = await ratingAuditRows(harness);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        action: 'session_settlement.rated',
        actorUserId: fixture.managerId,
      });
      expect(audit[0]?.metadata).toMatchObject({ trigger: 'EXPLICIT_RATING' });
    });

    it('refuses a rating with no reason', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: null });
      await shareRuleId(harness, fixture.managerToken, fixture.therapistId, {
        shareBasisPoints: 4000,
      });

      const response = await rateOverHttp(harness, fixture.managerToken, fixture.chargeId, {});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(await ratingRowsFor(harness, fixture.chargeId)).toHaveLength(0);
    });

    it('refuses a caller that tries to state the basis itself', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: 4000 });

      const response = await rateOverHttp(harness, fixture.managerToken, fixture.chargeId, {
        reason: 'دلیل آزمایشی',
        baseAmountToman: '1',
      });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses a second rating of a session that already carries one', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: 4000 });

      const response = await rateOverHttp(harness, fixture.managerToken, fixture.chargeId);
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('SESSION_ALREADY_RATED');

      expect(await ratingRowsFor(harness, fixture.chargeId)).toHaveLength(1);
      expect(await ratingAuditRows(harness)).toHaveLength(1);
    });

    it('refuses to rate a charge that has been withdrawn', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: null });
      await voidChargeOverHttp(harness, fixture.managerToken, fixture.chargeId).expect(200);
      await shareRuleId(harness, fixture.managerToken, fixture.therapistId, {
        shareBasisPoints: 4000,
      });

      const response = await rateOverHttp(harness, fixture.managerToken, fixture.chargeId);
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CHARGE_VOIDED');
      expect(await ratingRowsFor(harness, fixture.chargeId)).toHaveLength(0);
    });

    it('answers an unknown charge with the ledger refusal and writes nothing', async () => {
      const { token } = await signIn(harness, 'MANAGER');

      const response = await rateOverHttp(harness, token, uuidv7());
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('CHARGE_NOT_FOUND');
      expect(await ratingAuditRows(harness)).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // The snapshot survives everything that happens to the configuration
  // -------------------------------------------------------------------------

  describe('the snapshot is history, not a pointer', () => {
    it('does not move when the rule behind it is voided', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: 4000 });
      const before = (await ratingRowsFor(harness, fixture.chargeId))[0];

      await voidShareRule(
        harness,
        fixture.managerToken,
        before?.appliedShareRuleId ?? '',
        'اصلاح توافق',
      ).expect(200);

      const after = (await ratingRowsFor(harness, fixture.chargeId))[0];
      expect(after).toEqual(before);
      expect(after?.appliedShareBasisPoints).toBe(4000);
    });

    it('does not move when the rule is corrected and replaced', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: 4000 });
      const before = (await ratingRowsFor(harness, fixture.chargeId))[0];

      // The correction the share-rule lifecycle supports: void and replace in
      // one transaction, over the very same date range.
      const replacement = await makeShareRule(harness, fixture.managerToken, {
        therapistId: fixture.therapistId,
        shareBasisPoints: 7000,
        effectiveStart: '2020-01-01',
        effectiveEnd: null,
        supersedesShareRuleId: before?.appliedShareRuleId,
        reason: 'درصد اشتباه ثبت شده بود',
      });
      expect(replacement.status).toBe(201);

      const after = (await ratingRowsFor(harness, fixture.chargeId))[0];
      expect(after).toEqual(before);
      expect(after?.therapistGrossToman).toBe(100000n);
    });

    it('cannot be rewritten by a statement, whoever issues it', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: 4000 });
      const rating = (await ratingRowsFor(harness, fixture.chargeId))[0];

      await expect(
        harness.prisma.$executeRaw`
          UPDATE session_settlement SET applied_share_basis_points = 9000
          WHERE id = ${rating?.id}::uuid
        `,
      ).rejects.toThrow(/immutable/);

      await expect(
        ownerPrisma().$executeRaw`
          DELETE FROM session_settlement WHERE id = ${rating?.id}::uuid
        `,
      ).rejects.toThrow();

      const after = (await ratingRowsFor(harness, fixture.chargeId))[0];
      expect(after).toEqual(rating);
    });
  });

  // -------------------------------------------------------------------------
  // Withdrawal
  // -------------------------------------------------------------------------

  describe('withdrawing a rating', () => {
    it('returns the session to the explicit unrated state, with a reason', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: 4000 });
      const rating = (await ratingRowsFor(harness, fixture.chargeId))[0];

      const response = await voidRatingOverHttp(
        harness,
        fixture.managerToken,
        rating?.id ?? '',
        'جلسه اشتباه رتبه‌بندی شده بود',
      );

      expect(response.status).toBe(200);
      const settlement = settlementOf(response.body);
      expect(settlement.voidedAt).not.toBeNull();
      expect(settlement.voidReason).toBe('جلسه اشتباه رتبه‌بندی شده بود');
      // Every applied figure is left exactly as it was applied.
      expect(settlement.appliedShareBasisPoints).toBe(4000);
      expect(settlement.therapistGrossToman).toBe('100000');

      // UNRATED again — the absence of a STANDING row, with the history kept.
      const read = await readRatingOverHttp(harness, fixture.managerToken, fixture.chargeId);
      expect(read.status).toBe(422);
      expect(read.body.error.code).toBe('SESSION_NOT_RATED');
      expect(await ratingRowsFor(harness, fixture.chargeId)).toHaveLength(1);

      const audit = await ratingAuditRows(harness);
      expect(audit).toHaveLength(2);
      expect(audit[1]).toMatchObject({
        action: 'session_settlement.voided',
        entityId: rating?.id,
        actorUserId: fixture.managerId,
      });
      expect(audit[1]?.metadata).toMatchObject({ trigger: 'EXPLICIT_VOID' });
    });

    it('lets the session be rated again afterwards', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: 4000 });
      const rating = (await ratingRowsFor(harness, fixture.chargeId))[0];
      await voidRatingOverHttp(harness, fixture.managerToken, rating?.id ?? '').expect(200);

      const response = await rateOverHttp(harness, fixture.managerToken, fixture.chargeId);
      expect(response.status).toBe(201);
      expect(await ratingRowsFor(harness, fixture.chargeId)).toHaveLength(2);
    });

    it('refuses a second withdrawal', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: 4000 });
      const rating = (await ratingRowsFor(harness, fixture.chargeId))[0];
      await voidRatingOverHttp(harness, fixture.managerToken, rating?.id ?? '').expect(200);

      const again = await voidRatingOverHttp(harness, fixture.managerToken, rating?.id ?? '');
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('RATING_ALREADY_VOIDED');
      expect(await ratingAuditRows(harness)).toHaveLength(2);
    });

    it('answers an unknown rating with SESSION_NOT_RATED and writes nothing', async () => {
      const { token } = await signIn(harness, 'MANAGER');

      const response = await voidRatingOverHttp(harness, token, uuidv7());
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('SESSION_NOT_RATED');
      expect(await ratingAuditRows(harness)).toHaveLength(0);
    });

    it('refuses an unexplained withdrawal', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: 4000 });
      const rating = (await ratingRowsFor(harness, fixture.chargeId))[0];

      const response = await request(harness.app.getHttpServer())
        .post(`/settlement/session-ratings/${rating?.id}/void`)
        .set(asUser(fixture.managerToken))
        .send({});

      expect(response.status).toBe(400);
      expect(await ratingAuditRows(harness)).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Atomic correction
  // -------------------------------------------------------------------------

  describe('correcting a rating', () => {
    /**
     * A CORRECTION IS THE SECOND HALF OF CORRECTING A PERCENTAGE. The manager
     * corrects the RULE — which voids it and writes a replacement naming it —
     * and then corrects the rating, which re-resolves against the corrected
     * agreement. No percentage is typed anywhere in either step.
     */
    it('withdraws and replaces in one act, re-resolving from the corrected rule', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: 4000 });
      const original = (await ratingRowsFor(harness, fixture.chargeId))[0];

      const corrected = await makeShareRule(harness, fixture.managerToken, {
        therapistId: fixture.therapistId,
        shareBasisPoints: 5000,
        effectiveStart: '2020-01-01',
        effectiveEnd: null,
        supersedesShareRuleId: original?.appliedShareRuleId,
        reason: 'درصد اشتباه ثبت شده بود',
      });
      expect(corrected.status).toBe(201);
      const correctedRuleId = shareRuleResponseSchema.parse(corrected.body).shareRule.id;

      // The rating still says 4000: correcting the rule rewrites no session.
      expect((await ratingRowsFor(harness, fixture.chargeId))[0]?.appliedShareBasisPoints).toBe(
        4000,
      );

      const response = await correctRatingOverHttp(harness, fixture.managerToken, {
        sessionChargeId: fixture.chargeId,
        sessionSettlementId: original?.id,
        withdrawReason: 'درصد اشتباه اعمال شده بود',
        replacement: {
          sessionChargeId: fixture.chargeId,
          reason: 'اعمال درصد اصلاح‌شده بر این جلسه',
        },
      });

      expect(response.status).toBe(200);
      const replacement = settlementOf(response.body);
      expect(replacement).toMatchObject({
        supersedesSessionSettlementId: original?.id,
        appliedShareBasisPoints: 5000,
        appliedShareRuleId: correctedRuleId,
        ratedVia: 'EXPLICIT',
        therapistGrossToman: '125000',
        clinicGrossToman: '125000',
        voidedAt: null,
      });

      const rows = await ratingRowsFor(harness, fixture.chargeId);
      expect(rows).toHaveLength(2);
      // The withdrawn figure is still readable, exactly as applied, and still
      // names the rule it came from.
      expect(rows[0]).toMatchObject({
        id: original?.id,
        appliedShareBasisPoints: 4000,
        appliedShareRuleId: original?.appliedShareRuleId,
        therapistGrossToman: 100000n,
        voidReason: 'درصد اشتباه اعمال شده بود',
      });
      expect(rows[0]?.voidedAt).not.toBeNull();

      // One withdrawal and one rating, in one transaction, sharing a request id.
      const audit = await ratingAuditRows(harness);
      expect(audit).toHaveLength(3);
      expect(audit.map((row) => row.action)).toEqual([
        'session_settlement.rated',
        'session_settlement.voided',
        'session_settlement.rated',
      ]);
      expect(audit[1]?.metadata).toMatchObject({ trigger: 'RATING_CORRECTION' });
      expect(audit[2]?.metadata).toMatchObject({
        trigger: 'RATING_CORRECTION',
        supersedesSessionSettlementId: original?.id,
      });
      expect(audit[1]?.requestId).toBe(audit[2]?.requestId);
    });

    it('refuses a percentage on the replacement, and changes nothing', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: 4000 });
      const original = (await ratingRowsFor(harness, fixture.chargeId))[0];

      const response = await correctRatingOverHttp(harness, fixture.managerToken, {
        sessionChargeId: fixture.chargeId,
        sessionSettlementId: original?.id,
        withdrawReason: 'اصلاح',
        replacement: {
          sessionChargeId: fixture.chargeId,
          reason: 'اصلاح',
          shareBasisPoints: 9000,
        },
      });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');

      const rows = await ratingRowsFor(harness, fixture.chargeId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.voidedAt).toBeNull();
      expect(rows[0]?.appliedShareBasisPoints).toBe(4000);
    });

    it('refuses a replacement that names a different session, and changes nothing', async () => {
      const first = await seedChargedSession(harness, { shareBasisPoints: 4000 });
      const other = await seedChargedSession(harness, { shareBasisPoints: 4000 });
      const rating = (await ratingRowsFor(harness, first.chargeId))[0];

      const response = await correctRatingOverHttp(harness, first.managerToken, {
        sessionChargeId: other.chargeId,
        sessionSettlementId: rating?.id,
        withdrawReason: 'اصلاح',
        replacement: { sessionChargeId: other.chargeId, reason: 'اصلاح' },
      });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('RATING_SCOPE_MISMATCH');

      const rows = await ratingRowsFor(harness, first.chargeId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.voidedAt).toBeNull();
      expect(await ratingRowsFor(harness, other.chargeId)).toHaveLength(1);
    });

    it('refuses a replacement that cannot be produced, leaving the original standing', async () => {
      // The rule that produced the rating is voided outright, so nothing covers
      // the service date any more. The original must survive rather than the
      // session being left unrated.
      const fixture = await seedChargedSession(harness, { shareBasisPoints: 4000 });
      const original = (await ratingRowsFor(harness, fixture.chargeId))[0];

      await voidShareRule(
        harness,
        fixture.managerToken,
        original?.appliedShareRuleId ?? '',
        'توافق پایان یافت',
      ).expect(200);

      const response = await correctRatingOverHttp(harness, fixture.managerToken, {
        sessionChargeId: fixture.chargeId,
        sessionSettlementId: original?.id,
        withdrawReason: 'اصلاح',
        replacement: { sessionChargeId: fixture.chargeId, reason: 'اصلاح' },
      });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('SHARE_RULE_MISSING');

      const rows = await ratingRowsFor(harness, fixture.chargeId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.voidedAt).toBeNull();
      expect(await ratingAuditRows(harness)).toHaveLength(1);
    });

    it('refuses to correct a rating that is already withdrawn', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: 4000 });
      const rating = (await ratingRowsFor(harness, fixture.chargeId))[0];
      await voidRatingOverHttp(harness, fixture.managerToken, rating?.id ?? '').expect(200);

      const response = await correctRatingOverHttp(harness, fixture.managerToken, {
        sessionChargeId: fixture.chargeId,
        sessionSettlementId: rating?.id,
        withdrawReason: 'اصلاح',
        replacement: { sessionChargeId: fixture.chargeId, reason: 'اصلاح' },
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('RATING_ALREADY_VOIDED');
      expect(await ratingRowsFor(harness, fixture.chargeId)).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // The ledger side
  // -------------------------------------------------------------------------

  describe('when the charge itself is withdrawn', () => {
    /**
     * THE RULE THIS CHECKPOINT REVISION EXISTS FOR, ON THE OTHER SIDE. A rating
     * records what percentage WAS APPLIED to that charge while it stood. A void
     * is a later fact about the charge and does not travel backwards to make the
     * percentage never have been applied — so the row is left exactly as it was,
     * and no settlement fact nobody decided is written.
     */
    it('leaves the rating row completely untouched, and audits nothing', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: 4000 });
      const before = (await ratingRowsFor(harness, fixture.chargeId))[0];

      await voidChargeOverHttp(
        harness,
        fixture.managerToken,
        fixture.chargeId,
        'جلسه اشتباه ثبت شده بود',
      ).expect(200);

      const after = (await ratingRowsFor(harness, fixture.chargeId))[0];
      expect(after).toEqual(before);
      expect(after?.voidedAt).toBeNull();
      expect(after?.voidReason).toBeNull();

      // No `session_settlement.voided` fact: nobody withdrew a rating.
      const audit = await ratingAuditRows(harness);
      expect(audit).toHaveLength(1);
      expect(audit[0]?.action).toBe('session_settlement.rated');
    });

    it('makes the session earn nothing NOW, which is what the read reports', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: 4000 });
      await voidChargeOverHttp(harness, fixture.managerToken, fixture.chargeId).expect(200);

      const read = await readRatingOverHttp(harness, fixture.managerToken, fixture.chargeId);
      expect(read.status).toBe(409);
      expect(read.body.error.code).toBe('CHARGE_VOIDED');

      // The history is still there to be read by anything that asks for history.
      expect(await ratingRowsFor(harness, fixture.chargeId)).toHaveLength(1);
    });

    it('is harmless when the session was never rated', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: null });

      await voidChargeOverHttp(harness, fixture.managerToken, fixture.chargeId).expect(200);

      expect(await ratingRowsFor(harness, fixture.chargeId)).toHaveLength(0);
      expect(await ratingAuditRows(harness)).toHaveLength(0);
    });

    it('rates the replacement charge in its own right, unobstructed by the old one', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: 4000 });
      await voidChargeOverHttp(harness, fixture.managerToken, fixture.chargeId).expect(200);

      const reposted = await request(harness.app.getHttpServer())
        .post(`/session-charges/participants/${fixture.participantId}`)
        .set(asUser(fixture.managerToken))
        .send({});
      expect(reposted.status).toBe(200);

      const newChargeId = reposted.body.charge.id as string;
      expect(newChargeId).not.toBe(fixture.chargeId);

      // The old rating still stands against the old charge and blocks nothing:
      // uniqueness is per CHARGE, not per seat.
      const oldRows = await ratingRowsFor(harness, fixture.chargeId);
      expect(oldRows).toHaveLength(1);
      expect(oldRows[0]?.voidedAt).toBeNull();

      const rows = await ratingRowsFor(harness, newChargeId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.voidedAt).toBeNull();
      expect(rows[0]?.appliedShareBasisPoints).toBe(4000);

      // And the new charge is the one that currently earns.
      const read = await readRatingOverHttp(harness, fixture.managerToken, newChargeId);
      expect(read.status).toBe(200);
      expect(settlementOf(read.body).sessionChargeId).toBe(newChargeId);
    });

    it('can still have its rating withdrawn explicitly afterwards', async () => {
      // Correcting the settlement history of a withdrawn charge stays possible;
      // it is a decision somebody takes, with a reason, rather than a side
      // effect of the void.
      const fixture = await seedChargedSession(harness, { shareBasisPoints: 4000 });
      const rating = (await ratingRowsFor(harness, fixture.chargeId))[0];
      await voidChargeOverHttp(harness, fixture.managerToken, fixture.chargeId).expect(200);

      const response = await voidRatingOverHttp(
        harness,
        fixture.managerToken,
        rating?.id ?? '',
        'هزینه ابطال شد و این سهم نباید بماند',
      );

      expect(response.status).toBe(200);
      expect((await ratingRowsFor(harness, fixture.chargeId))[0]?.voidedAt).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // What a concession does to the rating — and what it does not
  // -------------------------------------------------------------------------

  describe('the rating under a concession', () => {
    /**
     * THE C3 PROMISE, KEPT AFTER C4 MADE ALLOCATION REAL. A concession changes
     * what the FAMILY owes and, when it is allocated, WHO BEARS it. Neither
     * restates what the session was worth, so no column of the snapshot moves —
     * and the immutability trigger means none could. The therapist's NET is the
     * gross on this row less the active portions, derived by reading.
     *
     * The allocation runtime itself — the floor, the refusals, the audit — is
     * proved in `settlement-concession-split.int-spec.ts`.
     */
    it('accepts a clinic-borne concession and leaves the rating untouched', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: 4000 });
      const before = (await ratingRowsFor(harness, fixture.chargeId))[0];

      await adjustOverHttp(harness, fixture.managerToken, fixture.chargeId, '50000').expect(200);

      // The basis is the PRE-DISCOUNT charge. A concession changes what the
      // family owes and nothing about what the session earned.
      const after = (await ratingRowsFor(harness, fixture.chargeId))[0];
      expect(after).toEqual(before);
      expect(after?.baseAmountToman).toBe(250000n);
    });
  });
});
