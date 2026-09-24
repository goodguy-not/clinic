import { TESTIMONIAL_STATUSES } from '@clinic/contracts';
import { uuidv7 } from '../src/common/uuid';
import { createHarness, resetDatabase, seedUser, type Harness } from './harness';

/**
 * The hand-written half of the checkpoint A2 migration, pinned by name and then
 * by behaviour.
 *
 * `prisma migrate diff` sees tables, columns, indexes and foreign keys. It does
 * not see CHECK constraints, functions or triggers — so the objects doing most
 * of the privacy and integrity work here are exactly the ones drift detection
 * would let disappear silently.
 *
 * THE SECOND HALF OF THIS FILE IS THE MORE IMPORTANT ONE. Every rule the
 * services rely on is attacked here with raw SQL, past every service, guard,
 * schema and controller in the application — because the question worth
 * answering is not "does the service refuse this?" but "could this row exist at
 * all?".
 */
describe('public content schema objects', () => {
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
        AND conrelid::regclass::text IN ('public_article', 'public_testimonial', 'service', 'therapist')
    `;
    return rows.map((row) => row.conname);
  }

  async function triggerNames(): Promise<string[]> {
    const rows = await harness.prisma.$queryRaw<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgrelid::regclass::text IN ('public_article', 'public_testimonial')
    `;
    return rows.map((row) => row.tgname);
  }

  describe('the inventory', () => {
    it('keeps every hand-written CHECK', async () => {
      const names = await constraintNames();

      for (const expected of [
        'public_article_public_slug_chk',
        'public_article_title_chk',
        'public_article_summary_chk',
        'public_article_body_chk',
        'public_article_published_title_chk',
        'public_article_published_summary_chk',
        'public_article_published_body_chk',
        'public_article_published_copy_chk',
        'public_article_public_revised_chk',
        'public_testimonial_author_label_chk',
        'public_testimonial_body_chk',
        'public_testimonial_approval_chk',
        'public_testimonial_public_revised_chk',
        // The sitemap column on the two A1 tables.
        'service_public_revised_chk',
        'therapist_public_revised_chk',
      ]) {
        expect(names).toContain(expected);
      }
    });

    it('keeps every trigger, including the two that refuse deletion', async () => {
      const names = await triggerNames();

      for (const expected of [
        // The A1 function, reused unchanged on a third table.
        'public_article_public_slug_stability',
        'public_testimonial_first_publication',
        'public_article_no_delete',
        'public_article_no_truncate',
        'public_testimonial_no_delete',
        'public_testimonial_no_truncate',
      ]) {
        expect(names).toContain(expected);
      }
    });

    it('reuses the A1 slug-stability function rather than copying it', async () => {
      // One function, three tables. The rule is stated once and cannot drift
      // between a service, a person and an article.
      const rows = await harness.prisma.$queryRaw<{ tgrelid: string }[]>`
        SELECT tgrelid::regclass::text AS tgrelid FROM pg_trigger
        WHERE tgfoid = 'enforce_public_slug_stability'::regproc AND NOT tgisinternal
      `;

      expect(rows.map((row) => row.tgrelid).sort()).toEqual([
        'public_article',
        'service',
        'therapist',
      ]);
    });

    it('matches the testimonial status enum to the contract', async () => {
      const rows = await harness.prisma.$queryRaw<{ value: string }[]>`
        SELECT unnest(enum_range(NULL::testimonial_status))::text AS value
      `;

      expect(rows.map((row) => row.value)).toEqual([...TESTIMONIAL_STATUSES]);
    });
  });

  describe('a draft cannot become public by accident', () => {
    async function insertTestimonial(
      status: 'DRAFT' | 'APPROVED',
      isPublic: boolean,
      approvedAt: Date | null,
    ): Promise<void> {
      await harness.prisma.$executeRaw`
        INSERT INTO public_testimonial (
          id, author_label, body, status, approved_at, is_public, created_by_user_id
        ) VALUES (
          ${uuidv7()}::uuid, NULL, 'Synthetic body.', ${status}::testimonial_status,
          ${approvedAt}, ${isPublic}, ${actorId}::uuid
        )
      `;
    }

    it('refuses a public testimonial that is not approved', async () => {
      await expect(insertTestimonial('DRAFT', true, null)).rejects.toThrow();
    });

    it('refuses an approved testimonial with no approval instant, and the reverse', async () => {
      // `(status = 'APPROVED') = (approved_at IS NOT NULL)`. Either half alone
      // would let "approved" mean something a reader could not check.
      await expect(insertTestimonial('APPROVED', false, null)).rejects.toThrow();
      await expect(insertTestimonial('DRAFT', false, new Date())).rejects.toThrow();
    });

    it('accepts the two states that are legitimate', async () => {
      await expect(insertTestimonial('DRAFT', false, null)).resolves.toBeUndefined();
      await expect(insertTestimonial('APPROVED', true, new Date())).resolves.toBeUndefined();
    });
  });

  describe('no markup is storable', () => {
    it('refuses a less-than sign in every public prose column', async () => {
      const attempts: [string, string][] = [
        [
          'title',
          `INSERT INTO public_article (id, public_slug, title, body, created_by_user_id)
          VALUES (gen_random_uuid(), 'markup-title', '<b>x</b>', 'Synthetic.', '${actorId}')`,
        ],
        [
          'summary',
          `INSERT INTO public_article (id, public_slug, title, summary, body, created_by_user_id)
          VALUES (gen_random_uuid(), 'markup-summary', 'Synthetic', '<i>x</i>', 'Synthetic.', '${actorId}')`,
        ],
        [
          'body',
          `INSERT INTO public_article (id, public_slug, title, body, created_by_user_id)
          VALUES (gen_random_uuid(), 'markup-body', 'Synthetic', '<script>x</script>', '${actorId}')`,
        ],
        [
          'testimonial body',
          `INSERT INTO public_testimonial (id, body, created_by_user_id)
          VALUES (gen_random_uuid(), '<img src=x>', '${actorId}')`,
        ],
        [
          'author label',
          `INSERT INTO public_testimonial (id, author_label, body, created_by_user_id)
          VALUES (gen_random_uuid(), '<a href=x>', 'Synthetic.', '${actorId}')`,
        ],
      ];

      for (const [, statement] of attempts) {
        await expect(harness.prisma.$executeRawUnsafe(statement)).rejects.toThrow();
      }
    });
  });

  describe('the article slug', () => {
    // A public row must carry a published copy, so the fixture writes one — the
    // same thing `setPublication` does, in the same statement, for the same
    // reason the CHECK demands it.
    async function insertArticle(slug: string, isPublic = false): Promise<string> {
      const id = uuidv7();
      await harness.prisma.$executeRaw`
        INSERT INTO public_article (
          id, public_slug, title, body, published_title, published_body,
          is_public, created_by_user_id
        ) VALUES (
          ${id}::uuid, ${slug}, 'Synthetic', 'Synthetic body.',
          ${isPublic ? 'Synthetic' : null}, ${isPublic ? 'Synthetic body.' : null},
          ${isPublic}, ${actorId}::uuid
        )
      `;
      return id;
    }

    it('is stamped at the first publication and never rewritten', async () => {
      const id = await insertArticle('stamped', true);

      const rows = await harness.prisma.$queryRaw<{ stamp: Date | null }[]>`
        SELECT public_first_published_at AS stamp FROM public_article WHERE id = ${id}::uuid
      `;

      expect(rows[0]!.stamp).not.toBeNull();

      await expect(
        harness.prisma.$executeRaw`
          UPDATE public_article SET public_first_published_at = NOW() WHERE id = ${id}::uuid
        `,
      ).rejects.toThrow();
    });

    it('cannot be changed once the row has been reachable, even in raw SQL', async () => {
      const id = await insertArticle('immutable-address', true);

      await expect(
        harness.prisma.$executeRaw`
          UPDATE public_article SET public_slug = 'a-different-one' WHERE id = ${id}::uuid
        `,
      ).rejects.toThrow();
    });

    it('may still be corrected while the article has never been published', async () => {
      const id = await insertArticle('correctable');

      await expect(
        harness.prisma.$executeRaw`
          UPDATE public_article SET public_slug = 'corrected' WHERE id = ${id}::uuid
        `,
      ).resolves.toBeDefined();
    });

    it('is unique across drafts and published articles alike', async () => {
      await insertArticle('one-address');

      await expect(insertArticle('one-address')).rejects.toThrow();
    });

    it('refuses a revision stamp on something never published', async () => {
      const id = await insertArticle('never-published');

      await expect(
        harness.prisma.$executeRaw`
          UPDATE public_article SET public_revised_at = NOW() WHERE id = ${id}::uuid
        `,
      ).rejects.toThrow();
    });
  });

  describe('a published article cannot exist without approved copy', () => {
    // `public_article_published_copy_chk`, attacked past every service, guard
    // and controller in the application. This is the constraint that makes
    // "only a manager decides what prose a visitor reads" a property of the
    // database rather than of whichever query happens to run.
    it('refuses is_public on a row whose published copy nobody wrote', async () => {
      await expect(
        harness.prisma.$executeRaw`
          INSERT INTO public_article (id, public_slug, title, body, is_public, created_by_user_id)
          VALUES (
            ${uuidv7()}::uuid, 'no-approved-copy', 'Synthetic', 'Synthetic body.',
            TRUE, ${actorId}::uuid
          )
        `,
      ).rejects.toThrow();
    });

    it('refuses half a published copy, in either direction', async () => {
      // Title and body are copied in one statement, so one without the other is
      // a row no publication act could have produced.
      for (const [title, body] of [
        ['Synthetic', null],
        [null, 'Synthetic body.'],
      ] as const) {
        await expect(
          harness.prisma.$executeRaw`
            INSERT INTO public_article (
              id, public_slug, title, body, published_title, published_body, created_by_user_id
            ) VALUES (
              ${uuidv7()}::uuid, ${`half-${title === null ? 'body' : 'title'}`}, 'Synthetic',
              'Synthetic body.', ${title}, ${body}, ${actorId}::uuid
            )
          `,
        ).rejects.toThrow();
      }
    });

    it('refuses a published summary with no published article behind it', async () => {
      await expect(
        harness.prisma.$executeRaw`
          INSERT INTO public_article (
            id, public_slug, title, body, published_summary, created_by_user_id
          ) VALUES (
            ${uuidv7()}::uuid, 'orphan-summary', 'Synthetic', 'Synthetic body.',
            'Synthetic standfirst.', ${actorId}::uuid
          )
        `,
      ).rejects.toThrow();
    });

    it('refuses markup in a published column too, not only in the draft', async () => {
      await expect(
        harness.prisma.$executeRawUnsafe(
          `INSERT INTO public_article (
             id, public_slug, title, body, published_title, published_body, created_by_user_id
           ) VALUES (
             gen_random_uuid(), 'published-markup', 'Synthetic', 'Synthetic body.',
             'Synthetic', '<script>x</script>', '${actorId}'
           )`,
        ),
      ).rejects.toThrow();
    });
  });

  describe('the tables hold nothing they should not', () => {
    it('has no column naming a family, child, service, therapist or appointment', async () => {
      // PROJECT_SPEC.md 11 forbids publishing identifying child or clinical
      // data. The narrowest way to obey a rule about a category of data is not
      // to hold it, and this is that assertion: a widened query cannot leak a
      // column that does not exist.
      const rows = await harness.prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('public_article', 'public_testimonial')
      `;
      const columns = rows.map((row) => row.column_name);

      for (const forbidden of [
        'family_id',
        'child_id',
        'service_id',
        'therapist_id',
        'appointment_id',
        'session_charge_id',
        'child_age',
        'diagnosis',
        'consent_document',
      ]) {
        expect(columns).not.toContain(forbidden);
      }
    });

    it('gives a testimonial no slug and therefore no URL of its own', async () => {
      const rows = await harness.prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'public_testimonial'
      `;

      expect(rows.map((row) => row.column_name)).not.toContain('public_slug');
    });
  });
});
