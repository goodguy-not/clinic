import request from 'supertest';
import { familyListResponseSchema } from '@clinic/contracts';
import { createHarness, resetDatabase, type Harness } from './harness';
import {
  asUser,
  deactivateFamily,
  familyPayload,
  guardian,
  searchFamilies,
  seedChild,
  seedFamily,
  signIn,
} from './families-support';

/**
 * Finding a family while somebody is on the phone.
 *
 * Two properties run through every test here. The term never enters a URL — it
 * is a name or a number, and a query string reaches history, `Referer` and every
 * access log. And the normalisation is PostgreSQL's, the same function that
 * produced the stored keys, so what a receptionist types and what was stored can
 * never drift apart.
 */
describe('family search (real PostgreSQL)', () => {
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

  async function names(body: Record<string, unknown>): Promise<string[]> {
    const response = await searchFamilies(harness, token, body);
    expect(response.status).toBe(200);

    return familyListResponseSchema
      .parse(response.body)
      .families.map((family) => family.familyName);
  }

  async function ids(body: Record<string, unknown>): Promise<string[]> {
    const response = await searchFamilies(harness, token, body);
    return familyListResponseSchema.parse(response.body).families.map((family) => family.id);
  }

  describe('the term never travels in a URL', () => {
    it('has no GET /families collection route at all', async () => {
      const response = await request(harness.app.getHttpServer())
        .get('/families')
        .query({ q: 'رضایی' })
        .set(asUser(token));

      // Not 200 with results, and not 400 either: the route does not exist.
      expect(response.status).toBe(404);
    });

    it('accepts the term only in a JSON body', async () => {
      await seedFamily(harness, token, familyPayload({ familyName: 'رضایی' }));

      expect(await names({ q: 'رضایی' })).toEqual(['رضایی']);
    });

    it('rejects a coerced string where the contract says boolean', async () => {
      // A body is not a query string, so nothing needs coercing. If this ever
      // starts passing, the contract has drifted back towards a query shape.
      const response = await searchFamilies(harness, token, { includeInactive: 'true' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('an empty query', () => {
    it('returns the most recently registered families', async () => {
      await seedFamily(harness, token, familyPayload({ familyName: 'اول' }));
      await seedFamily(
        harness,
        token,
        familyPayload({ familyName: 'دوم' }, [guardian({ mobile: '09120000002' })]),
      );

      // Newest first: the path taken straight after registering somebody.
      expect(await names({})).toEqual(['دوم', 'اول']);
    });

    it('returns at most twenty-five', async () => {
      await seedManyFamilies(harness, actorId, 30, 'خانواده');

      const body = familyListResponseSchema.parse((await searchFamilies(harness, token, {})).body);

      expect(body.families).toHaveLength(25);
      expect(body.truncated).toBe(false);
    });
  });

  describe('Persian normalisation', () => {
    it.each([
      ['Arabic yeh for Persian yeh', 'كريمي', 'کریمی'],
      ['Persian yeh for Arabic yeh', 'کریمی', 'كريمي'],
      ['a name written with a zero-width non-joiner', 'علی‌رضایی', 'علیرضایی'],
      ['tatweel', 'رضـایی', 'رضایی'],
      ['harakat', 'رَضایی', 'رضایی'],
    ])(
      'finds a family stored as %s when the query is spelled the other way',
      async (_label: string, stored: string, queried: string) => {
        await seedFamily(harness, token, familyPayload({ familyName: stored }));

        expect(await names({ q: queried })).toEqual([stored]);
      },
    );

    it('matches a guardian name and a child name the same way', async () => {
      const familyId = await seedFamily(
        harness,
        token,
        familyPayload({ familyName: 'الف' }, [guardian({ fullName: 'كريمي' })]),
      );
      await seedChild(harness, familyId, actorId, { firstName: 'علي', lastName: 'ب' });

      expect(await names({ q: 'کریمی' })).toEqual(['الف']);
      expect(await names({ q: 'علی' })).toEqual(['الف']);
    });
  });

  describe('digits', () => {
    it.each([
      ['ASCII', '09121234567'],
      ['Persian', '۰۹۱۲۱۲۳۴۵۶۷'],
      ['Arabic-Indic', '٠٩١٢١٢٣٤٥٦٧'],
      ['spaced', '0912 123 4567'],
    ])('finds a family by its %s mobile', async (_label: string, query: string) => {
      await seedFamily(
        harness,
        token,
        familyPayload({ familyName: 'رضایی' }, [guardian({ mobile: '09121234567' })]),
      );

      expect(await names({ q: query })).toEqual(['رضایی']);
    });

    it('finds a family by the last digits of a number', async () => {
      await seedFamily(
        harness,
        token,
        familyPayload({ familyName: 'رضایی' }, [guardian({ mobile: '09121234567' })]),
      );

      expect(await names({ q: '4567' })).toEqual(['رضایی']);
      // Three digits is below the suffix threshold, so it is not a phone search.
      expect(await names({ q: '567' })).toEqual([]);
    });

    it('finds a child by file number and by paper file number', async () => {
      const familyId = await seedFamily(harness, token, familyPayload({ familyName: 'رضایی' }));
      await seedChild(harness, familyId, actorId, { legacyPaperFileNumber: 'الف-۷۷' });

      const rows = await harness.prisma.$queryRaw<{ file_number: string }[]>`
        SELECT file_number FROM child WHERE family_id = ${familyId}::uuid
      `;

      expect(await names({ q: rows[0]?.file_number ?? '' })).toEqual(['رضایی']);
      expect(await names({ q: 'الف-77' })).toEqual(['رضایی']);
    });
  });

  describe('wildcards are data, never syntax', () => {
    beforeEach(async () => {
      await seedManyFamilies(harness, actorId, 5, 'خانواده');
      await seedFamily(harness, token, familyPayload({ familyName: 'a%b' }));
      await seedFamily(
        harness,
        token,
        familyPayload({ familyName: 'a_b' }, [guardian({ mobile: '09120000099' })]),
      );
    });

    it.each([['%%%'], ['\\%'], ['%_%'], ['__'], ['%b'], ['_b']])(
      'does not let %s broaden the result',
      async (query: string) => {
        // The failure this prevents is not a wrong answer, it is a bulk
        // disclosure: an unescaped `%` matches every family in the clinic. Seven
        // families exist here, so anything above one is the bug.
        const found = await names({ q: query });

        expect(found.length).toBeLessThanOrEqual(1);
      },
    );

    it.each([['%'], ['_'], ['\\']])(
      'never reaches SQL with the single character %s at all',
      async (query: string) => {
        // The two-character minimum refuses these before the query is built.
        // Worth stating: it means the most dangerous wildcard query of all is
        // stopped by the contract, and the escaping is the second line rather
        // than the only one.
        const response = await searchFamilies(harness, token, { q: query });

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      },
    );

    it('still finds a family whose name genuinely contains a wildcard character', async () => {
      // The assertion that proves the ESCAPE clause is in force. With an empty
      // escape character the tests above still pass and this one does not.
      expect(await names({ q: 'a%b' })).toEqual(['a%b']);
      expect(await names({ q: 'a_b' })).toEqual(['a_b']);
    });
  });

  describe('ranking', () => {
    it('puts an exact number above a name that merely starts the same way', async () => {
      // The family whose number was typed must come first even though the other
      // one's name also matches the digits as a substring.
      await seedFamily(
        harness,
        token,
        familyPayload({ familyName: 'ب' }, [guardian({ mobile: '09121234567' })]),
      );
      await seedFamily(
        harness,
        token,
        familyPayload({ familyName: 'الف' }, [guardian({ mobile: '09129990000' })]),
      );

      expect((await names({ q: '09121234567' }))[0]).toBe('ب');
    });

    it('puts a prefix match above a substring match', async () => {
      await seedFamily(harness, token, familyPayload({ familyName: 'رضایی' }));
      await seedFamily(
        harness,
        token,
        familyPayload({ familyName: 'محمدرضایی' }, [guardian({ mobile: '09120000002' })]),
      );

      // Both contain «رضا»; only one starts with it.
      expect(await names({ q: 'رضا' })).toEqual(['رضایی', 'محمدرضایی']);
    });

    it('puts a phone suffix above a name substring', async () => {
      await seedFamily(
        harness,
        token,
        familyPayload({ familyName: 'ب' }, [guardian({ mobile: '09120004567' })]),
      );
      await seedFamily(
        harness,
        token,
        familyPayload({ familyName: 'الف4567' }, [guardian({ mobile: '09120000002' })]),
      );

      expect((await names({ q: '4567' }))[0]).toBe('ب');
    });

    it('returns a family once even when several of its rows match', async () => {
      const familyId = await seedFamily(
        harness,
        token,
        familyPayload({ familyName: 'رضایی' }, [
          guardian({ fullName: 'رضایی الف' }),
          guardian({ fullName: 'رضایی ب', mobile: '09120000002', isPrimaryContact: false }),
        ]),
      );
      await seedChild(harness, familyId, actorId, { firstName: 'رضایی', lastName: 'رضایی' });

      // Family name, two guardians and a child all match. One row, not four.
      expect(await ids({ q: 'رضایی' })).toEqual([familyId]);
    });
  });

  describe('inactive families', () => {
    it('excludes them by default and returns them when asked', async () => {
      const activeId = await seedFamily(harness, token, familyPayload({ familyName: 'فعال' }));
      const inactiveId = await seedFamily(
        harness,
        token,
        familyPayload({ familyName: 'غیرفعال' }, [guardian({ mobile: '09120000002' })]),
      );
      await deactivateFamily(harness, inactiveId);

      expect(await ids({})).toEqual([activeId]);
      expect(await ids({ includeInactive: true })).toHaveLength(2);

      expect(await names({ q: 'غیرفعال' })).toEqual([]);
      expect(await names({ q: 'غیرفعال', includeInactive: true })).toEqual(['غیرفعال']);
    });
  });

  describe('the result cap', () => {
    it('returns fifty and says there are more', async () => {
      await seedManyFamilies(harness, actorId, 51, 'خانواده');

      const body = familyListResponseSchema.parse(
        (await searchFamilies(harness, token, { q: 'خانواده' })).body,
      );

      expect(body.families).toHaveLength(50);
      expect(body.truncated).toBe(true);
    });

    it('does not claim truncation at exactly fifty', async () => {
      await seedManyFamilies(harness, actorId, 50, 'خانواده');

      const body = familyListResponseSchema.parse(
        (await searchFamilies(harness, token, { q: 'خانواده' })).body,
      );

      expect(body.families).toHaveLength(50);
      expect(body.truncated).toBe(false);
    });
  });

  describe('query length', () => {
    it('refuses a single character', async () => {
      const response = await searchFamilies(harness, token, { q: 'ر' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses more than sixty characters', async () => {
      const response = await searchFamilies(harness, token, { q: 'ر'.repeat(61) });

      expect(response.status).toBe(400);
    });
  });
});

/**
 * Bulk-seeds families directly.
 *
 * Registering fifty-one families over HTTP would be fifty-one transactions and
 * fifty-one duplicate scans to prove a limit. These rows exercise the same
 * columns the service writes, including the normalised key its CHECK pins.
 */
async function seedManyFamilies(
  harness: Harness,
  actorId: string,
  count: number,
  prefix: string,
): Promise<void> {
  await harness.prisma.$executeRaw`
    INSERT INTO family (
      id, family_name, search_family_name, address, note, status,
      deactivated_at, created_at, created_by_user_id
    )
    SELECT
      gen_random_uuid(),
      ${prefix} || lpad(i::text, 3, '0'),
      fa_normalize(${prefix} || lpad(i::text, 3, '0')),
      NULL, NULL, 'ACTIVE'::record_status, NULL,
      transaction_timestamp() + (i || ' milliseconds')::interval,
      ${actorId}::uuid
    FROM generate_series(1, ${count}) AS i
  `;
}
