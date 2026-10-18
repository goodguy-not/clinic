import { MEDIA_ATTACHMENT_OWNERS } from '@clinic/contracts';
import { uuidv7 } from '../src/common/uuid';
import { createHarness, resetDatabase, seedUser, type Harness, ownerPrisma } from './harness';

/**
 * The hand-written half of the checkpoint A9 migrations, pinned by name and
 * then by behaviour.
 *
 * `prisma migrate diff` sees tables, columns, indexes and foreign keys. It does
 * not see CHECK constraints — so the object doing the work here,
 * `media_attachment_owner_chk`, is exactly the one drift detection would let
 * disappear silently.
 *
 * THE SECOND HALF OF THIS FILE IS THE MORE IMPORTANT ONE. Every rule the media
 * services rely on is attacked with raw SQL, past every service, guard, schema
 * and controller in the application, because the question worth answering is
 * not "does the service refuse this?" but "could this row exist at all?".
 */
describe('service imagery schema objects', () => {
  let harness: Harness;
  let actorId: string;
  let serviceId: string;

  beforeAll(async () => {
    harness = await createHarness();
  }, 60_000);

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    actorId = (await seedUser(harness, { role: 'MANAGER' })).id;
    serviceId = await insertService();
  });

  /** One service row, written straight to the table. */
  async function insertService(): Promise<string> {
    const id = uuidv7();

    await harness.prisma.$executeRawUnsafe(
      `
      INSERT INTO service (
        id, name, public_description, is_public, status,
        created_at, created_by_user_id
      ) VALUES (
        $1::uuid, $2, NULL, FALSE, 'ACTIVE'::catalog_status,
        transaction_timestamp(), $3::uuid
      )
      `,
      id,
      `Synthetic service ${id.slice(-8)}`,
      actorId,
    );

    return id;
  }

  /** One asset row, written straight to the table. */
  async function insertAsset(): Promise<string> {
    const id = uuidv7();

    await harness.prisma.$executeRawUnsafe(
      `
      INSERT INTO media_asset (
        id, alt_text, status, source_content_type, source_byte_size,
        master_storage_key, master_content_hash, master_byte_size,
        master_width, master_height, created_at, created_by_user_id
      ) VALUES (
        $1::uuid, 'برچسب مصنوعی', 'ACTIVE'::media_asset_status, 'image/jpeg', 1024,
        $2, $3, 2048, 600, 900, transaction_timestamp(), $4::uuid
      )
      `,
      id,
      `aa/bb/${id}/master.jpg`,
      'a'.repeat(64),
      actorId,
    );

    return id;
  }

  /**
   * One attachment row, with every owner column stated explicitly.
   *
   * Raw SQL and `Unsafe` on purpose: the point is to write shapes the
   * application's own `normalizeOwner` would never produce, and to find out
   * whether the DATABASE refuses them.
   */
  function insertAttachment(
    assetId: string,
    ownerType: string,
    columns: {
      therapist?: string;
      article?: string;
      testimonial?: string;
      space?: string;
      contentEntry?: string;
      service?: string;
    } = {},
  ) {
    const value = (id: string | undefined) => (id === undefined ? 'NULL' : `'${id}'::uuid`);

    return harness.prisma.$executeRawUnsafe(
      `
      INSERT INTO media_attachment (
        id, media_asset_id, owner_type, therapist_id, article_id, testimonial_id,
        space_id, content_entry_id, service_id, position, attached_at, attached_by_user_id
      ) VALUES (
        '${uuidv7()}'::uuid, '${assetId}'::uuid, '${ownerType}'::media_attachment_owner,
        ${value(columns.therapist)}, ${value(columns.article)}, ${value(columns.testimonial)},
        ${value(columns.space)}, ${value(columns.contentEntry)}, ${value(columns.service)},
        0, transaction_timestamp(), '${actorId}'::uuid
      )
      `,
    );
  }

  describe('the enum and the storage', () => {
    it('carries every owner label the contract names, and no other', async () => {
      // The enum and `MEDIA_ATTACHMENT_OWNERS` are two statements of one
      // vocabulary. A label added to either alone is a shape one tier can
      // write and the other cannot read.
      const rows = await harness.prisma.$queryRaw<{ label: string }[]>`
        SELECT enumlabel AS label
        FROM pg_enum
        WHERE enumtypid = 'media_attachment_owner'::regtype
        ORDER BY enumsortorder
      `;

      expect(new Set(rows.map((row) => row.label))).toEqual(new Set(MEDIA_ATTACHMENT_OWNERS));
      expect(rows.map((row) => row.label)).toContain('PUBLIC_SERVICE');
    });

    it('keeps the service reference nullable, restricted and indexed', async () => {
      const column = await harness.prisma.$queryRaw<{ is_nullable: string; data_type: string }[]>`
        SELECT is_nullable, data_type
        FROM information_schema.columns
        WHERE table_name = 'media_attachment' AND column_name = 'service_id'
      `;

      // Nullable because seven of the eight owner types do not use it, and the
      // CHECK below is what makes "nullable" mean "exactly when it should be".
      expect(column[0]).toEqual({ is_nullable: 'YES', data_type: 'uuid' });

      const foreignKey = await harness.prisma.$queryRaw<{ definition: string }[]>`
        SELECT pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conname = 'media_attachment_service_id_fkey'
      `;

      // RESTRICT, like every other attachment owner: the photograph must never
      // be the thing that makes a catalog row deletable.
      expect(foreignKey[0]?.definition).toContain('REFERENCES service(id)');
      expect(foreignKey[0]?.definition).toContain('ON DELETE RESTRICT');

      const indexes = await harness.prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes WHERE tablename = 'media_attachment'
      `;

      expect(indexes.map((row) => row.indexname)).toContain(
        'media_attachment_service_id_position_idx',
      );
    });

    it('keeps the owner CHECK, which drift detection cannot see', async () => {
      const rows = await harness.prisma.$queryRaw<{ conname: string }[]>`
        SELECT conname FROM pg_constraint
        WHERE contype = 'c' AND conrelid = 'media_attachment'::regclass
      `;

      expect(rows.map((row) => row.conname)).toContain('media_attachment_owner_chk');
    });
  });

  describe('the owner rule, attacked with raw SQL', () => {
    it('accepts a PUBLIC_SERVICE attachment that names exactly one service', async () => {
      const assetId = await insertAsset();

      await expect(
        insertAttachment(assetId, 'PUBLIC_SERVICE', { service: serviceId }),
      ).resolves.toBeDefined();
    });

    it('refuses a PUBLIC_SERVICE attachment that names no service', async () => {
      // `PUBLIC_SERVICE` is not one of the ownerless pair. A row with no
      // service to consult would be a photograph no publication act could ever
      // withdraw, which is precisely the coupling this owner type exists to
      // avoid.
      const assetId = await insertAsset();

      await expect(insertAttachment(assetId, 'PUBLIC_SERVICE')).rejects.toThrow();
    });

    it('refuses a PUBLIC_SERVICE attachment that also names another owner', async () => {
      const assetId = await insertAsset();
      const therapistId = uuidv7();

      await harness.prisma.$executeRawUnsafe(
        `INSERT INTO therapist (id, full_name, specialty, status, created_at, created_by_user_id)
         VALUES ('${therapistId}'::uuid, 'Synthetic Colleague', 'Synthetic Specialty',
                 'ACTIVE'::catalog_status, transaction_timestamp(), '${actorId}'::uuid)`,
      );

      await expect(
        insertAttachment(assetId, 'PUBLIC_SERVICE', {
          service: serviceId,
          therapist: therapistId,
        }),
      ).rejects.toThrow();
    });

    it('refuses every other owner type that smuggles a service id', async () => {
      // The reason the CHECK is REDEFINED over all eight branches rather than
      // extended with one: without naming `service_id` in every branch, a
      // `PUBLIC_ARTICLE` row could also carry one and two reads would disagree
      // about what it is attached to.
      const assetId = await insertAsset();

      for (const ownerType of ['CLINIC_SPACE', 'CLINIC_OPEN_GRAPH', 'THERAPIST_PROFILE']) {
        await expect(
          insertAttachment(assetId, ownerType, { service: serviceId }),
        ).rejects.toThrow();
      }
    });

    it('refuses a PUBLIC_SERVICE attachment naming a service that does not exist', async () => {
      // The foreign key, which is what makes six real columns better than one
      // loose `owner_id`: a polymorphic reference here cannot dangle.
      const assetId = await insertAsset();

      await expect(
        insertAttachment(assetId, 'PUBLIC_SERVICE', { service: uuidv7() }),
      ).rejects.toThrow();
    });

    it('refuses to let a photographed service be deleted', async () => {
      // Two guards agree here, and either alone would be enough: the Milestone
      // 2 `service_no_delete` trigger, and this checkpoint's RESTRICT. A
      // service row is never deleted in this product, and an attachment must
      // not become a reason to try.
      const assetId = await insertAsset();
      await insertAttachment(assetId, 'PUBLIC_SERVICE', { service: serviceId });

      await expect(
        ownerPrisma().$executeRawUnsafe(`DELETE FROM service WHERE id = '${serviceId}'`),
      ).rejects.toThrow();
    });
  });
});
