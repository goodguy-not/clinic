import { createHash } from 'node:crypto';
import request from 'supertest';
import { familyWriteResponseSchema, registrationDraftResponseSchema } from '@clinic/contracts';
import {
  createHarness,
  internalHeaders,
  resetDatabase,
  TEST_PASSWORD,
  type Harness,
} from './harness';
import {
  asUser,
  blockOn,
  confirmRegistration,
  deactivateFamily,
  discardDraft,
  expireDraft,
  familyPayload,
  guardian,
  insertFamilyDirect,
  resolveDraft,
  seedFamily,
  signIn,
} from './families-support';

/**
 * The registration-draft lifecycle.
 *
 * A draft holds what somebody typed while they decide whether the family they
 * are registering already exists. It is addressed by an opaque bearer token, so
 * most of this suite is about the ways that token must fail: expired, consumed,
 * belonging to another person, belonging to another session. Every one of them
 * answers `DRAFT_NOT_FOUND`, because telling the holder of a stale token which
 * condition they tripped is telling them how to get closer.
 */
describe('registration drafts (real PostgreSQL)', () => {
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

  const MOBILE = '09121234567';

  /** Seeds a family, then blocks on it, leaving one live draft. */
  async function blockedDraft(): Promise<{ draftToken: string; candidateIds: string[] }> {
    await seedFamily(harness, token, familyPayload({ familyName: 'رضایی' }));

    return blockOn(
      harness,
      token,
      familyPayload({ familyName: 'احمدی' }, [guardian({ mobile: MOBILE })]),
    );
  }

  describe('the token at rest', () => {
    it('stores only the SHA-256 hash, never the token', async () => {
      const { draftToken } = await blockedDraft();

      const rows = await harness.prisma.$queryRaw<{ token_hash: Uint8Array; row: string }[]>`
        SELECT token_hash, registration_draft::text AS row FROM registration_draft
      `;

      const stored = Buffer.from(rows[0]?.token_hash ?? new Uint8Array());

      expect(stored).toHaveLength(32);
      expect(stored.equals(createHash('sha256').update(draftToken).digest())).toBe(true);
      // The whole row, rendered as text, contains the token nowhere.
      expect(rows[0]?.row).not.toContain(draftToken);
    });

    it('is 32 random bytes in base64url', async () => {
      const { draftToken } = await blockedDraft();

      expect(draftToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(draftToken, 'base64url')).toHaveLength(32);
    });

    it('binds to the creating user and session', async () => {
      const { draftToken } = await blockedDraft();

      const session = await request(harness.app.getHttpServer())
        .get('/auth/session')
        .set(asUser(token));

      const draft = await harness.prisma.registrationDraft.findFirstOrThrow();

      expect(draft.createdByUserId).toBe(session.body.user.id);
      expect(draft.sessionId).not.toBeNull();
      expect(
        createHash('sha256').update(draftToken).digest().equals(Buffer.from(draft.tokenHash)),
      ).toBe(true);
    });

    it('is never audited', async () => {
      await blockedDraft();

      const rows = await harness.prisma.auditLog.findMany();

      for (const row of rows) {
        expect(row.entityType).not.toBe('registration_draft');
        expect(row.action).not.toMatch(/draft/i);
      }
    });
  });

  describe('GET /registration-drafts/current', () => {
    it('resolves a valid draft without consuming it', async () => {
      const { draftToken } = await blockedDraft();

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const response = await resolveDraft(harness, token, draftToken);
        expect(response.status).toBe(200);

        const body = registrationDraftResponseSchema.parse(response.body);
        expect(body.purpose).toBe('FAMILY_CREATE');
        expect(body.family?.familyName).toBe('احمدی');
        expect(body.child).toBeNull();
        expect(body.targetFamilyId).toBeNull();
        expect(body.targetChildId).toBeNull();
      }

      // Three reads, one draft. Refreshing the confirmation screen must not
      // destroy the thing it is showing.
      expect(await harness.prisma.registrationDraft.count()).toBe(1);
    });

    it('presents the stored shown set, not a fresh detection pass', async () => {
      const { draftToken, candidateIds } = await blockedDraft();

      const body = registrationDraftResponseSchema.parse(
        (await resolveDraft(harness, token, draftToken)).body,
      );

      expect(body.candidates.map((candidate) => candidate.familyId)).toEqual(candidateIds);
      expect(body.candidates[0]?.rule).toBe('FAMILY_DUPLICATE_MOBILE');
      expect(body.candidates[0]?.blocking).toBe(true);
    });

    it('never demotes a blocking candidate because its data changed', async () => {
      // The defect this pins: classifying each stored candidate by re-comparing
      // it against the payload meant that editing the candidate's mobile
      // relabelled it `SIMILAR_FAMILY_NAME_AND_GUARDIAN` — the stored
      // confirmation state saying one thing and the screen saying another, on a
      // page whose entire job is to ask "is this the same family?".
      const { draftToken, candidateIds } = await blockedDraft();

      await harness.prisma.$executeRaw`
        UPDATE guardian SET mobile = '09990000000' WHERE family_id = ${candidateIds[0]}::uuid
      `;

      const body = registrationDraftResponseSchema.parse(
        (await resolveDraft(harness, token, draftToken)).body,
      );

      expect(body.candidates.map((candidate) => candidate.familyId)).toEqual(candidateIds);
      expect(body.candidates[0]?.rule).toBe('FAMILY_DUPLICATE_MOBILE');
      expect(body.candidates[0]?.blocking).toBe(true);
    });

    it('stores only the blocking candidates, so membership carries the meaning', async () => {
      // A soft warning is shown once, in the response that reported it. Mixing
      // the two kinds into one stored list would force every reader to guess
      // which is which — which is exactly how the demotion bug became possible.
      const session = await request(harness.app.getHttpServer())
        .get('/auth/session')
        .set(asUser(token));
      const actorId = session.body.user.id as string;

      // A blocking family (shared mobile) and a soft-warning family (shared
      // landline only).
      await seedFamily(harness, token, familyPayload({ familyName: 'رضایی' }));
      await insertFamilyDirect(harness, actorId, 'هم‌تلفن', '09998887766', '02112345678');

      const { draftToken, candidateIds } = await blockOn(
        harness,
        token,
        familyPayload({ familyName: 'احمدی' }, [
          guardian({ mobile: MOBILE, landline: '02112345678' }),
        ]),
      );

      const draft = await harness.prisma.registrationDraft.findFirstOrThrow();
      expect(draft.shownCandidateIds).toEqual(candidateIds);
      expect(draft.shownCandidateIds).toHaveLength(1);

      const body = registrationDraftResponseSchema.parse(
        (await resolveDraft(harness, token, draftToken)).body,
      );
      expect(body.candidates.every((candidate) => candidate.blocking)).toBe(true);
    });

    it('keeps showing a candidate that has since been deactivated', async () => {
      // The stored set is what somebody was shown, and opening the page again
      // must not quietly rewrite it. Whether that family still blocks is a
      // question for the confirm transaction, which is where it is acted on.
      const { draftToken, candidateIds } = await blockedDraft();

      await deactivateFamily(harness, candidateIds[0] ?? '');

      const body = registrationDraftResponseSchema.parse(
        (await resolveDraft(harness, token, draftToken)).body,
      );

      expect(body.candidates.map((candidate) => candidate.familyId)).toEqual(candidateIds);

      const draft = await harness.prisma.registrationDraft.findFirstOrThrow();
      expect(draft.shownCandidateIds).toEqual(candidateIds);
    });

    it('exposes no token hash and no internal search column', async () => {
      const { draftToken } = await blockedDraft();

      const raw = JSON.stringify((await resolveDraft(harness, token, draftToken)).body);

      for (const forbidden of [
        'tokenHash',
        'token_hash',
        'search_family_name',
        'searchFamilyName',
      ]) {
        expect(raw).not.toContain(forbidden);
      }
    });

    it('masks candidate contact details', async () => {
      const { draftToken } = await blockedDraft();

      const raw = JSON.stringify((await resolveDraft(harness, token, draftToken)).body);

      // The submitted payload legitimately carries the number somebody typed —
      // it is what they are being shown back. The CANDIDATE must not.
      const body = registrationDraftResponseSchema.parse(JSON.parse(raw));
      for (const candidate of body.candidates) {
        expect(candidate.maskedMobile === null || candidate.maskedMobile.startsWith('*')).toBe(
          true,
        );
        expect(candidate.maskedMobile).not.toBe(MOBILE);
      }
    });
  });

  describe('the shown set changes only when the blocking flow changes it', () => {
    it('walks the whole sequence: shown A, B appears, confirm refuses, shown A+B, confirm succeeds', async () => {
      // The sequence the design turns on, end to end.

      // 1. A blocked registration stores candidate A.
      const { draftToken, candidateIds } = await blockedDraft();
      expect(candidateIds).toHaveLength(1);
      const [candidateA] = candidateIds;

      // 2. GET current resolves A, and consumes nothing.
      const first = registrationDraftResponseSchema.parse(
        (await resolveDraft(harness, token, draftToken)).body,
      );
      expect(first.candidates.map((candidate) => candidate.familyId)).toEqual([candidateA]);
      expect(await harness.prisma.registrationDraft.count()).toBe(1);

      // 3. A new blocking family B appears. Merely looking at the page must not
      //    notice it, must not run the authoritative transition, and must not
      //    rewrite the stored set.
      const session = await request(harness.app.getHttpServer())
        .get('/auth/session')
        .set(asUser(token));
      const candidateB = await insertFamilyDirect(
        harness,
        session.body.user.id as string,
        'تازه‌وارد',
        MOBILE,
      );

      const afterB = registrationDraftResponseSchema.parse(
        (await resolveDraft(harness, token, draftToken)).body,
      );
      expect(afterB.candidates.map((candidate) => candidate.familyId)).toEqual([candidateA]);
      expect((await harness.prisma.registrationDraft.findFirstOrThrow()).shownCandidateIds).toEqual(
        [candidateA],
      );
      // Nothing was created and no draft was consumed by looking. Two families
      // exist: the one that caused the block, and B.
      expect(await harness.prisma.registrationDraft.count()).toBe(1);
      expect(await harness.prisma.family.count()).toBe(2);

      // 4. Confirming with only A detects B authoritatively and refuses.
      const refused = await confirmRegistration(harness, token, draftToken, [candidateA ?? '']);
      expect(refused.status).toBe(409);

      const details = refused.body.error.details as {
        draftToken: string;
        candidates: { familyId: string; blocking: boolean }[];
      };
      expect(details.draftToken).toBe(draftToken);
      expect(
        details.candidates
          .filter((candidate) => candidate.blocking)
          .map((candidate) => candidate.familyId)
          .sort(),
      ).toEqual([candidateA, candidateB].sort());

      // 5. The draft survived, with a refreshed stored set.
      const refreshed = await harness.prisma.registrationDraft.findFirstOrThrow();
      expect([...refreshed.shownCandidateIds].sort()).toEqual([candidateA, candidateB].sort());

      // 6. A following GET current reflects the refreshed stored set.
      const afterRefresh = registrationDraftResponseSchema.parse(
        (await resolveDraft(harness, token, draftToken)).body,
      );
      expect(afterRefresh.candidates.map((candidate) => candidate.familyId).sort()).toEqual(
        [candidateA, candidateB].sort(),
      );

      // 7. Acknowledging the fresh set completes the registration.
      const confirmed = await confirmRegistration(harness, token, draftToken, [
        candidateA ?? '',
        candidateB,
      ]);
      expect(confirmed.status).toBe(201);
      expect(await harness.prisma.family.count()).toBe(3);
      expect(await harness.prisma.registrationDraft.count()).toBe(0);
    }, 30000);
  });

  describe('every unusable token answers the same way', () => {
    it('rejects a missing header', async () => {
      await blockedDraft();

      const response = await request(harness.app.getHttpServer())
        .get('/registration-drafts/current')
        .set(asUser(token));

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('DRAFT_NOT_FOUND');
    });

    it('rejects an unknown token', async () => {
      await blockedDraft();

      const response = await resolveDraft(harness, token, 'a'.repeat(43));

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('DRAFT_NOT_FOUND');
    });

    it('rejects another user holding the token', async () => {
      const { draftToken } = await blockedDraft();
      const other = await signIn(harness, 'MANAGER');

      const response = await resolveDraft(harness, other.token, draftToken);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('DRAFT_NOT_FOUND');
    });

    it('rejects the same user in a different session', async () => {
      // The binding is (user, session), not user alone. Somebody signed in on a
      // second machine is not the person who typed this.
      const { draftToken } = await blockedDraft();
      const secondSession = await signInAgain(harness, token);

      const response = await resolveDraft(harness, secondSession, draftToken);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('DRAFT_NOT_FOUND');
    });

    it('rejects an expired token, and the row is swept away', async () => {
      const { draftToken } = await blockedDraft();
      await expireDraft(harness, draftToken);

      const response = await resolveDraft(harness, token, draftToken);
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('DRAFT_NOT_FOUND');

      // The opportunistic sweep removed it rather than leaving a dead row.
      expect(await harness.prisma.registrationDraft.count()).toBe(0);
    });

    it('does not sweep a draft that is still valid', async () => {
      const { draftToken } = await blockedDraft();

      await resolveDraft(harness, token, draftToken);

      expect(await harness.prisma.registrationDraft.count()).toBe(1);
    });
  });

  describe('POST /registration-drafts/discard', () => {
    it('deletes the draft and answers 204', async () => {
      const { draftToken } = await blockedDraft();

      const response = await discardDraft(harness, token, draftToken);

      expect(response.status).toBe(204);
      expect(response.body).toEqual({});
      expect(await harness.prisma.registrationDraft.count()).toBe(0);
    });

    it('answers DRAFT_NOT_FOUND on replay', async () => {
      const { draftToken } = await blockedDraft();

      await discardDraft(harness, token, draftToken);
      const replay = await discardDraft(harness, token, draftToken);

      expect(replay.status).toBe(404);
      expect(replay.body.error.code).toBe('DRAFT_NOT_FOUND');
    });

    it('cannot be discarded by another session of the same user', async () => {
      const { draftToken } = await blockedDraft();
      const secondSession = await signInAgain(harness, token);

      expect((await discardDraft(harness, secondSession, draftToken)).status).toBe(404);
      expect(await harness.prisma.registrationDraft.count()).toBe(1);
    });

    it('writes no audit row', async () => {
      const { draftToken } = await blockedDraft();
      const before = await harness.prisma.auditLog.count();

      await discardDraft(harness, token, draftToken);

      expect(await harness.prisma.auditLog.count()).toBe(before);
    });
  });

  describe('cross-session and replacement', () => {
    it('keeps two sessions of one user independent', async () => {
      await seedFamily(harness, token, familyPayload({ familyName: 'رضایی' }));
      const secondSession = await signInAgain(harness, token);

      const first = await blockOn(
        harness,
        token,
        familyPayload({ familyName: 'الف' }, [guardian({ mobile: MOBILE })]),
      );
      const second = await blockOn(
        harness,
        secondSession,
        familyPayload({ familyName: 'ب' }, [guardian({ mobile: MOBILE })]),
      );

      expect(await harness.prisma.registrationDraft.count()).toBe(2);

      // Each session resolves its own and only its own.
      expect((await resolveDraft(harness, token, first.draftToken)).status).toBe(200);
      expect((await resolveDraft(harness, secondSession, second.draftToken)).status).toBe(200);
      expect((await resolveDraft(harness, token, second.draftToken)).status).toBe(404);
      expect((await resolveDraft(harness, secondSession, first.draftToken)).status).toBe(404);
    });

    it('invalidates the previous token when the same session blocks again', async () => {
      await seedFamily(harness, token, familyPayload({ familyName: 'رضایی' }));

      const first = await blockOn(
        harness,
        token,
        familyPayload({ familyName: 'الف' }, [guardian({ mobile: MOBILE })]),
      );
      const second = await blockOn(
        harness,
        token,
        familyPayload({ familyName: 'ب' }, [guardian({ mobile: MOBILE })]),
      );

      expect(first.draftToken).not.toBe(second.draftToken);
      expect(await harness.prisma.registrationDraft.count()).toBe(1);

      // The replacement is one upsert, so the old token stopped working the
      // instant it committed.
      expect((await resolveDraft(harness, token, first.draftToken)).status).toBe(404);

      const body = registrationDraftResponseSchema.parse(
        (await resolveDraft(harness, token, second.draftToken)).body,
      );
      expect(body.family?.familyName).toBe('ب');
    });
  });

  describe('one-time consumption through confirmation', () => {
    it('creates the family and consumes the draft exactly once', async () => {
      const { draftToken, candidateIds } = await blockedDraft();

      const response = await confirmRegistration(harness, token, draftToken, candidateIds);
      expect(response.status).toBe(201);

      const body = familyWriteResponseSchema.parse(response.body);
      expect(body.family.familyName).toBe('احمدی');
      expect(body.children).toEqual([]);

      expect(await harness.prisma.family.count()).toBe(2);
      expect(await harness.prisma.registrationDraft.count()).toBe(0);
    });

    it('answers DRAFT_NOT_FOUND when the same token is replayed', async () => {
      const { draftToken, candidateIds } = await blockedDraft();

      await confirmRegistration(harness, token, draftToken, candidateIds);
      const replay = await confirmRegistration(harness, token, draftToken, candidateIds);

      expect(replay.status).toBe(404);
      expect(replay.body.error.code).toBe('DRAFT_NOT_FOUND');
      // The replay created nothing.
      expect(await harness.prisma.family.count()).toBe(2);
    });

    it('cannot be confirmed after being discarded', async () => {
      const { draftToken, candidateIds } = await blockedDraft();

      await discardDraft(harness, token, draftToken);
      const response = await confirmRegistration(harness, token, draftToken, candidateIds);

      expect(response.status).toBe(404);
      expect(await harness.prisma.family.count()).toBe(1);
    });

    it('cannot be confirmed by another session of the same user', async () => {
      const { draftToken, candidateIds } = await blockedDraft();
      const secondSession = await signInAgain(harness, token);

      const response = await confirmRegistration(harness, secondSession, draftToken, candidateIds);

      expect(response.status).toBe(404);
      expect(await harness.prisma.family.count()).toBe(1);
      expect(await harness.prisma.registrationDraft.count()).toBe(1);
    });

    it('cannot be confirmed after expiry', async () => {
      const { draftToken, candidateIds } = await blockedDraft();
      await expireDraft(harness, draftToken);

      const response = await confirmRegistration(harness, token, draftToken, candidateIds);

      expect(response.status).toBe(404);
      expect(await harness.prisma.family.count()).toBe(1);
    });
  });

  describe('response headers', () => {
    it('sets no-store and no-referrer on every draft response', async () => {
      const { draftToken } = await blockedDraft();

      const responses = [
        await resolveDraft(harness, token, draftToken),
        // 404 — through the exception filter.
        await resolveDraft(harness, token, 'b'.repeat(43)),
        // 401 — rejected by a guard, before the interceptor runs.
        await request(harness.app.getHttpServer())
          .get('/registration-drafts/current')
          .set(internalHeaders({ 'x-draft-token': draftToken })),
        await discardDraft(harness, token, draftToken),
      ];

      for (const response of responses) {
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.headers['referrer-policy']).toBe('no-referrer');
      }
    });

    it('refuses a receptionist nothing and an anonymous caller everything', async () => {
      const { draftToken } = await blockedDraft();

      expect((await resolveDraft(harness, token, draftToken)).status).toBe(200);

      const anonymous = await request(harness.app.getHttpServer())
        .post('/registration-drafts/discard')
        .set(internalHeaders({ 'x-draft-token': draftToken }));

      expect(anonymous.status).toBe(401);
      expect(anonymous.body.error.code).toBe('AUTH_SESSION_INVALID');
    });
  });

  describe('the routes deferred to Checkpoint E do not exist yet', () => {
    it.each([
      ['/families/confirm-update'],
      ['/children/confirm-registration'],
      ['/children/confirm-update'],
    ])('%s is not routed', async (path: string) => {
      // A confirmation route exists to perform a domain write. The writes these
      // would perform do not exist, so neither do they.
      const response = await request(harness.app.getHttpServer())
        .post(path)
        .set(asUser(token))
        .send({ acknowledgedDuplicateIds: ['0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'] });

      expect(response.status).toBe(404);
    });
  });

  describe('the draft token stays out of logs', () => {
    it('never appears in stdout or stderr, even on a refused confirmation', async () => {
      const captured: string[] = [];
      const spies = [process.stdout, process.stderr].map((stream) =>
        jest.spyOn(stream, 'write').mockImplementation((chunk: unknown) => {
          captured.push(typeof chunk === 'string' ? chunk : String(chunk));
          return true;
        }),
      );

      try {
        const { draftToken } = await blockedDraft();

        // Acknowledge nothing, so the confirmation is refused and the draft is
        // re-armed — the path that touches the token most.
        await confirmRegistration(harness, token, draftToken, [
          '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
        ]);
        await resolveDraft(harness, token, draftToken);
        await resolveDraft(harness, token, 'c'.repeat(43));

        const log = captured.join('\n');

        expect(log).not.toContain(draftToken);
        expect(log).not.toContain('احمدی');
        expect(log).not.toContain(MOBILE);
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
    });

    it('keeps the token out of the audit trail after a successful override', async () => {
      const { draftToken, candidateIds } = await blockedDraft();

      await confirmRegistration(harness, token, draftToken, candidateIds);

      const rows = await harness.prisma.auditLog.findMany();
      const dump = JSON.stringify(rows.map((row) => [row.before, row.after, row.metadata]));

      expect(dump).not.toContain(draftToken);
      expect(dump).not.toContain(MOBILE);
    });
  });

  describe('a draft whose stored payload no longer satisfies the contract', () => {
    it('is unusable, and says so the same way as every other failure', async () => {
      const { draftToken, candidateIds } = await blockedDraft();

      // Simulates a contract that tightened after the row was written: the
      // stored payload now has no primary contact.
      await harness.prisma.$executeRaw`
        UPDATE registration_draft
        SET payload = jsonb_set(payload, '{guardians,0,isPrimaryContact}', 'false'::jsonb)
      `;

      expect((await resolveDraft(harness, token, draftToken)).body.error.code).toBe(
        'DRAFT_NOT_FOUND',
      );

      const confirm = await confirmRegistration(harness, token, draftToken, candidateIds);
      expect(confirm.status).toBe(404);
      expect(confirm.body.error.code).toBe('DRAFT_NOT_FOUND');
      expect(await harness.prisma.family.count()).toBe(1);
    });
  });
});

/** Signs the same account in again, producing a second independent session. */
async function signInAgain(harness: Harness, existingToken: string): Promise<string> {
  const session = await request(harness.app.getHttpServer())
    .get('/auth/session')
    .set(asUser(existingToken));

  const response = await request(harness.app.getHttpServer())
    .post('/auth/login')
    .set(internalHeaders())
    .send({ username: session.body.user.username, password: TEST_PASSWORD });

  return response.body.sessionToken as string;
}
