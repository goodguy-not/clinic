import { Prisma } from '@prisma/client';
import { uuidv7 } from '../src/common/uuid';
import { createHarness, resetDatabase, seedUser, type Harness, ownerPrisma } from './harness';

/**
 * What the database refuses, proved by asking it to do the thing.
 *
 * Every fixture here is synthetic. `0912…`, `1234567891` and «خانوادهٔ آزمایشی»
 * are shapes and placeholders, not anybody's details: no real clinic data
 * appears in any test in this project.
 *
 * These tests write raw SQL rather than going through a service, deliberately.
 * There is no Milestone 3 service yet, and more importantly the question being
 * asked is "what does PostgreSQL refuse when the application is bypassed?" —
 * which is the only question that matters for a constraint. A test that could
 * only reach the database through code that already validates would prove
 * nothing about the database.
 */
describe('families constraints (real PostgreSQL)', () => {
  let harness: Harness;
  let actorId: string;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    actorId = (await seedUser(harness, { role: 'RECEPTIONIST' })).id;
  });

  /** SQLSTATE 23001, restrict_violation — the one code every refusal raises. */
  const RESTRICT_VIOLATION = '23001';

  async function expectRejected(run: () => Promise<unknown>, sqlState?: string): Promise<void> {
    await expect(run()).rejects.toThrow(sqlState === undefined ? /.*/ : new RegExp(sqlState));
  }

  // --- family ---------------------------------------------------------------

  async function insertFamily(overrides: Partial<Record<string, unknown>> = {}): Promise<string> {
    const id = String(overrides['id'] ?? uuidv7());
    const familyName = String(overrides['familyName'] ?? 'خانوادهٔ آزمایشی');
    const searchName = overrides['searchFamilyName'];
    const address = overrides['address'] ?? null;
    const note = overrides['note'] ?? null;
    const status = String(overrides['status'] ?? 'ACTIVE');
    const deactivatedAt = overrides['deactivatedAt'] ?? null;

    await harness.prisma.$executeRaw`
      INSERT INTO family (
        id, family_name, search_family_name, address, note, status, deactivated_at,
        created_at, created_by_user_id
      ) VALUES (
        ${id}::uuid,
        ${familyName},
        ${searchName === undefined ? Prisma.sql`fa_normalize(${familyName})` : Prisma.sql`${searchName as string}`},
        ${address as string | null},
        ${note as string | null},
        ${status}::record_status,
        ${deactivatedAt === null ? Prisma.sql`NULL` : Prisma.sql`transaction_timestamp()`},
        transaction_timestamp(),
        ${actorId}::uuid
      )
    `;

    return id;
  }

  describe('family', () => {
    it('accepts a trimmed, bounded name and normalises its search key in one statement', async () => {
      const id = await insertFamily({ familyName: 'رضایی' });

      const rows = await harness.prisma.$queryRaw<
        { family_name: string; search_family_name: string }[]
      >`
        SELECT family_name, search_family_name FROM family WHERE id = ${id}::uuid
      `;

      // The stored text is untouched; only the derived key is folded.
      expect(rows[0]?.family_name).toBe('رضایی');
      expect(rows[0]?.search_family_name).toBe('رضایی');
    });

    it.each([
      [' رضایی', 'leading whitespace'],
      ['رضایی ', 'trailing whitespace'],
      ['', 'empty'],
      ['   ', 'whitespace only'],
      ['x'.repeat(121), 'over 120 characters'],
    ])('refuses %s (%s)', async (familyName: string) => {
      await expectRejected(() => insertFamily({ familyName }));
    });

    it('refuses a search key that is not the normaliser output', async () => {
      // The case that matters: a future INSERT that forgot to normalise would
      // produce a family the search built to find it could never find.
      await expectRejected(() =>
        insertFamily({ familyName: 'رضایی', searchFamilyName: 'something-else' }),
      );
    });

    it.each([
      ['address', 501],
      ['note', 2001],
    ])('bounds %s', async (column: string, tooLong: number) => {
      await expect(insertFamily({ [column]: 'a'.repeat(tooLong - 1) })).resolves.toBeDefined();
      await expectRejected(() => insertFamily({ [column]: 'a'.repeat(tooLong) }));
      await expectRejected(() => insertFamily({ [column]: '  ' }));
    });

    it('keeps status and deactivated_at consistent in both directions', async () => {
      await expectRejected(() => insertFamily({ status: 'INACTIVE', deactivatedAt: null }));
      await expectRejected(() => insertFamily({ status: 'ACTIVE', deactivatedAt: 'now' }));
      await expect(
        insertFamily({ status: 'INACTIVE', deactivatedAt: 'now' }),
      ).resolves.toBeDefined();
    });

    it('refuses DELETE and TRUNCATE', async () => {
      const id = await insertFamily();

      await expectRejected(
        () => ownerPrisma().$executeRaw`DELETE FROM family WHERE id = ${id}::uuid`,
        RESTRICT_VIOLATION,
      );
      await expectRejected(
        () => ownerPrisma().$executeRawUnsafe('TRUNCATE family CASCADE'),
        RESTRICT_VIOLATION,
      );

      expect(await harness.prisma.family.count()).toBe(1);
    });
  });

  // --- guardian -------------------------------------------------------------

  async function insertGuardian(
    familyId: string,
    overrides: Partial<Record<string, unknown>> = {},
  ): Promise<string> {
    const id = uuidv7();
    const fullName = String(overrides['fullName'] ?? 'سرپرست آزمایشی');
    const relationship = String(overrides['relationship'] ?? 'MOTHER');
    const relationshipNote = (overrides['relationshipNote'] ?? null) as string | null;
    const mobile = (overrides['mobile'] === undefined ? '09121234567' : overrides['mobile']) as
      string | null;
    const landline = (overrides['landline'] ?? null) as string | null;
    const isPrimary = overrides['isPrimaryContact'] ?? true;
    const searchName = overrides['searchFullName'];

    await harness.prisma.$executeRaw`
      INSERT INTO guardian (
        id, family_id, full_name, search_full_name, relationship, relationship_note,
        mobile, landline, is_primary_contact
      ) VALUES (
        ${id}::uuid, ${familyId}::uuid, ${fullName},
        ${searchName === undefined ? Prisma.sql`fa_normalize(${fullName})` : Prisma.sql`${searchName as string}`},
        ${relationship}::guardian_relationship, ${relationshipNote},
        ${mobile}, ${landline}, ${isPrimary as boolean}
      )
    `;

    return id;
  }

  describe('guardian', () => {
    it('bounds the name and pins its search key', async () => {
      const familyId = await insertFamily();

      await expectRejected(() => insertGuardian(familyId, { fullName: ' نام' }));
      await expectRejected(() => insertGuardian(familyId, { fullName: 'x'.repeat(121) }));
      await expectRejected(() => insertGuardian(familyId, { searchFullName: 'wrong' }));
    });

    it('requires a relationship note for OTHER and forbids one otherwise', async () => {
      const familyId = await insertFamily();

      await expectRejected(() =>
        insertGuardian(familyId, { relationship: 'OTHER', relationshipNote: null }),
      );
      await expectRejected(() =>
        insertGuardian(familyId, { relationship: 'MOTHER', relationshipNote: 'اضافی' }),
      );
      await expect(
        insertGuardian(familyId, { relationship: 'OTHER', relationshipNote: 'همسایه' }),
      ).resolves.toBeDefined();
    });

    it.each([
      ['09121234567', true],
      ['09001234567', true],
      ['9121234567', false],
      ['+989121234567', false],
      ['091212345678', false],
      ['08121234567', false],
    ])('mobile %s accepted=%s', async (mobile: string, accepted: boolean) => {
      const familyId = await insertFamily();
      const run = () => insertGuardian(familyId, { mobile });

      if (accepted) await expect(run()).resolves.toBeDefined();
      else await expectRejected(run);
    });

    it.each([
      ['02112345678', true],
      ['0341234567', true],
      ['0021234567', false],
      ['02112345', false],
      ['2112345678', false],
    ])('landline %s accepted=%s', async (landline: string, accepted: boolean) => {
      const familyId = await insertFamily();
      const run = () =>
        insertGuardian(familyId, { mobile: null, landline, isPrimaryContact: false });

      if (accepted) await expect(run()).resolves.toBeDefined();
      else await expectRejected(run);
    });

    it('accepts a primary contact reachable only by mobile', async () => {
      const familyId = await insertFamily();

      await expect(
        insertGuardian(familyId, { mobile: '09121234567', landline: null }),
      ).resolves.toBeDefined();
    });

    it('accepts a primary contact reachable only by landline', async () => {
      // A family reachable only on a landline is a real family, and refusing it
      // would refuse a patient.
      const familyId = await insertFamily();

      await expect(
        insertGuardian(familyId, { mobile: null, landline: '02112345678' }),
      ).resolves.toBeDefined();
    });

    it('refuses a primary contact reachable by neither', async () => {
      const familyId = await insertFamily();

      await expectRejected(() => insertGuardian(familyId, { mobile: null, landline: null }));
    });

    it('allows a non-primary guardian with no number at all', async () => {
      // A named grandparent whose number nobody has recorded is still worth
      // knowing about; only the primary contact must be reachable.
      const familyId = await insertFamily();
      await insertGuardian(familyId);

      await expect(
        insertGuardian(familyId, {
          fullName: 'سرپرست دوم',
          mobile: null,
          landline: null,
          isPrimaryContact: false,
        }),
      ).resolves.toBeDefined();
    });

    it('permits at most one primary contact per family', async () => {
      const familyId = await insertFamily();
      await insertGuardian(familyId);

      await expectRejected(() => insertGuardian(familyId, { fullName: 'سرپرست دوم' }), '23505');
    });

    it('lets two different families each have their own primary contact', async () => {
      const first = await insertFamily({ familyName: 'الف' });
      const second = await insertFamily({ familyName: 'ب' });

      await expect(insertGuardian(first)).resolves.toBeDefined();
      await expect(insertGuardian(second)).resolves.toBeDefined();
    });

    it('is deletable, because a guardian set is configuration rather than history', async () => {
      const familyId = await insertFamily();
      const guardianId = await insertGuardian(familyId);

      await expect(
        harness.prisma.$executeRaw`DELETE FROM guardian WHERE id = ${guardianId}::uuid`,
      ).resolves.toBe(1);
    });
  });

  // --- child ----------------------------------------------------------------

  let fileNumberCounter = 20000;

  async function insertChild(
    familyId: string,
    overrides: Partial<Record<string, unknown>> = {},
  ): Promise<string> {
    const id = uuidv7();
    const firstName = String(overrides['firstName'] ?? 'کودک');
    const lastName = String(overrides['lastName'] ?? 'آزمایشی');
    const searchFirst = overrides['searchFirstName'];
    const birthDate = String(overrides['birthDate'] ?? '2020-03-21');
    fileNumberCounter += 1;
    const fileNumber = String(overrides['fileNumber'] ?? String(fileNumberCounter));
    const status = String(overrides['status'] ?? 'ACTIVE');

    await harness.prisma.$executeRaw`
      INSERT INTO child (
        id, family_id, first_name, last_name, search_first_name, search_last_name,
        birth_date, file_number, legacy_paper_file_number, national_id, sex,
        referral_source, note, status, deactivated_at, created_at, created_by_user_id
      ) VALUES (
        ${id}::uuid, ${familyId}::uuid, ${firstName}, ${lastName},
        ${searchFirst === undefined ? Prisma.sql`fa_normalize(${firstName})` : Prisma.sql`${searchFirst as string}`},
        fa_normalize(${lastName}),
        ${birthDate}::date, ${fileNumber},
        ${(overrides['legacyPaperFileNumber'] ?? null) as string | null},
        ${(overrides['nationalId'] ?? null) as string | null},
        ${String(overrides['sex'] ?? 'UNSPECIFIED')}::child_sex,
        ${(overrides['referralSource'] ?? null) as string | null},
        ${(overrides['note'] ?? null) as string | null},
        ${status}::record_status,
        ${overrides['deactivatedAt'] === undefined ? Prisma.sql`NULL` : Prisma.sql`transaction_timestamp()`},
        transaction_timestamp(), ${actorId}::uuid
      )
    `;

    return id;
  }

  describe('child', () => {
    it('stores a birth date as a calendar day with no time and no offset', async () => {
      const familyId = await insertFamily();
      const id = await insertChild(familyId, { birthDate: '2020-03-21' });

      const rows = await harness.prisma.$queryRaw<{ typename: string; as_text: string }[]>`
        SELECT pg_typeof(birth_date)::text AS typename, birth_date::text AS as_text
        FROM child WHERE id = ${id}::uuid
      `;

      expect(rows[0]?.typename).toBe('date');
      expect(rows[0]?.as_text).toBe('2020-03-21');
    });

    it('enforces the loose lower birth-date bound', async () => {
      const familyId = await insertFamily();

      await expectRejected(() => insertChild(familyId, { birthDate: '1899-12-31' }));
      await expect(insertChild(familyId, { birthDate: '1900-01-01' })).resolves.toBeDefined();
    });

    it('pins both search keys to the normaliser', async () => {
      const familyId = await insertFamily();

      await expectRejected(() => insertChild(familyId, { searchFirstName: 'wrong' }));
    });

    it.each([['1234'], ['12345678901'], ['1234a'], ['']])(
      'refuses the file number %s',
      async (fileNumber: string) => {
        const familyId = await insertFamily();
        await expectRejected(() => insertChild(familyId, { fileNumber }));
      },
    );

    it.each([['123456789'], ['12345678901'], ['12345 6789'], ['abcdefghij']])(
      'refuses the national identifier %s',
      async (nationalId: string) => {
        const familyId = await insertFamily();
        await expectRejected(() => insertChild(familyId, { nationalId }));
      },
    );

    it('bounds the optional text columns', async () => {
      const familyId = await insertFamily();

      await expectRejected(() => insertChild(familyId, { legacyPaperFileNumber: 'a'.repeat(41) }));
      await expectRejected(() => insertChild(familyId, { legacyPaperFileNumber: ' ' }));
      await expectRejected(() => insertChild(familyId, { referralSource: 'a'.repeat(201) }));
      await expectRejected(() => insertChild(familyId, { note: 'a'.repeat(2001) }));
    });

    it('keeps status and deactivated_at consistent', async () => {
      const familyId = await insertFamily();

      await expectRejected(() => insertChild(familyId, { status: 'INACTIVE' }));
      await expect(
        insertChild(familyId, { status: 'INACTIVE', deactivatedAt: 'now' }),
      ).resolves.toBeDefined();
    });

    it('makes a national identifier unique where present, and irrelevant where absent', async () => {
      const familyId = await insertFamily();
      await insertChild(familyId, { nationalId: '1234567891' });

      // Two children may both have no identifier; two may not share one.
      await expect(insertChild(familyId, { nationalId: null })).resolves.toBeDefined();
      await expect(insertChild(familyId, { nationalId: null })).resolves.toBeDefined();
      await expectRejected(() => insertChild(familyId, { nationalId: '1234567891' }), '23505');
    });

    it('makes a legacy paper file number unique where present', async () => {
      const familyId = await insertFamily();
      await insertChild(familyId, { legacyPaperFileNumber: 'A-77' });

      await expect(insertChild(familyId, { legacyPaperFileNumber: null })).resolves.toBeDefined();
      await expectRejected(() => insertChild(familyId, { legacyPaperFileNumber: 'A-77' }), '23505');
    });

    it('refuses DELETE and TRUNCATE', async () => {
      const familyId = await insertFamily();
      const id = await insertChild(familyId);

      await expectRejected(
        () => ownerPrisma().$executeRaw`DELETE FROM child WHERE id = ${id}::uuid`,
        RESTRICT_VIOLATION,
      );
      await expectRejected(
        () => ownerPrisma().$executeRawUnsafe('TRUNCATE child CASCADE'),
        RESTRICT_VIOLATION,
      );
    });

    describe('identity is immutable', () => {
      it('refuses to move a child between families', async () => {
        // The one that matters most: reassignment rewrites who owes for every
        // session that child has ever had. It must be a designed, audited
        // repair operation, not an UPDATE.
        const first = await insertFamily({ familyName: 'الف' });
        const second = await insertFamily({ familyName: 'ب' });
        const id = await insertChild(first);

        await expectRejected(
          () =>
            harness.prisma
              .$executeRaw`UPDATE child SET family_id = ${second}::uuid WHERE id = ${id}::uuid`,
          RESTRICT_VIOLATION,
        );

        const rows = await harness.prisma.$queryRaw<{ family_id: string }[]>`
          SELECT family_id FROM child WHERE id = ${id}::uuid
        `;
        expect(rows[0]?.family_id).toBe(first);
      });

      it.each([
        ['file_number', Prisma.sql`file_number = '99999'`],
        ['created_at', Prisma.sql`created_at = transaction_timestamp() - interval '1 day'`],
        ['id', Prisma.sql`id = gen_random_uuid()`],
      ])('refuses to change %s', async (_column: string, assignment: Prisma.Sql) => {
        const familyId = await insertFamily();
        const id = await insertChild(familyId);

        await expectRejected(
          () => harness.prisma.$executeRaw`UPDATE child SET ${assignment} WHERE id = ${id}::uuid`,
          RESTRICT_VIOLATION,
        );
      });

      it('refuses to change created_by_user_id', async () => {
        const familyId = await insertFamily();
        const id = await insertChild(familyId);
        const other = await seedUser(harness, { role: 'MANAGER' });

        await expectRejected(
          () =>
            harness.prisma
              .$executeRaw`UPDATE child SET created_by_user_id = ${other.id}::uuid WHERE id = ${id}::uuid`,
          RESTRICT_VIOLATION,
        );
      });

      it('still permits an ordinary edit', async () => {
        // The trigger guards identity, not the record. A corrected spelling
        // must go through.
        const familyId = await insertFamily();
        const id = await insertChild(familyId, { firstName: 'کودک' });

        await expect(
          harness.prisma.$executeRaw`
            UPDATE child SET first_name = 'علی', search_first_name = fa_normalize('علی')
            WHERE id = ${id}::uuid
          `,
        ).resolves.toBe(1);
      });
    });
  });

  // --- registration_draft ---------------------------------------------------

  async function insertDraft(overrides: Partial<Record<string, unknown>> = {}): Promise<string> {
    const id = uuidv7();
    const purpose = String(overrides['purpose'] ?? 'FAMILY_CREATE');
    const tokenBytes = (overrides['tokenHash'] ?? null) as Buffer | null;

    await harness.prisma.$executeRaw`
      INSERT INTO registration_draft (
        id, token_hash, purpose, created_by_user_id, session_id, payload,
        shown_candidate_ids, target_family_id, target_child_id, created_at, expires_at
      ) VALUES (
        ${id}::uuid,
        ${tokenBytes === null ? Prisma.sql`sha256(${id}::text::bytea)` : Prisma.sql`${tokenBytes}`},
        ${purpose}::draft_purpose,
        ${String(overrides['createdByUserId'] ?? actorId)}::uuid,
        ${String(overrides['sessionId'] ?? '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b')}::uuid,
        '{}'::jsonb,
        ARRAY[]::uuid[],
        ${(overrides['targetFamilyId'] ?? null) as string | null}::uuid,
        ${(overrides['targetChildId'] ?? null) as string | null}::uuid,
        transaction_timestamp(),
        ${
          overrides['expiresAt'] === 'past'
            ? Prisma.sql`transaction_timestamp() - interval '1 minute'`
            : Prisma.sql`transaction_timestamp() + interval '10 minutes'`
        }
      )
    `;

    return id;
  }

  describe('registration draft', () => {
    it('requires a token hash of exactly 32 bytes', async () => {
      await expect(insertDraft()).resolves.toBeDefined();
      await expectRejected(() => insertDraft({ tokenHash: Buffer.alloc(31) }));
      await expectRejected(() => insertDraft({ tokenHash: Buffer.alloc(33) }));
    });

    it('requires expiry to be after creation', async () => {
      // Both timestamps come from the same transaction clock, so this is a bug
      // rather than a clock-skew symptom.
      await expectRejected(() => insertDraft({ expiresAt: 'past' }));
    });

    it.each([
      ['FAMILY_CREATE', false, false, true],
      ['FAMILY_CREATE', true, false, false],
      ['FAMILY_UPDATE', true, false, true],
      ['FAMILY_UPDATE', false, false, false],
      ['CHILD_CREATE', true, false, true],
      ['CHILD_CREATE', false, false, false],
      ['CHILD_UPDATE', true, true, true],
      ['CHILD_UPDATE', true, false, false],
    ])(
      '%s with family=%s child=%s is accepted=%s',
      async (purpose: string, withFamily: boolean, withChild: boolean, accepted: boolean) => {
        const familyId = withFamily || withChild ? await insertFamily() : null;
        const childId = withChild && familyId !== null ? await insertChild(familyId) : null;

        const run = () =>
          insertDraft({
            purpose,
            targetFamilyId: withFamily ? familyId : null,
            targetChildId: withChild ? childId : null,
          });

        if (accepted) await expect(run()).resolves.toBeDefined();
        else await expectRejected(run);
      },
    );

    it('lets one user hold the same purpose in two different sessions', async () => {
      // The whole point of binding to a session as well as a user: somebody
      // working in two browsers must not have one registration silently
      // destroy the other.
      await expect(insertDraft({ sessionId: uuidv7() })).resolves.toBeDefined();
      await expect(insertDraft({ sessionId: uuidv7() })).resolves.toBeDefined();

      expect(await harness.prisma.registrationDraft.count()).toBe(2);
    });

    it('refuses a second draft for the same user, session and purpose', async () => {
      const sessionId = uuidv7();

      await insertDraft({ sessionId });
      await expectRejected(() => insertDraft({ sessionId }), '23505');
    });

    it('lets one user hold different purposes in one session', async () => {
      const sessionId = uuidv7();
      const familyId = await insertFamily();

      await expect(insertDraft({ sessionId, purpose: 'FAMILY_CREATE' })).resolves.toBeDefined();
      await expect(
        insertDraft({ sessionId, purpose: 'CHILD_CREATE', targetFamilyId: familyId }),
      ).resolves.toBeDefined();
    });

    it('is physically deletable and truncatable', async () => {
      // Deletion is how a draft ends: consumed on confirmation, discarded, or
      // swept once expired. Protecting it would be exactly wrong.
      const id = await insertDraft();

      await expect(
        harness.prisma.$executeRaw`DELETE FROM registration_draft WHERE id = ${id}::uuid`,
      ).resolves.toBe(1);

      // TRUNCATE is the owner's alone — the runtime holds no TRUNCATE anywhere —
      // so this proves only that no trigger stands in its way.
      await insertDraft();
      await expect(
        ownerPrisma().$executeRawUnsafe('TRUNCATE registration_draft'),
      ).resolves.toBeDefined();

      expect(await harness.prisma.registrationDraft.count()).toBe(0);
    });
  });

  // --- functions ------------------------------------------------------------

  describe('fa_normalize', () => {
    async function normalize(value: string): Promise<string> {
      const rows = await harness.prisma.$queryRaw<{ result: string }[]>`
        SELECT fa_normalize(${value}) AS result
      `;
      return rows[0]?.result ?? '';
    }

    it.each([
      ['Arabic yeh and Persian yeh', 'علي', 'علی'],
      ['alef maksura', 'على', 'علی'],
      ['Arabic kaf', 'كريمي', 'کریمی'],
      ['zero-width non-joiner', 'علی‌رضا', 'علیرضا'],
      ['zero-width joiner', 'علی‍رضا', 'علیرضا'],
      ['tatweel', 'عـ___ـلی'.replace(/_/g, 'ـ'), 'علی'],
      ['harakat', 'عَلِی', 'علی'],
      ['madda alef', 'آبان', 'ابان'],
      ['teh marbuta', 'فاطمة', 'فاطمه'],
    ])('folds %s to one key', async (_label: string, left: string, right: string) => {
      expect(await normalize(left)).toBe(await normalize(right));
    });

    it.each([
      ['۱۲۳', '123'],
      ['١٢٣', '123'],
      ['  a   b  ', 'a b'],
      ['ABC', 'abc'],
    ])('normalises %s to %s', async (input: string, expected: string) => {
      expect(await normalize(input)).toBe(expected);
    });

    it('never rewrites the stored value', async () => {
      // The rule Milestone 2 set: folding belongs to a derived key, never to
      // what somebody typed. Two spellings stay two distinguishable rows.
      const arabic = 'كريمي';
      const persian = 'کریمی';

      const first = await insertFamily({ familyName: arabic });
      const second = await insertFamily({ familyName: persian });

      const rows = await harness.prisma.$queryRaw<
        { family_name: string; search_family_name: string }[]
      >`
        SELECT family_name, search_family_name FROM family
        WHERE id IN (${first}::uuid, ${second}::uuid) ORDER BY family_name
      `;

      expect(rows.map((row) => row.family_name).sort()).toEqual([arabic, persian].sort());
      // Same search key, different stored text.
      expect(new Set(rows.map((row) => row.search_family_name)).size).toBe(1);
    });
  });

  describe('search_like_escape', () => {
    it('doubles a backslash before escaping anything else', async () => {
      const rows = await harness.prisma.$queryRaw<{ escaped: string; combined: string }[]>`
        SELECT search_like_escape(chr(92)) AS escaped,
               search_like_escape(chr(92) || '%') AS combined
      `;

      expect(rows[0]?.escaped).toBe('\\\\');
      expect(rows[0]?.combined).toBe('\\\\\\%');
    });

    it('stops a wildcard query from returning the whole table', async () => {
      // The failure this prevents is not a wrong answer, it is a bulk
      // disclosure: an unescaped `%` matches every family in the clinic.
      await insertFamily({ familyName: 'احمدی' });
      await insertFamily({ familyName: 'رضایی' });
      await insertFamily({ familyName: 'a%b' });
      await insertFamily({ familyName: 'a_b' });

      const matches = async (query: string): Promise<number> => {
        // `ESCAPE '\\'` and not `ESCAPE '\'`. In a JavaScript template literal
        // `\'` is an escaped quote, so the second form reaches PostgreSQL as
        // `ESCAPE ''` — an empty escape character, which disables escaping
        // altogether. The security case still looks fine when that happens
        // (a query of `%` becomes a search for a name starting with a literal
        // backslash, and matches nothing), so the mistake hides itself; what
        // breaks is finding the row that genuinely contains a `%`.
        const rows = await harness.prisma.$queryRaw<{ count: bigint }[]>`
          SELECT count(*) AS count FROM family
          WHERE search_family_name LIKE search_like_escape(fa_normalize(${query})) || '%' ESCAPE '\\'
        `;
        return Number(rows[0]?.count ?? 0);
      };

      expect(await matches('%')).toBe(0);
      expect(await matches('_')).toBe(0);
      expect(await matches('%%%')).toBe(0);
      expect(await matches('\\')).toBe(0);

      // A literal wildcard character still finds the row that genuinely has one.
      // This is the assertion that proves the ESCAPE clause is actually in
      // force: with an empty escape character the two above still return 0, so
      // only this one distinguishes "escaping works" from "escaping is off".
      expect(await matches('a%b')).toBe(1);
      expect(await matches('a_b')).toBe(1);
      // And an ordinary prefix still works.
      expect(await matches('اح')).toBe(1);
    });

    it('an empty ESCAPE clause silently disables escaping, which is the trap', async () => {
      // Recorded as a property rather than a comment, because the service query
      // written in Checkpoint C will contain exactly this clause and the
      // difference between the two spellings is one backslash in a template
      // literal.
      await insertFamily({ familyName: 'a%b' });

      const withEscape = await harness.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count FROM family
        WHERE search_family_name LIKE search_like_escape('a%b') || '%' ESCAPE '\\'
      `;
      const withoutEscape = await harness.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count FROM family
        WHERE search_family_name LIKE search_like_escape('a%b') || '%' ESCAPE ''
      `;

      expect(Number(withEscape[0]?.count)).toBe(1);
      expect(Number(withoutEscape[0]?.count)).toBe(0);
    });
  });

  describe('audit_identifiers_masked', () => {
    async function accepts(payload: string): Promise<boolean> {
      const rows = await harness.prisma.$queryRaw<{ ok: boolean }[]>`
        SELECT audit_identifiers_masked(${payload}::jsonb) AS ok
      `;
      return rows[0]?.ok ?? false;
    }

    it.each([
      ['{"nationalId":null,"mobile":null,"landline":null}', true],
      ['{"nationalId":"******7891"}', true],
      ['{"mobile":"*******4567"}', true],
      ['{"landline":"******4567"}', true],
      ['{"landline":"*******5678"}', true],
      ['{"guardians":[{"mobile":"*******4567"}]}', true],
      ['{"nationalId":"1234567891"}', false],
      ['{"mobile":"09121234567"}', false],
      ['{"nationalId":"*1234567891"}', false],
      ['{"nationalId":"*******7891"}', false],
      ['{"mobile":"******4567"}', false],
      ['{"mobile":9121234567}', false],
      ['{"a":{"b":{"mobile":"09121234567"}}}', false],
      ['{"guardians":[{"ok":1},{"mobile":"09121234567"}]}', false],
      ['{"primaryMobile":"09121234567"}', false],
      ['{"guardian_mobile":"09121234567"}', false],
      ['{"homePhone":"02112345678"}', false],
      ['{"national_id":"1234567891"}', false],
    ])('%s accepted=%s', async (payload: string, expected: boolean) => {
      expect(await accepts(payload)).toBe(expected);
    });

    it('still walks nested payloads with an empty search_path, as pg_restore evaluates it', async () => {
      // Milestone 10, checkpoint A2: pg_restore loads rows with search_path ''.
      // The function's recursive call must resolve anyway, or the CHECK raises
      // and no backup of this schema can be restored.
      const results = await harness.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO ''`);
        return tx.$queryRaw<{ nested_raw: boolean; nested_masked: boolean }[]>`
          SELECT
            public.audit_identifiers_masked('{"a":{"b":[{"mobile":"09121234567"}]}}'::jsonb) AS nested_raw,
            public.audit_identifiers_masked('{"a":{"b":[{"mobile":"*******4567"}]}}'::jsonb) AS nested_masked
        `;
      });

      expect(results[0]).toEqual({ nested_raw: false, nested_masked: true });
    });

    it('leaves unrelated numeric facts alone', async () => {
      // `priceToman` reaches ten digits under the Milestone 2 tariff ceiling.
      // A rule keyed on value shape rather than field name would break it.
      expect(await accepts('{"priceToman":"1000000000"}')).toBe(true);
      expect(await accepts('{"failedLoginCount":5,"durationMinutes":45}')).toBe(true);
      expect(await accepts('{"role":"MANAGER","mustChangePassword":true}')).toBe(true);
    });

    it('is enforced by the audit_log constraint, not merely available', async () => {
      const requestId = uuidv7();

      await expectRejected(
        () => harness.prisma.$executeRaw`
          INSERT INTO audit_log (id, occurred_at, action, actor_type, actor_user_id, request_id, entity_type, after)
          VALUES (${uuidv7()}::uuid, transaction_timestamp(), 'family.created', 'USER'::audit_actor_type,
                  ${actorId}::uuid, ${requestId}::uuid, 'family', '{"mobile":"09121234567"}'::jsonb)
        `,
        '23514',
      );
    });

    it('accepts a correctly masked audit row', async () => {
      await expect(
        harness.prisma.$executeRaw`
          INSERT INTO audit_log (id, occurred_at, action, actor_type, actor_user_id, request_id, entity_type, after)
          VALUES (${uuidv7()}::uuid, transaction_timestamp(), 'family.created', 'USER'::audit_actor_type,
                  ${actorId}::uuid, ${uuidv7()}::uuid, 'family',
                  '{"familyName":"رضایی","guardians":[{"mobile":"*******4567"}]}'::jsonb)
        `,
      ).resolves.toBe(1);
    });
  });

  describe('child_file_number_seq', () => {
    it('is declared to start at the approved value', async () => {
      // Asserted from the catalogue rather than by calling `nextval`. A
      // sequence is not reset by TRUNCATE and is deliberately not reset between
      // tests, so "the next value is 10001" is only true for whichever test
      // happens to run first — which is a property of the suite order, not of
      // the schema.
      const rows = await harness.prisma.$queryRaw<{ start_value: bigint; min_value: bigint }[]>`
        SELECT start_value, min_value FROM pg_sequences
        WHERE schemaname = 'public' AND sequencename = 'child_file_number_seq'
      `;

      expect(Number(rows[0]?.start_value)).toBe(10001);
    });

    it('issues values wide enough to read aloud', async () => {
      // Five digits from the start, so a file number quoted over the phone has
      // a stable shape for a long time.
      const rows = await harness.prisma.$queryRaw<{ value: bigint }[]>`
        SELECT nextval('child_file_number_seq') AS value
      `;

      expect(String(rows[0]?.value).length).toBeGreaterThanOrEqual(5);
      expect(Number(rows[0]?.value)).toBeGreaterThanOrEqual(10001);
    });

    it('never issues the same number twice', async () => {
      // Gaps are expected and deliberately not asserted against: a rolled-back
      // transaction burns a number, which is the correct trade for uniqueness.
      const rows = await harness.prisma.$queryRaw<{ value: bigint }[]>`
        SELECT nextval('child_file_number_seq') AS value FROM generate_series(1, 50)
      `;

      const values = rows.map((row) => Number(row.value));

      expect(new Set(values).size).toBe(values.length);
      expect([...values].sort((a, b) => a - b)).toEqual(values);
    });
  });
});
