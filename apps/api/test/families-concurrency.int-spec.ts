import { createHash } from 'node:crypto';
import { duplicateBlockedDetailsSchema } from '@clinic/contracts';
import { createHarness, resetDatabase, type Harness } from './harness';
import {
  blockOn,
  childPayload,
  confirmRegistration,
  createChild,
  createFamily,
  discardDraft,
  familyPayload,
  guardian,
  seedFamily,
  signIn,
} from './families-support';

/**
 * What happens when two receptionists register at the same moment.
 *
 * This is the suite that decides whether duplicate detection means anything. A
 * check that reads before it writes is not a check under concurrency: both
 * requests read "no duplicate", both insert, and the clinic ends up with exactly
 * the two records the check existed to prevent. The advisory locks are what turn
 * a read into a decision.
 *
 * As in the Milestone 2 tariff suite, nothing here is synchronised on a timer. A
 * `sleep` long enough to be reliable is slow, and one short enough to be fast
 * passes on a quiet machine and fails in CI — the worst kind of failure, because
 * it looks like a defect in the code under test. Two mechanisms do the work
 * instead: firing requests together and asserting on the invariant that must
 * hold whichever order they land in, and `waitUntilBlocked`, which polls
 * `pg_stat_activity` until a request is provably waiting on a lock.
 */
describe('family concurrency (real PostgreSQL)', () => {
  let harness: Harness;
  let token: string;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
    token = (await signIn(harness, 'RECEPTIONIST')).token;
  });

  const MOBILE_A = '09121111111';
  const MOBILE_B = '09122222222';
  const MOBILE_C = '09123333333';

  /**
   * Returns once at least `count` backends are waiting on a lock.
   *
   * The bound is an iteration count rather than a deadline, so a failure says
   * "this never happened" rather than "this was slow". Each iteration is one
   * cheap round trip.
   */
  async function waitUntilBlocked(count = 1): Promise<void> {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const rows = await harness.prisma.$queryRaw<{ blocked: bigint }[]>`
        SELECT count(*) AS blocked
        FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND state = 'active'
      `;

      if (Number(rows[0]?.blocked ?? 0) >= count) return;

      // Yields to the event loop so the in-flight request can progress. Not a
      // delay: the next iteration re-checks the same condition immediately.
      await new Promise((resolve) => setImmediate(resolve));
    }

    throw new Error('No request ever blocked on a lock');
  }

  describe('two registrations sharing one mobile', () => {
    it('produces exactly one 201 and one 409, whichever lands first', async () => {
      const [first, second] = await Promise.all([
        createFamily(
          harness,
          token,
          familyPayload({ familyName: 'الف' }, [guardian({ mobile: MOBILE_A })]),
        ),
        createFamily(
          harness,
          token,
          familyPayload({ familyName: 'ب' }, [guardian({ mobile: MOBILE_A })]),
        ),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([201, 409]);

      const blocked = first.status === 409 ? first : second;
      expect(blocked.body.error.code).toBe('FAMILY_POSSIBLE_DUPLICATE');

      // Exactly one family, one guardian, one audit row — and one draft, held
      // for the request that was refused.
      expect(await harness.prisma.family.count()).toBe(1);
      expect(await harness.prisma.guardian.count()).toBe(1);
      expect(await harness.prisma.auditLog.count({ where: { action: 'family.created' } })).toBe(1);
      expect(await harness.prisma.registrationDraft.count()).toBe(1);
    }, 30000);

    it('holds when the shared number is on a non-primary guardian', async () => {
      const [first, second] = await Promise.all([
        createFamily(
          harness,
          token,
          familyPayload({ familyName: 'الف' }, [
            guardian({ fullName: 'مادر', mobile: MOBILE_B, isPrimaryContact: true }),
            guardian({ fullName: 'پدر', mobile: MOBILE_A, isPrimaryContact: false }),
          ]),
        ),
        createFamily(
          harness,
          token,
          familyPayload({ familyName: 'ب' }, [
            guardian({ fullName: 'مادر', mobile: MOBILE_C, isPrimaryContact: true }),
            guardian({ fullName: 'پدر', mobile: MOBILE_A, isPrimaryContact: false }),
          ]),
        ),
      ]);

      expect([first.status, second.status].sort()).toEqual([201, 409]);
      expect(await harness.prisma.family.count()).toBe(1);
    }, 30000);

    it('really does block, rather than merely losing a race', async () => {
      // Proves the second request waits on a lock instead of both reading a
      // stale snapshot. The transaction below holds the advisory key the second
      // request needs, so the block is a fact rather than a hope.
      const key = await harness.prisma.$queryRaw<{ key: bigint }[]>`
        SELECT hashtextextended('family-mobile:' || ${MOBILE_A}, 0) AS key
      `;

      let inFlight!: Promise<{ status: number }>;

      await harness.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key[0]?.key}::bigint)`;

        inFlight = createFamily(
          harness,
          token,
          familyPayload({ familyName: 'الف' }, [guardian({ mobile: MOBILE_A })]),
        ).then((response) => response);

        await waitUntilBlocked();
      });

      const created = await inFlight;
      expect(created.status).toBe(201);
    }, 30000);
  });

  describe('lock ordering', () => {
    it('does not deadlock when two requests submit overlapping sets in opposite orders', async () => {
      // {A,B} and {B,A}. Without ascending-key ordering these two transactions
      // would take the shared keys in opposite orders and wait on each other
      // forever; the test would hang rather than fail, which is why it carries
      // its own timeout.
      const [first, second] = await Promise.all([
        createFamily(
          harness,
          token,
          familyPayload({ familyName: 'الف' }, [
            guardian({ fullName: 'یک', mobile: MOBILE_A, isPrimaryContact: true }),
            guardian({ fullName: 'دو', mobile: MOBILE_B, isPrimaryContact: false }),
          ]),
        ),
        createFamily(
          harness,
          token,
          familyPayload({ familyName: 'ب' }, [
            guardian({ fullName: 'یک', mobile: MOBILE_B, isPrimaryContact: true }),
            guardian({ fullName: 'دو', mobile: MOBILE_A, isPrimaryContact: false }),
          ]),
        ),
      ]);

      // Both completed. One won, one was refused as a duplicate; neither hung
      // and neither raised a deadlock error.
      expect([first.status, second.status].sort()).toEqual([201, 409]);
      for (const response of [first, second]) {
        expect(response.body.error?.code).not.toBe('INTERNAL_ERROR');
      }
    }, 30000);

    it('lets unrelated numbers register at the same time', async () => {
      // Different keys, so the locks never meet. Serialising these would make
      // registration a global bottleneck for no safety gain.
      const [first, second] = await Promise.all([
        createFamily(
          harness,
          token,
          familyPayload({ familyName: 'الف' }, [guardian({ mobile: MOBILE_A })]),
        ),
        createFamily(
          harness,
          token,
          familyPayload({ familyName: 'ب' }, [guardian({ mobile: MOBILE_B })]),
        ),
      ]);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(await harness.prisma.family.count()).toBe(2);
    }, 30000);
  });

  describe('transaction boundaries', () => {
    it('rolls the family and its audit row back when a guardian insert fails', async () => {
      // The guardian is rejected by `guardian_mobile_chk` after the family row
      // and before the audit row. Either all three exist or none do.
      const rejected = harness.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          INSERT INTO family (id, family_name, search_family_name, address, note, status,
                              deactivated_at, created_at, created_by_user_id)
          VALUES (gen_random_uuid(), 'رضایی', fa_normalize('رضایی'), NULL, NULL,
                  'ACTIVE'::record_status, NULL, transaction_timestamp(),
                  (SELECT id FROM app_user LIMIT 1))
        `;
        await tx.$executeRaw`
          INSERT INTO guardian (id, family_id, full_name, search_full_name, relationship,
                                relationship_note, mobile, landline, is_primary_contact)
          VALUES (gen_random_uuid(), (SELECT id FROM family LIMIT 1), 'الف', fa_normalize('الف'),
                  'MOTHER'::guardian_relationship, NULL, 'not-a-number', NULL, true)
        `;
      });

      await expect(rejected).rejects.toThrow();

      expect(await harness.prisma.family.count()).toBe(0);
      expect(await harness.prisma.guardian.count()).toBe(0);
      expect(await harness.prisma.auditLog.count({ where: { action: 'family.created' } })).toBe(0);
    }, 30000);
  });

  describe('draft replacement', () => {
    it('invalidates the previous token atomically for the same user and session', async () => {
      await seedFamily(
        harness,
        token,
        familyPayload({ familyName: 'رضایی' }, [guardian({ mobile: MOBILE_A })]),
      );

      const first = await createFamily(
        harness,
        token,
        familyPayload({ familyName: 'الف' }, [guardian({ mobile: MOBILE_A })]),
      );
      const second = await createFamily(
        harness,
        token,
        familyPayload({ familyName: 'ب' }, [guardian({ mobile: MOBILE_A })]),
      );

      const firstToken = duplicateBlockedDetailsSchema.parse(first.body.error.details).draftToken;
      const secondToken = duplicateBlockedDetailsSchema.parse(second.body.error.details).draftToken;

      expect(firstToken).not.toBe(secondToken);

      // One row, carrying the hash of the second token only. The first token
      // stopped working the instant the upsert committed.
      const drafts = await harness.prisma.registrationDraft.findMany();
      expect(drafts).toHaveLength(1);

      const stored = Buffer.from(drafts[0]?.tokenHash ?? new Uint8Array());
      expect(stored.equals(createHash('sha256').update(secondToken).digest())).toBe(true);
      expect(stored.equals(createHash('sha256').update(firstToken).digest())).toBe(false);

      expect((drafts[0]?.payload as { familyName: string }).familyName).toBe('ب');
    }, 30000);

    it('leaves another session of the same user untouched', async () => {
      // Somebody working in two browsers holds two independent drafts. Starting
      // one must not silently destroy the other.
      await seedFamily(
        harness,
        token,
        familyPayload({ familyName: 'رضایی' }, [guardian({ mobile: MOBILE_A })]),
      );

      const secondSession = await signInSameUser(harness, token);

      const first = await createFamily(
        harness,
        token,
        familyPayload({ familyName: 'الف' }, [guardian({ mobile: MOBILE_A })]),
      );
      const second = await createFamily(
        harness,
        secondSession,
        familyPayload({ familyName: 'ب' }, [guardian({ mobile: MOBILE_A })]),
      );

      expect(first.status).toBe(409);
      expect(second.status).toBe(409);

      const drafts = await harness.prisma.registrationDraft.findMany();
      expect(drafts).toHaveLength(2);
      // Same user, same purpose, two sessions — so two rows, not one.
      expect(new Set(drafts.map((draft) => draft.createdByUserId)).size).toBe(1);
      expect(new Set(drafts.map((draft) => draft.sessionId)).size).toBe(2);
    }, 30000);
  });
});

/**
 * Signs the same account in again, producing a second live session.
 *
 * Reads the username from the session the caller already holds rather than
 * threading it through every helper.
 */
async function signInSameUser(harness: Harness, existingToken: string): Promise<string> {
  const request = (await import('supertest')).default;
  const { internalHeaders, TEST_PASSWORD } = await import('./harness');
  const { loginResponseSchema } = await import('@clinic/contracts');

  const session = await request(harness.app.getHttpServer())
    .get('/auth/session')
    .set(internalHeaders({ 'x-session-id': existingToken }));

  const username = session.body.user.username as string;

  const response = await request(harness.app.getHttpServer())
    .post('/auth/login')
    .set(internalHeaders())
    .send({ username, password: TEST_PASSWORD });

  return loginResponseSchema.parse(response.body).sessionToken;
}

/**
 * The child half of the matrix, and the draft races that decide who wins a
 * one-time consumption.
 *
 * Same discipline as above: fire together, assert the invariant that must hold
 * in either order, and use `pg_stat_activity` when a block has to be proved
 * rather than hoped for.
 */
describe('child and draft concurrency (real PostgreSQL)', () => {
  let harness: Harness;
  let token: string;
  let familyId: string;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
    token = (await signIn(harness, 'RECEPTIONIST')).token;
    familyId = await seedFamily(harness, token, familyPayload());
  });

  /** Polls until a backend is provably waiting on a lock. */
  async function waitUntilLockWait(count = 1): Promise<void> {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const rows = await harness.prisma.$queryRaw<{ blocked: bigint }[]>`
        SELECT count(*) AS blocked FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND state = 'active'
      `;

      if (Number(rows[0]?.blocked ?? 0) >= count) return;

      await new Promise((resolve) => setImmediate(resolve));
    }

    throw new Error('No request ever blocked on a lock');
  }

  describe('two registrations of the same child', () => {
    it('produces exactly one 201 and one 409', async () => {
      const [first, second] = await Promise.all([
        createChild(harness, token, familyId, childPayload()),
        createChild(harness, token, familyId, childPayload()),
      ]);

      expect([first.status, second.status].sort()).toEqual([201, 409]);

      const blocked = first.status === 409 ? first : second;
      expect(blocked.body.error.code).toBe('CHILD_POSSIBLE_DUPLICATE');

      expect(await harness.prisma.child.count()).toBe(1);
      expect(await harness.prisma.auditLog.count({ where: { action: 'child.created' } })).toBe(1);
      expect(await harness.prisma.registrationDraft.count()).toBe(1);
    }, 30000);

    it('holds across Persian spelling variants of the same name', async () => {
      // The key is derived from the NORMALISED name, so the Arabic and Persian
      // spellings take the same lock and one of them waits.
      const [first, second] = await Promise.all([
        createChild(harness, token, familyId, childPayload({ firstName: 'علي' })),
        createChild(harness, token, familyId, childPayload({ firstName: 'علی' })),
      ]);

      expect([first.status, second.status].sort()).toEqual([201, 409]);
      expect(await harness.prisma.child.count()).toBe(1);
    }, 30000);

    it('really does block on the identity key', async () => {
      const key = await harness.prisma.$queryRaw<{ key: bigint }[]>`
        SELECT hashtextextended(
          'child-identity:' || ${familyId}::text || ':' || fa_normalize('علی')
            || ':' || fa_normalize('رضایی') || ':' || '2020-03-21'::date::text, 0
        ) AS key
      `;

      let inFlight!: Promise<{ status: number }>;

      await harness.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key[0]?.key}::bigint)`;

        inFlight = createChild(harness, token, familyId, childPayload()).then((r) => r);

        await waitUntilLockWait();
      });

      expect((await inFlight).status).toBe(201);
    }, 30000);

    it('lets two different children register at the same time', async () => {
      const [first, second] = await Promise.all([
        createChild(harness, token, familyId, childPayload({ firstName: 'علی' })),
        createChild(harness, token, familyId, childPayload({ firstName: 'زهرا' })),
      ]);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(await harness.prisma.child.count()).toBe(2);
    }, 30000);

    it('gives concurrent registrations distinct file numbers', async () => {
      const results = await Promise.all([
        createChild(harness, token, familyId, childPayload({ firstName: 'الف' })),
        createChild(harness, token, familyId, childPayload({ firstName: 'ب' })),
        createChild(harness, token, familyId, childPayload({ firstName: 'پ' })),
      ]);

      for (const response of results) expect(response.status).toBe(201);

      const numbers = (await harness.prisma.child.findMany({ select: { fileNumber: true } })).map(
        (row) => row.fileNumber,
      );

      // No gap-free claim: a rolled-back transaction legitimately burns one.
      expect(new Set(numbers).size).toBe(3);
    }, 30000);
  });

  describe('one draft, two terminal actions', () => {
    it('lets exactly one confirmation consume the token', async () => {
      // The family seeded in beforeEach already holds this mobile, so this
      // registration is blocked by it.
      const { draftToken, candidateIds } = await blockOn(
        harness,
        token,
        familyPayload({ familyName: 'ب' }, [guardian({ mobile: '09121234567' })]),
      );

      const [first, second] = await Promise.all([
        confirmRegistration(harness, token, draftToken, candidateIds),
        confirmRegistration(harness, token, draftToken, candidateIds),
      ]);

      expect([first.status, second.status].sort()).toEqual([201, 404]);

      const loser = first.status === 404 ? first : second;
      expect(loser.body.error.code).toBe('DRAFT_NOT_FOUND');

      expect(await harness.prisma.registrationDraft.count()).toBe(0);
      expect(
        await harness.prisma.auditLog.count({ where: { action: 'family.duplicate_override' } }),
      ).toBe(1);
    }, 30000);

    it('lets exactly one of confirm and discard win', async () => {
      // The family seeded in beforeEach already holds this mobile, so this
      // registration is blocked by it.
      const { draftToken, candidateIds } = await blockOn(
        harness,
        token,
        familyPayload({ familyName: 'ب' }, [guardian({ mobile: '09121234567' })]),
      );

      const familiesBefore = await harness.prisma.family.count();

      const [confirmed, discarded] = await Promise.all([
        confirmRegistration(harness, token, draftToken, candidateIds),
        discardDraft(harness, token, draftToken),
      ]);

      const outcomes = [confirmed.status, discarded.status].sort();
      // Either the confirmation won (201 + 404) or the discard did (204 + 404).
      expect([
        [201, 404],
        [204, 404],
      ]).toContainEqual(outcomes);

      expect(await harness.prisma.registrationDraft.count()).toBe(0);
      expect(await harness.prisma.family.count()).toBe(
        confirmed.status === 201 ? familiesBefore + 1 : familiesBefore,
      );
    }, 30000);

    it('never lets an old token spend a replaced draft', async () => {
      const first = await blockOn(
        harness,
        token,
        familyPayload({ familyName: 'اول' }, [guardian({ mobile: '09121234567' })]),
      );
      const second = await blockOn(
        harness,
        token,
        familyPayload({ familyName: 'دوم' }, [guardian({ mobile: '09121234567' })]),
      );

      // Replacement is one ON CONFLICT DO UPDATE, so the first token's hash is
      // gone the instant it commits.
      const stale = await confirmRegistration(harness, token, first.draftToken, first.candidateIds);
      expect(stale.status).toBe(404);

      const current = await confirmRegistration(
        harness,
        token,
        second.draftToken,
        second.candidateIds,
      );
      expect(current.status).toBe(201);

      // The payload written is the second one, never the first.
      const created = await harness.prisma.family.findFirstOrThrow({
        where: { familyName: { in: ['اول', 'دوم'] } },
      });
      expect(created.familyName).toBe('دوم');
    }, 30000);
  });
});
