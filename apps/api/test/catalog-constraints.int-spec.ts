import { Prisma } from '@prisma/client';
import { uuidv7 } from '../src/common/uuid';
import { createHarness, resetDatabase, seedUser, type Harness, ownerPrisma } from './harness';

/**
 * What the database refuses, proved against a real PostgreSQL.
 *
 * These tests write raw SQL and bypass the service layer entirely — there is no
 * catalog service yet, and that is the point: every guarantee here has to hold
 * without one. A future endpoint, a data-fix script or somebody at a psql
 * prompt is subject to the same constraints as the code that will arrive in the
 * next checkpoint.
 *
 * Everything is synthetic. No real therapist, service, room or price appears in
 * any fixture.
 */

/** SQLSTATE 23001, restrict_violation: what both protective triggers raise. */
const RESTRICT_VIOLATION = '23001';
/** SQLSTATE 23514, check_violation. */
const CHECK_VIOLATION = '23514';
/** SQLSTATE 23P01, exclusion_violation. */
const EXCLUSION_VIOLATION = '23P01';
/** SQLSTATE 23503, foreign_key_violation. */
const FOREIGN_KEY_VIOLATION = '23503';
/** SQLSTATE 23502, not_null_violation. */
const NOT_NULL_VIOLATION = '23502';

describe('catalog database constraints', () => {
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
      INSERT INTO service_duration (id, service_id, duration_minutes)
      VALUES (${uuidv7()}::uuid, ${serviceId}::uuid, 45)
    `;
    await harness.prisma.$executeRaw`
      INSERT INTO therapist (id, full_name, specialty, created_by_user_id)
      VALUES (${therapistId}::uuid, 'Synthetic Therapist', 'Synthetic Specialty', ${actorId}::uuid)
    `;
  });

  /**
   * Asserts the statement failed, and failed for the stated reason.
   *
   * Matching on SQLSTATE and the constraint name rather than "it threw" is what
   * stops a test passing because of an unrelated typo in the fixture.
   */
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

  function insertTariff(values: {
    id?: string;
    durationMinutes?: number;
    therapistId?: string | null;
    priceMode?: 'PAID' | 'FREE';
    priceToman?: bigint;
    freeReason?: string | null;
    effectiveStart?: string;
    effectiveEnd?: string | null;
  }): Promise<unknown> {
    return harness.prisma.$executeRaw`
      INSERT INTO tariff (
        id, service_id, duration_minutes, therapist_id, price_mode, price_toman,
        free_reason, effective_start, effective_end, created_by_user_id
      ) VALUES (
        ${values.id ?? uuidv7()}::uuid,
        ${serviceId}::uuid,
        ${values.durationMinutes ?? 45},
        ${values.therapistId ?? null}::uuid,
        ${values.priceMode ?? 'PAID'}::tariff_price_mode,
        ${values.priceToman ?? 120000n},
        ${values.freeReason ?? null},
        ${values.effectiveStart ?? '2026-01-01'}::date,
        ${values.effectiveEnd ?? null}::date,
        ${actorId}::uuid
      )
    `;
  }

  describe('price mode is explicit, never inferred from a zero amount', () => {
    it('accepts a paid tariff with a real price', async () => {
      await expect(insertTariff({ priceToman: 120000n })).resolves.toBeDefined();
    });

    it('accepts a free tariff at exactly zero with a stated reason', async () => {
      await expect(
        insertTariff({
          priceMode: 'FREE',
          priceToman: 0n,
          freeReason: 'complimentary screening programme',
        }),
      ).resolves.toBeDefined();
    });

    it('refuses a paid tariff priced at zero, which would be a free one in disguise', async () => {
      await expectRejection(
        insertTariff({ priceToman: 0n }),
        CHECK_VIOLATION,
        /tariff_price_mode_chk/,
      );
    });

    it('refuses a free tariff that charges money', async () => {
      await expectRejection(
        insertTariff({ priceMode: 'FREE', priceToman: 5000n, freeReason: 'campaign' }),
        CHECK_VIOLATION,
        /tariff_price_mode_chk/,
      );
    });

    it('refuses a free tariff with no reason', async () => {
      await expectRejection(
        insertTariff({ priceMode: 'FREE', priceToman: 0n, freeReason: null }),
        CHECK_VIOLATION,
        /tariff_price_mode_chk/,
      );
    });

    it('refuses a free tariff whose reason is only whitespace', async () => {
      await expectRejection(
        insertTariff({ priceMode: 'FREE', priceToman: 0n, freeReason: '   ' }),
        CHECK_VIOLATION,
        /tariff_free_reason_chk/,
      );
    });

    it('refuses a paid tariff carrying a free-programme reason', async () => {
      await expectRejection(
        insertTariff({ priceToman: 1000n, freeReason: 'why' }),
        CHECK_VIOLATION,
        /tariff_price_mode_chk/,
      );
    });

    it('refuses a price above the practical ceiling', async () => {
      await expectRejection(
        insertTariff({ priceToman: 1000000001n }),
        CHECK_VIOLATION,
        /tariff_price_bounds_chk/,
      );
    });

    it('accepts a price exactly at the ceiling', async () => {
      await expect(insertTariff({ priceToman: 1000000000n })).resolves.toBeDefined();
    });
  });

  describe('a tariff may only price a duration its service offers', () => {
    it('refuses a duration the service has not declared', async () => {
      await expectRejection(
        insertTariff({ durationMinutes: 30 }),
        FOREIGN_KEY_VIOLATION,
        /tariff_service_id_duration_minutes_fkey/,
      );
    });

    it('refuses withdrawing a duration while a tariff still prices it', async () => {
      await insertTariff({});

      await expectRejection(
        harness.prisma.$executeRaw`
          DELETE FROM service_duration WHERE service_id = ${serviceId}::uuid
        `,
        FOREIGN_KEY_VIOLATION,
        /tariff_service_id_duration_minutes_fkey/,
      );
    });
  });

  describe('two live tariffs may not cover the same scope on overlapping dates', () => {
    it('refuses an overlapping general tariff', async () => {
      await insertTariff({ effectiveStart: '2026-01-01', effectiveEnd: '2026-06-30' });

      await expectRejection(
        insertTariff({ effectiveStart: '2026-03-01', effectiveEnd: null }),
        EXCLUSION_VIOLATION,
        /tariff_no_overlap_general_excl/,
      );
    });

    it('refuses an overlapping tariff for the same therapist', async () => {
      await insertTariff({ therapistId, effectiveStart: '2026-01-01', effectiveEnd: '2026-06-30' });

      await expectRejection(
        insertTariff({ therapistId, effectiveStart: '2026-06-30', effectiveEnd: null }),
        EXCLUSION_VIOLATION,
        /tariff_no_overlap_therapist_excl/,
      );
    });

    it('allows a therapist-specific tariff alongside a general one on the same dates', async () => {
      await insertTariff({ effectiveStart: '2026-01-01', effectiveEnd: '2026-06-30' });

      // The precedence rule needs both to exist at once; this is what makes a
      // therapist-specific price able to override a general one.
      await expect(
        insertTariff({ therapistId, effectiveStart: '2026-01-01', effectiveEnd: '2026-06-30' }),
      ).resolves.toBeDefined();
    });

    it('allows adjacent ranges that do not overlap', async () => {
      await insertTariff({ effectiveStart: '2026-01-01', effectiveEnd: '2026-06-30' });

      await expect(
        insertTariff({ effectiveStart: '2026-07-01', effectiveEnd: null }),
      ).resolves.toBeDefined();
    });

    it('frees the range again once the earlier tariff is voided', async () => {
      const id = uuidv7();
      await insertTariff({ id, effectiveStart: '2026-01-01', effectiveEnd: '2026-06-30' });

      await harness.prisma.$executeRaw`
        UPDATE tariff
        SET voided_at = transaction_timestamp(), void_reason = 'price corrected'
        WHERE id = ${id}::uuid
      `;

      // A voided tariff is history: it may overlap anything, and its dates are
      // available to the replacement that supersedes it.
      await expect(
        insertTariff({ effectiveStart: '2026-01-01', effectiveEnd: '2026-06-30' }),
      ).resolves.toBeDefined();
    });
  });

  describe('a tariff is immutable once written', () => {
    let tariffId: string;

    beforeEach(async () => {
      tariffId = uuidv7();
      await insertTariff({
        id: tariffId,
        effectiveStart: '2026-01-01',
        effectiveEnd: '2026-06-30',
      });
    });

    it.each([
      ['price_toman', Prisma.sql`price_toman = 1`],
      ['price_mode', Prisma.sql`price_mode = 'FREE'::tariff_price_mode`],
      ['free_reason', Prisma.sql`free_reason = 'rewritten'`],
      ['effective_start', Prisma.sql`effective_start = DATE '2025-01-01'`],
      ['effective_end', Prisma.sql`effective_end = DATE '2027-01-01'`],
      ['duration_minutes', Prisma.sql`duration_minutes = 30`],
      ['created_at', Prisma.sql`created_at = transaction_timestamp()`],
    ])('refuses to change %s', async (_column, assignment) => {
      await expectRejection(
        harness.prisma.$executeRaw`
          UPDATE tariff SET ${assignment} WHERE id = ${tariffId}::uuid
        `,
        RESTRICT_VIOLATION,
        /immutable/,
      );
    });

    it('permits the one void transition', async () => {
      await expect(
        harness.prisma.$executeRaw`
          UPDATE tariff
          SET voided_at = transaction_timestamp(), void_reason = 'price corrected'
          WHERE id = ${tariffId}::uuid
        `,
      ).resolves.toBe(1);
    });

    it('refuses to unvoid', async () => {
      await harness.prisma.$executeRaw`
        UPDATE tariff
        SET voided_at = transaction_timestamp(), void_reason = 'price corrected'
        WHERE id = ${tariffId}::uuid
      `;

      await expectRejection(
        harness.prisma.$executeRaw`
          UPDATE tariff SET voided_at = NULL, void_reason = NULL WHERE id = ${tariffId}::uuid
        `,
        RESTRICT_VIOLATION,
        /already voided/,
      );
    });

    it('refuses to rewrite the void reason afterwards', async () => {
      await harness.prisma.$executeRaw`
        UPDATE tariff
        SET voided_at = transaction_timestamp(), void_reason = 'price corrected'
        WHERE id = ${tariffId}::uuid
      `;

      await expectRejection(
        harness.prisma.$executeRaw`
          UPDATE tariff SET void_reason = 'a different story' WHERE id = ${tariffId}::uuid
        `,
        RESTRICT_VIOLATION,
        /already voided/,
      );
    });

    it('refuses a void that states no reason', async () => {
      await expectRejection(
        harness.prisma.$executeRaw`
          UPDATE tariff SET voided_at = transaction_timestamp() WHERE id = ${tariffId}::uuid
        `,
        CHECK_VIOLATION,
        /tariff_void_consistency_chk/,
      );
    });

    it('refuses a void reason that is only whitespace', async () => {
      await expectRejection(
        harness.prisma.$executeRaw`
          UPDATE tariff
          SET voided_at = transaction_timestamp(), void_reason = '   '
          WHERE id = ${tariffId}::uuid
        `,
        CHECK_VIOLATION,
        /tariff_void_reason_chk/,
      );
    });
  });

  describe('stored names are already trimmed', () => {
    it.each([
      ['room', 'room_name_chk'],
      ['service', 'service_name_chk'],
    ])('refuses an untrimmed %s name', async (table, constraint) => {
      const statement =
        table === 'room'
          ? harness.prisma.$executeRaw`
              INSERT INTO room (id, name, created_by_user_id)
              VALUES (${uuidv7()}::uuid, '  Padded  ', ${actorId}::uuid)
            `
          : harness.prisma.$executeRaw`
              INSERT INTO service (id, name, is_public, created_by_user_id)
              VALUES (${uuidv7()}::uuid, '  Padded  ', false, ${actorId}::uuid)
            `;

      await expectRejection(statement, CHECK_VIOLATION, new RegExp(constraint));
    });

    it('refuses an untrimmed therapist name or specialty', async () => {
      await expectRejection(
        harness.prisma.$executeRaw`
          INSERT INTO therapist (id, full_name, specialty, created_by_user_id)
          VALUES (${uuidv7()}::uuid, ' Padded ', 'Specialty', ${actorId}::uuid)
        `,
        CHECK_VIOLATION,
        /therapist_full_name_chk/,
      );

      await expectRejection(
        harness.prisma.$executeRaw`
          INSERT INTO therapist (id, full_name, specialty, created_by_user_id)
          VALUES (${uuidv7()}::uuid, 'Name', ' Padded ', ${actorId}::uuid)
        `,
        CHECK_VIOLATION,
        /therapist_specialty_chk/,
      );
    });

    it('makes "Room A" and " Room A " unable to coexist', async () => {
      await harness.prisma.$executeRaw`
        INSERT INTO room (id, name, created_by_user_id)
        VALUES (${uuidv7()}::uuid, 'Room A', ${actorId}::uuid)
      `;

      // Refused by the trim constraint before the unique index is even
      // consulted — a stronger guarantee than uniqueness alone, because the
      // padded spelling can never be stored at all.
      await expectRejection(
        harness.prisma.$executeRaw`
          INSERT INTO room (id, name, created_by_user_id)
          VALUES (${uuidv7()}::uuid, ' Room A ', ${actorId}::uuid)
        `,
        CHECK_VIOLATION,
        /room_name_chk/,
      );

      expect(await harness.prisma.room.count()).toBe(1);
    });

    it('refuses a blank name outright', async () => {
      await expectRejection(
        harness.prisma.$executeRaw`
          INSERT INTO room (id, name, created_by_user_id)
          VALUES (${uuidv7()}::uuid, '', ${actorId}::uuid)
        `,
        CHECK_VIOLATION,
        /room_name_chk/,
      );
    });
  });

  describe('deactivation records when it happened', () => {
    it('refuses a deactivation timestamp on an active row', async () => {
      const roomId = uuidv7();
      await harness.prisma.$executeRaw`
        INSERT INTO room (id, name, created_by_user_id)
        VALUES (${roomId}::uuid, 'Room B', ${actorId}::uuid)
      `;

      await expectRejection(
        harness.prisma.$executeRaw`
          UPDATE room SET deactivated_at = transaction_timestamp() WHERE id = ${roomId}::uuid
        `,
        CHECK_VIOLATION,
        /room_deactivated_consistency_chk/,
      );
    });

    it('refuses deactivation that records no time', async () => {
      const roomId = uuidv7();
      await harness.prisma.$executeRaw`
        INSERT INTO room (id, name, created_by_user_id)
        VALUES (${roomId}::uuid, 'Room C', ${actorId}::uuid)
      `;

      await expectRejection(
        harness.prisma.$executeRaw`
          UPDATE room SET status = 'INACTIVE'::catalog_status WHERE id = ${roomId}::uuid
        `,
        CHECK_VIOLATION,
        /room_deactivated_consistency_chk/,
      );
    });

    it('accepts the two together', async () => {
      const roomId = uuidv7();
      await harness.prisma.$executeRaw`
        INSERT INTO room (id, name, created_by_user_id)
        VALUES (${roomId}::uuid, 'Room D', ${actorId}::uuid)
      `;

      await expect(
        harness.prisma.$executeRaw`
          UPDATE room
          SET status = 'INACTIVE'::catalog_status, deactivated_at = transaction_timestamp()
          WHERE id = ${roomId}::uuid
        `,
      ).resolves.toBe(1);
    });
  });

  describe('catalog rows are never deleted', () => {
    it.each(['therapist', 'service', 'room'])('refuses DELETE on %s', async (table) => {
      // A BEFORE DELETE trigger fires per row, so the table must not be empty
      // or the statement would succeed by deleting nothing and prove nothing.
      // `therapist` and `service` are seeded; `room` is not, so seed it here.
      if (table === 'room') {
        await harness.prisma.$executeRaw`
          INSERT INTO room (id, name, created_by_user_id)
          VALUES (${uuidv7()}::uuid, 'Doomed Room', ${actorId}::uuid)
        `;
      }

      await expectRejection(
        ownerPrisma().$executeRawUnsafe(`DELETE FROM ${table}`),
        RESTRICT_VIOLATION,
        /protected|not permitted/i,
      );
    });

    it.each(['therapist', 'service', 'room', 'tariff'])(
      'refuses TRUNCATE on %s, which bypasses row triggers',
      async (table) => {
        await expectRejection(
          ownerPrisma().$executeRawUnsafe(`TRUNCATE ${table} CASCADE`),
          RESTRICT_VIOLATION,
          /protected|not permitted/i,
        );
      },
    );

    it('refuses DELETE on tariff', async () => {
      await insertTariff({});

      await expectRejection(
        ownerPrisma().$executeRawUnsafe('DELETE FROM tariff'),
        RESTRICT_VIOLATION,
        /protected|not permitted/i,
      );

      expect(await harness.prisma.tariff.count()).toBe(1);
    });
  });

  describe('every catalog row names who created it', () => {
    it.each([
      [
        'room',
        (): Promise<unknown> =>
          harness.prisma.$executeRawUnsafe(
            `INSERT INTO room (id, name) VALUES ('${uuidv7()}'::uuid, 'Orphan Room')`,
          ),
      ],
      [
        'therapist',
        (): Promise<unknown> =>
          harness.prisma.$executeRawUnsafe(
            `INSERT INTO therapist (id, full_name, specialty) VALUES ('${uuidv7()}'::uuid, 'Orphan', 'Specialty')`,
          ),
      ],
    ])('refuses a %s with no creator', async (table, statement) => {
      // Prisma reports the failing row rather than naming the column, so the
      // SQLSTATE is what identifies this as a not-null violation. The count
      // assertion is what proves nothing was written.
      await expectRejection(statement(), NOT_NULL_VIOLATION, /Failing row contains/i);

      const [row] = await harness.prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*) AS count FROM ${table} WHERE created_by_user_id IS NULL`,
      );
      expect(Number(row?.count ?? 0)).toBe(0);
    });
  });

  describe('dates are stored as calendar days, not instants', () => {
    it('reads back the exact day that was written, across a year boundary', async () => {
      const id = uuidv7();
      await insertTariff({
        id,
        effectiveStart: '2026-12-31',
        effectiveEnd: '2027-01-01',
      });

      const [row] = await harness.prisma.$queryRaw<
        { effective_start: Date; effective_end: Date }[]
      >`SELECT effective_start, effective_end FROM tariff WHERE id = ${id}::uuid`;

      // Compared through UTC components for the same reason `iso-date.ts`
      // formats through them: the local ones answer a question a DATE cannot be
      // asked, and would shift the day either side of UTC.
      expect(row?.effective_start.toISOString().slice(0, 10)).toBe('2026-12-31');
      expect(row?.effective_end.toISOString().slice(0, 10)).toBe('2027-01-01');
    });

    it('stores a leap day unchanged', async () => {
      const id = uuidv7();
      await insertTariff({ id, effectiveStart: '2028-02-29', effectiveEnd: null });

      const [row] = await harness.prisma.$queryRaw<{ effective_start: Date }[]>`
        SELECT effective_start FROM tariff WHERE id = ${id}::uuid
      `;

      expect(row?.effective_start.toISOString().slice(0, 10)).toBe('2028-02-29');
    });

    it('refuses a range that ends before it starts', async () => {
      await expectRejection(
        insertTariff({ effectiveStart: '2026-06-30', effectiveEnd: '2026-01-01' }),
        CHECK_VIOLATION,
        /tariff_effective_range_chk/,
      );
    });
  });
});
