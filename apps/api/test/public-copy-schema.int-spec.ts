import { Prisma } from '@prisma/client';
import { uuidv7 } from '../src/common/uuid';
import { createHarness, resetDatabase, seedUser, type Harness } from './harness';

/**
 * The Milestone 9.5 checkpoint A6 schema, proved against a real PostgreSQL.
 *
 * TWO JOBS, as `public-catalog-schema.int-spec.ts` has. The first is the
 * INVENTORY: `prisma migrate diff` sees columns and does not see CHECK
 * constraints, so the four objects this migration adds and the one it redefines
 * are exactly what drift detection would let disappear silently. The second is
 * the BEHAVIOUR, written in raw SQL and bypassing the service layer entirely,
 * because a data-fix script or somebody at a psql prompt is subject to the same
 * rules as the code.
 *
 * THE RULE THAT MATTERS MOST IS WHICH COLUMN THE OPT-IN READS. After A6 the
 * draft display name is not what a visitor sees, so an opt-in checked against
 * it would let a manager publish a page with no name on it. No query is trusted
 * to remember that; the constraint is.
 *
 * Everything is synthetic.
 */

/** SQLSTATE 23514, check_violation. */
const CHECK_VIOLATION = '23514';

describe('public copy schema objects (real PostgreSQL)', () => {
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

    actorId = (await seedUser(harness, { role: 'MANAGER' })).id;
    serviceId = uuidv7();
    therapistId = uuidv7();

    await harness.prisma.$executeRaw`
      INSERT INTO service (id, name, is_public, created_by_user_id)
      VALUES (${serviceId}::uuid, 'Synthetic Service', false, ${actorId}::uuid)
    `;
    await harness.prisma.$executeRaw`
      INSERT INTO therapist (id, full_name, specialty, created_by_user_id)
      VALUES (
        ${therapistId}::uuid, 'Synthetic Therapist', 'Synthetic Specialty', ${actorId}::uuid
      )
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

  async function constraintsOn(table: string): Promise<string[]> {
    const rows = await harness.prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = ${table}::regclass AND contype = 'c'
    `;
    return rows.map((row) => row.conname);
  }

  describe('the inventory', () => {
    it('carries a published copy column on both tables', async () => {
      const rows = await harness.prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name IN (
            'published_public_description',
            'published_public_display_name',
            'published_public_title',
            'published_public_bio'
          )
        ORDER BY table_name, column_name
      `;

      expect(rows).toEqual([
        { table_name: 'service', column_name: 'published_public_description' },
        { table_name: 'therapist', column_name: 'published_public_bio' },
        { table_name: 'therapist', column_name: 'published_public_display_name' },
        { table_name: 'therapist', column_name: 'published_public_title' },
      ]);
    });

    it('holds every published column to the same rule as its draft', async () => {
      expect(await constraintsOn('service')).toContain('service_published_public_description_chk');

      const therapist = await constraintsOn('therapist');
      for (const name of [
        'therapist_published_public_display_name_chk',
        'therapist_published_public_title_chk',
        'therapist_published_public_bio_chk',
      ]) {
        expect(therapist).toContain(name);
      }
    });

    it('keeps the opt-in constraint under its original name', async () => {
      // Redefined, not replaced by a differently named one: a reader looking
      // for the rule A1 wrote finds it where A1 left it.
      expect(await constraintsOn('therapist')).toContain('therapist_public_profile_chk');
    });
  });

  describe('what the database refuses', () => {
    it('refuses a published description that is untrimmed, empty or too long', async () => {
      for (const value of [' padded ', '', 'x'.repeat(2001)]) {
        await expectRejection(
          harness.prisma.$executeRaw`
            UPDATE service SET published_public_description = ${value}
            WHERE id = ${serviceId}::uuid
          `,
          CHECK_VIOLATION,
          /service_published_public_description_chk/,
        );
      }
    });

    it('refuses a published biography longer than the draft may be', async () => {
      await expectRejection(
        harness.prisma.$executeRaw`
          UPDATE therapist SET published_public_bio = ${'x'.repeat(4001)}
          WHERE id = ${therapistId}::uuid
        `,
        CHECK_VIOLATION,
        /therapist_published_public_bio_chk/,
      );
    });

    it('REFUSES PUBLISHING SOMEBODY WHOSE PUBLISHED NAME IS ABSENT, whatever the draft says', async () => {
      // The rule this checkpoint moved. A draft name is not what a visitor
      // sees, so it cannot be what the opt-in is checked against.
      await expectRejection(
        harness.prisma.$executeRaw`
          UPDATE therapist
          SET is_public = TRUE,
              public_display_name = 'Synthetic Draft Name'
          WHERE id = ${therapistId}::uuid
        `,
        CHECK_VIOLATION,
        /therapist_public_profile_chk/,
      );
    });

    it('accepts publishing somebody whose PUBLISHED name is present', async () => {
      await harness.prisma.$executeRaw`
        UPDATE therapist
        SET is_public = TRUE,
            published_public_display_name = 'Synthetic Published Name'
        WHERE id = ${therapistId}::uuid
      `;

      const rows = await harness.prisma.$queryRaw<{ is_public: boolean }[]>`
        SELECT is_public FROM therapist WHERE id = ${therapistId}::uuid
      `;

      expect(rows[0]!.is_public).toBe(true);
    });

    it('refuses clearing the PUBLISHED name of somebody public, and permits clearing the draft', async () => {
      await harness.prisma.$executeRaw`
        UPDATE therapist
        SET is_public = TRUE,
            public_display_name = 'Synthetic Draft Name',
            published_public_display_name = 'Synthetic Published Name'
        WHERE id = ${therapistId}::uuid
      `;

      await expectRejection(
        harness.prisma.$executeRaw`
          UPDATE therapist SET published_public_display_name = NULL
          WHERE id = ${therapistId}::uuid
        `,
        CHECK_VIOLATION,
        /therapist_public_profile_chk/,
      );

      // The draft, on the other hand, is nobody's live page.
      await harness.prisma.$executeRaw`
        UPDATE therapist SET public_display_name = NULL WHERE id = ${therapistId}::uuid
      `;

      const rows = await harness.prisma.$queryRaw<{ is_public: boolean }[]>`
        SELECT is_public FROM therapist WHERE id = ${therapistId}::uuid
      `;

      expect(rows[0]!.is_public).toBe(true);
    });

    it('leaves the slug rule standing beside the redefined constraint', async () => {
      // A6 touched neither the stability trigger nor its stamp; M10-A10
      // tightened the trigger to "immutable once assigned". Restated here
      // because the constraint beside it was redefined, and a reader should be
      // able to see that the address rule did not move with it.
      await harness.prisma.$executeRaw`
        UPDATE therapist
        SET is_public = TRUE,
            published_public_display_name = 'Synthetic Published Name'
        WHERE id = ${therapistId}::uuid
      `;

      await expectRejection(
        harness.prisma.$executeRaw`
          UPDATE therapist SET public_slug = 'a-different-address'
          WHERE id = ${therapistId}::uuid
        `,
        '23001',
        /public_slug/,
      );
    });
  });
});
