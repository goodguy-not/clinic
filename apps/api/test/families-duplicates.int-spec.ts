import { createHash } from 'node:crypto';
import { duplicateBlockedDetailsSchema, familyWriteResponseSchema } from '@clinic/contracts';
import { createHarness, resetDatabase, type Harness } from './harness';
import {
  createFamily,
  deactivateFamily,
  familyPayload,
  guardian,
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
