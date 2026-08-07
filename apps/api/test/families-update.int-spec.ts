import {
  familyDetailResponseSchema,
  familyWriteResponseSchema,
  registrationDraftResponseSchema,
} from '@clinic/contracts';
import { createHarness, resetDatabase, type Harness } from './harness';
import {
  childPayload,
  confirmFamilyUpdate,
  familyPayload,
  getFamily,
  guardian,
  resolveDraft,
  seedChildViaApi,
  seedFamily,
  setFamilyStatus,
  signIn,
  updateFamily,
} from './families-support';

/**
 * Editing a family, and taking it out of the daily list.
 *
 * The guardian set is replaced wholesale rather than diffed: guardians carry no
 * history of their own, the change is recorded in `audit_log` as an ordered list
 * of values, and nothing references a guardian id.
 */
describe('family update and status (real PostgreSQL)', () => {
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
  const OTHER = '09129876543';

  describe('editing', () => {
    it('applies a correction and replaces the guardian set', async () => {
      const id = await seedFamily(harness, token, familyPayload());

      const response = await updateFamily(
        harness,
        token,
        id,
        familyPayload({ familyName: 'رضایی‌نژاد', address: 'نشانی تازه' }, [
          guardian({ fullName: 'مادر', mobile: MOBILE }),
          guardian({ fullName: 'پدر', mobile: OTHER, isPrimaryContact: false }),
        ]),
      );

      expect(response.status).toBe(200);

      const body = familyWriteResponseSchema.parse(response.body);
      expect(body.family.familyName).toBe('رضایی‌نژاد');
      expect(body.family.address).toBe('نشانی تازه');
      expect(body.guardians).toHaveLength(2);
      expect(body.guardians[0]?.fullName).toBe('مادر');
      expect(body.nonBlockingWarnings).toEqual([]);
    });

    it('keeps the derived search key in step with the stored name', async () => {
      const id = await seedFamily(harness, token, familyPayload());

      await updateFamily(harness, token, id, familyPayload({ familyName: 'كريمي' }));

      const rows = await harness.prisma.$queryRaw<
        { family_name: string; search_family_name: string }[]
      >`SELECT family_name, search_family_name FROM family WHERE id = ${id}::uuid`;

      expect(rows[0]?.family_name).toBe('كريمي');
      expect(rows[0]?.search_family_name).toBe('کریمی');
    });

    it('returns the family children alongside the edit', async () => {
      const id = await seedFamily(harness, token, familyPayload());
      await seedChildViaApi(harness, token, id, childPayload());

      const body = familyWriteResponseSchema.parse(
        (await updateFamily(harness, token, id, familyPayload({ familyName: 'تازه' }))).body,
      );

      expect(body.children).toHaveLength(1);
    });

    it('is not its own duplicate', async () => {
      // The family keeps its own number. Without excluding itself the edit would
      // block on the record being edited, which would make a family with a
      // mobile uneditable forever.
      const id = await seedFamily(harness, token, familyPayload());

      const response = await updateFamily(
        harness,
        token,
        id,
        familyPayload({ familyName: 'نام تازه' }, [guardian({ mobile: MOBILE })]),
      );

      expect(response.status).toBe(200);
    });

    it('blocks when the edit adopts another active family mobile', async () => {
      const other = await seedFamily(harness, token, familyPayload({ familyName: 'دیگری' }));
      const id = await seedFamily(
        harness,
        token,
        familyPayload({ familyName: 'رضایی' }, [guardian({ mobile: OTHER })]),
      );

      const response = await updateFamily(
        harness,
        token,
        id,
        familyPayload({ familyName: 'رضایی' }, [guardian({ mobile: MOBILE })]),
      );

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('FAMILY_POSSIBLE_DUPLICATE');
      expect(response.body.error.details.candidates[0].familyId).toBe(other);

      // Nothing was written.
      const unchanged = familyDetailResponseSchema.parse(
        (await getFamily(harness, token, id)).body,
      );
      expect(unchanged.guardians[0]?.mobile).toBe(OTHER);
      expect(await harness.prisma.auditLog.count({ where: { action: 'family.updated' } })).toBe(0);
    });

    it('records the change with masked contact details', async () => {
      const id = await seedFamily(harness, token, familyPayload());

      await updateFamily(
        harness,
        token,
        id,
        familyPayload({ familyName: 'تازه' }, [guardian({ mobile: OTHER })]),
      );

      const row = await harness.prisma.auditLog.findFirstOrThrow({
        where: { action: 'family.updated' },
      });
      const payload = JSON.stringify({ before: row.before, after: row.after });

      expect(payload).not.toContain(MOBILE);
      expect(payload).not.toContain(OTHER);
      expect(payload).toContain('*******4567');
      expect(payload).toContain('*******6543');
      // The name change is the fact being recorded.
      expect(payload).toContain('تازه');
    });

    it('still permits editing an inactive family', async () => {
      // Deactivation takes a record out of the daily list; it does not make it
      // uncorrectable.
      const id = await seedFamily(harness, token, familyPayload());
      await setFamilyStatus(harness, token, id, 'INACTIVE');

      const response = await updateFamily(
        harness,
        token,
        id,
        familyPayload({ familyName: 'اصلاح‌شده' }),
      );

      expect(response.status).toBe(200);
      expect(familyWriteResponseSchema.parse(response.body).family.status).toBe('INACTIVE');
    });

    it('refuses an edit that leaves no reachable primary contact', async () => {
      const id = await seedFamily(harness, token, familyPayload());

      const response = await updateFamily(
        harness,
        token,
        id,
        familyPayload({}, [guardian({ mobile: null, landline: null })]),
      );

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('confirming an edit', () => {
    it('completes through the draft, without resubmitting the payload', async () => {
      const other = await seedFamily(harness, token, familyPayload({ familyName: 'دیگری' }));
      const id = await seedFamily(
        harness,
        token,
        familyPayload({ familyName: 'رضایی' }, [guardian({ mobile: OTHER })]),
      );

      const blocked = await updateFamily(
        harness,
        token,
        id,
        familyPayload({ familyName: 'رضایی‌نژاد' }, [guardian({ mobile: MOBILE })]),
      );
      const draftToken = blocked.body.error.details.draftToken as string;

      // The draft knows which family it is editing.
      const draft = registrationDraftResponseSchema.parse(
        (await resolveDraft(harness, token, draftToken)).body,
      );
      expect(draft.purpose).toBe('FAMILY_UPDATE');
      expect(draft.targetFamilyId).toBe(id);
      expect(draft.family?.familyName).toBe('رضایی‌نژاد');

      const confirmed = await confirmFamilyUpdate(harness, token, draftToken, [other]);
      expect(confirmed.status).toBe(200);

      const body = familyWriteResponseSchema.parse(confirmed.body);
      expect(body.family.familyName).toBe('رضایی‌نژاد');
      expect(body.guardians[0]?.mobile).toBe(MOBILE);

      // Consumed exactly once, and the override recorded.
      expect(await harness.prisma.registrationDraft.count()).toBe(0);
      expect(
        await harness.prisma.auditLog.count({ where: { action: 'family.duplicate_override' } }),
      ).toBe(1);
      expect(await harness.prisma.auditLog.count({ where: { action: 'family.updated' } })).toBe(1);
    });

    it('refuses a replayed token', async () => {
      const other = await seedFamily(harness, token, familyPayload({ familyName: 'دیگری' }));
      const id = await seedFamily(
        harness,
        token,
        familyPayload({ familyName: 'رضایی' }, [guardian({ mobile: OTHER })]),
      );

      const blocked = await updateFamily(
        harness,
        token,
        id,
        familyPayload({ familyName: 'تازه' }, [guardian({ mobile: MOBILE })]),
      );
      const draftToken = blocked.body.error.details.draftToken as string;

      expect((await confirmFamilyUpdate(harness, token, draftToken, [other])).status).toBe(200);

      const replay = await confirmFamilyUpdate(harness, token, draftToken, [other]);
      expect(replay.status).toBe(404);
      expect(replay.body.error.code).toBe('DRAFT_NOT_FOUND');
    });

    it('will not spend a FAMILY_UPDATE token on a registration', async () => {
      // Purpose is part of what makes a token usable. A token minted for one
      // flow must not be redeemable in another.
      const other = await seedFamily(harness, token, familyPayload({ familyName: 'دیگری' }));
      const id = await seedFamily(
        harness,
        token,
        familyPayload({ familyName: 'رضایی' }, [guardian({ mobile: OTHER })]),
      );

      const blocked = await updateFamily(
        harness,
        token,
        id,
        familyPayload({ familyName: 'تازه' }, [guardian({ mobile: MOBILE })]),
      );
      const draftToken = blocked.body.error.details.draftToken as string;

      const { confirmRegistration } = await import('./families-support');
      const wrong = await confirmRegistration(harness, token, draftToken, [other]);

      expect(wrong.status).toBe(404);
      expect(wrong.body.error.code).toBe('DRAFT_NOT_FOUND');
    });
  });

  describe('status', () => {
    it('deactivates and reactivates without deleting anything', async () => {
      const id = await seedFamily(harness, token, familyPayload());

      const off = await setFamilyStatus(harness, token, id, 'INACTIVE');
      expect(off.status).toBe(200);

      const offBody = familyDetailResponseSchema.parse(off.body);
      expect(offBody.family.status).toBe('INACTIVE');
      expect(offBody.family.deactivatedAt).not.toBeNull();

      const on = await setFamilyStatus(harness, token, id, 'ACTIVE');
      expect(familyDetailResponseSchema.parse(on.body).family.deactivatedAt).toBeNull();

      expect(await harness.prisma.family.count()).toBe(1);
    });

    it('writes one audit row per real change and none for a no-op', async () => {
      const id = await seedFamily(harness, token, familyPayload());

      await setFamilyStatus(harness, token, id, 'INACTIVE');
      await setFamilyStatus(harness, token, id, 'INACTIVE');

      expect(
        await harness.prisma.auditLog.count({ where: { action: 'family.status_changed' } }),
      ).toBe(1);
    });

    it('frees the mobile for a new registration once deactivated', async () => {
      // Only active families block, so deactivating one is also how a number is
      // released — which matters when a family is re-registered after a gap.
      const id = await seedFamily(harness, token, familyPayload());
      await setFamilyStatus(harness, token, id, 'INACTIVE');

      const { createFamily } = await import('./families-support');
      const response = await createFamily(
        harness,
        token,
        familyPayload({ familyName: 'تازه' }, [guardian({ mobile: MOBILE })]),
      );

      expect(response.status).toBe(201);
    });
  });
});
