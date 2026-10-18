import { Prisma } from '@prisma/client';
import { uuidv7 } from '../src/common/uuid';
import { createHarness, resetDatabase, seedUser, type Harness, ownerPrisma } from './harness';

/**
 * The Milestone 9 checkpoint A1 schema, proved against a real PostgreSQL.
 *
 * TWO JOBS IN ONE FILE, and they are different jobs. The first is the
 * INVENTORY: `prisma migrate diff` sees tables, columns, indexes and foreign
 * keys and does not see CHECK constraints or triggers, so the objects doing
 * most of the work here are exactly the ones drift detection would let
 * disappear silently. The second is the BEHAVIOUR: what the database refuses,
 * written in raw SQL and bypassing the service layer entirely, because a
 * data-fix script or somebody at a psql prompt is subject to the same rules as
 * the code.
 *
 * The rule that matters most is the opt-in: `is_public` cannot be true without
 * the approved public identity beside it, and no query is trusted to remember
 * that.
 *
 * Everything is synthetic. No real therapist, service, address or telephone
 * number appears in any fixture.
 */

/** SQLSTATE 23514, check_violation. */
const CHECK_VIOLATION = '23514';
/** SQLSTATE 23505, unique_violation. */
const UNIQUE_VIOLATION = '23505';
/** SQLSTATE 23001, restrict_violation: what the protective triggers raise. */
const RESTRICT_VIOLATION = '23001';
/** SQLSTATE 23502, not_null_violation. */
const NOT_NULL_VIOLATION = '23502';
/** The system-assigned address (M10-A10, T-010). */
const SLUG_FORMAT = /^[2-9bcdfghjkmnpqrstvwxz]{8}$/;

describe('public catalog schema objects (real PostgreSQL)', () => {
  let harness: Harness;
  let actorId: string;
  let serviceId: string;
  let therapistId: string;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase();

    const actor = await seedUser(harness, { role: 'MANAGER' });
    actorId = actor.id;
    serviceId = uuidv7();
    therapistId = uuidv7();

    await harness.prisma.$executeRaw`
      INSERT INTO service (id, name, is_public, created_by_user_id)
      VALUES (${serviceId}::uuid, 'Synthetic Service', false, ${actorId}::uuid)
    `;
    await harness.prisma.$executeRaw`
      INSERT INTO therapist (id, full_name, specialty, created_by_user_id)
      VALUES (${therapistId}::uuid, 'Synthetic Therapist', 'Synthetic Specialty', ${actorId}::uuid)
    `;

    // The singleton survives `resetDatabase` — it is truncated by nothing and
    // deleted by nobody — so each test starts it empty again rather than
    // inheriting whatever the last one wrote.
    await harness.prisma.$executeRaw`
      UPDATE clinic_public_profile
      SET display_name = NULL, tagline = NULL, about = NULL, address_line = NULL,
          city_label = NULL, phone_primary = NULL, phone_secondary = NULL, email = NULL,
          working_hours_note = NULL, map_latitude = NULL, map_longitude = NULL,
          instagram_url = NULL, telegram_url = NULL
      WHERE singleton_key = 1
    `;
  });

  async function expectRejection(
    statement: Promise<unknown>,
    sqlState: string,
    detail: RegExp,
  ): Promise<void> {
    let error: unknown;
    try {
      await statement;
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeDefined();

    const raw = error as Prisma.PrismaClientKnownRequestError;
    const meta = (raw.meta ?? {}) as { code?: string; message?: string };
    const text = `${meta.code ?? ''} ${meta.message ?? ''} ${raw.message}`;

    expect(text).toContain(sqlState);
    expect(text).toMatch(detail);
  }

  describe('the inventory', () => {
    async function constraintNames(): Promise<string[]> {
      const rows = await harness.prisma.$queryRaw<{ conname: string }[]>`
        SELECT conname FROM pg_constraint
        WHERE contype = 'c'
          AND conrelid::regclass::text IN ('service', 'therapist', 'clinic_public_profile')
      `;
      return rows.map((row) => row.conname);
    }

    it('holds every hand-written CHECK this checkpoint added', async () => {
      expect(await constraintNames()).toEqual(
        expect.arrayContaining([
          'service_public_slug_chk',
          'therapist_public_slug_chk',
          'therapist_public_display_name_chk',
          'therapist_public_title_chk',
          'therapist_public_bio_chk',
          'therapist_public_profile_chk',
          'service_public_first_published_chk',
          'therapist_public_first_published_chk',
          'clinic_public_profile_singleton_chk',
          'clinic_public_profile_text_chk',
          'clinic_public_profile_email_chk',
          'clinic_public_profile_links_chk',
          'clinic_public_profile_map_chk',
        ]),
      );
    });

    it('holds the two unique slug indexes', async () => {
      const rows = await harness.prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes
        WHERE tablename IN ('service', 'therapist')
          AND indexname IN ('service_public_slug_key', 'therapist_public_slug_key')
      `;

      expect(rows.map((row) => row.indexname).sort()).toEqual([
        'service_public_slug_key',
        'therapist_public_slug_key',
      ]);
    });

    it('protects the singleton from deletion and truncation', async () => {
      const rows = await harness.prisma.$queryRaw<{ tgname: string }[]>`
        SELECT tgname FROM pg_trigger
        WHERE NOT tgisinternal AND tgrelid::regclass::text = 'clinic_public_profile'
      `;

      expect(rows.map((row) => row.tgname).sort()).toEqual([
        'clinic_public_profile_no_delete',
        'clinic_public_profile_no_truncate',
      ]);
    });

    it('created exactly one profile row, and it is empty of owner data', async () => {
      // The migration inserts it and invents nothing. A public read is therefore
      // a lookup that cannot miss, and an unconfigured clinic reads as nulls
      // rather than as a 404 on its own contact page.
      const rows = await harness.prisma.$queryRaw<{ singleton_key: number }[]>`
        SELECT singleton_key FROM clinic_public_profile
      `;

      expect(rows).toEqual([{ singleton_key: 1 }]);
    });

    it('refuses a second profile row and a key other than one', async () => {
      await expectRejection(
        ownerPrisma().$executeRaw`INSERT INTO clinic_public_profile (singleton_key) VALUES (1)`,
        UNIQUE_VIOLATION,
        // PostgreSQL names the KEY in a unique violation, not the index, so the
        // assertion matches what the database actually says.
        /singleton_key/,
      );

      await expectRejection(
        ownerPrisma().$executeRaw`INSERT INTO clinic_public_profile (singleton_key) VALUES (2)`,
        CHECK_VIOLATION,
        /clinic_public_profile_singleton_chk/,
      );
    });

    it('refuses to delete the profile', async () => {
      await expectRejection(
        ownerPrisma().$executeRaw`DELETE FROM clinic_public_profile WHERE singleton_key = 1`,
        RESTRICT_VIOLATION,
        /clinic_public_profile/,
      );
    });
  });

  describe('slug stability (M9, tightened in M10-A10)', () => {
    async function publish(table: 'service' | 'therapist', id: string) {
      // The PUBLISHED display name, because that is the column
      // `therapist_public_profile_chk` reads from Milestone 9.5, checkpoint A6.
      // The draft beside it is not what a visitor sees and is not what the
      // opt-in is checked against.
      const extra =
        table === 'therapist' ? ", published_public_display_name = 'Synthetic Public Name'" : '';

      await harness.prisma.$executeRawUnsafe(
        `UPDATE ${table} SET is_public = TRUE${extra} WHERE id = $1::uuid`,
        id,
      );
    }

    async function stampOf(table: 'service' | 'therapist', id: string): Promise<Date | null> {
      const rows = await harness.prisma.$queryRawUnsafe<{ stamp: Date | null }[]>(
        `SELECT public_first_published_at AS stamp FROM ${table} WHERE id = $1::uuid`,
        id,
      );
      return rows[0]?.stamp ?? null;
    }

    async function slugOf(table: 'service' | 'therapist', id: string): Promise<string> {
      const rows = await harness.prisma.$queryRawUnsafe<{ public_slug: string }[]>(
        `SELECT public_slug FROM ${table} WHERE id = $1::uuid`,
        id,
      );
      return rows[0]!.public_slug;
    }

    it('carries the stability trigger on both tables, and its shared function', async () => {
      const triggers = await harness.prisma.$queryRaw<{ tgname: string }[]>`
        SELECT tgname FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgname IN ('service_public_slug_stability', 'therapist_public_slug_stability')
      `;
      expect(triggers.map((row) => row.tgname).sort()).toEqual([
        'service_public_slug_stability',
        'therapist_public_slug_stability',
      ]);

      const [fn] = await harness.prisma.$queryRaw<{ proname: string }[]>`
        SELECT proname FROM pg_proc WHERE proname = 'enforce_public_slug_stability'
      `;
      expect(fn?.proname).toBe('enforce_public_slug_stability');
    });

    it('stamps nothing while the row is private, although it has an address', async () => {
      expect(await slugOf('service', serviceId)).toMatch(SLUG_FORMAT);
      expect(await stampOf('service', serviceId)).toBeNull();

      await harness.prisma.$executeRaw`
        UPDATE therapist SET public_display_name = 'Synthetic Public Name'
        WHERE id = ${therapistId}::uuid
      `;
      expect(await stampOf('therapist', therapistId)).toBeNull();
    });

    it('refuses any change of address once assigned, published or not, on both tables', async () => {
      // No correction is left to allow: nobody types an address any more, and
      // one that could change while private could be released and reused.
      await expectRejection(
        harness.prisma
          .$executeRaw`UPDATE service SET public_slug = 'corrected' WHERE id = ${serviceId}::uuid`,
        RESTRICT_VIOLATION,
        /service\.public_slug is immutable once assigned/,
      );
      await expectRejection(
        harness.prisma
          .$executeRaw`UPDATE therapist SET public_slug = 'corrected-two' WHERE id = ${therapistId}::uuid`,
        RESTRICT_VIOLATION,
        /therapist\.public_slug is immutable once assigned/,
      );

      await publish('service', serviceId);
      await expectRejection(
        harness.prisma
          .$executeRaw`UPDATE service SET public_slug = 'moved-service' WHERE id = ${serviceId}::uuid`,
        RESTRICT_VIOLATION,
        /service\.public_slug is immutable/,
      );
    });

    it('refuses to clear an address', async () => {
      await expectRejection(
        harness.prisma
          .$executeRaw`UPDATE service SET public_slug = NULL WHERE id = ${serviceId}::uuid`,
        RESTRICT_VIOLATION,
        /service\.public_slug is immutable/,
      );
    });

    it('stamps the instant a row first becomes reachable, and never restamps', async () => {
      await publish('service', serviceId);
      const first = await stampOf('service', serviceId);
      expect(first).toBeInstanceOf(Date);

      // An unrelated edit does not move the stamp.
      await harness.prisma
        .$executeRaw`UPDATE service SET public_description = 'Synthetic.' WHERE id = ${serviceId}::uuid`;
      expect((await stampOf('service', serviceId))?.getTime()).toBe(first?.getTime());
    });

    it('refuses the unpublish-rename-republish round trip', async () => {
      const address = await slugOf('service', serviceId);
      await publish('service', serviceId);

      await harness.prisma
        .$executeRaw`UPDATE service SET is_public = FALSE WHERE id = ${serviceId}::uuid`;

      await expectRejection(
        harness.prisma
          .$executeRaw`UPDATE service SET public_slug = 'second-life' WHERE id = ${serviceId}::uuid`,
        RESTRICT_VIOLATION,
        /service\.public_slug is immutable/,
      );

      // Republishing at the SAME address is fine, and the stamp is unchanged.
      await harness.prisma
        .$executeRaw`UPDATE service SET is_public = TRUE WHERE id = ${serviceId}::uuid`;
      expect(await slugOf('service', serviceId)).toBe(address);
    });

    it('refuses to rewrite the stamp itself', async () => {
      await publish('service', serviceId);

      await expectRejection(
        harness.prisma
          .$executeRaw`UPDATE service SET public_first_published_at = transaction_timestamp() - interval '1 day' WHERE id = ${serviceId}::uuid`,
        RESTRICT_VIOLATION,
        /written once and never rewritten/,
      );
    });
  });

  describe('the address (M10-A10, T-010)', () => {
    it('is assigned on insert to every row of both tables, each its own', async () => {
      const otherId = uuidv7();
      await harness.prisma.$executeRaw`
        INSERT INTO service (id, name, is_public, created_by_user_id)
        VALUES (${otherId}::uuid, 'Second Synthetic Service', false, ${actorId}::uuid)
      `;

      const rows = await harness.prisma.$queryRaw<{ public_slug: string }[]>`
        SELECT public_slug FROM service
        UNION ALL
        SELECT public_slug FROM therapist
      `;
      expect(rows).toHaveLength(3);
      for (const row of rows) expect(row.public_slug).toMatch(SLUG_FORMAT);
      expect(new Set(rows.map((row) => row.public_slug)).size).toBe(3);
    });

    it('keeps an address given explicitly, as every row published before M10-A10 has', async () => {
      const otherId = uuidv7();
      await harness.prisma.$executeRaw`
        INSERT INTO service (id, name, is_public, public_slug, created_by_user_id)
        VALUES (${otherId}::uuid, 'Legacy Synthetic Service', false, 'synthetic-service', ${actorId}::uuid)
      `;

      const rows = await harness.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count FROM service WHERE public_slug = 'synthetic-service'
      `;
      expect(Number(rows[0]?.count ?? 0n)).toBe(1);
    });

    it('refuses a row with no address at all', async () => {
      await expectRejection(
        harness.prisma.$executeRaw`
          INSERT INTO service (id, name, is_public, public_slug, created_by_user_id)
          VALUES (${uuidv7()}::uuid, 'Addressless', false, NULL, ${actorId}::uuid)
        `,
        NOT_NULL_VIOLATION,
        /Addressless/,
      );
    });

    it('refuses anything that would make one page two strings', async () => {
      for (const invalid of [
        'A',
        'Synthetic',
        'synthetic_service',
        'synthetic--service',
        '-x',
        'x-',
        'a',
        'خدمت',
      ]) {
        await expectRejection(
          harness.prisma.$executeRaw`
            INSERT INTO service (id, name, is_public, public_slug, created_by_user_id)
            VALUES (${uuidv7()}::uuid, ${`Invalid ${invalid}`}, false, ${invalid}, ${actorId}::uuid)
          `,
          CHECK_VIOLATION,
          /service_public_slug_chk/,
        );
      }
    });

    it('refuses an address a second row already holds, private or not', async () => {
      const taken = await harness.prisma.$queryRaw<{ public_slug: string }[]>`
        SELECT public_slug FROM service WHERE id = ${serviceId}::uuid
      `;

      await expectRejection(
        harness.prisma.$executeRaw`
          INSERT INTO service (id, name, is_public, public_slug, created_by_user_id)
          VALUES (${uuidv7()}::uuid, 'Second', false, ${taken[0]!.public_slug}, ${actorId}::uuid)
        `,
        UNIQUE_VIOLATION,
        /public_slug/,
      );
    });

    it('draws only from its own alphabet, and only for the three addressed tables', async () => {
      const drawn = await harness.prisma.$queryRaw<{ slug: string }[]>`
        SELECT next_public_slug('public_article') AS slug FROM generate_series(1, 200)
      `;
      for (const { slug } of drawn) expect(slug).toMatch(SLUG_FORMAT);

      await expect(harness.prisma.$queryRaw`SELECT next_public_slug('family')`).rejects.toThrow(
        /has no public address/,
      );
    });
  });

  describe('the therapist opt-in', () => {
    it('starts every therapist private, including a brand new active one', async () => {
      const rows = await harness.prisma.$queryRaw<{ is_public: boolean; status: string }[]>`
        SELECT is_public, status::text AS status FROM therapist WHERE id = ${therapistId}::uuid
      `;

      expect(rows[0]).toEqual({ is_public: false, status: 'ACTIVE' });
    });

    it('refuses to publish a therapist with no approved public identity', async () => {
      await expectRejection(
        harness.prisma
          .$executeRaw`UPDATE therapist SET is_public = TRUE WHERE id = ${therapistId}::uuid`,
        CHECK_VIOLATION,
        /therapist_public_profile_chk/,
      );

      // The address every therapist now has from creation (M10-A10) is not an
      // identity: the approved display name is what the website prints, and
      // there is nothing to fall back to — which is what the refusal above is.
    });

    it('allows the content to be prepared while the person stays private', async () => {
      // Writing the profile and flipping the visibility are two acts, and the
      // constraint deliberately permits the first without the second.
      await harness.prisma.$executeRaw`
        UPDATE therapist
        SET public_display_name = 'Synthetic Public Name'
        WHERE id = ${therapistId}::uuid
      `;

      const rows = await harness.prisma.$queryRaw<{ is_public: boolean }[]>`
        SELECT is_public FROM therapist WHERE id = ${therapistId}::uuid
      `;
      expect(rows[0]?.is_public).toBe(false);
    });

    it('refuses untrimmed, empty and over-long approved content', async () => {
      for (const [column, constraint, value] of [
        ['public_display_name', 'therapist_public_display_name_chk', '  padded  '],
        ['public_title', 'therapist_public_title_chk', ''],
        ['public_bio', 'therapist_public_bio_chk', 'x'.repeat(4001)],
      ] as const) {
        await expectRejection(
          harness.prisma.$executeRawUnsafe(
            `UPDATE therapist SET ${column} = $1 WHERE id = $2::uuid`,
            value,
            therapistId,
          ),
          CHECK_VIOLATION,
          new RegExp(constraint),
        );
      }
    });

    it('no longer has the legacy photograph path or its constraint', async () => {
      // Dropped in the Milestone 9.5 stabilisation; a portrait is a media
      // attachment and nothing else.
      const columns = await harness.prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'therapist' AND column_name = 'public_photo_path'
      `;

      const constraints = await harness.prisma.$queryRaw<{ conname: string }[]>`
        SELECT conname FROM pg_constraint WHERE conname = 'therapist_public_photo_path_chk'
      `;

      expect(columns).toEqual([]);
      expect(constraints).toEqual([]);
    });
  });

  describe('the clinic profile', () => {
    it('accepts a complete synthetic profile', async () => {
      await harness.prisma.$executeRaw`
        UPDATE clinic_public_profile
        SET display_name = 'Synthetic Clinic',
            tagline = 'Synthetic tagline',
            about = 'Synthetic about text.',
            address_line = 'Synthetic street 0',
            city_label = 'Synthetic City',
            phone_primary = '021-00000000',
            email = 'info@example.invalid',
            working_hours_note = 'Synthetic hours',
            map_latitude = 35.7,
            map_longitude = 51.4,
            instagram_url = 'https://example.invalid/instagram',
            telegram_url = 'https://example.invalid/telegram'
        WHERE singleton_key = 1
      `;

      const rows = await harness.prisma.$queryRaw<{ display_name: string | null }[]>`
        SELECT display_name FROM clinic_public_profile WHERE singleton_key = 1
      `;
      expect(rows[0]?.display_name).toBe('Synthetic Clinic');
    });

    it('refuses half a map pin', async () => {
      // A location rendered from one coordinate would put the clinic in the sea.
      await expectRejection(
        harness.prisma
          .$executeRaw`UPDATE clinic_public_profile SET map_latitude = 35.7 WHERE singleton_key = 1`,
        CHECK_VIOLATION,
        /clinic_public_profile_map_chk/,
      );
    });

    it('refuses a coordinate outside the world', async () => {
      await expectRejection(
        harness.prisma
          .$executeRaw`UPDATE clinic_public_profile SET map_latitude = 91, map_longitude = 51.4 WHERE singleton_key = 1`,
        CHECK_VIOLATION,
        /clinic_public_profile_map_chk/,
      );
    });

    it('refuses a link that is not https, and an address that is not an e-mail', async () => {
      await expectRejection(
        harness.prisma
          .$executeRaw`UPDATE clinic_public_profile SET instagram_url = 'http://example.invalid' WHERE singleton_key = 1`,
        CHECK_VIOLATION,
        /clinic_public_profile_links_chk/,
      );

      await expectRejection(
        harness.prisma
          .$executeRaw`UPDATE clinic_public_profile SET telegram_url = 'javascript:alert(1)' WHERE singleton_key = 1`,
        CHECK_VIOLATION,
        /clinic_public_profile_links_chk/,
      );

      await expectRejection(
        harness.prisma
          .$executeRaw`UPDATE clinic_public_profile SET email = 'not an address' WHERE singleton_key = 1`,
        CHECK_VIOLATION,
        /clinic_public_profile_email_chk/,
      );
    });

    it('refuses an untrimmed or empty owner value', async () => {
      await expectRejection(
        harness.prisma
          .$executeRaw`UPDATE clinic_public_profile SET display_name = '  padded  ' WHERE singleton_key = 1`,
        CHECK_VIOLATION,
        /clinic_public_profile_text_chk/,
      );

      await expectRejection(
        harness.prisma
          .$executeRaw`UPDATE clinic_public_profile SET phone_primary = '' WHERE singleton_key = 1`,
        CHECK_VIOLATION,
        /clinic_public_profile_text_chk/,
      );
    });
  });
});
