import { TESTIMONIAL_KINDS } from '@clinic/contracts';
import { uuidv7 } from '../src/common/uuid';
import { createHarness, resetDatabase, seedUser, type Harness, ownerPrisma } from './harness';

/**
 * The hand-written half of the checkpoint A7 migrations, pinned by name and
 * then by behaviour.
 *
 * `prisma migrate diff` sees tables, columns, indexes and foreign keys. It does
 * not see CHECK constraints or triggers — so the objects doing the publication
 * and privacy work here are exactly the ones drift detection would let
 * disappear silently.
 *
 * THE SECOND HALF OF THIS FILE IS THE MORE IMPORTANT ONE. Every rule the
 * services rely on is attacked with raw SQL, past every service, guard, schema
 * and controller in the application, because the question worth answering is
 * not "does the service refuse this?" but "could this row exist at all?".
 */
describe('public space schema objects', () => {
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
    actorId = (await seedUser(harness, { role: 'MANAGER' })).id;
  });

  async function constraintNames(): Promise<string[]> {
    const rows = await harness.prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE contype = 'c'
        AND conrelid::regclass::text IN ('public_space', 'public_testimonial', 'media_attachment')
    `;
    return rows.map((row) => row.conname);
  }

  async function triggerNames(): Promise<string[]> {
    const rows = await harness.prisma.$queryRaw<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger
      WHERE NOT tgisinternal AND tgrelid::regclass::text = 'public_space'
    `;
    return rows.map((row) => row.tgname);
  }

  /** Inserts a space with the triggers in force, returning the promise. */
  function insertSpace(values: {
    name?: string;
    description?: string | null;
    displayOrder?: number;
    publishedName?: string | null;
    publishedDisplayOrder?: number | null;
    isPublic?: boolean;
  }) {
    return harness.prisma.$executeRaw`
      INSERT INTO public_space (
        id, name, description, display_order,
        published_name, published_description, published_display_order,
        is_public, created_at, created_by_user_id
      ) VALUES (
        ${uuidv7()}::uuid,
        ${values.name ?? 'Synthetic space'},
        ${values.description ?? null},
        ${values.displayOrder ?? 0},
        ${values.publishedName ?? null},
        NULL,
        ${values.publishedDisplayOrder ?? null},
        ${values.isPublic ?? false},
        transaction_timestamp(),
        ${actorId}::uuid
      )
    `;
  }

  describe('the inventory', () => {
    it('keeps every hand-written CHECK', async () => {
      const names = await constraintNames();

      for (const expected of [
        'public_space_name_chk',
        'public_space_description_chk',
        'public_space_published_name_chk',
        'public_space_published_description_chk',
        'public_space_display_order_chk',
        'public_space_published_copy_chk',
        'public_space_public_revised_chk',
        'public_testimonial_handwritten_body_chk',
        'media_attachment_owner_chk',
      ]) {
        expect(names).toContain(expected);
      }
    });

    it('keeps the publication stamp and both append-only triggers', async () => {
      const names = await triggerNames();

      expect(names).toContain('public_space_first_publication');
      expect(names).toContain('public_space_no_delete');
      expect(names).toContain('public_space_no_truncate');
    });

    it('gives the attachment table a fourth real foreign key', async () => {
      // The A7 owner is a genuine reference, not a loose id: an attachment
      // naming a space that does not exist is refused by PostgreSQL rather than
      // by a service that remembered to check.
      const rows = await harness.prisma.$queryRaw<{ conname: string }[]>`
        SELECT conname FROM pg_constraint
        WHERE contype = 'f'
          AND conrelid::regclass::text = 'media_attachment'
          AND confrelid::regclass::text = 'public_space'
      `;

      expect(rows).toHaveLength(1);
    });

    it('states both testimonial kinds identically in PostgreSQL and the contract', async () => {
      const rows = await harness.prisma.$queryRaw<{ label: string }[]>`
        SELECT enumlabel AS label FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'testimonial_kind'
        ORDER BY e.enumsortorder
      `;

      expect(rows.map((row) => row.label)).toEqual([...TESTIMONIAL_KINDS]);
    });

    it('states every attachment owner in PostgreSQL, A7 fifth and A8 last', async () => {
      const rows = await harness.prisma.$queryRaw<{ label: string }[]>`
        SELECT enumlabel AS label FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'media_attachment_owner'
        ORDER BY e.enumsortorder
      `;

      // The last three arrived after A7 and are asserted HERE, in the A7 suite,
      // deliberately: this list is the one place the whole owner vocabulary is
      // written out in declaration order, and a checkpoint that adds a label
      // without reading it would be a checkpoint that could quietly widen what
      // a photograph may hang off. `CLINIC_CONTENT_ENTRY` names an editorial
      // block; `CLINIC_OPEN_GRAPH` is ownerless like `CLINIC_SPACE`;
      // `PUBLIC_SERVICE` (checkpoint A9) names a `service` row and is gated on
      // that service being publicly reachable.
      expect(rows.map((row) => row.label)).toEqual([
        'THERAPIST_PROFILE',
        'PUBLIC_ARTICLE',
        'PUBLIC_TESTIMONIAL',
        'CLINIC_SPACE',
        'PUBLIC_SPACE',
        'CLINIC_CONTENT_ENTRY',
        'CLINIC_OPEN_GRAPH',
        'PUBLIC_SERVICE',
      ]);
    });
  });

  describe('the rules, attacked with raw SQL', () => {
    it('refuses a public space with no published copy', async () => {
      // THE FLAG ALONE CANNOT PUBLISH A DRAFT, and it is the database saying so
      // rather than the service.
      await expect(insertSpace({ isPublic: true })).rejects.toThrow();
    });

    it('accepts a public space whose published copy is written', async () => {
      await expect(
        insertSpace({
          isPublic: true,
          publishedName: 'Synthetic published name',
          publishedDisplayOrder: 0,
        }),
      ).resolves.toBeDefined();
    });

    it('refuses markup in the draft copy and in the published copy alike', async () => {
      await expect(insertSpace({ name: 'Synthetic <b>name</b>' })).rejects.toThrow();
      await expect(
        insertSpace({ description: 'Synthetic <script>alert(1)</script>' }),
      ).rejects.toThrow();
      await expect(
        insertSpace({
          isPublic: true,
          publishedName: 'Synthetic <b>published</b>',
          publishedDisplayOrder: 0,
        }),
      ).rejects.toThrow();
    });

    it('refuses an untrimmed or empty name', async () => {
      await expect(insertSpace({ name: '  Synthetic  ' })).rejects.toThrow();
      await expect(insertSpace({ name: '' })).rejects.toThrow();
    });

    it('refuses an out-of-range display order', async () => {
      await expect(insertSpace({ displayOrder: -1 })).rejects.toThrow();
      await expect(insertSpace({ displayOrder: 1001 })).rejects.toThrow();
    });

    it('stamps the first publication once and refuses to rewrite it', async () => {
      const id = uuidv7();

      await harness.prisma.$executeRaw`
        INSERT INTO public_space (
          id, name, display_order, published_name, published_display_order,
          is_public, created_at, created_by_user_id
        ) VALUES (
          ${id}::uuid, 'Synthetic space', 0, 'Synthetic space', 0,
          TRUE, transaction_timestamp(), ${actorId}::uuid
        )
      `;

      const stamped = await harness.prisma.$queryRaw<{ at: Date | null }[]>`
        SELECT public_first_published_at AS at FROM public_space WHERE id = ${id}::uuid
      `;
      expect(stamped[0]?.at).not.toBeNull();

      await expect(
        harness.prisma.$executeRaw`
          UPDATE public_space SET public_first_published_at = transaction_timestamp() - interval '1 day'
          WHERE id = ${id}::uuid
        `,
      ).rejects.toThrow();
    });

    it('refuses a DELETE and a TRUNCATE', async () => {
      const id = uuidv7();
      await harness.prisma.$executeRaw`
        INSERT INTO public_space (id, name, display_order, is_public, created_at, created_by_user_id)
        VALUES (${id}::uuid, 'Synthetic space', 0, FALSE, transaction_timestamp(), ${actorId}::uuid)
      `;

      await expect(
        ownerPrisma().$executeRaw`DELETE FROM public_space WHERE id = ${id}::uuid`,
      ).rejects.toThrow();
      await expect(
        ownerPrisma().$executeRawUnsafe('TRUNCATE public_space CASCADE'),
      ).rejects.toThrow();
    });

    it('refuses an attachment that names two owners at once', async () => {
      // THE REDEFINED OWNER RULE. Every branch names every column, so a
      // `PUBLIC_SPACE` attachment cannot also carry an article id and leave two
      // reads disagreeing about what it is attached to.
      const spaceId = uuidv7();
      await harness.prisma.$executeRaw`
        INSERT INTO public_space (id, name, display_order, is_public, created_at, created_by_user_id)
        VALUES (${spaceId}::uuid, 'Synthetic space', 0, FALSE, transaction_timestamp(), ${actorId}::uuid)
      `;

      const articleId = uuidv7();
      await harness.prisma.$executeRaw`
        INSERT INTO public_article (
          id, public_slug, title, body, is_public, created_at, created_by_user_id
        ) VALUES (
          ${articleId}::uuid, 'synthetic-article', 'Synthetic', 'Synthetic body',
          FALSE, transaction_timestamp(), ${actorId}::uuid
        )
      `;

      await expect(
        harness.prisma.$executeRaw`
          INSERT INTO media_attachment (
            id, media_asset_id, owner_type, article_id, space_id, position,
            attached_at, attached_by_user_id
          ) VALUES (
            ${uuidv7()}::uuid, ${uuidv7()}::uuid, 'PUBLIC_SPACE'::media_attachment_owner,
            ${articleId}::uuid, ${spaceId}::uuid, 0,
            transaction_timestamp(), ${actorId}::uuid
          )
        `,
      ).rejects.toThrow();
    });

    it('refuses a PUBLIC_SPACE attachment that names no space', async () => {
      await expect(
        harness.prisma.$executeRaw`
          INSERT INTO media_attachment (
            id, media_asset_id, owner_type, position, attached_at, attached_by_user_id
          ) VALUES (
            ${uuidv7()}::uuid, ${uuidv7()}::uuid, 'PUBLIC_SPACE'::media_attachment_owner, 0,
            transaction_timestamp(), ${actorId}::uuid
          )
        `,
      ).rejects.toThrow();
    });

    it('still refuses a CLINIC_SPACE attachment that names a space', async () => {
      // The A5 slot is ownerless and stays ownerless. The two owner types are
      // opposites despite the similar names, and the constraint says so.
      const spaceId = uuidv7();
      await harness.prisma.$executeRaw`
        INSERT INTO public_space (id, name, display_order, is_public, created_at, created_by_user_id)
        VALUES (${spaceId}::uuid, 'Synthetic space', 0, FALSE, transaction_timestamp(), ${actorId}::uuid)
      `;

      await expect(
        harness.prisma.$executeRaw`
          INSERT INTO media_attachment (
            id, media_asset_id, owner_type, space_id, position, attached_at, attached_by_user_id
          ) VALUES (
            ${uuidv7()}::uuid, ${uuidv7()}::uuid, 'CLINIC_SPACE'::media_attachment_owner,
            ${spaceId}::uuid, 0, transaction_timestamp(), ${actorId}::uuid
          )
        `,
      ).rejects.toThrow();
    });
  });

  describe('the separation from operational rooms', () => {
    it('holds no foreign key between public_space and room, in either direction', async () => {
      const rows = await harness.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count FROM pg_constraint
        WHERE contype = 'f'
          AND (
            (conrelid::regclass::text = 'public_space' AND confrelid::regclass::text = 'room')
            OR (conrelid::regclass::text = 'room' AND confrelid::regclass::text = 'public_space')
          )
      `;

      expect(Number(rows[0]?.count)).toBe(0);
    });

    it('gives public_space exactly the columns the checkpoint decided on', async () => {
      // NO capacity, NO equipment, NO floor, NO area, NO opening hours, NO
      // accessibility claim, NO service link and NO room reference. Stated as an
      // exact list so that adding one has to be a deliberate edit here.
      const rows = await harness.prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'public_space'
        ORDER BY column_name
      `;

      expect(rows.map((row) => row.column_name)).toEqual([
        'created_at',
        'created_by_user_id',
        'description',
        'display_order',
        'id',
        'is_public',
        'name',
        'public_first_published_at',
        'public_revised_at',
        'published_description',
        'published_display_order',
        'published_name',
      ]);
    });
  });
});
