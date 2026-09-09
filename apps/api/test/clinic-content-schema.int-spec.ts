import {
  CLINIC_CONTENT_SLOTS,
  CLINIC_CONTENT_SLOT_SIZES,
  MEDIA_ATTACHMENT_OWNERS,
} from '@clinic/contracts';
import { createHarness, resetDatabase, type Harness } from './harness';

/**
 * The hand-written half of the checkpoint A8 migrations, pinned by name and
 * then by behaviour.
 *
 * `prisma migrate diff` sees tables, columns, indexes and foreign keys. It does
 * not see CHECK constraints, triggers or the twenty-one rows this migration
 * inserts — so the objects doing the publication, shape and privacy work here
 * are exactly the ones drift detection would let disappear silently.
 *
 * THE SECOND HALF OF THIS FILE IS THE MORE IMPORTANT ONE. Every rule the
 * services rely on is attacked with raw SQL, past every service, guard, schema
 * and controller in the application, because the question worth answering is
 * not "does the service refuse this?" but "could this row exist at all?".
 */
describe('clinic content schema objects', () => {
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

  async function constraintNames(): Promise<string[]> {
    const rows = await harness.prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE contype = 'c'
        AND conrelid::regclass::text IN ('clinic_content_entry', 'media_attachment')
    `;
    return rows.map((row) => row.conname);
  }

  async function triggerNames(): Promise<string[]> {
    const rows = await harness.prisma.$queryRaw<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger
      WHERE NOT tgisinternal AND tgrelid::regclass::text = 'clinic_content_entry'
    `;
    return rows.map((row) => row.tgname);
  }

  /** Inserts a block past every service, returning the promise. */
  function insertEntry(values: {
    slot?: string;
    position?: number;
    label?: string | null;
    eyebrow?: string | null;
    heading?: string | null;
    body?: string | null;
  }) {
    return harness.prisma.$executeRawUnsafe(
      `
        INSERT INTO clinic_content_entry (id, slot, "position", label, eyebrow, heading, body)
        VALUES (gen_random_uuid(), $1::clinic_content_slot, $2, $3, $4, $5, $6)
      `,
      values.slot ?? 'HOME_CONCERN',
      values.position ?? 0,
      values.label ?? null,
      values.eyebrow ?? null,
      values.heading ?? null,
      values.body ?? null,
    );
  }

  describe('the inventory', () => {
    it('keeps every hand-written CHECK', async () => {
      const names = await constraintNames();

      for (const expected of [
        'clinic_content_entry_label_chk',
        'clinic_content_entry_eyebrow_chk',
        'clinic_content_entry_heading_chk',
        'clinic_content_entry_body_chk',
        'clinic_content_entry_slot_size_chk',
        'media_attachment_owner_chk',
      ]) {
        expect(names).toContain(expected);
      }
    });

    it('keeps both append-only triggers', async () => {
      const names = await triggerNames();

      expect(names).toContain('clinic_content_entry_no_delete');
      expect(names).toContain('clinic_content_entry_no_truncate');
    });

    it('gives the attachment table a fifth real foreign key', async () => {
      // The A8 block owner is a genuine reference, not a loose id: an
      // attachment naming a block that does not exist is refused by PostgreSQL
      // rather than by a service that remembered to check.
      const rows = await harness.prisma.$queryRaw<{ conname: string }[]>`
        SELECT conname FROM pg_constraint
        WHERE contype = 'f'
          AND conrelid::regclass::text = 'media_attachment'
          AND confrelid::regclass::text = 'clinic_content_entry'
      `;

      expect(rows).toHaveLength(1);
    });

    it('holds no foreign key of its own, in either direction', async () => {
      // The privacy guarantee of this table is an ABSENCE, exactly as
      // `public_space`'s is. It names no therapist, room, service, appointment,
      // family or child, so no widened SELECT could produce one.
      const rows = await harness.prisma.$queryRaw<{ conname: string }[]>`
        SELECT conname FROM pg_constraint
        WHERE contype = 'f' AND conrelid::regclass::text = 'clinic_content_entry'
      `;

      expect(rows).toEqual([]);
    });
  });

  describe('the vocabulary the two tiers share', () => {
    it('declares the same nine slots in the same order as the contract', async () => {
      const rows = await harness.prisma.$queryRaw<{ label: string }[]>`
        SELECT e.enumlabel AS label
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'clinic_content_slot'
        ORDER BY e.enumsortorder
      `;

      // The ORDER matters and is asserted rather than sorted away: the public
      // read orders by this enum, so the declaration order IS the order the
      // pages render in.
      expect(rows.map((row) => row.label)).toEqual([...CLINIC_CONTENT_SLOTS]);
    });

    it('declares the same seven attachment owners as the contract', async () => {
      const rows = await harness.prisma.$queryRaw<{ label: string }[]>`
        SELECT e.enumlabel AS label
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'media_attachment_owner'
        ORDER BY e.enumsortorder
      `;

      expect(rows.map((row) => row.label).sort()).toEqual([...MEDIA_ATTACHMENT_OWNERS].sort());
    });

    it('caps each slot at exactly the size the contract states', async () => {
      // The CHECK and `CLINIC_CONTENT_SLOT_SIZES` are two statements of one
      // number. A widened CHECK with an unchanged contract, or the reverse,
      // fails here rather than producing a screen with a box the database
      // refuses to save.
      for (const slot of CLINIC_CONTENT_SLOTS) {
        const size = CLINIC_CONTENT_SLOT_SIZES[slot];

        const rows = await harness.prisma.$queryRaw<{ count: bigint }[]>`
          SELECT count(*) AS count FROM clinic_content_entry WHERE slot = ${slot}::clinic_content_slot
        `;

        expect(Number(rows[0]?.count)).toBe(size);

        // One past the end is refused by the database, not by a service.
        await expect(insertEntry({ slot, position: size })).rejects.toThrow();
      }
    });
  });

  describe('what the database refuses', () => {
    it('refuses a negative position', async () => {
      await expect(insertEntry({ slot: 'HOME_HERO', position: -1 })).rejects.toThrow();
    });

    it('refuses a second block in the same place', async () => {
      // The seed already occupies every position, so any insert at an existing
      // one is a duplicate — which is the guarantee: no sixth concern prompt
      // and no second hero.
      await expect(insertEntry({ slot: 'HOME_HERO', position: 0 })).rejects.toThrow();
    });

    it('refuses markup, an untrimmed value and an over-long value in every text column', async () => {
      const entry = await harness.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM clinic_content_entry WHERE slot = 'HOME_HERO' AND "position" = 0
      `;
      const id = entry[0]?.id as string;

      const attempts: [string, string][] = [
        ['label', '<script>alert(1)</script>'],
        ['eyebrow', '  untrimmed  '],
        ['heading', 'x'.repeat(201)],
        ['body', 'y'.repeat(4001)],
        ['heading', ''],
      ];

      for (const [column, value] of attempts) {
        await expect(
          harness.prisma.$executeRawUnsafe(
            `UPDATE clinic_content_entry SET ${column} = $1 WHERE id = $2::uuid`,
            value,
            id,
          ),
        ).rejects.toThrow();
      }
    });

    it('refuses to delete or truncate a block', async () => {
      await expect(
        harness.prisma.$executeRawUnsafe(
          `DELETE FROM clinic_content_entry WHERE slot = 'HOME_HERO'`,
        ),
      ).rejects.toThrow();

      await expect(
        harness.prisma.$executeRawUnsafe(`TRUNCATE clinic_content_entry`),
      ).rejects.toThrow();
    });

    it('refuses an attachment that names a block and something else at once', async () => {
      // The polymorphic reference is only as good as the constraint pinning it,
      // and every branch names every column. This is the A7 assertion extended
      // to the fifth owner column.
      const entry = await harness.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM clinic_content_entry LIMIT 1
      `;

      await expect(
        harness.prisma.$executeRawUnsafe(
          `
            INSERT INTO media_attachment (
              id, media_asset_id, owner_type, content_entry_id, space_id,
              "position", attached_at, attached_by_user_id
            ) VALUES (
              gen_random_uuid(), gen_random_uuid(), 'CLINIC_CONTENT_ENTRY',
              $1::uuid, gen_random_uuid(), 0, transaction_timestamp(), gen_random_uuid()
            )
          `,
          entry[0]?.id,
        ),
      ).rejects.toThrow();
    });

    it('refuses an ownerless attachment that names a block', async () => {
      const entry = await harness.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM clinic_content_entry LIMIT 1
      `;

      await expect(
        harness.prisma.$executeRawUnsafe(
          `
            INSERT INTO media_attachment (
              id, media_asset_id, owner_type, content_entry_id,
              "position", attached_at, attached_by_user_id
            ) VALUES (
              gen_random_uuid(), gen_random_uuid(), 'CLINIC_OPEN_GRAPH',
              $1::uuid, 0, transaction_timestamp(), gen_random_uuid()
            )
          `,
          entry[0]?.id,
        ),
      ).rejects.toThrow();
    });
  });
});
