import request from 'supertest';
import { sessionSettlementResponseSchema } from '@clinic/contracts';
import { uuidv7 } from '../src/common/uuid';
import { asUser, signIn } from './appointments-support';
import { createHarness, resetDatabase, type Harness } from './harness';
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
    await resetDatabase(harness.prisma);
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
      ['rate', 'post', `/settlement/session-charges/${uuidv7()}/rating`, { ratedVia: 'AUTOMATIC' }],
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
      await shareRuleId(harness, fixture.managerToken, fixture.therapistId, {
        shareBasisPoints: 6000,
        effectiveStart: '2026-10-01',
      });

      const response = await rateOverHttp(harness, fixture.managerToken, fixture.chargeId);
      expect(response.status).toBe(201);

      const settlement = settlementOf(response.body);
      expect(settlement).toMatchObject({
        appliedShareBasisPoints: 3000,
        ratedVia: 'AUTOMATIC',
        serviceDate: fixture.serviceDate,
        baseAmountToman: '250000',
        therapistGrossToman: '75000',
        clinicGrossToman: '175000',
        reason: null,
      });
    });

    it('refuses when no rule covers the service date, and writes nothing', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: null });

      const response = await rateOverHttp(harness, fixture.managerToken, fixture.chargeId);
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('SHARE_RULE_MISSING');

      expect(await ratingRowsFor(harness, fixture.chargeId)).toHaveLength(0);
      expect(await ratingAuditRows(harness)).toHaveLength(0);
    });

    it('records a manager override with its percentage and its reason', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: null });

      const response = await rateOverHttp(harness, fixture.managerToken, fixture.chargeId, {
        ratedVia: 'EXPLICIT',
        shareBasisPoints: 5500,
        reason: 'توافق موردی برای این جلسه',
      });

      expect(response.status).toBe(201);
      const settlement = settlementOf(response.body);
      expect(settlement).toMatchObject({
        ratedVia: 'EXPLICIT',
        appliedShareBasisPoints: 5500,
        appliedShareRuleId: null,
        reason: 'توافق موردی برای این جلسه',
        therapistGrossToman: '137500',
        clinicGrossToman: '112500',
      });

      const audit = await ratingAuditRows(harness);
      expect(audit).toHaveLength(1);
      expect(audit[0]?.metadata).toMatchObject({ trigger: 'EXPLICIT_RATING' });
    });

    it('refuses an override with no reason', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: null });

      const response = await rateOverHttp(harness, fixture.managerToken, fixture.chargeId, {
        ratedVia: 'EXPLICIT',
        shareBasisPoints: 5500,
      });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(await ratingRowsFor(harness, fixture.chargeId)).toHaveLength(0);
    });

    it('refuses a caller that tries to state the basis itself', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: 4000 });

      const response = await rateOverHttp(harness, fixture.managerToken, fixture.chargeId, {
        ratedVia: 'AUTOMATIC',
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
        harness.prisma.$executeRaw`
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
    it('withdraws and replaces in one act, and never leaves the session unrated', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: 4000 });
      const original = (await ratingRowsFor(harness, fixture.chargeId))[0];

      const response = await correctRatingOverHttp(harness, fixture.managerToken, {
        sessionChargeId: fixture.chargeId,
        sessionSettlementId: original?.id,
        withdrawReason: 'درصد اشتباه اعمال شده بود',
        replacement: {
          sessionChargeId: fixture.chargeId,
          ratedVia: 'EXPLICIT',
          shareBasisPoints: 5000,
          reason: 'درصد توافق‌شده برای این جلسه',
        },
      });

      expect(response.status).toBe(200);
      const replacement = settlementOf(response.body);
      expect(replacement).toMatchObject({
        supersedesSessionSettlementId: original?.id,
        appliedShareBasisPoints: 5000,
        therapistGrossToman: '125000',
        clinicGrossToman: '125000',
        voidedAt: null,
      });

      const rows = await ratingRowsFor(harness, fixture.chargeId);
      expect(rows).toHaveLength(2);
      // The withdrawn figure is still readable, exactly as applied.
      expect(rows[0]).toMatchObject({
        id: original?.id,
        appliedShareBasisPoints: 4000,
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

    it('refuses a replacement that names a different session, and changes nothing', async () => {
      const first = await seedChargedSession(harness, { shareBasisPoints: 4000 });
      const other = await seedChargedSession(harness, { shareBasisPoints: 4000 });
      const rating = (await ratingRowsFor(harness, first.chargeId))[0];

      const response = await correctRatingOverHttp(harness, first.managerToken, {
        sessionChargeId: other.chargeId,
        sessionSettlementId: rating?.id,
        withdrawReason: 'اصلاح',
        replacement: {
          sessionChargeId: other.chargeId,
          ratedVia: 'EXPLICIT',
          shareBasisPoints: 5000,
          reason: 'اصلاح',
        },
      });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('RATING_SCOPE_MISMATCH');

      const rows = await ratingRowsFor(harness, first.chargeId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.voidedAt).toBeNull();
      expect(await ratingRowsFor(harness, other.chargeId)).toHaveLength(1);
    });

    it('refuses a replacement that cannot be produced, leaving the original standing', async () => {
      // The rating was written explicitly, so no rule covers the day; an
      // AUTOMATIC replacement therefore has nothing to resolve. The original
      // must survive rather than the session being left unrated.
      const fixture = await seedChargedSession(harness, { shareBasisPoints: null });
      const rated = await rateOverHttp(harness, fixture.managerToken, fixture.chargeId, {
        ratedVia: 'EXPLICIT',
        shareBasisPoints: 5500,
        reason: 'توافق موردی',
      });
      const original = settlementOf(rated.body);

      const response = await correctRatingOverHttp(harness, fixture.managerToken, {
        sessionChargeId: fixture.chargeId,
        sessionSettlementId: original.id,
        withdrawReason: 'اصلاح',
        replacement: { sessionChargeId: fixture.chargeId, ratedVia: 'AUTOMATIC' },
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
        replacement: {
          sessionChargeId: fixture.chargeId,
          ratedVia: 'EXPLICIT',
          shareBasisPoints: 5000,
          reason: 'اصلاح',
        },
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
    it('withdraws the rating with it, in the same act, and audits both', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: 4000 });
      const rating = (await ratingRowsFor(harness, fixture.chargeId))[0];

      await voidChargeOverHttp(
        harness,
        fixture.managerToken,
        fixture.chargeId,
        'جلسه اشتباه ثبت شده بود',
      ).expect(200);

      const rows = await ratingRowsFor(harness, fixture.chargeId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.voidedAt).not.toBeNull();
      expect(rows[0]?.voidReason).toBe('جلسه اشتباه ثبت شده بود');
      // Every applied figure is left exactly as it was applied.
      expect(rows[0]?.therapistGrossToman).toBe(100000n);

      const audit = await ratingAuditRows(harness);
      expect(audit).toHaveLength(2);
      expect(audit[1]).toMatchObject({ action: 'session_settlement.voided', entityId: rating?.id });
      expect(audit[1]?.metadata).toMatchObject({ trigger: 'CHARGE_VOIDED' });
    });

    it('is harmless when the session was never rated', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: null });

      await voidChargeOverHttp(harness, fixture.managerToken, fixture.chargeId).expect(200);

      expect(await ratingRowsFor(harness, fixture.chargeId)).toHaveLength(0);
      expect(await ratingAuditRows(harness)).toHaveLength(0);
    });

    it('rates the replacement charge in its own right', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: 4000 });
      await voidChargeOverHttp(harness, fixture.managerToken, fixture.chargeId).expect(200);

      const reposted = await request(harness.app.getHttpServer())
        .post(`/session-charges/participants/${fixture.participantId}`)
        .set(asUser(fixture.managerToken))
        .send({});
      expect(reposted.status).toBe(200);

      const newChargeId = reposted.body.charge.id as string;
      expect(newChargeId).not.toBe(fixture.chargeId);

      const rows = await ratingRowsFor(harness, newChargeId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.voidedAt).toBeNull();
      expect(rows[0]?.appliedShareBasisPoints).toBe(4000);
    });
  });

  // -------------------------------------------------------------------------
  // The temporary concession guard from the C2 revision
  // -------------------------------------------------------------------------

  describe('the therapist-borne concession guard', () => {
    /**
     * C3 CREATES THE RATING BUT NOT THE SPLIT RUNTIME. Allocating a concession
     * between the therapist and the clinic — and the therapist-net floor that
     * goes with it — is the next accepted checkpoint, so a non-zero portion is
     * still refused outright even now that the session carries a rating to bear
     * it against.
     */
    it('still refuses a non-zero therapist portion on a rated session', async () => {
      const fixture = await seedChargedSession(harness, { shareBasisPoints: 4000 });

      const response = await request(harness.app.getHttpServer())
        .post(`/session-charges/${fixture.chargeId}/adjustments`)
        .set(asUser(fixture.managerToken))
        .send({ amountToman: '50000', reason: 'تخفیف آزمایشی', therapistDiscountToman: '10000' });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('ADJUSTMENT_SPLIT_INVALID');
      expect(await harness.prisma.chargeAdjustment.count()).toBe(0);
    });

    it('still accepts a clinic-borne concession and leaves the rating untouched', async () => {
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
