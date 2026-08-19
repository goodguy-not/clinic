import request from 'supertest';
import {
  loginResponseSchema,
  shareRuleResponseSchema,
  therapistResponseSchema,
} from '@clinic/contracts';
import {
  createHarness,
  internalHeaders,
  resetDatabase,
  seedUser,
  TEST_PASSWORD,
  type Harness,
} from './harness';

/**
 * What happens when two share-rule requests arrive at once.
 *
 * THE INVARIANT UNDER TEST IS THE ONE THE WHOLE CHECKPOINT RESTS ON: at most
 * one live rule may cover a therapist on any given day, so "which percentage
 * applied on this date?" has exactly one answer or none. An application that
 * reads before it writes cannot hold that — two managers submitting overlapping
 * ranges at the same instant both find the range free — so the authority is
 * `therapist_share_rule_no_overlap_excl`, and these tests exercise it rather
 * than the service's own checks.
 *
 * Every case is synchronised on an observable database condition, never on a
 * timer, for the reason `catalog-tariffs-concurrency.int-spec.ts` states: a
 * sleep long enough to be reliable is slow, and one short enough to be fast
 * fails in CI for a reason that looks like a defect in the code under test.
 */
describe('therapist share rule concurrency (real PostgreSQL)', () => {
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

  const server = () => harness.app.getHttpServer();
  const asUser = (token: string) => internalHeaders({ 'x-session-id': token });

  async function signIn() {
    const user = await seedUser(harness, { role: 'MANAGER' });
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

  /**
   * Returns once at least `count` backends are waiting on a lock for a query
   * matching `pattern`. An iteration bound rather than a deadline, so a failure
   * says "this never happened" rather than "this was slow".
   */
  async function waitUntilBlocked(pattern: string, count = 1): Promise<void> {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const rows = await harness.prisma.$queryRaw<{ blocked: bigint }[]>`
        SELECT count(*) AS blocked
        FROM pg_stat_activity
        WHERE wait_event_type = 'Lock'
          AND state = 'active'
          AND query ILIKE ${pattern}
      `;

      if (Number(rows[0]?.blocked ?? 0) >= count) return;

      // Yields to the event loop so the in-flight request can progress. Not a
      // delay: the next iteration re-checks the same condition immediately.
      await new Promise((resolve) => setImmediate(resolve));
    }

    throw new Error(`No request ever blocked on a lock matching ${pattern}`);
  }

  it('lets exactly one of two simultaneous overlapping rules become authoritative', async () => {
    const { token } = await signIn();
    const therapistId = await makeTherapist(token);

    // Fired together with no coordination at all. Either winner is legitimate;
    // the invariant is what must hold in both orderings.
    const responses = await Promise.all([
      createRule(token, rule(therapistId, { shareBasisPoints: 4000 })),
      createRule(token, rule(therapistId, { shareBasisPoints: 6000 })),
    ]);

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 409]);

    const refused = responses.find((response) => response.status === 409);
    expect(refused?.body.error.code).toBe('SHARE_RULE_OVERLAP');

    // One row, one audit row. The refusal wrote nothing and claims nothing.
    expect(await harness.prisma.therapistShareRule.count()).toBe(1);
    expect(
      await harness.prisma.auditLog.count({ where: { entityType: 'therapist_share_rule' } }),
    ).toBe(1);

    // And the question has exactly one answer.
    const resolution = await request(server())
      .get('/settlement/share-rule-resolution')
      .query({ therapistId, serviceDate: '2026-03-15' })
      .set(asUser(token));
    expect(resolution.status).toBe(200);
  }, 30000);

  it('refuses the second of two overlapping rules blocked behind an uncommitted first', async () => {
    const { token, user } = await signIn();
    const therapistId = await makeTherapist(token);

    let inFlight!: Promise<request.Response>;

    await harness.prisma.$transaction(async (tx) => {
      // Insert a covering rule inside a transaction the test controls and hold
      // it open. The exclusion constraint's index entry is taken; the row is
      // not yet visible to anyone else.
      await tx.$executeRawUnsafe(
        `INSERT INTO therapist_share_rule
           (id, therapist_id, share_basis_points, effective_start, effective_end,
            created_at, created_by_user_id)
         VALUES (gen_random_uuid(), $1::uuid, 4000, '2026-01-01'::date, NULL,
                 transaction_timestamp(), $2::uuid)`,
        therapistId,
        user.id,
      );

      // `.then` is what dispatches a supertest request — assigning it alone
      // builds the request without sending it, and nothing would ever block.
      inFlight = createRule(token, rule(therapistId, { shareBasisPoints: 6000 })).then(
        (response) => response,
      );

      // An exclusion constraint makes a conflicting inserter WAIT on the
      // uncommitted row rather than fail immediately, which is exactly the
      // ordering this test needs to be a fact rather than an assumption.
      await waitUntilBlocked('%INSERT INTO therapist_share_rule%');
    });

    const refused = await inFlight;
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('SHARE_RULE_OVERLAP');

    expect(await harness.prisma.therapistShareRule.count()).toBe(1);
    expect(
      await harness.prisma.auditLog.count({ where: { entityType: 'therapist_share_rule' } }),
    ).toBe(0);
  }, 30000);

  it('voids a rule exactly once when two withdrawals race', async () => {
    const { token } = await signIn();
    const therapistId = await makeTherapist(token);
    const created = shareRuleResponseSchema.parse(
      (await createRule(token, rule(therapistId))).body,
    ).shareRule;

    const responses = await Promise.all([
      voidRule(token, created.id, 'first withdrawal'),
      voidRule(token, created.id, 'second withdrawal'),
    ]);

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect(responses.find((response) => response.status === 409)?.body.error.code).toBe(
      'SHARE_RULE_ALREADY_VOIDED',
    );

    // Exactly one void fact. The loser blocked on `FOR UPDATE`, re-read the
    // committed `voided_at` and refused — it did not write a second one.
    const voidRows = await harness.prisma.auditLog.count({
      where: { entityType: 'therapist_share_rule', action: 'therapist_share_rule.voided' },
    });
    expect(voidRows).toBe(1);
  }, 30000);

  it('supersedes a rule exactly once when two corrections race', async () => {
    const { token } = await signIn();
    const therapistId = await makeTherapist(token);
    const original = shareRuleResponseSchema.parse(
      (await createRule(token, rule(therapistId))).body,
    ).shareRule;

    const correction = (shareBasisPoints: number) =>
      createRule(
        token,
        rule(therapistId, {
          shareBasisPoints,
          supersedesShareRuleId: original.id,
          reason: 'the agreed percentage was entered wrongly',
        }),
      );

    const responses = await Promise.all([correction(4500), correction(5500)]);

    // The loser either finds the rule already voided or collides with the
    // winner's replacement on the exclusion constraint. Both are correct
    // refusals; what must never happen is two live replacements.
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 409]);
    expect(responses.find((response) => response.status === 409)?.body.error.code).toMatch(
      /SHARE_RULE_ALREADY_VOIDED|SHARE_RULE_OVERLAP/,
    );

    const live = await harness.prisma.therapistShareRule.count({ where: { voidedAt: null } });
    expect(live).toBe(1);
    expect(await harness.prisma.therapistShareRule.count()).toBe(2);
  }, 30000);
});
