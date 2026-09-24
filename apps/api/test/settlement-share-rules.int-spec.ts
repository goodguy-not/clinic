import request from 'supertest';
import {
  loginResponseSchema,
  resolveShareRuleResponseSchema,
  shareRuleListResponseSchema,
  shareRuleResponseSchema,
  therapistResponseSchema,
} from '@clinic/contracts';
import { uuidv7 } from '../src/common/uuid';
import {
  createHarness,
  internalHeaders,
  resetDatabase,
  seedUser,
  TEST_PASSWORD,
  type Harness,
  ownerPrisma,
} from './harness';

/**
 * Effective-dated therapist share rules over real HTTP against real PostgreSQL.
 *
 * Everything is synthetic. No real therapist, agreement or percentage appears
 * in any fixture; the percentages below are round numbers chosen to be
 * obviously invented.
 *
 * WHAT THIS CHECKPOINT DOES NOT DO, and is asserted not to do: it snapshots
 * nothing onto a session, writes no settlement fact, closes no period and reads
 * no charge, payment or family balance. A share rule is configuration.
 */
describe('therapist share rules (real PostgreSQL)', () => {
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

  const server = () => harness.app.getHttpServer();
  const asUser = (token: string) => internalHeaders({ 'x-session-id': token });

  async function signIn(role: 'MANAGER' | 'RECEPTIONIST') {
    const user = await seedUser(harness, { role });
    const response = await request(server())
      .post('/auth/login')
      .set(internalHeaders())
      .send({ username: user.username, password: TEST_PASSWORD });

    return { user, token: loginResponseSchema.parse(response.body).sessionToken };
  }

  async function makeTherapist(token: string, fullName = 'Synthetic Therapist') {
    const response = await request(server())
      .post('/catalog/therapists')
      .set(asUser(token))
      .send({ fullName, specialty: 'Synthetic Specialty', supportedServiceIds: [] });

    return therapistResponseSchema.parse(response.body).therapist.id;
  }

  function rule(therapistId: string, overrides: Record<string, unknown> = {}) {
    return {
      therapistId,
      shareBasisPoints: 4000,
      effectiveStart: '2026-01-01',
      effectiveEnd: null,
      ...overrides,
    };
  }

  const createRule = (token: string, body: Record<string, unknown>) =>
    request(server()).post('/settlement/share-rules').set(asUser(token)).send(body);

  const voidRule = (token: string, id: string, reason: string) =>
    request(server())
      .post(`/settlement/share-rules/${id}/void`)
      .set(asUser(token))
      .send({ reason });

  const resolveRule = (token: string, therapistId: string, serviceDate: string) =>
    request(server())
      .get('/settlement/share-rule-resolution')
      .query({ therapistId, serviceDate })
      .set(asUser(token));

  const auditRows = () =>
    harness.prisma.auditLog.findMany({
      where: { entityType: 'therapist_share_rule' },
      orderBy: { occurredAt: 'asc' },
    });

  // -------------------------------------------------------------------------
  // Authorization
  // -------------------------------------------------------------------------

  describe('authorization', () => {
    /**
     * The receptionist's refusal is total, and it is where this differs from
     * the tariff. They may READ a tariff, because running the diary means
     * looking up what a session costs a family; they may not read a share rule,
     * because what a therapist takes home is not diary work
     * (PROJECT_SPEC.md 4).
     */
    it.each([
      ['list', 'get', '/settlement/share-rules', undefined],
      ['resolve', 'get', '/settlement/share-rule-resolution', undefined],
      ['get by id', 'get', `/settlement/share-rules/${uuidv7()}`, undefined],
      ['create', 'post', '/settlement/share-rules', {}],
      ['void', 'post', `/settlement/share-rules/${uuidv7()}/void`, {}],
    ])('refuses a receptionist %s', async (_label, method, path, body) => {
      const { token } = await signIn('RECEPTIONIST');

      const call =
        method === 'get'
          ? request(server()).get(path).set(asUser(token))
          : request(server()).post(path).set(asUser(token)).send(body);

      const response = await call;
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('writes no audit row for a refused receptionist create', async () => {
      const manager = await signIn('MANAGER');
      const therapistId = await makeTherapist(manager.token);

      const { token } = await signIn('RECEPTIONIST');
      const refused = await createRule(token, rule(therapistId));

      expect(refused.status).toBe(403);
      expect(await auditRows()).toHaveLength(0);
      expect(await harness.prisma.therapistShareRule.count()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Creation and listing
  // -------------------------------------------------------------------------

  describe('creation', () => {
    it('records the agreement and audits it', async () => {
      const { token, user } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      const response = await createRule(
        token,
        rule(therapistId, { shareBasisPoints: 4250, effectiveEnd: '2026-06-30' }),
      );

      expect(response.status).toBe(201);
      const shareRule = shareRuleResponseSchema.parse(response.body).shareRule;
      expect(shareRule).toMatchObject({
        therapistId,
        shareBasisPoints: 4250,
        effectiveStart: '2026-01-01',
        effectiveEnd: '2026-06-30',
        voidedAt: null,
        voidReason: null,
        supersedesShareRuleId: null,
      });

      const audit = await auditRows();
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        action: 'therapist_share_rule.created',
        entityType: 'therapist_share_rule',
        entityId: shareRule.id,
        actorUserId: user.id,
      });
      expect(audit[0]?.after).toMatchObject({
        therapistId,
        shareBasisPoints: 4250,
        effectiveStart: '2026-01-01',
        effectiveEnd: '2026-06-30',
      });
      // A rule knows about no session, no charge and no family, so no audit
      // payload here may carry one.
      expect(JSON.stringify(audit[0]?.after)).not.toMatch(/family|child|amount|toman/i);
    });

    it.each([
      ['zero, a therapist who takes no share of this work', 0],
      ['the whole session value', 10000],
    ])('accepts %s', async (_label, shareBasisPoints) => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      const response = await createRule(token, rule(therapistId, { shareBasisPoints }));
      expect(response.status).toBe(201);
      expect(shareRuleResponseSchema.parse(response.body).shareRule.shareBasisPoints).toBe(
        shareBasisPoints,
      );
    });

    it.each([
      ['above the maximum', 10001],
      ['negative', -1],
      ['fractional, which basis points exist to make unnecessary', 42.5],
    ])('refuses a share %s', async (_label, shareBasisPoints) => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      const response = await createRule(token, rule(therapistId, { shareBasisPoints }));
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(await harness.prisma.therapistShareRule.count()).toBe(0);
    });

    it('refuses an effective end before its start', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      const response = await createRule(
        token,
        rule(therapistId, { effectiveStart: '2026-06-01', effectiveEnd: '2026-05-31' }),
      );
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses a rule for a therapist that does not exist', async () => {
      const { token } = await signIn('MANAGER');

      const response = await createRule(token, rule(uuidv7()));
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('THERAPIST_NOT_FOUND');
      expect(await auditRows()).toHaveLength(0);
    });

    /**
     * Deliberately ALLOWED, and this is where the share rule departs from the
     * tariff.
     *
     * A tariff prices future bookings, so an inactive therapist has nothing to
     * price. A share rule records an agreement about work that may already have
     * happened, and a therapist who has left is exactly the case where a wrong
     * historical percentage most needs correcting. Refusing on status would
     * make a departed therapist's configuration permanently uncorrectable.
     */
    it('allows a rule for an inactive therapist, so history stays correctable', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      const deactivated = await request(server())
        .patch(`/catalog/therapists/${therapistId}/status`)
        .set(asUser(token))
        .send({ status: 'INACTIVE' });
      expect(deactivated.status).toBe(200);

      const response = await createRule(token, rule(therapistId));
      expect(response.status).toBe(201);
    });

    it('refuses a reason on a rule that supersedes nothing', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      const response = await createRule(
        token,
        rule(therapistId, { reason: 'a first agreement withdraws nothing' }),
      );
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  // -------------------------------------------------------------------------
  // Overlap
  // -------------------------------------------------------------------------

  describe('overlap', () => {
    it('refuses a second live rule covering the same therapist and dates', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      expect((await createRule(token, rule(therapistId))).status).toBe(201);

      const second = await createRule(
        token,
        rule(therapistId, { shareBasisPoints: 5000, effectiveStart: '2026-03-01' }),
      );

      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('SHARE_RULE_OVERLAP');
      expect(await harness.prisma.therapistShareRule.count()).toBe(1);
      // A refused write leaves no audit history claiming it happened.
      expect(await auditRows()).toHaveLength(1);
    });

    it('refuses an overlap of exactly one day at the boundary', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      expect(
        (await createRule(token, rule(therapistId, { effectiveEnd: '2026-06-30' }))).status,
      ).toBe(201);

      // The stored range is inclusive on both ends, so a successor starting on
      // the predecessor's last day overlaps by that day.
      const second = await createRule(
        token,
        rule(therapistId, { shareBasisPoints: 5000, effectiveStart: '2026-06-30' }),
      );
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('SHARE_RULE_OVERLAP');
    });

    it('accepts adjacent, non-overlapping ranges', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      expect(
        (await createRule(token, rule(therapistId, { effectiveEnd: '2026-06-30' }))).status,
      ).toBe(201);
      expect(
        (
          await createRule(
            token,
            rule(therapistId, { shareBasisPoints: 5000, effectiveStart: '2026-07-01' }),
          )
        ).status,
      ).toBe(201);

      expect(await harness.prisma.therapistShareRule.count()).toBe(2);
    });

    it('does not let one therapist rule interfere with another', async () => {
      const { token } = await signIn('MANAGER');
      const first = await makeTherapist(token, 'Synthetic Therapist One');
      const second = await makeTherapist(token, 'Synthetic Therapist Two');

      expect((await createRule(token, rule(first, { shareBasisPoints: 4000 }))).status).toBe(201);
      // The identical range for a different therapist is not an overlap.
      expect((await createRule(token, rule(second, { shareBasisPoints: 6000 }))).status).toBe(201);

      const one = await resolveRule(token, first, '2026-03-15');
      const two = await resolveRule(token, second, '2026-03-15');
      expect(resolveShareRuleResponseSchema.parse(one.body).shareRule.shareBasisPoints).toBe(4000);
      expect(resolveShareRuleResponseSchema.parse(two.body).shareRule.shareBasisPoints).toBe(6000);
    });
  });

  // -------------------------------------------------------------------------
  // Resolution
  // -------------------------------------------------------------------------

  describe('resolution by service date', () => {
    it('resolves at both inclusive boundaries and misses just outside them', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      await createRule(
        token,
        rule(therapistId, { effectiveStart: '2026-03-01', effectiveEnd: '2026-03-31' }),
      );

      for (const inside of ['2026-03-01', '2026-03-15', '2026-03-31']) {
        const response = await resolveRule(token, therapistId, inside);
        expect(response.status).toBe(200);
        expect(resolveShareRuleResponseSchema.parse(response.body).shareRule.shareBasisPoints).toBe(
          4000,
        );
      }

      for (const outside of ['2026-02-28', '2026-04-01']) {
        const response = await resolveRule(token, therapistId, outside);
        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe('SHARE_RULE_MISSING');
      }
    });

    /**
     * The frozen rule that decides everything downstream: a miss is an explicit
     * missing state, NEVER a zero. Zero is a legitimate agreed share, so the
     * two must be different SHAPES rather than different values.
     */
    it('reports an unconfigured therapist as missing, never as a zero share', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      const response = await resolveRule(token, therapistId, '2026-03-15');
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('SHARE_RULE_MISSING');
      expect(JSON.stringify(response.body)).not.toContain('shareBasisPoints');
    });

    it('resolves an open-ended rule for any date at or after its start', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      await createRule(token, rule(therapistId, { effectiveStart: '2026-01-01' }));

      expect((await resolveRule(token, therapistId, '2026-01-01')).status).toBe(200);
      expect((await resolveRule(token, therapistId, '2030-12-31')).status).toBe(200);
      expect((await resolveRule(token, therapistId, '2025-12-31')).status).toBe(422);
    });

    it('keeps a historical date resolving to the rule that was live for it', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      // The agreement in force for the first half of the year, then its
      // successor. A change is a new row, never an edit.
      await createRule(
        token,
        rule(therapistId, {
          shareBasisPoints: 4000,
          effectiveStart: '2026-01-01',
          effectiveEnd: '2026-06-30',
        }),
      );
      await createRule(
        token,
        rule(therapistId, { shareBasisPoints: 5500, effectiveStart: '2026-07-01' }),
      );

      const historical = await resolveRule(token, therapistId, '2026-04-10');
      const current = await resolveRule(token, therapistId, '2026-08-10');

      expect(resolveShareRuleResponseSchema.parse(historical.body).shareRule.shareBasisPoints).toBe(
        4000,
      );
      expect(resolveShareRuleResponseSchema.parse(current.body).shareRule.shareBasisPoints).toBe(
        5500,
      );
    });

    it('refuses to resolve without a service date', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      // There is no default of "today": an effective-dated agreement is
      // resolved against the day of the session it governs.
      const response = await request(server())
        .get('/settlement/share-rule-resolution')
        .query({ therapistId })
        .set(asUser(token));

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('never resolves a voided rule', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      const created = await createRule(token, rule(therapistId));
      const id = shareRuleResponseSchema.parse(created.body).shareRule.id;

      expect((await voidRule(token, id, 'agreement never took effect')).status).toBe(200);

      const response = await resolveRule(token, therapistId, '2026-03-15');
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('SHARE_RULE_MISSING');
    });
  });

  // -------------------------------------------------------------------------
  // Correction and withdrawal
  // -------------------------------------------------------------------------

  describe('correction', () => {
    it('preserves the previous rule instead of rewriting it', async () => {
      const { token, user } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      const original = shareRuleResponseSchema.parse(
        (await createRule(token, rule(therapistId, { shareBasisPoints: 4000 }))).body,
      ).shareRule;

      const corrected = await createRule(
        token,
        rule(therapistId, {
          shareBasisPoints: 4500,
          supersedesShareRuleId: original.id,
          reason: 'the agreed percentage was entered wrongly',
        }),
      );

      expect(corrected.status).toBe(201);
      const replacement = shareRuleResponseSchema.parse(corrected.body).shareRule;
      expect(replacement.supersedesShareRuleId).toBe(original.id);
      expect(replacement.shareBasisPoints).toBe(4500);

      // The old row is still there, still says 4000, and says why it stopped
      // applying. Nothing about it was rewritten.
      const stored = await harness.prisma.therapistShareRule.findUniqueOrThrow({
        where: { id: original.id },
      });
      expect(stored.shareBasisPoints).toBe(4000);
      expect(stored.effectiveStart.toISOString()).toBe('2026-01-01T00:00:00.000Z');
      expect(stored.voidedAt).not.toBeNull();
      expect(stored.voidReason).toBe('the agreed percentage was entered wrongly');
      expect(stored.voidedByUserId).toBe(user.id);

      // And it stays inspectable through the ordinary read.
      const listed = await request(server())
        .get('/settlement/share-rules')
        .query({ therapistId, includeVoided: 'true' })
        .set(asUser(token));
      expect(shareRuleListResponseSchema.parse(listed.body).shareRules).toHaveLength(2);
    });

    it('writes both facts of a correction, in one request', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      const original = shareRuleResponseSchema.parse(
        (await createRule(token, rule(therapistId))).body,
      ).shareRule;

      await createRule(
        token,
        rule(therapistId, {
          shareBasisPoints: 4500,
          supersedesShareRuleId: original.id,
          reason: 'the agreed percentage was entered wrongly',
        }),
      );

      const audit = await auditRows();
      expect(audit.map((row) => row.action)).toEqual([
        'therapist_share_rule.created',
        'therapist_share_rule.voided',
        'therapist_share_rule.created',
      ]);

      // The withdrawal and its replacement share one request id, which is what
      // ties the two facts together without a third action naming the pair.
      expect(audit[1]?.requestId).toBe(audit[2]?.requestId);
      expect(audit[1]?.before).toMatchObject({ shareBasisPoints: 4000 });
      expect(audit[1]?.metadata).toMatchObject({ superseded: true });
      expect(audit[2]?.metadata).toMatchObject({ supersedesShareRuleId: original.id });
    });

    it('refuses a correction with no reason', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      const original = shareRuleResponseSchema.parse(
        (await createRule(token, rule(therapistId))).body,
      ).shareRule;

      const response = await createRule(
        token,
        rule(therapistId, { shareBasisPoints: 4500, supersedesShareRuleId: original.id }),
      );

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(await harness.prisma.therapistShareRule.count()).toBe(1);
    });

    it('refuses a replacement that names another therapist rule', async () => {
      const { token } = await signIn('MANAGER');
      const first = await makeTherapist(token, 'Synthetic Therapist One');
      const second = await makeTherapist(token, 'Synthetic Therapist Two');

      const theirs = shareRuleResponseSchema.parse(
        (await createRule(token, rule(first))).body,
      ).shareRule;

      const response = await createRule(
        token,
        rule(second, {
          supersedesShareRuleId: theirs.id,
          reason: 'correcting the wrong therapist by mistake',
        }),
      );

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('SHARE_RULE_SCOPE_MISMATCH');

      // Nothing was withdrawn and nothing was written.
      const untouched = await harness.prisma.therapistShareRule.findUniqueOrThrow({
        where: { id: theirs.id },
      });
      expect(untouched.voidedAt).toBeNull();
      expect(await harness.prisma.therapistShareRule.count()).toBe(1);
      expect(await auditRows()).toHaveLength(1);
    });

    it('refuses to supersede a rule that is already voided', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      const original = shareRuleResponseSchema.parse(
        (await createRule(token, rule(therapistId))).body,
      ).shareRule;
      expect((await voidRule(token, original.id, 'withdrawn')).status).toBe(200);

      const response = await createRule(
        token,
        rule(therapistId, {
          supersedesShareRuleId: original.id,
          reason: 'a second withdrawal of the same rule',
        }),
      );

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('SHARE_RULE_ALREADY_VOIDED');
      expect(await harness.prisma.therapistShareRule.count()).toBe(1);
    });

    it('keeps a historical date resolving correctly after a later change', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      // The first half of the year, closed off; then an open-ended successor;
      // then the successor itself is corrected. None of it touches the first.
      await createRule(
        token,
        rule(therapistId, {
          shareBasisPoints: 4000,
          effectiveStart: '2026-01-01',
          effectiveEnd: '2026-06-30',
        }),
      );
      const second = shareRuleResponseSchema.parse(
        (
          await createRule(
            token,
            rule(therapistId, { shareBasisPoints: 5000, effectiveStart: '2026-07-01' }),
          )
        ).body,
      ).shareRule;
      await createRule(
        token,
        rule(therapistId, {
          shareBasisPoints: 5500,
          effectiveStart: '2026-07-01',
          supersedesShareRuleId: second.id,
          reason: 'the successor percentage was agreed at a higher figure',
        }),
      );

      const historical = await resolveRule(token, therapistId, '2026-04-10');
      const current = await resolveRule(token, therapistId, '2026-08-10');

      expect(resolveShareRuleResponseSchema.parse(historical.body).shareRule.shareBasisPoints).toBe(
        4000,
      );
      expect(resolveShareRuleResponseSchema.parse(current.body).shareRule.shareBasisPoints).toBe(
        5500,
      );
    });
  });

  describe('withdrawal', () => {
    it('voids a rule, recording when, by whom and why', async () => {
      const { token, user } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      const created = shareRuleResponseSchema.parse(
        (await createRule(token, rule(therapistId))).body,
      ).shareRule;

      const response = await voidRule(token, created.id, 'agreement was never signed');
      expect(response.status).toBe(200);

      const voided = shareRuleResponseSchema.parse(response.body).shareRule;
      expect(voided.voidedAt).not.toBeNull();
      expect(voided.voidReason).toBe('agreement was never signed');

      const stored = await harness.prisma.therapistShareRule.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(stored.voidedByUserId).toBe(user.id);

      const audit = await auditRows();
      expect(audit.map((row) => row.action)).toEqual([
        'therapist_share_rule.created',
        'therapist_share_rule.voided',
      ]);
      expect(audit[1]?.after).toMatchObject({ voidReason: 'agreement was never signed' });
      expect(audit[1]?.metadata).toMatchObject({ superseded: false });
    });

    it('refuses to void the same rule twice', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      const created = shareRuleResponseSchema.parse(
        (await createRule(token, rule(therapistId))).body,
      ).shareRule;

      expect((await voidRule(token, created.id, 'withdrawn')).status).toBe(200);

      const second = await voidRule(token, created.id, 'withdrawn again');
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('SHARE_RULE_ALREADY_VOIDED');

      // The refusal wrote no second void fact, and did not rewrite the first.
      const audit = await auditRows();
      expect(audit.filter((row) => row.action === 'therapist_share_rule.voided')).toHaveLength(1);
      const stored = await harness.prisma.therapistShareRule.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(stored.voidReason).toBe('withdrawn');
    });

    it('refuses to void a rule that does not exist, and audits nothing', async () => {
      const { token } = await signIn('MANAGER');

      const response = await voidRule(token, uuidv7(), 'withdrawn');
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('SHARE_RULE_NOT_FOUND');
      expect(await auditRows()).toHaveLength(0);
    });

    it('refuses a void with no reason', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      const created = shareRuleResponseSchema.parse(
        (await createRule(token, rule(therapistId))).body,
      ).shareRule;

      const response = await request(server())
        .post(`/settlement/share-rules/${created.id}/void`)
        .set(asUser(token))
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  describe('reading', () => {
    it('excludes voided rules unless they are asked for', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      const created = shareRuleResponseSchema.parse(
        (await createRule(token, rule(therapistId))).body,
      ).shareRule;
      await voidRule(token, created.id, 'withdrawn');

      const live = await request(server())
        .get('/settlement/share-rules')
        .query({ therapistId })
        .set(asUser(token));
      expect(shareRuleListResponseSchema.parse(live.body).shareRules).toHaveLength(0);

      const all = await request(server())
        .get('/settlement/share-rules')
        .query({ therapistId, includeVoided: 'true' })
        .set(asUser(token));
      expect(shareRuleListResponseSchema.parse(all.body).shareRules).toHaveLength(1);
    });

    it('filters by the date a rule was in force', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      await createRule(
        token,
        rule(therapistId, { effectiveStart: '2026-01-01', effectiveEnd: '2026-06-30' }),
      );
      await createRule(
        token,
        rule(therapistId, { shareBasisPoints: 5000, effectiveStart: '2026-07-01' }),
      );

      const response = await request(server())
        .get('/settlement/share-rules')
        .query({ therapistId, onDate: '2026-04-10' })
        .set(asUser(token));

      const shareRules = shareRuleListResponseSchema.parse(response.body).shareRules;
      expect(shareRules).toHaveLength(1);
      expect(shareRules[0]?.shareBasisPoints).toBe(4000);
    });

    it('answers an unknown id with a not-found rather than a missing-rule', async () => {
      const { token } = await signIn('MANAGER');

      const response = await request(server())
        .get(`/settlement/share-rules/${uuidv7()}`)
        .set(asUser(token));

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('SHARE_RULE_NOT_FOUND');
    });
  });

  // -------------------------------------------------------------------------
  // What the audit trail may and may not carry
  // -------------------------------------------------------------------------

  describe('audit payload contents', () => {
    /**
     * The percentage is the FACT BEING CHANGED, so it is written in full — the
     * accepted rule (DECISION_LOG, 2026-08-09) masks or omits identifiers that
     * are not the fact, and writes the fact itself, because masking it "would
     * make the trail useless for the corrections it exists to explain". C1's
     * audit vocabulary depends on this: there is no
     * `therapist_share_rule.updated` precisely because a change is recorded as
     * the share that stopped applying and the one that replaced it.
     */
    it('records the share that started applying and the one that stopped', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);
      const original = shareRuleResponseSchema.parse(
        (await createRule(token, rule(therapistId, { shareBasisPoints: 4000 }))).body,
      ).shareRule;
      await createRule(
        token,
        rule(therapistId, {
          shareBasisPoints: 4500,
          supersedesShareRuleId: original.id,
          reason: 'the agreed percentage was entered wrongly',
        }),
      );

      const audit = await auditRows();
      expect(audit[1]?.action).toBe('therapist_share_rule.voided');
      expect(audit[1]?.before).toMatchObject({ shareBasisPoints: 4000 });
      expect(audit[2]?.after).toMatchObject({ shareBasisPoints: 4500 });
    });

    /**
     * The value belongs in `before`/`after`, where a changed fact belongs.
     * `metadata` carries the correction linkage and nothing else, so the
     * percentage is recorded once rather than duplicated across two columns.
     */
    it('keeps every value out of metadata, which carries only the linkage', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);
      const original = shareRuleResponseSchema.parse(
        (await createRule(token, rule(therapistId))).body,
      ).shareRule;
      await createRule(
        token,
        rule(therapistId, {
          shareBasisPoints: 4500,
          supersedesShareRuleId: original.id,
          reason: 'the agreed percentage was entered wrongly',
        }),
      );

      for (const row of await auditRows()) {
        expect(JSON.stringify(row.metadata ?? {})).not.toMatch(/shareBasisPoints|percent/i);
      }
    });

    /**
     * `audit_log` is append-only and permanent, so nothing personal may reach
     * it here. A share rule knows about no family, child, session or amount, and
     * `therapistId` is an opaque uuid — the same identifier every existing audit
     * row about a therapist already carries, never a name.
     */
    it('copies no name, no identifier and no family or session fact into the trail', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token, 'Synthetic Therapist');
      const created = shareRuleResponseSchema.parse(
        (await createRule(token, rule(therapistId))).body,
      ).shareRule;
      await voidRule(token, created.id, 'withdrawn');

      for (const row of await auditRows()) {
        const payload = JSON.stringify({
          before: row.before,
          after: row.after,
          metadata: row.metadata,
        });

        expect(payload).not.toContain('Synthetic Therapist');
        expect(payload).not.toMatch(/nationalId|mobile|landline|phone|fileNumber/i);
        expect(payload).not.toMatch(/familyId|childId|sessionChargeId|amountToman/i);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Schema objects and database-enforced immutability
  // -------------------------------------------------------------------------

  describe('schema', () => {
    async function objectNames(query: string): Promise<string[]> {
      const rows = await harness.prisma.$queryRawUnsafe<{ name: string }[]>(query);
      return rows.map((row) => row.name);
    }

    it('holds every hand-written constraint by name', async () => {
      const names = await objectNames(`
        SELECT conname AS name FROM pg_constraint
        WHERE conrelid = 'therapist_share_rule'::regclass
      `);

      for (const constraint of [
        'therapist_share_rule_basis_points_chk',
        'therapist_share_rule_effective_range_chk',
        'therapist_share_rule_void_consistency_chk',
        'therapist_share_rule_void_reason_chk',
        'therapist_share_rule_self_supersede_chk',
        'therapist_share_rule_no_overlap_excl',
      ]) {
        expect(names).toContain(constraint);
      }
    });

    it('holds the no-delete, no-truncate and immutability triggers', async () => {
      const names = await objectNames(`
        SELECT tgname AS name FROM pg_trigger
        WHERE tgrelid = 'therapist_share_rule'::regclass AND NOT tgisinternal
      `);

      expect(names).toEqual(
        expect.arrayContaining([
          'therapist_share_rule_no_delete',
          'therapist_share_rule_no_truncate',
          'therapist_share_rule_enforce_immutability',
        ]),
      );
    });

    it('refuses a percentage outside the basis-point bounds at the database', async () => {
      const { token, user } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      // Straight past the service and past Zod, which is the point: the bound
      // must hold for a migration script and a psql prompt too.
      await expect(
        harness.prisma.$executeRawUnsafe(
          `INSERT INTO therapist_share_rule
             (id, therapist_id, share_basis_points, effective_start, created_at, created_by_user_id)
           VALUES ($1::uuid, $2::uuid, 10001, '2026-01-01'::date, transaction_timestamp(), $3::uuid)`,
          uuidv7(),
          therapistId,
          user.id,
        ),
      ).rejects.toThrow();
    });

    it('refuses every edit but the single void transition', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);
      const created = shareRuleResponseSchema.parse(
        (await createRule(token, rule(therapistId))).body,
      ).shareRule;

      for (const update of [
        `share_basis_points = 9000`,
        `effective_start = '2025-01-01'::date`,
        `effective_end = '2026-12-31'::date`,
      ]) {
        await expect(
          harness.prisma.$executeRawUnsafe(
            `UPDATE therapist_share_rule SET ${update} WHERE id = $1::uuid`,
            created.id,
          ),
        ).rejects.toThrow();
      }

      const stored = await harness.prisma.therapistShareRule.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(stored.shareBasisPoints).toBe(4000);
    });

    it('refuses a delete', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);
      const created = shareRuleResponseSchema.parse(
        (await createRule(token, rule(therapistId))).body,
      ).shareRule;

      await expect(
        ownerPrisma().$executeRawUnsafe(
          `DELETE FROM therapist_share_rule WHERE id = $1::uuid`,
          created.id,
        ),
      ).rejects.toThrow();
    });

    it('refuses to unvoid a rule once it is voided', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);
      const created = shareRuleResponseSchema.parse(
        (await createRule(token, rule(therapistId))).body,
      ).shareRule;
      await voidRule(token, created.id, 'withdrawn');

      await expect(
        harness.prisma.$executeRawUnsafe(
          `UPDATE therapist_share_rule
             SET voided_at = NULL, voided_by_user_id = NULL, void_reason = NULL
           WHERE id = $1::uuid`,
          created.id,
        ),
      ).rejects.toThrow();
    });

    it('refuses a rule that supersedes itself', async () => {
      const { token, user } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);
      const id = uuidv7();

      await expect(
        harness.prisma.$executeRawUnsafe(
          `INSERT INTO therapist_share_rule
             (id, therapist_id, share_basis_points, effective_start, supersedes_share_rule_id,
              created_at, created_by_user_id)
           VALUES ($1::uuid, $2::uuid, 4000, '2026-01-01'::date, $1::uuid,
                   transaction_timestamp(), $3::uuid)`,
          id,
          therapistId,
          user.id,
        ),
      ).rejects.toThrow();
    });
  });
});
