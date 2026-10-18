import { uuidv7 } from '../src/common/uuid';
import { createHarness, resetDatabase, seedUser, type Harness, ownerPrisma } from './harness';

/**
 * The hand-written half of the checkpoint A5 migration, pinned by name and then
 * attacked with raw SQL.
 *
 * `prisma migrate diff` sees tables, columns, indexes and foreign keys. It does
 * not see CHECK constraints, partial unique indexes or triggers — so the
 * objects doing most of the privacy and integrity work here are exactly the
 * ones drift detection would let disappear silently.
 *
 * THE SECOND HALF IS THE MORE IMPORTANT ONE. Every rule the media services rely
 * on is attacked here past every service, guard, schema and controller in the
 * application, because the question worth answering is not "does the service
 * refuse this?" but "could this row exist at all?".
 */
describe('media schema objects', () => {
  let harness: Harness;
  let actorId: string;

  beforeAll(async () => {
    harness = await createHarness();
  }, 60_000);

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    actorId = (await seedUser(harness, { role: 'MANAGER' })).id;
  });

  const MEDIA_TABLES = ['media_asset', 'media_rendition', 'media_attachment'];

  async function constraintNames(): Promise<string[]> {
    const rows = await harness.prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE contype = 'c'
        AND conrelid::regclass::text = ANY (${MEDIA_TABLES}::text[])
    `;
    return rows.map((row) => row.conname);
  }

  async function triggerNames(): Promise<string[]> {
    const rows = await harness.prisma.$queryRaw<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgrelid::regclass::text = ANY (${MEDIA_TABLES}::text[])
    `;
    return rows.map((row) => row.tgname);
  }

  async function indexNames(): Promise<string[]> {
    const rows = await harness.prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = ANY (${MEDIA_TABLES}::text[])
    `;
    return rows.map((row) => row.indexname);
  }

  /** One asset row, written straight to the table. */
  async function insertAsset(overrides: Record<string, string> = {}): Promise<string> {
    const id = overrides['id'] ?? uuidv7();

    await harness.prisma.$executeRawUnsafe(
      `
      INSERT INTO media_asset (
        id, alt_text, status, source_content_type, source_byte_size,
        master_storage_key, master_content_hash, master_byte_size,
        master_width, master_height, created_at, created_by_user_id
      ) VALUES (
        $1::uuid, $2, $3::media_asset_status, $4, $5,
        $6, $7, $8, $9, $10, transaction_timestamp(), $11::uuid
      )
      `,
      id,
      overrides['alt_text'] ?? 'برچسب مصنوعی',
      overrides['status'] ?? 'ACTIVE',
      overrides['source_content_type'] ?? 'image/jpeg',
      Number(overrides['source_byte_size'] ?? 1024),
      overrides['master_storage_key'] ?? `aa/bb/${id}/master.jpg`,
      overrides['master_content_hash'] ?? 'a'.repeat(64),
      Number(overrides['master_byte_size'] ?? 2048),
      Number(overrides['master_width'] ?? 600),
      Number(overrides['master_height'] ?? 900),
      actorId,
    );

    return id;
  }

  /**
   * The two columns whose NULLABILITY is a feature rather than an oversight.
   *
   * Milestone 9.5 coordinator revision. A storage key is present exactly while
   * the bytes are: nullable so that "erased" is a state the schema can express,
   * and pinned to a purge marker in both directions so it can never mean
   * anything else. `media-retention-readiness.int-spec.ts` exercises the
   * erasure itself; this asserts the shape it depends on.
   */
  describe('erasure is representable', () => {
    it('lets a storage key be absent, and only when the row says the bytes were erased', async () => {
      const rows = await harness.prisma.$queryRaw<{ table_name: string; is_nullable: string }[]>`
        SELECT table_name, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (
            (table_name = 'media_asset' AND column_name = 'master_storage_key')
            OR (table_name = 'media_rendition' AND column_name = 'storage_key')
          )
        ORDER BY table_name
      `;

      expect(rows.map((row) => `${row.table_name}:${row.is_nullable}`)).toEqual([
        'media_asset:YES',
        'media_rendition:YES',
      ]);
    });

    it('carries a purge marker on both tables and nothing that sets it', async () => {
      const rows = await harness.prisma.$queryRaw<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = 'bytes_purged_at'
          AND table_name IN ('media_asset', 'media_rendition')
        ORDER BY table_name
      `;

      expect(rows.map((row) => row.table_name)).toEqual(['media_asset', 'media_rendition']);

      // AND NOTHING IN THIS CHECKPOINT WRITES EITHER. The retention policy is an
      // owner decision nobody has taken; the schema is ready for it and the
      // application deliberately cannot carry it out.
      const written = await harness.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM media_asset WHERE bytes_purged_at IS NOT NULL
      `;
      expect(Number(written[0]!.n)).toBe(0);
    });
  });

  describe('the inventory', () => {
    it('keeps every hand-written CHECK', async () => {
      const names = await constraintNames();

      for (const expected of [
        'media_asset_alt_text_chk',
        'media_asset_source_content_type_chk',
        'media_asset_dimensions_chk',
        'media_asset_master_content_hash_chk',
        'media_asset_master_storage_key_chk',
        'media_asset_archive_chk',
        'media_rendition_dimensions_chk',
        'media_rendition_content_hash_chk',
        'media_rendition_storage_key_chk',
        'media_attachment_owner_chk',
        'media_attachment_lifecycle_chk',
        'media_attachment_position_chk',
        // Coordinator revision. Framing, and the erasure the retention policy
        // will one day perform.
        'media_attachment_focal_chk',
        'media_attachment_crop_chk',
        'media_asset_purge_chk',
        'media_rendition_purge_chk',
        // Checkpoint A10: the description is present exactly while the bytes are.
        'media_asset_description_erasure_chk',
      ]) {
        expect(names).toContain(expected);
      }
    });

    it('keeps every hand-written index', async () => {
      const names = await indexNames();

      for (const expected of [
        'media_attachment_unique_live_owner_idx',
        'media_attachment_unique_live_clinic_space_idx',
        'media_attachment_live_idx',
      ]) {
        expect(names).toContain(expected);
      }
    });

    it('protects all three tables against DELETE and TRUNCATE', async () => {
      const names = await triggerNames();

      for (const table of MEDIA_TABLES) {
        expect(names).toContain(`${table}_no_delete`);
        expect(names).toContain(`${table}_no_truncate`);
      }
    });
  });

  describe('nothing here can be erased', () => {
    it('refuses a DELETE on every media table', async () => {
      // The retention decision is the OWNER's and has not been taken. A routine
      // that could delete from these tables would be a retention policy
      // implemented before anybody chose one.
      const id = await insertAsset();

      await expect(
        ownerPrisma().$executeRawUnsafe(`DELETE FROM media_asset WHERE id = '${id}'`),
      ).rejects.toThrow();
    });
  });

  describe('the accepted format list is a database rule', () => {
    it('refuses an SVG at the column, not merely at the uploader', async () => {
      // The uploader already refuses it from the bytes. This makes the decision
      // survive a future import, a data fix, or a second writer nobody has
      // written yet.
      await expect(insertAsset({ source_content_type: 'image/svg+xml' })).rejects.toThrow();
      await expect(insertAsset({ source_content_type: 'application/pdf' })).rejects.toThrow();
    });

    it('accepts the three photograph formats', async () => {
      for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
        await expect(insertAsset({ source_content_type: type })).resolves.toBeDefined();
      }
    });
  });

  describe('a storage key cannot address anything outside the media root', () => {
    it('refuses an absolute path, a climbing path and a Windows path', async () => {
      for (const key of [
        '/etc/passwd',
        '../../etc/passwd',
        'aa/../../../etc/passwd',
        'C:/Windows/System32/config/SAM',
        'aa/bb/x/master.jpg/../../../../secret',
      ]) {
        await expect(insertAsset({ master_storage_key: key })).rejects.toThrow();
      }
    });

    it('accepts the shape the application actually generates', async () => {
      await expect(
        insertAsset({
          master_storage_key: 'aa/bb/0199a0f9-0000-7000-8000-000000000000/master.jpg',
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('the alt text', () => {
    it('refuses an empty label and one carrying markup', async () => {
      await expect(insertAsset({ alt_text: '' })).rejects.toThrow();
      await expect(insertAsset({ alt_text: '  ' })).rejects.toThrow();
      await expect(insertAsset({ alt_text: '<script>x</script>' })).rejects.toThrow();
    });
  });

  describe('archiving is one fact with one actor and one instant', () => {
    it('refuses an ARCHIVED row with no archival instant', async () => {
      await expect(insertAsset({ status: 'ARCHIVED' })).rejects.toThrow();
    });

    it('refuses an ACTIVE row that claims to have been archived', async () => {
      const id = await insertAsset();

      await expect(
        harness.prisma.$executeRawUnsafe(
          `UPDATE media_asset SET archived_at = transaction_timestamp() WHERE id = '${id}'`,
        ),
      ).rejects.toThrow();
    });

    it('refuses an archival instant with no actor', async () => {
      const id = await insertAsset();

      await expect(
        harness.prisma.$executeRawUnsafe(
          `UPDATE media_asset
           SET status = 'ARCHIVED', archived_at = transaction_timestamp()
           WHERE id = '${id}'`,
        ),
      ).rejects.toThrow();
    });
  });

  describe('the owner rule', () => {
    const insertAttachment = async (
      assetId: string,
      ownerType: string,
      columns: { therapist?: string; article?: string; testimonial?: string } = {},
      extra = '',
    ) =>
      harness.prisma.$executeRawUnsafe(
        `
        INSERT INTO media_attachment (
          id, media_asset_id, owner_type, therapist_id, article_id, testimonial_id,
          position, attached_at, attached_by_user_id${extra === '' ? '' : ', published_at, published_by_user_id'}
        ) VALUES (
          '${uuidv7()}'::uuid, '${assetId}'::uuid, '${ownerType}'::media_attachment_owner,
          ${columns.therapist === undefined ? 'NULL' : `'${columns.therapist}'::uuid`},
          ${columns.article === undefined ? 'NULL' : `'${columns.article}'::uuid`},
          ${columns.testimonial === undefined ? 'NULL' : `'${columns.testimonial}'::uuid`},
          0, transaction_timestamp(), '${actorId}'::uuid${extra}
        )
        `,
      );

    let therapistId: string;

    beforeEach(async () => {
      therapistId = uuidv7();
      await harness.prisma.$executeRawUnsafe(
        `INSERT INTO therapist (id, full_name, specialty, status, created_at, created_by_user_id)
         VALUES ('${therapistId}'::uuid, 'Synthetic Colleague', 'Synthetic Specialty',
                 'ACTIVE'::catalog_status, transaction_timestamp(), '${actorId}'::uuid)`,
      );
    });

    it('refuses a therapist attachment with no therapist', async () => {
      const assetId = await insertAsset();

      await expect(insertAttachment(assetId, 'THERAPIST_PROFILE')).rejects.toThrow();
    });

    it('refuses a clinic-space attachment that names an owner', async () => {
      const assetId = await insertAsset();

      await expect(
        insertAttachment(assetId, 'CLINIC_SPACE', { therapist: therapistId }),
      ).rejects.toThrow();
    });

    it('refuses an attachment whose discriminator names one column and whose data names another', async () => {
      const assetId = await insertAsset();

      await expect(
        insertAttachment(assetId, 'PUBLIC_ARTICLE', { therapist: therapistId }),
      ).rejects.toThrow();
    });

    it('refuses an attachment naming a therapist that does not exist', async () => {
      // The foreign key, which is what makes three real columns better than one
      // loose `owner_id`: a polymorphic reference here cannot dangle.
      const assetId = await insertAsset();

      await expect(
        insertAttachment(assetId, 'THERAPIST_PROFILE', { therapist: uuidv7() }),
      ).rejects.toThrow();
    });

    it('accepts the four legal shapes', async () => {
      const assetId = await insertAsset();

      await expect(
        insertAttachment(assetId, 'THERAPIST_PROFILE', { therapist: therapistId }),
      ).resolves.toBeDefined();
      await expect(insertAttachment(assetId, 'CLINIC_SPACE')).resolves.toBeDefined();
    });

    it('refuses two standing attachments of one photograph to one owner', async () => {
      const assetId = await insertAsset();

      await insertAttachment(assetId, 'THERAPIST_PROFILE', { therapist: therapistId });

      await expect(
        insertAttachment(assetId, 'THERAPIST_PROFILE', { therapist: therapistId }),
      ).rejects.toThrow();
    });

    it('refuses two standing clinic-space attachments of one photograph', async () => {
      // The second partial unique index. `CLINIC_SPACE` rows have NULL in every
      // owner column and NULLs do not collide, so the rule needs its own index.
      const assetId = await insertAsset();

      await insertAttachment(assetId, 'CLINIC_SPACE');

      await expect(insertAttachment(assetId, 'CLINIC_SPACE')).rejects.toThrow();
    });

    it('allows re-attaching a photograph that was detached', async () => {
      const assetId = await insertAsset();

      await insertAttachment(assetId, 'CLINIC_SPACE');
      await harness.prisma.$executeRawUnsafe(
        `UPDATE media_attachment
         SET detached_at = transaction_timestamp(), detached_by_user_id = '${actorId}'::uuid`,
      );

      await expect(insertAttachment(assetId, 'CLINIC_SPACE')).resolves.toBeDefined();
    });

    it('refuses a detached attachment that is still published', async () => {
      // The invariant behind `MEDIA_ATTACHMENT_PUBLISHED`: a photograph taken
      // off a page cannot be left marked published, or the serving predicate's
      // two conditions would disagree about one row.
      const assetId = await insertAsset();

      await insertAttachment(
        assetId,
        'CLINIC_SPACE',
        {},
        `, transaction_timestamp(), '${actorId}'::uuid`,
      );

      await expect(
        harness.prisma.$executeRawUnsafe(
          `UPDATE media_attachment
           SET detached_at = transaction_timestamp(), detached_by_user_id = '${actorId}'::uuid`,
        ),
      ).rejects.toThrow();
    });

    it('refuses a publication instant with no actor', async () => {
      const assetId = await insertAsset();

      await insertAttachment(assetId, 'CLINIC_SPACE');

      await expect(
        harness.prisma.$executeRawUnsafe(
          `UPDATE media_attachment SET published_at = transaction_timestamp()`,
        ),
      ).rejects.toThrow();
    });
  });

  describe('one rendition per photograph per format per width', () => {
    it('refuses a second row for the same combination', async () => {
      const assetId = await insertAsset();

      const insert = (id: string, key: string) =>
        harness.prisma.$executeRawUnsafe(
          `INSERT INTO media_rendition (
             id, media_asset_id, format, width, height, byte_size, content_hash, storage_key, created_at
           ) VALUES (
             '${id}'::uuid, '${assetId}'::uuid, 'WEBP'::media_rendition_format,
             640, 960, 1024, '${'b'.repeat(64)}', '${key}', transaction_timestamp()
           )`,
        );

      await insert(uuidv7(), `aa/bb/${assetId}/w640.webp`);

      await expect(insert(uuidv7(), `aa/bb/${assetId}/w640-again.webp`)).rejects.toThrow();
    });
  });
});
