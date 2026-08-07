import request from 'supertest';
import { childDetailResponseSchema, childWriteResponseSchema } from '@clinic/contracts';
import { createHarness, internalHeaders, resetDatabase, type Harness } from './harness';
import {
  asUser,
  childPayload,
  createChild,
  familyPayload,
  getChild,
  guardian,
  seedChildViaApi,
  seedFamily,
  setChildStatus,
  setFamilyStatus,
  signIn,
  updateChild,
} from './families-support';

/**
 * Children: the people the clinic treats.
 *
 * Two rules run through the whole suite. A child belongs permanently to one
 * family — there is no move operation and the database refuses one — and a file
 * number is assigned by the server, never typed, so nobody can collide on it.
 */
describe('children (real PostgreSQL)', () => {
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

  const server = () => harness.app.getHttpServer();

  describe('authorisation', () => {
    it('lets a receptionist and a manager use every route', async () => {
      for (const role of ['RECEPTIONIST', 'MANAGER'] as const) {
        const session = await signIn(harness, role);
        const family = await seedFamily(
          harness,
          session.token,
          familyPayload({ familyName: role }, [
            guardian({ mobile: `0912000000${role === 'MANAGER' ? '1' : '2'}` }),
          ]),
        );

        const created = await createChild(harness, session.token, family, childPayload());
        expect(created.status).toBe(201);

        const childId = created.body.child.id as string;
        expect((await getChild(harness, session.token, childId)).status).toBe(200);
        expect(
          (await updateChild(harness, session.token, childId, childPayload({ note: 'ویرایش' })))
            .status,
        ).toBe(200);
        expect((await setChildStatus(harness, session.token, childId, 'INACTIVE')).status).toBe(
          200,
        );
      }
    });

    it('rejects anonymous requests', async () => {
      const childId = await seedChildViaApi(harness, token, familyId, childPayload());

      const calls = [
        () =>
          request(server())
            .post(`/families/${familyId}/children`)
            .set(internalHeaders())
            .send(childPayload()),
        () => request(server()).get(`/children/${childId}`).set(internalHeaders()),
        () =>
          request(server())
            .patch(`/children/${childId}`)
            .set(internalHeaders())
            .send(childPayload()),
        () =>
          request(server())
            .patch(`/children/${childId}/status`)
            .set(internalHeaders())
            .send({ status: 'INACTIVE' }),
      ];

      for (const call of calls) {
        const response = await call();
        expect(response.status).toBe(401);
      }
    });

    it('exposes no delete route', async () => {
      const childId = await seedChildViaApi(harness, token, familyId, childPayload());

      const response = await request(server()).delete(`/children/${childId}`).set(asUser(token));
      expect([404, 405]).toContain(response.status);
    });
  });

  describe('registration', () => {
    it('assigns a file number the caller never supplied', async () => {
      const response = await createChild(harness, token, familyId, childPayload());
      expect(response.status).toBe(201);

      const body = childWriteResponseSchema.parse(response.body);

      expect(body.child.fileNumber).toMatch(/^\d{5,10}$/);
      expect(Number(body.child.fileNumber)).toBeGreaterThanOrEqual(10001);
      expect(body.child.familyId).toBe(familyId);
      expect(body.child.status).toBe('ACTIVE');
      expect(body.nonBlockingWarnings).toEqual([]);
    });

    it('refuses a request that tries to choose its own file number', async () => {
      const response = await createChild(
        harness,
        token,
        familyId,
        childPayload({ fileNumber: '99999' }),
      );

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('gives siblings distinct file numbers', async () => {
      const first = await seedChildViaApi(
        harness,
        token,
        familyId,
        childPayload({ firstName: 'الف' }),
      );
      const second = await seedChildViaApi(
        harness,
        token,
        familyId,
        childPayload({ firstName: 'ب' }),
      );

      const numbers = await harness.prisma.child.findMany({
        where: { id: { in: [first, second] } },
        select: { fileNumber: true },
      });

      expect(new Set(numbers.map((row) => row.fileNumber)).size).toBe(2);
    });

    it('stores the birth date as a calendar day', async () => {
      const childId = await seedChildViaApi(
        harness,
        token,
        familyId,
        childPayload({ birthDate: '2019-12-31' }),
      );

      const body = childDetailResponseSchema.parse((await getChild(harness, token, childId)).body);
      expect(body.child.birthDate).toBe('2019-12-31');
    });

    it('refuses a birth date after today in Tehran', async () => {
      const rows = await harness.prisma.$queryRaw<{ tomorrow: string }[]>`
        SELECT (clinic_date() + 1)::text AS tomorrow
      `;

      const response = await createChild(
        harness,
        token,
        familyId,
        childPayload({ birthDate: rows[0]?.tomorrow ?? '' }),
      );

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('CHILD_BIRTH_DATE_IN_FUTURE');
    });

    it('accepts a birth date of today in Tehran', async () => {
      const rows = await harness.prisma.$queryRaw<{ today: string }[]>`
        SELECT clinic_date()::text AS today
      `;

      const response = await createChild(
        harness,
        token,
        familyId,
        childPayload({ birthDate: rows[0]?.today ?? '' }),
      );

      expect(response.status).toBe(201);
    });

    it('refuses a child under an inactive family', async () => {
      await setFamilyStatus(harness, token, familyId, 'INACTIVE');

      const response = await createChild(harness, token, familyId, childPayload());

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('FAMILY_INACTIVE');
    });

    it('refuses a child under a family that does not exist', async () => {
      const response = await createChild(
        harness,
        token,
        '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
        childPayload(),
      );

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('FAMILY_NOT_FOUND');
    });

    it('validates the national identifier check digit', async () => {
      const bad = await createChild(
        harness,
        token,
        familyId,
        childPayload({ nationalId: '1234567890' }),
      );
      expect(bad.status).toBe(400);

      const good = await createChild(
        harness,
        token,
        familyId,
        childPayload({ nationalId: '1234567891' }),
      );
      expect(good.status).toBe(201);
    });

    it('refuses a national identifier another child already has', async () => {
      await seedChildViaApi(harness, token, familyId, childPayload({ nationalId: '1234567891' }));

      const response = await createChild(
        harness,
        token,
        familyId,
        childPayload({ firstName: 'دیگری', nationalId: '1234567891' }),
      );

      // Hard uniqueness with no override: a national identifier names exactly
      // one person.
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CHILD_NATIONAL_ID_TAKEN');
    });

    it('refuses a paper file number another child already has', async () => {
      await seedChildViaApi(
        harness,
        token,
        familyId,
        childPayload({ legacyPaperFileNumber: 'الف-۷۷' }),
      );

      const response = await createChild(
        harness,
        token,
        familyId,
        childPayload({ firstName: 'دیگری', legacyPaperFileNumber: 'الف-۷۷' }),
      );

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CHILD_LEGACY_FILE_NUMBER_TAKEN');
    });
  });

  describe('detail', () => {
    it('returns the child, its family and its siblings', async () => {
      const first = await seedChildViaApi(
        harness,
        token,
        familyId,
        childPayload({ firstName: 'علی', lastName: 'رضایی' }),
      );
      await seedChildViaApi(
        harness,
        token,
        familyId,
        childPayload({ firstName: 'زهرا', lastName: 'رضایی' }),
      );

      const body = childDetailResponseSchema.parse((await getChild(harness, token, first)).body);

      expect(body.child.firstName).toBe('علی');
      expect(body.family.id).toBe(familyId);
      expect(body.siblings.map((sibling) => sibling.firstName)).toEqual(['زهرا']);
    });

    it('returns CHILD_NOT_FOUND for an unknown id', async () => {
      const response = await getChild(harness, token, '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b');

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('CHILD_NOT_FOUND');
    });

    it('exposes no internal column', async () => {
      const childId = await seedChildViaApi(harness, token, familyId, childPayload());
      const raw = JSON.stringify((await getChild(harness, token, childId)).body);

      for (const forbidden of ['search_first_name', 'searchFirstName', 'created_by_user_id']) {
        expect(raw).not.toContain(forbidden);
      }
    });
  });

  describe('editing', () => {
    it('applies an ordinary correction', async () => {
      const childId = await seedChildViaApi(harness, token, familyId, childPayload());

      const response = await updateChild(
        harness,
        token,
        childId,
        childPayload({ firstName: 'رضا', referralSource: 'معرف آزمایشی', note: 'یادداشت' }),
      );

      expect(response.status).toBe(200);

      const body = childWriteResponseSchema.parse(response.body);
      expect(body.child.firstName).toBe('رضا');
      expect(body.child.referralSource).toBe('معرف آزمایشی');
    });

    it('never changes the file number or the family', async () => {
      const childId = await seedChildViaApi(harness, token, familyId, childPayload());
      const before = await harness.prisma.child.findUniqueOrThrow({ where: { id: childId } });

      await updateChild(harness, token, childId, childPayload({ firstName: 'رضا' }));

      const after = await harness.prisma.child.findUniqueOrThrow({ where: { id: childId } });

      expect(after.fileNumber).toBe(before.fileNumber);
      expect(after.familyId).toBe(before.familyId);
      expect(after.createdAt).toEqual(before.createdAt);
    });

    it('refuses a birth date moved into the future', async () => {
      const childId = await seedChildViaApi(harness, token, familyId, childPayload());
      const rows = await harness.prisma.$queryRaw<{ tomorrow: string }[]>`
        SELECT (clinic_date() + 1)::text AS tomorrow
      `;

      const response = await updateChild(
        harness,
        token,
        childId,
        childPayload({ birthDate: rows[0]?.tomorrow ?? '' }),
      );

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('CHILD_BIRTH_DATE_IN_FUTURE');
    });

    it('records the change with masked identifiers', async () => {
      const childId = await seedChildViaApi(
        harness,
        token,
        familyId,
        childPayload({ nationalId: '1234567891' }),
      );

      await updateChild(
        harness,
        token,
        childId,
        childPayload({ firstName: 'رضا', nationalId: '1234567891' }),
      );

      const row = await harness.prisma.auditLog.findFirstOrThrow({
        where: { action: 'child.updated' },
      });

      const payload = JSON.stringify({ before: row.before, after: row.after });

      expect(payload).not.toContain('1234567891');
      expect(payload).toContain('******7891');
      // A name is the fact being recorded, so it stays in full.
      expect(payload).toContain('رضا');
    });
  });

  describe('status', () => {
    it('deactivates and reactivates, preserving the record', async () => {
      const childId = await seedChildViaApi(harness, token, familyId, childPayload());

      const deactivated = await setChildStatus(harness, token, childId, 'INACTIVE');
      expect(deactivated.status).toBe(200);
      expect(childDetailResponseSchema.parse(deactivated.body).child.status).toBe('INACTIVE');
      expect(childDetailResponseSchema.parse(deactivated.body).child.deactivatedAt).not.toBeNull();

      const reactivated = await setChildStatus(harness, token, childId, 'ACTIVE');
      expect(childDetailResponseSchema.parse(reactivated.body).child.deactivatedAt).toBeNull();

      // The row is still there. History is preserved through status, not deletion.
      expect(await harness.prisma.child.count()).toBe(1);
    });

    it('writes one audit row per real change and none for a no-op', async () => {
      const childId = await seedChildViaApi(harness, token, familyId, childPayload());

      await setChildStatus(harness, token, childId, 'INACTIVE');
      await setChildStatus(harness, token, childId, 'INACTIVE');

      expect(
        await harness.prisma.auditLog.count({ where: { action: 'child.status_changed' } }),
      ).toBe(1);
    });

    it('does not cascade from the family', async () => {
      // Deactivating a family leaves its children as they were, so reactivating
      // restores exactly the prior state rather than one this code invented.
      const childId = await seedChildViaApi(harness, token, familyId, childPayload());

      await setFamilyStatus(harness, token, familyId, 'INACTIVE');

      const body = childDetailResponseSchema.parse((await getChild(harness, token, childId)).body);
      expect(body.child.status).toBe('ACTIVE');
      expect(body.family.status).toBe('INACTIVE');
    });
  });

  describe('response headers', () => {
    it('sets no-store on every child response', async () => {
      const childId = await seedChildViaApi(harness, token, familyId, childPayload());

      const responses = [
        await getChild(harness, token, childId),
        await updateChild(harness, token, childId, childPayload()),
        await setChildStatus(harness, token, childId, 'INACTIVE'),
        await getChild(harness, token, '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'),
        await request(server()).get(`/children/${childId}`).set(internalHeaders()),
      ];

      for (const response of responses) {
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.headers['referrer-policy']).toBe('no-referrer');
      }
    });
  });
});
