import request from 'supertest';
import {
  familyDetailResponseSchema,
  familyListResponseSchema,
  familyWriteResponseSchema,
} from '@clinic/contracts';
import { createHarness, internalHeaders, resetDatabase, type Harness } from './harness';
import {
  asUser,
  createFamily,
  familyPayload,
  getFamily,
  guardian,
  searchFamilies,
  seedChild,
  seedFamily,
  signIn,
} from './families-support';

/**
 * Family search, detail and registration over real HTTP.
 *
 * Everything here goes through the guard chain, the validation pipe and the
 * interceptor, because that is the surface a browser reaches. A test that called
 * the service directly would prove the SQL works and nothing about whether a
 * receptionist can actually use it.
 */
describe('families (real PostgreSQL)', () => {
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

  describe('authorisation', () => {
    it('lets a receptionist search, read and register', async () => {
      // The first surface a receptionist has ever been able to reach.
      const { token } = await signIn(harness, 'RECEPTIONIST');

      const created = await createFamily(harness, token, familyPayload());
      expect(created.status).toBe(201);

      const id = created.body.family.id as string;

      expect((await getFamily(harness, token, id)).status).toBe(200);
      expect((await searchFamilies(harness, token, {})).status).toBe(200);
    });

    it('lets a manager do the same', async () => {
      const { token } = await signIn(harness, 'MANAGER');

      const created = await createFamily(harness, token, familyPayload());
      expect(created.status).toBe(201);
      expect((await searchFamilies(harness, token, {})).status).toBe(200);
    });

    it('rejects an anonymous request on every route', async () => {
      // Each request is built inside the loop: supertest binds an ephemeral
      // port per `request(server())` and closes it once that response lands, so
      // an array of pre-built requests would fail with ECONNREFUSED on the
      // second one.
      const calls = [
        () => request(server()).post('/families/search').set(internalHeaders()).send({}),
        () =>
          request(server())
            .get('/families/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b')
            .set(internalHeaders()),
        () => request(server()).post('/families').set(internalHeaders()).send(familyPayload()),
      ];

      for (const call of calls) {
        const response = await call();
        expect(response.status).toBe(401);
        expect(response.body.error.code).toBe('AUTH_SESSION_INVALID');
      }
    });

    it('exposes no delete or replace route', async () => {
      // A family holds the balance and is named by every charge from Milestone 5
      // onward, so it is deactivated rather than removed. `PATCH` exists;
      // `PUT` and `DELETE` do not, and never will.
      const { token } = await signIn(harness, 'MANAGER');
      const id = await seedFamily(harness, token, familyPayload());

      const calls = [
        () => request(server()).put(`/families/${id}`).set(asUser(token)).send({}),
        () => request(server()).delete(`/families/${id}`).set(asUser(token)),
        () => request(server()).delete('/families').set(asUser(token)),
      ];

      for (const call of calls) {
        const response = await call();
        expect([404, 405]).toContain(response.status);
      }
    });
  });

  describe('registration', () => {
    it('creates a family with no children and says so', async () => {
      const { token } = await signIn(harness);

      const response = await createFamily(harness, token, familyPayload());
      expect(response.status).toBe(201);

      const body = familyWriteResponseSchema.parse(response.body);

      expect(body.family.familyName).toBe('رضایی');
      expect(body.family.status).toBe('ACTIVE');
      expect(body.family.deactivatedAt).toBeNull();
      expect(body.children).toEqual([]);
      expect(body.nonBlockingWarnings).toEqual([]);
      expect(body.guardians).toHaveLength(1);
      expect(body.guardians[0]?.isPrimaryContact).toBe(true);
    });

    it('preserves the entered name exactly and normalises only the search key', async () => {
      const { token } = await signIn(harness);
      // Arabic kaf and yeh. The stored value keeps them; the derived key folds.
      const id = await seedFamily(harness, token, familyPayload({ familyName: 'كريمي' }));

      const rows = await harness.prisma.$queryRaw<
        { family_name: string; search_family_name: string }[]
      >`SELECT family_name, search_family_name FROM family WHERE id = ${id}::uuid`;

      expect(rows[0]?.family_name).toBe('كريمي');
      expect(rows[0]?.search_family_name).toBe('کریمی');
    });

    it('writes createdAt from the PostgreSQL transaction clock', async () => {
      const { token } = await signIn(harness);
      const id = await seedFamily(harness, token, familyPayload());

      // The family row and its audit row must carry the same instant, which is
      // only true if both came from `transaction_timestamp()`.
      const rows = await harness.prisma.$queryRaw<{ same: boolean }[]>`
        SELECT f.created_at = a.occurred_at AS same
        FROM family f JOIN audit_log a ON a.entity_id = f.id
        WHERE f.id = ${id}::uuid AND a.action = 'family.created'
      `;

      expect(rows[0]?.same).toBe(true);
    });

    it('accepts several guardians and exactly one primary', async () => {
      const { token } = await signIn(harness);

      const response = await createFamily(
        harness,
        token,
        familyPayload({}, [
          guardian({ fullName: 'مادر', isPrimaryContact: true }),
          guardian({ fullName: 'پدر', mobile: '09129876543', isPrimaryContact: false }),
          guardian({
            fullName: 'همسایه',
            relationship: 'OTHER',
            relationshipNote: 'همسایه',
            mobile: null,
            landline: null,
            isPrimaryContact: false,
          }),
        ]),
      );

      expect(response.status).toBe(201);

      const body = familyWriteResponseSchema.parse(response.body);
      expect(body.guardians).toHaveLength(3);
      // Primary first, then by name — deterministic, because guardian ids churn.
      expect(body.guardians[0]?.isPrimaryContact).toBe(true);
      expect(body.guardians.filter((g) => g.isPrimaryContact)).toHaveLength(1);
    });

    it('accepts a primary contact reachable only by landline', async () => {
      const { token } = await signIn(harness);

      const response = await createFamily(
        harness,
        token,
        familyPayload({}, [guardian({ mobile: null, landline: '02112345678' })]),
      );

      expect(response.status).toBe(201);
    });

    it.each([
      ['no guardian', []],
      ['no primary', [guardian({ isPrimaryContact: false })]],
      ['two primaries', [guardian({ fullName: 'الف' }), guardian({ fullName: 'ب' })]],
      ['unreachable primary', [guardian({ mobile: null, landline: null })]],
      ['OTHER without a note', [guardian({ relationship: 'OTHER', relationshipNote: null })]],
    ])('refuses a family with %s', async (_label: string, guardians: Record<string, unknown>[]) => {
      const { token } = await signIn(harness);

      const response = await createFamily(harness, token, familyPayload({}, guardians));

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses a non-canonical phone number', async () => {
      const { token } = await signIn(harness);

      for (const mobile of ['+989121234567', '9121234567', '۰۹۱۲۱۲۳۴۵۶۷']) {
        const response = await createFamily(
          harness,
          token,
          familyPayload({}, [guardian({ mobile })]),
        );

        // The web tier folds Persian digits and `+98` before anything reaches
        // here; the contract describes the canonical form only.
        expect(response.status).toBe(400);
      }
    });
  });

  describe('detail', () => {
    it('returns the family, its guardians and its children in a deterministic order', async () => {
      const { id: actorId, token } = await signIn(harness);

      const familyId = await seedFamily(
        harness,
        token,
        familyPayload({ address: 'نشانی آزمایشی', note: 'یادداشت غیرپزشکی' }, [
          guardian({ fullName: 'ب', isPrimaryContact: false, mobile: '09129876543' }),
          guardian({ fullName: 'الف', isPrimaryContact: true }),
        ]),
      );

      await seedChild(harness, familyId, actorId, { firstName: 'زهرا', lastName: 'رضایی' });
      await seedChild(harness, familyId, actorId, { firstName: 'علی', lastName: 'رضایی' });

      const response = await getFamily(harness, token, familyId);
      expect(response.status).toBe(200);

      const body = familyDetailResponseSchema.parse(response.body);

      expect(body.family.address).toBe('نشانی آزمایشی');
      expect(body.family.note).toBe('یادداشت غیرپزشکی');
      expect(body.guardians.map((g) => g.fullName)).toEqual(['الف', 'ب']);
      expect(body.guardians[0]?.isPrimaryContact).toBe(true);
      // Surname, then given name.
      expect(body.children.map((c) => c.firstName)).toEqual(['زهرا', 'علی']);
      // A calendar day, not an instant.
      expect(body.children[0]?.birthDate).toBe('2020-03-21');
    });

    it('returns FAMILY_NOT_FOUND for an unknown id', async () => {
      const { token } = await signIn(harness);

      const response = await getFamily(harness, token, '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b');

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('FAMILY_NOT_FOUND');
    });

    it('rejects a malformed id before it reaches the service', async () => {
      const { token } = await signIn(harness);

      const response = await request(server()).get('/families/not-a-uuid').set(asUser(token));

      expect(response.status).toBe(400);
    });

    it('exposes no internal column', async () => {
      // The strict contract already refuses an unknown field; this states which
      // ones specifically must never appear.
      const { id: actorId, token } = await signIn(harness);
      const familyId = await seedFamily(harness, token, familyPayload());
      await seedChild(harness, familyId, actorId);

      const raw = JSON.stringify((await getFamily(harness, token, familyId)).body);

      for (const forbidden of [
        'search_family_name',
        'searchFamilyName',
        'search_full_name',
        'searchFullName',
        'search_first_name',
        'token_hash',
        'tokenHash',
        'created_by_user_id',
      ]) {
        expect(raw).not.toContain(forbidden);
      }
    });
  });

  describe('audit', () => {
    it('writes exactly one family.created row, with masked contact details', async () => {
      const { token } = await signIn(harness);

      await seedFamily(
        harness,
        token,
        familyPayload({}, [guardian({ mobile: '09121234567', landline: '02112345678' })]),
      );

      const rows = await harness.prisma.auditLog.findMany({ where: { action: 'family.created' } });
      expect(rows).toHaveLength(1);

      const payload = JSON.stringify(rows[0]?.after);

      // Full identifiers absent, masked forms present.
      expect(payload).not.toContain('09121234567');
      expect(payload).not.toContain('02112345678');
      expect(payload).toContain('*******4567');
      expect(payload).toContain('*******5678');

      // A name is the fact being recorded, so it is written in full.
      expect(payload).toContain('رضایی');
    });

    it('records no duplicate-override action for an ordinary registration', async () => {
      const { token } = await signIn(harness);
      await seedFamily(harness, token, familyPayload());

      expect(
        await harness.prisma.auditLog.count({ where: { action: 'family.duplicate_override' } }),
      ).toBe(0);
    });

    it('names the acting user and the request', async () => {
      const { id: actorId, token } = await signIn(harness);
      await seedFamily(harness, token, familyPayload());

      const row = await harness.prisma.auditLog.findFirstOrThrow({
        where: { action: 'family.created' },
      });

      expect(row.actorType).toBe('USER');
      expect(row.actorUserId).toBe(actorId);
      expect(row.entityType).toBe('family');
      expect(row.requestId).not.toBeNull();
    });
  });

  describe('response headers', () => {
    it('sets no-store on every personal-data response, success or failure', async () => {
      const { token } = await signIn(harness);
      const id = await seedFamily(harness, token, familyPayload());

      const responses = [
        await searchFamilies(harness, token, {}),
        await getFamily(harness, token, id),
        await createFamily(harness, token, familyPayload({ familyName: 'احمدی' })),
        // 404 — goes through the exception filter, not the interceptor.
        await getFamily(harness, token, '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'),
        // 401 — rejected by a guard, which runs *before* the interceptor.
        await request(server()).post('/families/search').set(internalHeaders()).send({}),
      ];

      for (const response of responses) {
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.headers['referrer-policy']).toBe('no-referrer');
      }
    });

    it('sets no-store on a 403 guard rejection, same as any other response', async () => {
      // No role is missing a family permission today — a receptionist holds the
      // full family/child workflow, same as a manager (`guards.int-spec.ts`,
      // "permission model") — so there is no *reachable* 403 here that comes
      // from `PermissionsGuard` without inventing a role the production model
      // does not have. `SessionGuard` genuinely refuses this surface for a real,
      // shipped reason instead: a signed-in user who still owes a password
      // change gets `AUTH_PASSWORD_CHANGE_REQUIRED` on every route except the
      // few that clear it, and family/child/draft routes carry no
      // `@AllowWhilePasswordChangePending` exemption. That is a genuine 403
      // guard rejection on this exact surface, reachable by any account.
      const { token } = await signIn(harness, 'RECEPTIONIST', { mustChangePassword: true });

      const response = await searchFamilies(harness, token, {});

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('AUTH_PASSWORD_CHANGE_REQUIRED');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
    });
  });

  describe('operational logs', () => {
    it('carries no submitted name, number, note, search term or draft token', async () => {
      // `ErrorEnvelopeFilter` logs only `message` and `stack`, and only above
      // 500, so a 409 duplicate logs nothing at all — which is what keeps the
      // draft token out. This asserts the property rather than the mechanism,
      // so a future change to either has to keep it true.
      // Spying on the streams rather than on `console` catches whatever Nest's
      // logger writes with, now and after any future change to it.
      const captured: string[] = [];
      const spies = [process.stdout, process.stderr].map((stream) =>
        jest.spyOn(stream, 'write').mockImplementation((chunk: unknown) => {
          captured.push(typeof chunk === 'string' ? chunk : String(chunk));
          return true;
        }),
      );

      try {
        const { token } = await signIn(harness);

        await createFamily(
          harness,
          token,
          familyPayload(
            { familyName: 'محرمانه', address: 'نشانی محرمانه', note: 'یادداشت محرمانه' },
            [
              guardian({
                fullName: 'سرپرست محرمانه',
                mobile: '09121234567',
                landline: '02112345678',
              }),
            ],
          ),
        );

        // A blocked registration, which is the path that mints a draft token.
        const blocked = await createFamily(
          harness,
          token,
          familyPayload({ familyName: 'دیگری' }, [guardian({ mobile: '09121234567' })]),
        );
        const draftToken = blocked.body?.error?.details?.draftToken as string | undefined;

        await searchFamilies(harness, token, { q: 'محرمانه' });

        const log = captured.join('\n');

        for (const secret of [
          'محرمانه',
          '09121234567',
          '02112345678',
          'نشانی محرمانه',
          'یادداشت محرمانه',
        ]) {
          expect(log).not.toContain(secret);
        }

        expect(draftToken).toBeDefined();
        if (draftToken !== undefined) expect(log).not.toContain(draftToken);
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
    });
  });

  describe('search response shape', () => {
    it('flags a family that is still awaiting its first child', async () => {
      const { id: actorId, token } = await signIn(harness);

      const withoutChild = await seedFamily(harness, token, familyPayload({ familyName: 'الف' }));
      const withChild = await seedFamily(
        harness,
        token,
        familyPayload({ familyName: 'ب' }, [guardian({ mobile: '09120000001' })]),
      );
      await seedChild(harness, withChild, actorId);

      const body = familyListResponseSchema.parse((await searchFamilies(harness, token, {})).body);
      const byId = new Map(body.families.map((family) => [family.id, family]));

      expect(byId.get(withoutChild)?.awaitingFirstChild).toBe(true);
      expect(byId.get(withoutChild)?.childCount).toBe(0);
      expect(byId.get(withChild)?.awaitingFirstChild).toBe(false);
      expect(byId.get(withChild)?.childCount).toBe(1);
    });

    it('carries the primary guardian and a guardian count', async () => {
      const { token } = await signIn(harness);
      await seedFamily(
        harness,
        token,
        familyPayload({}, [
          guardian({ fullName: 'مادر', isPrimaryContact: true }),
          guardian({ fullName: 'پدر', mobile: '09129876543', isPrimaryContact: false }),
        ]),
      );

      const body = familyListResponseSchema.parse((await searchFamilies(harness, token, {})).body);

      expect(body.families[0]?.primaryGuardian?.fullName).toBe('مادر');
      expect(body.families[0]?.guardianCount).toBe(2);
    });
  });
});
