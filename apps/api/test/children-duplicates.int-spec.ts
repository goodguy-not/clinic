import { childWriteResponseSchema, registrationDraftResponseSchema } from '@clinic/contracts';
import { createHarness, resetDatabase, type Harness } from './harness';
import {
  blockOnChild,
  childPayload,
  confirmChildRegistration,
  confirmChildUpdate,
  createChild,
  familyPayload,
  guardian,
  resolveDraft,
  seedChildViaApi,
  seedFamily,
  setChildStatus,
  signIn,
  updateChild,
} from './families-support';

/**
 * Duplicate detection for children.
 *
 * The rule is narrow on purpose: same family, same normalised name, same birth
 * date. Inside one family that is a re-entry — a family does not have two
 * children of the same name born on the same day. Across families it is a
 * coincidence, and a common one, so it warns and never refuses.
 */
describe('child duplicates (real PostgreSQL)', () => {
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
    await resetDatabase();
    token = (await signIn(harness, 'RECEPTIONIST')).token;
    familyId = await seedFamily(harness, token, familyPayload());
  });

  async function secondFamily(): Promise<string> {
    return seedFamily(
      harness,
      token,
      familyPayload({ familyName: 'احمدی' }, [guardian({ mobile: '09129876543' })]),
    );
  }

  describe('inside one family', () => {
    it('blocks the same name and birth date', async () => {
      await seedChildViaApi(harness, token, familyId, childPayload());

      const response = await createChild(harness, token, familyId, childPayload());

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CHILD_POSSIBLE_DUPLICATE');

      const candidate = response.body.error.details.candidates[0];
      expect(candidate.rule).toBe('CHILD_DUPLICATE_IN_FAMILY');
      expect(candidate.blocking).toBe(true);
      expect(candidate.childId).not.toBeNull();
    });

    it('folds Persian spelling variants into the same identity', async () => {
      await seedChildViaApi(harness, token, familyId, childPayload({ firstName: 'علي' }));

      const response = await createChild(
        harness,
        token,
        familyId,
        childPayload({ firstName: 'علی' }),
      );

      expect(response.status).toBe(409);
    });

    it('allows the same name on a different birth date', async () => {
      await seedChildViaApi(harness, token, familyId, childPayload());

      const response = await createChild(
        harness,
        token,
        familyId,
        childPayload({ birthDate: '2021-06-01' }),
      );

      expect(response.status).toBe(201);
      expect(childWriteResponseSchema.parse(response.body).nonBlockingWarnings).toEqual([]);
    });

    it('allows a different name on the same birth date', async () => {
      // Twins.
      await seedChildViaApi(harness, token, familyId, childPayload({ firstName: 'علی' }));

      const response = await createChild(
        harness,
        token,
        familyId,
        childPayload({ firstName: 'زهرا' }),
      );

      expect(response.status).toBe(201);
    });

    it('ignores a deactivated sibling', async () => {
      const childId = await seedChildViaApi(harness, token, familyId, childPayload());
      await setChildStatus(harness, token, childId, 'INACTIVE');

      const response = await createChild(harness, token, familyId, childPayload());

      expect(response.status).toBe(201);
    });
  });

  describe('across families', () => {
    it('warns but never blocks', async () => {
      const other = await secondFamily();
      await seedChildViaApi(harness, token, other, childPayload());

      const response = await createChild(harness, token, familyId, childPayload());

      expect(response.status).toBe(201);
      expect(childWriteResponseSchema.parse(response.body).nonBlockingWarnings).toEqual([
        'SIMILAR_CHILD_EXISTS',
      ]);
      // A warning creates nothing to confirm.
      expect(await harness.prisma.registrationDraft.count()).toBe(0);
    });
  });

  describe('editing into a duplicate', () => {
    it('blocks when a rename collides with a sibling', async () => {
      await seedChildViaApi(harness, token, familyId, childPayload({ firstName: 'علی' }));
      const second = await seedChildViaApi(
        harness,
        token,
        familyId,
        childPayload({ firstName: 'زهرا' }),
      );

      const response = await updateChild(
        harness,
        token,
        second,
        childPayload({ firstName: 'علی' }),
      );

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CHILD_POSSIBLE_DUPLICATE');
    });

    it('is not its own duplicate when nothing identifying changed', async () => {
      const childId = await seedChildViaApi(harness, token, familyId, childPayload());

      const response = await updateChild(
        harness,
        token,
        childId,
        childPayload({ note: 'یادداشت' }),
      );

      expect(response.status).toBe(200);
    });

    it('is not its own duplicate when re-saved unchanged', async () => {
      const childId = await seedChildViaApi(harness, token, familyId, childPayload());

      const response = await updateChild(harness, token, childId, childPayload());

      expect(response.status).toBe(200);
    });
  });

  describe('confirming a child registration', () => {
    it('completes through the draft and records the override', async () => {
      const existing = await seedChildViaApi(harness, token, familyId, childPayload());
      const { draftToken, candidateIds } = await blockOnChild(
        harness,
        token,
        familyId,
        childPayload(),
      );

      expect(candidateIds).toEqual([existing]);

      const draft = registrationDraftResponseSchema.parse(
        (await resolveDraft(harness, token, draftToken)).body,
      );
      expect(draft.purpose).toBe('CHILD_CREATE');
      expect(draft.targetFamilyId).toBe(familyId);
      expect(draft.targetChildId).toBeNull();
      expect(draft.child?.firstName).toBe('علی');
      expect(draft.family).toBeNull();

      const confirmed = await confirmChildRegistration(harness, token, draftToken, candidateIds);
      expect(confirmed.status).toBe(201);

      expect(await harness.prisma.child.count()).toBe(2);
      expect(await harness.prisma.registrationDraft.count()).toBe(0);
      expect(await harness.prisma.auditLog.count({ where: { action: 'child.created' } })).toBe(2);
      expect(
        await harness.prisma.auditLog.count({ where: { action: 'child.duplicate_override' } }),
      ).toBe(1);
    });

    it('records only ids and rule names in the override', async () => {
      await seedChildViaApi(harness, token, familyId, childPayload({ nationalId: '1234567891' }));
      const { draftToken, candidateIds } = await blockOnChild(
        harness,
        token,
        familyId,
        childPayload(),
      );

      await confirmChildRegistration(harness, token, draftToken, candidateIds);

      const row = await harness.prisma.auditLog.findFirstOrThrow({
        where: { action: 'child.duplicate_override' },
      });

      expect(row.metadata).toEqual({
        acknowledgedIds: candidateIds,
        rules: ['CHILD_DUPLICATE_IN_FAMILY'],
      });
      expect(JSON.stringify(row.metadata)).not.toContain('1234567891');
    });

    it('refuses an acknowledgement that misses a current candidate', async () => {
      await seedChildViaApi(harness, token, familyId, childPayload());
      const { draftToken } = await blockOnChild(harness, token, familyId, childPayload());

      // An id that is not the blocking candidate grants nothing.
      const response = await confirmChildRegistration(harness, token, draftToken, [
        '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      ]);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CHILD_POSSIBLE_DUPLICATE');
      // The draft survived, with the same token.
      expect(response.body.error.details.draftToken).toBe(draftToken);
      expect(await harness.prisma.registrationDraft.count()).toBe(1);
      expect(await harness.prisma.child.count()).toBe(1);
    });

    it('detects a sibling registered while somebody was deciding', async () => {
      const first = await seedChildViaApi(harness, token, familyId, childPayload());
      const { draftToken, candidateIds } = await blockOnChild(
        harness,
        token,
        familyId,
        childPayload(),
      );

      // The first candidate is deactivated and a fresh one takes its place, so
      // acknowledging the original set is no longer sufficient.
      await setChildStatus(harness, token, first, 'INACTIVE');
      const replacement = await seedChildViaApi(harness, token, familyId, childPayload());

      const stale = await confirmChildRegistration(harness, token, draftToken, candidateIds);
      expect(stale.status).toBe(409);
      expect(stale.body.error.details.candidates[0].childId).toBe(replacement);

      const fresh = await confirmChildRegistration(harness, token, draftToken, [replacement]);
      expect(fresh.status).toBe(201);
    });

    it('refuses a replayed token', async () => {
      await seedChildViaApi(harness, token, familyId, childPayload());
      const { draftToken, candidateIds } = await blockOnChild(
        harness,
        token,
        familyId,
        childPayload(),
      );

      expect(
        (await confirmChildRegistration(harness, token, draftToken, candidateIds)).status,
      ).toBe(201);

      const replay = await confirmChildRegistration(harness, token, draftToken, candidateIds);
      expect(replay.status).toBe(404);
      expect(replay.body.error.code).toBe('DRAFT_NOT_FOUND');
    });
  });

  describe('confirming a child edit', () => {
    it('completes through the draft', async () => {
      const first = await seedChildViaApi(
        harness,
        token,
        familyId,
        childPayload({ firstName: 'علی' }),
      );
      const second = await seedChildViaApi(
        harness,
        token,
        familyId,
        childPayload({ firstName: 'زهرا' }),
      );

      const blocked = await updateChild(harness, token, second, childPayload({ firstName: 'علی' }));
      expect(blocked.status).toBe(409);

      const draftToken = blocked.body.error.details.draftToken as string;

      const draft = registrationDraftResponseSchema.parse(
        (await resolveDraft(harness, token, draftToken)).body,
      );
      expect(draft.purpose).toBe('CHILD_UPDATE');
      expect(draft.targetFamilyId).toBe(familyId);
      expect(draft.targetChildId).toBe(second);

      const confirmed = await confirmChildUpdate(harness, token, draftToken, [first]);
      expect(confirmed.status).toBe(200);

      const body = childWriteResponseSchema.parse(confirmed.body);
      expect(body.child.id).toBe(second);
      expect(body.child.firstName).toBe('علی');

      expect(await harness.prisma.child.count()).toBe(2);
      expect(await harness.prisma.registrationDraft.count()).toBe(0);
      expect(
        await harness.prisma.auditLog.count({ where: { action: 'child.duplicate_override' } }),
      ).toBe(1);
    });

    it('will not spend a CHILD_UPDATE token on a registration', async () => {
      const first = await seedChildViaApi(
        harness,
        token,
        familyId,
        childPayload({ firstName: 'علی' }),
      );
      const second = await seedChildViaApi(
        harness,
        token,
        familyId,
        childPayload({ firstName: 'زهرا' }),
      );

      const blocked = await updateChild(harness, token, second, childPayload({ firstName: 'علی' }));
      const draftToken = blocked.body.error.details.draftToken as string;

      const wrong = await confirmChildRegistration(harness, token, draftToken, [first]);

      expect(wrong.status).toBe(404);
      expect(wrong.body.error.code).toBe('DRAFT_NOT_FOUND');
    });
  });

  describe('four independent draft purposes', () => {
    it('lets one session hold a live draft of every kind at once', async () => {
      // The uniqueness key is (user, session, purpose), so four purposes means
      // up to four live drafts, each independently addressable.
      const other = await secondFamily();

      // FAMILY_CREATE
      const { createFamily } = await import('./families-support');
      const familyCreate = await createFamily(
        harness,
        token,
        familyPayload({ familyName: 'تازه' }, [guardian({ mobile: '09121234567' })]),
      );
      expect(familyCreate.status).toBe(409);

      // FAMILY_UPDATE
      const { updateFamily } = await import('./families-support');
      const familyUpdate = await updateFamily(
        harness,
        token,
        other,
        familyPayload({ familyName: 'احمدی' }, [guardian({ mobile: '09121234567' })]),
      );
      expect(familyUpdate.status).toBe(409);

      // CHILD_CREATE
      await seedChildViaApi(harness, token, familyId, childPayload());
      const childCreate = await createChild(harness, token, familyId, childPayload());
      expect(childCreate.status).toBe(409);

      // CHILD_UPDATE
      const sibling = await seedChildViaApi(
        harness,
        token,
        familyId,
        childPayload({ firstName: 'زهرا' }),
      );
      const childUpdate = await updateChild(harness, token, sibling, childPayload());
      expect(childUpdate.status).toBe(409);

      const drafts = await harness.prisma.registrationDraft.findMany();
      expect(drafts).toHaveLength(4);
      expect(new Set(drafts.map((draft) => draft.purpose))).toEqual(
        new Set(['FAMILY_CREATE', 'FAMILY_UPDATE', 'CHILD_CREATE', 'CHILD_UPDATE']),
      );
      // One user, one session, four purposes.
      expect(new Set(drafts.map((draft) => draft.createdByUserId)).size).toBe(1);
      expect(new Set(drafts.map((draft) => draft.sessionId)).size).toBe(1);
    }, 30000);
  });
});
