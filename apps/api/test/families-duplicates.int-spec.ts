import { createHash } from 'node:crypto';
import { duplicateBlockedDetailsSchema, familyWriteResponseSchema } from '@clinic/contracts';
import { createHarness, resetDatabase, type Harness } from './harness';
import {
  blockOn,
  confirmRegistration,
  createFamily,
  deactivateFamily,
  familyPayload,
  guardian,
  insertFamilyDirect,
  seedFamily,
  signIn,
} from './families-support';

/**
 * Duplicate detection at registration.
 *
 * The distinction this suite exists to prove is the one the whole feature turns
 * on: a shared mobile number blocks until somebody looks, and a shared NAME
 * never blocks at all. Refusing two real families who happen to share a surname
 * would be worse than the duplicate it prevented — in Iran, «رضایی» is not a
 * coincidence worth refusing a patient over.
 */
describe('family duplicates (real PostgreSQL)', () => {
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
  const OTHER_MOBILE = '09129876543';
  const LANDLINE = '02112345678';

  describe('a shared mobile blocks', () => {
    it('refuses a second family answering on the same number', async () => {
      await seedFamily(harness, token, familyPayload({ familyName: 'رضایی' }));

      const response = await createFamily(
        harness,
        token,
        familyPayload({ familyName: 'احمدی' }, [guardian({ mobile: MOBILE })]),
      );

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('FAMILY_POSSIBLE_DUPLICATE');
    });

    it('fires when the shared number is on a NON-primary guardian of the new family', async () => {
      await seedFamily(harness, token, familyPayload({ familyName: 'رضایی' }));

      const response = await createFamily(
        harness,
        token,
        familyPayload({ familyName: 'احمدی' }, [
          guardian({ fullName: 'مادر', mobile: OTHER_MOBILE, isPrimaryContact: true }),
          guardian({ fullName: 'پدر', mobile: MOBILE, isPrimaryContact: false }),
        ]),
      );

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('FAMILY_POSSIBLE_DUPLICATE');
    });

    it('fires when the shared number is on a non-primary guardian of the EXISTING family', async () => {
      await seedFamily(
        harness,
        token,
        familyPayload({ familyName: 'رضایی' }, [
          guardian({ fullName: 'مادر', mobile: OTHER_MOBILE, isPrimaryContact: true }),
          guardian({ fullName: 'پدر', mobile: MOBILE, isPrimaryContact: false }),
        ]),
      );

      const response = await createFamily(
        harness,
        token,
        familyPayload({ familyName: 'احمدی' }, [guardian({ mobile: MOBILE })]),
      );

      expect(response.status).toBe(409);
    });

    it('ignores an inactive family', async () => {
      // Only active families block. A family taken out of the daily list is not
      // the one somebody is about to re-register by accident.
      const id = await seedFamily(harness, token, familyPayload({ familyName: 'رضایی' }));
      await deactivateFamily(harness, id);

      const response = await createFamily(
        harness,
        token,
        familyPayload({ familyName: 'احمدی' }, [guardian({ mobile: MOBILE })]),
      );

      expect(response.status).toBe(201);
    });

    it('does not fire for a family with no mobile at all', async () => {
      // A family reachable only on a landline triggers no blocking rule, which
      // is correct: there is no number to have seen before.
      await seedFamily(
        harness,
        token,
        familyPayload({ familyName: 'رضایی' }, [guardian({ mobile: null, landline: LANDLINE })]),
      );

      const response = await createFamily(
        harness,
        token,
        familyPayload({ familyName: 'احمدی' }, [
          guardian({ mobile: null, landline: '0341234567' }),
        ]),
      );

      expect(response.status).toBe(201);
    });
  });

  describe('a name never blocks', () => {
    it('registers two families with the identical surname', async () => {
      await seedFamily(harness, token, familyPayload({ familyName: 'رضایی' }));

      const response = await createFamily(
        harness,
        token,
        familyPayload({ familyName: 'رضایی' }, [guardian({ mobile: OTHER_MOBILE })]),
      );

      expect(response.status).toBe(201);
    });

    it('registers two families with the same surname AND the same guardian name', async () => {
      // The strongest name-only signal there is, and it still only warns.
      await seedFamily(
        harness,
        token,
        familyPayload({ familyName: 'رضایی' }, [guardian({ fullName: 'علی رضایی' })]),
      );

      const response = await createFamily(
        harness,
        token,
        familyPayload({ familyName: 'رضایی' }, [
          guardian({ fullName: 'علی رضایی', mobile: OTHER_MOBILE }),
        ]),
      );

      expect(response.status).toBe(201);

      const body = familyWriteResponseSchema.parse(response.body);
      expect(body.nonBlockingWarnings).toEqual(['SIMILAR_FAMILY_EXISTS']);
    });

    it('warns across Persian spelling variants too', async () => {
      await seedFamily(
        harness,
        token,
        familyPayload({ familyName: 'كريمي' }, [guardian({ fullName: 'علي' })]),
      );

      const response = await createFamily(
        harness,
        token,
        familyPayload({ familyName: 'کریمی' }, [
          guardian({ fullName: 'علی', mobile: OTHER_MOBILE }),
        ]),
      );

      expect(response.status).toBe(201);
      expect(familyWriteResponseSchema.parse(response.body).nonBlockingWarnings).toEqual([
        'SIMILAR_FAMILY_EXISTS',
      ]);
    });

    it('stays silent when only the surname matches', async () => {
      await seedFamily(
        harness,
        token,
        familyPayload({ familyName: 'رضایی' }, [guardian({ fullName: 'مادر' })]),
      );

      const response = await createFamily(
        harness,
        token,
        familyPayload({ familyName: 'رضایی' }, [
          guardian({ fullName: 'کس دیگر', mobile: OTHER_MOBILE }),
        ]),
      );

      expect(response.status).toBe(201);
      // A surname alone is far too common to be worth showing.
      expect(familyWriteResponseSchema.parse(response.body).nonBlockingWarnings).toEqual([]);
    });
  });

  describe('a shared landline warns', () => {
    it('creates the family and reports the similarity', async () => {
      await seedFamily(
        harness,
        token,
        familyPayload({ familyName: 'رضایی' }, [guardian({ mobile: MOBILE, landline: LANDLINE })]),
      );

      const response = await createFamily(
        harness,
        token,
        familyPayload({ familyName: 'احمدی' }, [
          guardian({ mobile: OTHER_MOBILE, landline: LANDLINE }),
        ]),
      );

      // A household, a workplace, a relative's number: ordinary, not a duplicate.
      expect(response.status).toBe(201);
      expect(familyWriteResponseSchema.parse(response.body).nonBlockingWarnings).toEqual([
        'SIMILAR_FAMILY_EXISTS',
      ]);
    });

    it('creates no draft for a warning', async () => {
      await seedFamily(
        harness,
        token,
        familyPayload({ familyName: 'رضایی' }, [guardian({ mobile: MOBILE, landline: LANDLINE })]),
      );

      await createFamily(
        harness,
        token,
        familyPayload({ familyName: 'احمدی' }, [
          guardian({ mobile: OTHER_MOBILE, landline: LANDLINE }),
        ]),
      );

      // Nothing to confirm, so nothing to hold.
      expect(await harness.prisma.registrationDraft.count()).toBe(0);
    });
  });

  describe('the blocked response', () => {
    it('carries masked candidates and never a full identifier', async () => {
      await seedFamily(
        harness,
        token,
        familyPayload({ familyName: 'رضایی' }, [
          guardian({ fullName: 'مادر رضایی', mobile: MOBILE, landline: LANDLINE }),
        ]),
      );

      const response = await createFamily(
        harness,
        token,
        familyPayload({ familyName: 'احمدی' }, [guardian({ mobile: MOBILE })]),
      );

      expect(response.status).toBe(409);

      const details = duplicateBlockedDetailsSchema.parse(response.body.error.details);
      const candidate = details.candidates[0];

      expect(candidate?.rule).toBe('FAMILY_DUPLICATE_MOBILE');
      expect(candidate?.blocking).toBe(true);
      // Enough to recognise the family…
      expect(candidate?.familyName).toBe('رضایی');
      expect(candidate?.primaryGuardianName).toBe('مادر رضایی');
      expect(candidate?.maskedMobile).toBe('*******4567');
      expect(candidate?.maskedLandline).toBe('*******5678');

      // …and never a copy of the number itself, anywhere in the body.
      const raw = JSON.stringify(response.body);
      expect(raw).not.toContain(MOBILE);
      expect(raw).not.toContain(LANDLINE);
    });

    it('carries a draft token and an expiry ten minutes out', async () => {
      await seedFamily(harness, token, familyPayload({ familyName: 'رضایی' }));

      const before = Date.now();
      const response = await createFamily(
        harness,
        token,
        familyPayload({ familyName: 'احمدی' }, [guardian({ mobile: MOBILE })]),
      );

      const details = duplicateBlockedDetailsSchema.parse(response.body.error.details);

      expect(details.draftToken.length).toBeGreaterThanOrEqual(43);
      const expiry = Date.parse(details.draftExpiresAt);
      expect(expiry).toBeGreaterThan(before + 9 * 60 * 1000);
      expect(expiry).toBeLessThan(before + 11 * 60 * 1000);
    });

    it('stores only the hash of the token, never the token', async () => {
      await seedFamily(harness, token, familyPayload({ familyName: 'رضایی' }));

      const response = await createFamily(
        harness,
        token,
        familyPayload({ familyName: 'احمدی' }, [guardian({ mobile: MOBILE })]),
      );

      const details = duplicateBlockedDetailsSchema.parse(response.body.error.details);
      const drafts = await harness.prisma.registrationDraft.findMany();

      expect(drafts).toHaveLength(1);

      const stored = Buffer.from(drafts[0]?.tokenHash ?? new Uint8Array());
      expect(stored).toHaveLength(32);

      // The stored bytes are the SHA-256 of the token that was returned, and
      // the token itself appears nowhere in the row. A leaked backup or query
      // log therefore yields nothing replayable.
      expect(stored.equals(createHash('sha256').update(details.draftToken).digest())).toBe(true);
      expect(stored.toString('utf8')).not.toContain(details.draftToken);

      expect(drafts[0]?.purpose).toBe('FAMILY_CREATE');
      expect(drafts[0]?.targetFamilyId).toBeNull();
      expect(drafts[0]?.targetChildId).toBeNull();
    });

    it('stores the submitted payload and the candidate ids for the confirmation screen', async () => {
      const existingId = await seedFamily(harness, token, familyPayload({ familyName: 'رضایی' }));

      await createFamily(
        harness,
        token,
        familyPayload({ familyName: 'احمدی' }, [guardian({ mobile: MOBILE })]),
      );

      const draft = await harness.prisma.registrationDraft.findFirstOrThrow();

      expect(draft.shownCandidateIds).toEqual([existingId]);
      expect((draft.payload as { familyName: string }).familyName).toBe('احمدی');
    });

    it('writes no family, no guardian and no audit row', async () => {
      await seedFamily(harness, token, familyPayload({ familyName: 'رضایی' }));

      const beforeAudit = await harness.prisma.auditLog.count();

      await createFamily(
        harness,
        token,
        familyPayload({ familyName: 'احمدی' }, [guardian({ mobile: MOBILE })]),
      );

      // Exactly the one family that was seeded, and its one guardian.
      expect(await harness.prisma.family.count()).toBe(1);
      expect(await harness.prisma.guardian.count()).toBe(1);
      expect(await harness.prisma.auditLog.count()).toBe(beforeAudit);
      expect(
        await harness.prisma.auditLog.count({ where: { action: 'family.duplicate_override' } }),
      ).toBe(0);
    });

    it('never audits the draft', async () => {
      await seedFamily(harness, token, familyPayload({ familyName: 'رضایی' }));

      await createFamily(
        harness,
        token,
        familyPayload({ familyName: 'احمدی' }, [guardian({ mobile: MOBILE })]),
      );

      const rows = await harness.prisma.auditLog.findMany();

      // A draft is a submission that was never made. Auditing one would create
      // a permanent record of something that did not happen.
      for (const row of rows) {
        expect(row.entityType).not.toBe('registration_draft');
        expect(row.action).not.toMatch(/draft/i);
      }
    });
  });
});

/**
 * Completing a registration that was refused.
 *
 * The interesting cases here are all about time passing. Somebody was shown a
 * list of possible duplicates, went away to think, and came back — and the
 * clinic may have changed underneath them. The acknowledgement they send is a
 * statement about what they were shown; it must never be treated as permission
 * to skip what is true now.
 */
describe('family create confirmation (real PostgreSQL)', () => {
  let harness: Harness;
  let actorId: string;
  let token: string;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
    const session = await signIn(harness, 'RECEPTIONIST');
    actorId = session.id;
    token = session.token;
  });

  const MOBILE = '09121234567';

  async function blockedDraft(): Promise<{ draftToken: string; candidateIds: string[] }> {
    await seedFamily(harness, token, familyPayload({ familyName: 'رضایی' }));

    return blockOn(
      harness,
      token,
      familyPayload({ familyName: 'احمدی' }, [guardian({ mobile: MOBILE })]),
    );
  }

  describe('acknowledgement semantics', () => {
    it('succeeds when every current blocking candidate is acknowledged', async () => {
      const { draftToken, candidateIds } = await blockedDraft();

      const response = await confirmRegistration(harness, token, draftToken, candidateIds);

      expect(response.status).toBe(201);
      expect(familyWriteResponseSchema.parse(response.body).family.familyName).toBe('احمدی');
    });

    it('blocks again when the real candidate is not acknowledged', async () => {
      const { draftToken } = await blockedDraft();

      const response = await confirmRegistration(harness, token, draftToken, [
        '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      ]);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('FAMILY_POSSIBLE_DUPLICATE');
      expect(await harness.prisma.family.count()).toBe(1);
    });

    it('is not satisfied by extra irrelevant ids alone', async () => {
      const { draftToken } = await blockedDraft();

      // A padded list must not grant permission it does not contain.
      const response = await confirmRegistration(harness, token, draftToken, [
        '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
        '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
      ]);

      expect(response.status).toBe(409);
    });

    it('tolerates extra ids alongside the real ones', async () => {
      const { draftToken, candidateIds } = await blockedDraft();

      const response = await confirmRegistration(harness, token, draftToken, [
        ...candidateIds,
        '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      ]);

      // Every current candidate is present, so the extra one is simply noise.
      expect(response.status).toBe(201);
    });

    it('blocks when only some of several candidates are acknowledged', async () => {
      await seedFamily(harness, token, familyPayload({ familyName: 'رضایی' }));
      const second = await insertFamilyDirect(harness, actorId, 'کریمی', '09129876543');

      const { draftToken, candidateIds } = await blockOn(
        harness,
        token,
        familyPayload({ familyName: 'احمدی' }, [
          guardian({ fullName: 'یک', mobile: MOBILE, isPrimaryContact: true }),
          guardian({ fullName: 'دو', mobile: '09129876543', isPrimaryContact: false }),
        ]),
      );

      expect(candidateIds).toHaveLength(2);

      const partial = await confirmRegistration(harness, token, draftToken, [second]);
      expect(partial.status).toBe(409);

      const full = await confirmRegistration(harness, token, draftToken, candidateIds);
      expect(full.status).toBe(201);
    });
  });

  describe('a duplicate that appeared while somebody was deciding', () => {
    it('is recomputed, not taken from the draft, and is not silently bypassed', async () => {
      // The case the whole design exists for. The stored candidate list names
      // one family; by confirmation time there are two.
      const { draftToken, candidateIds } = await blockedDraft();

      const appeared = await insertFamilyDirect(harness, actorId, 'تازه‌وارد', MOBILE);

      const refused = await confirmRegistration(harness, token, draftToken, candidateIds);

      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('FAMILY_POSSIBLE_DUPLICATE');

      const details = duplicateBlockedDetailsSchema.parse(refused.body.error.details);
      const freshIds = details.candidates.filter((c) => c.blocking).map((c) => c.familyId);

      expect(freshIds).toContain(appeared);
      expect(freshIds).toHaveLength(2);

      // Nothing was written.
      expect(await harness.prisma.family.count()).toBe(2);
      expect(await harness.prisma.auditLog.count({ where: { action: 'family.created' } })).toBe(1);
      expect(
        await harness.prisma.auditLog.count({ where: { action: 'family.duplicate_override' } }),
      ).toBe(0);
    });

    it('keeps the draft, the same token, and refreshes its candidates and expiry', async () => {
      const { draftToken, candidateIds } = await blockedDraft();
      const before = await harness.prisma.registrationDraft.findFirstOrThrow();

      const appeared = await insertFamilyDirect(harness, actorId, 'تازه‌وارد', MOBILE);
      const refused = await confirmRegistration(harness, token, draftToken, candidateIds);

      const details = duplicateBlockedDetailsSchema.parse(refused.body.error.details);

      // The same bearer token, not a replacement: the caller already holds this
      // one in a cookie, and two live tokens for one draft is one too many.
      expect(details.draftToken).toBe(draftToken);

      const after = await harness.prisma.registrationDraft.findFirstOrThrow();

      expect(after.id).toBe(before.id);
      expect(Buffer.from(after.tokenHash).equals(Buffer.from(before.tokenHash))).toBe(true);
      expect([...after.shownCandidateIds].sort()).toEqual([...candidateIds, appeared].sort());
      expect(after.expiresAt.getTime()).toBeGreaterThan(before.expiresAt.getTime());
      // The typed values survived the refusal.
      expect((after.payload as { familyName: string }).familyName).toBe('احمدی');
    });

    it('succeeds once the fresh candidate is acknowledged too', async () => {
      const { draftToken, candidateIds } = await blockedDraft();
      const appeared = await insertFamilyDirect(harness, actorId, 'تازه‌وارد', MOBILE);

      await confirmRegistration(harness, token, draftToken, candidateIds);

      const response = await confirmRegistration(harness, token, draftToken, [
        ...candidateIds,
        appeared,
      ]);

      expect(response.status).toBe(201);
      expect(await harness.prisma.family.count()).toBe(3);
      expect(await harness.prisma.registrationDraft.count()).toBe(0);
    });

    it('does not let a stale id stand in for the new one', async () => {
      const { draftToken, candidateIds } = await blockedDraft();
      const appeared = await insertFamilyDirect(harness, actorId, 'تازه‌وارد', MOBILE);

      // Deactivating the original makes its id stale: still in the
      // acknowledgement, no longer a blocking candidate.
      await deactivateFamily(harness, candidateIds[0] ?? '');

      const response = await confirmRegistration(harness, token, draftToken, candidateIds);

      expect(response.status).toBe(409);

      const details = duplicateBlockedDetailsSchema.parse(response.body.error.details);
      const freshIds = details.candidates.filter((c) => c.blocking).map((c) => c.familyId);

      expect(freshIds).toEqual([appeared]);
    });

    it('writes no override row when every candidate has gone away', async () => {
      const { draftToken, candidateIds } = await blockedDraft();

      await deactivateFamily(harness, candidateIds[0] ?? '');

      const response = await confirmRegistration(harness, token, draftToken, candidateIds);
      expect(response.status).toBe(201);

      // Nothing was overridden, so claiming an override would put a decision in
      // the permanent record that nobody made.
      expect(
        await harness.prisma.auditLog.count({ where: { action: 'family.duplicate_override' } }),
      ).toBe(0);
      expect(await harness.prisma.auditLog.count({ where: { action: 'family.created' } })).toBe(2);
    });
  });

  describe('the override audit row', () => {
    it('records candidate ids and rule names, and nothing else', async () => {
      const { draftToken, candidateIds } = await blockedDraft();

      await confirmRegistration(harness, token, draftToken, candidateIds);

      const rows = await harness.prisma.auditLog.findMany({
        where: { action: 'family.duplicate_override' },
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]?.metadata).toEqual({
        acknowledgedIds: candidateIds,
        rules: ['FAMILY_DUPLICATE_MOBILE'],
      });

      // No number, no address, no token — an id resolves to the family for
      // anyone who needs it and to nothing for anyone who does not.
      const dump = JSON.stringify(rows[0]);
      expect(dump).not.toContain(MOBILE);
      expect(dump).not.toContain(draftToken);
      expect(rows[0]?.before).toBeNull();
      expect(rows[0]?.after).toBeNull();
    });

    it('names the same family as the creation it accompanies', async () => {
      const { draftToken, candidateIds } = await blockedDraft();

      const response = await confirmRegistration(harness, token, draftToken, candidateIds);
      const created = familyWriteResponseSchema.parse(response.body).family.id;

      const override = await harness.prisma.auditLog.findFirstOrThrow({
        where: { action: 'family.duplicate_override' },
      });

      expect(override.entityId).toBe(created);
      expect(override.entityType).toBe('family');
      expect(await harness.prisma.auditLog.count({ where: { action: 'family.created' } })).toBe(2);
    });
  });

  describe('one-time consumption under concurrency', () => {
    it('lets exactly one of two simultaneous confirmations through', async () => {
      // The draft row lock is what makes this deterministic: both reach
      // SELECT ... FOR UPDATE, the second waits, and when it proceeds the row is
      // gone. The wider confirm-versus-discard matrix belongs to the next
      // checkpoint's concurrency suite; this is the one-time property itself.
      const { draftToken, candidateIds } = await blockedDraft();

      const [first, second] = await Promise.all([
        confirmRegistration(harness, token, draftToken, candidateIds),
        confirmRegistration(harness, token, draftToken, candidateIds),
      ]);

      expect([first.status, second.status].sort()).toEqual([201, 404]);

      const loser = first.status === 404 ? first : second;
      expect(loser.body.error.code).toBe('DRAFT_NOT_FOUND');

      expect(await harness.prisma.family.count()).toBe(2);
      expect(await harness.prisma.registrationDraft.count()).toBe(0);
      expect(await harness.prisma.auditLog.count({ where: { action: 'family.created' } })).toBe(2);
      expect(
        await harness.prisma.auditLog.count({ where: { action: 'family.duplicate_override' } }),
      ).toBe(1);
    }, 30000);
  });
});
