import request from 'supertest';
import {
  articleResponseSchema,
  publicArticleDetailResponseSchema,
  publicArticleListResponseSchema,
  publicSitemapResponseSchema,
  publicTestimonialListResponseSchema,
  testimonialResponseSchema,
} from '@clinic/contracts';
import { uuidv7 } from '../src/common/uuid';
import { createHarness, resetDatabase, type Harness } from './harness';
import { articleDraft, as, asVisitor, loginAs, testimonialDraft } from './website-support';

/**
 * What a visitor can actually reach, and the sitemap that claims to list it.
 *
 * Milestone 9, checkpoint A2. Like the A1 suite, THIS IS WRITTEN AS AN ATTACK:
 * almost every test publishes nothing, or publishes and then withdraws, and
 * then tries to reach the row through each public route in turn. A public read
 * that returns something the clinic did not publish is the one defect this
 * checkpoint cannot ship with.
 *
 * The sitemap tests are the mirror image: the failure they exist to catch is a
 * URL list that has drifted from the pages it describes, in either direction.
 *
 * Everything is synthetic.
 */
describe('public content reads and sitemap data (real PostgreSQL)', () => {
  let harness: Harness;
  let manager: string;
  let receptionist: string;
  let actorId: string;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
    manager = await loginAs(harness, 'MANAGER');
    receptionist = await loginAs(harness, 'RECEPTIONIST');

    actorId = (
      await harness.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM app_user WHERE role = 'MANAGER'::user_role LIMIT 1
      `
    )[0]!.id;
  });

  const server = () => harness.app.getHttpServer();

  async function draftArticle(slug: string): Promise<string> {
    const response = await request(server())
      .post('/content/articles')
      .set(as(receptionist))
      .send(articleDraft(slug));

    return articleResponseSchema.parse(response.body).article.id;
  }

  async function publishArticle(slug: string): Promise<string> {
    const id = await draftArticle(slug);
    await request(server())
      .patch(`/content/articles/${id}/publication`)
      .set(as(manager))
      .send({ isPublic: true });
    return id;
  }

  async function approvedTestimonial(published: boolean): Promise<string> {
    const created = await request(server())
      .post('/content/testimonials')
      .set(as(receptionist))
      .send(testimonialDraft());
    const id = testimonialResponseSchema.parse(created.body).testimonial.id;

    await request(server())
      .patch(`/content/testimonials/${id}/approval`)
      .set(as(manager))
      .send({ approved: true });

    if (published) {
      await request(server())
        .patch(`/content/testimonials/${id}/publication`)
        .set(as(manager))
        .send({ isPublic: true });
    }

    return id;
  }

  /** A published service, written with the same raw SQL the A1 suite uses. */
  async function seedPublishedService(slug: string, active = true): Promise<void> {
    await harness.prisma.$executeRaw`
      INSERT INTO service (
        id, name, is_public, public_slug, status, deactivated_at, created_by_user_id
      ) VALUES (
        ${uuidv7()}::uuid, ${`Synthetic Service ${slug}`}, TRUE, ${slug},
        ${active ? 'ACTIVE' : 'INACTIVE'}::catalog_status,
        ${active ? null : new Date()}, ${actorId}::uuid
      )
    `;
  }

  async function seedPublishedTherapist(slug: string): Promise<void> {
    await harness.prisma.$executeRaw`
      INSERT INTO therapist (
        id, full_name, specialty, is_public, public_slug, public_display_name,
        -- Checkpoint A6: the sitemap and the team page read the PUBLISHED name.
        published_public_display_name,
        status, created_by_user_id
      ) VALUES (
        ${uuidv7()}::uuid, 'Synthetic Colleague', 'Synthetic Specialty', TRUE, ${slug},
        'Synthetic Display Name', 'Synthetic Display Name',
        'ACTIVE'::catalog_status, ${actorId}::uuid
      )
    `;
  }

  describe('a draft is unreachable', () => {
    it('is absent from the public list', async () => {
      await draftArticle('unpublished-article');

      const list = await request(server()).get('/public/articles').set(asVisitor());

      expect(list.status).toBe(200);
      expect(publicArticleListResponseSchema.parse(list.body).articles).toEqual([]);
    });

    it('answers a draft slug exactly as it answers a slug nobody has used', async () => {
      // Two different answers would let anybody enumerate what the clinic is
      // still writing by watching which spellings replied differently.
      await draftArticle('still-being-written');

      const draft = await request(server())
        .get('/public/articles/still-being-written')
        .set(asVisitor());
      const nonexistent = await request(server())
        .get('/public/articles/never-existed')
        .set(asVisitor());

      expect(draft.status).toBe(404);
      expect(draft.body.error.code).toBe('ARTICLE_NOT_FOUND');
      expect(nonexistent.status).toBe(404);
      expect(nonexistent.body.error.code).toBe('ARTICLE_NOT_FOUND');
    });

    it('becomes unreachable again the moment it is withdrawn', async () => {
      const id = await publishArticle('temporarily-live');
      await request(server())
        .patch(`/content/articles/${id}/publication`)
        .set(as(manager))
        .send({ isPublic: false });

      const detail = await request(server())
        .get('/public/articles/temporarily-live')
        .set(asVisitor());
      const list = await request(server()).get('/public/articles').set(asVisitor());

      expect(detail.status).toBe(404);
      expect(publicArticleListResponseSchema.parse(list.body).articles).toEqual([]);
    });
  });

  describe('an unapproved testimonial is unreachable', () => {
    it('is absent while it is only a draft', async () => {
      await request(server())
        .post('/content/testimonials')
        .set(as(receptionist))
        .send(testimonialDraft());

      const list = await request(server()).get('/public/testimonials').set(asVisitor());

      expect(publicTestimonialListResponseSchema.parse(list.body).testimonials).toEqual([]);
    });

    it('is still absent once approved but not yet published', async () => {
      // APPROVAL IS NOT PUBLICATION. A manager who has read and accepted the
      // wording has not thereby put it on a page.
      await approvedTestimonial(false);

      const list = await request(server()).get('/public/testimonials').set(asVisitor());

      expect(publicTestimonialListResponseSchema.parse(list.body).testimonials).toEqual([]);
    });

    it('disappears again when the approval is withdrawn', async () => {
      const id = await approvedTestimonial(true);

      const before = await request(server()).get('/public/testimonials').set(asVisitor());
      await request(server())
        .patch(`/content/testimonials/${id}/approval`)
        .set(as(manager))
        .send({ approved: false });
      const after = await request(server()).get('/public/testimonials').set(asVisitor());

      expect(publicTestimonialListResponseSchema.parse(before.body).testimonials).toHaveLength(1);
      expect(publicTestimonialListResponseSchema.parse(after.body).testimonials).toEqual([]);
    });
  });

  describe('what a published page carries', () => {
    it('states five facts about a listed article and six about the detail', async () => {
      await publishArticle('a-published-article');

      const list = await request(server()).get('/public/articles').set(asVisitor());
      const detail = await request(server())
        .get('/public/articles/a-published-article')
        .set(asVisitor());

      const summary = publicArticleListResponseSchema.parse(list.body).articles[0]!;
      const article = publicArticleDetailResponseSchema.parse(detail.body).article;

      // `images` is the fifth, added in Milestone 9.5 checkpoint A5, and it is
      // an EMPTY ARRAY here: nothing in this test attaches or publishes a
      // photograph, so the projection carries the shape without the content.
      expect(Object.keys(summary).sort()).toEqual([
        'images',
        'publishedAt',
        'slug',
        'summary',
        'title',
      ]);
      expect(summary.images).toEqual([]);
      expect(Object.keys(article).sort()).toEqual([
        'body',
        'images',
        'publishedAt',
        'slug',
        'summary',
        'title',
      ]);
      expect(article.images).toEqual([]);
    });

    it('carries no internal identifier, publication flag or actor', async () => {
      await publishArticle('projection-check');
      await approvedTestimonial(true);

      const article = await request(server())
        .get('/public/articles/projection-check')
        .set(asVisitor());
      const testimonials = await request(server()).get('/public/testimonials').set(asVisitor());

      for (const body of [JSON.stringify(article.body), JSON.stringify(testimonials.body)]) {
        for (const forbidden of [
          '"id"',
          'isPublic',
          'createdBy',
          'created_by',
          'status',
          'approvedAt',
          'publicRevisedAt',
          'firstPublishedAt',
        ]) {
          expect(body).not.toContain(forbidden);
        }
      }
    });

    it('states four facts about a testimonial and nothing that identifies anybody', async () => {
      await approvedTestimonial(true);

      const list = await request(server()).get('/public/testimonials').set(asVisitor());
      const testimonial = publicTestimonialListResponseSchema.parse(list.body).testimonials[0]!;

      // `image` is the third, added in Milestone 9.5 checkpoint A5. Null here,
      // because no photograph has been attached — and null is what an
      // unillustrated testimonial reports, never an omitted key.
      //
      // `kind` is the fourth, added in checkpoint A7. It says HOW the words
      // arrived — typed, or transcribed from a note the family wrote — so the
      // web tier can present a photographed note as one. It names nobody, it
      // says nothing clinical, and the exact-list assertion is what stops a
      // fifth field arriving here without a decision.
      expect(Object.keys(testimonial).sort()).toEqual(['authorLabel', 'body', 'image', 'kind']);
      expect(testimonial.image).toBeNull();
      expect(testimonial.kind).toBe('TYPED');
    });
  });

  describe('the sitemap data', () => {
    it('lists exactly the pages that answer', async () => {
      await seedPublishedService('a-published-service');
      await seedPublishedTherapist('a-published-therapist');
      await publishArticle('a-published-article');

      // And one of each that must NOT appear.
      await seedPublishedService('a-retired-service', false);
      await draftArticle('an-unpublished-article');
      await approvedTestimonial(true);

      const sitemap = await request(server()).get('/public/sitemap').set(asVisitor());
      const entries = publicSitemapResponseSchema.parse(sitemap.body).entries;

      expect(entries.map((entry) => `${entry.kind}:${entry.slug}`).sort()).toEqual([
        'article:a-published-article',
        'service:a-published-service',
        'therapist:a-published-therapist',
      ]);
    });

    it('agrees with the reads it describes, page for page', async () => {
      // THE PROPERTY THAT MATTERS, ASSERTED AS A PROPERTY. Every sitemap entry
      // must answer, and every page that answers must be in the sitemap —
      // otherwise the file advertises a 404 or hides a page.
      await seedPublishedService('service-one');
      await seedPublishedTherapist('therapist-one');
      await publishArticle('article-one');
      await publishArticle('article-two');

      const sitemap = publicSitemapResponseSchema.parse(
        (await request(server()).get('/public/sitemap').set(asVisitor())).body,
      );

      for (const entry of sitemap.entries) {
        const path =
          entry.kind === 'service'
            ? `/public/services/${entry.slug}`
            : entry.kind === 'therapist'
              ? `/public/team/${entry.slug}`
              : `/public/articles/${entry.slug}`;

        const response = await request(server()).get(path).set(asVisitor());
        expect(response.status).toBe(200);
      }

      const articles = publicArticleListResponseSchema.parse(
        (await request(server()).get('/public/articles').set(asVisitor())).body,
      );

      for (const article of articles.articles) {
        expect(sitemap.entries).toContainEqual(
          expect.objectContaining({ kind: 'article', slug: article.slug }),
        );
      }
    });

    it('reports no last-modified for a row published before the A2 write paths existed', async () => {
      // The A1 synthetic seeder publishes with raw SQL and writes no revision
      // stamp. A null here is the honest answer: inventing one from the
      // publication instant would tell a crawler a cached page is older than it
      // is.
      await seedPublishedService('seeded-service');

      const sitemap = publicSitemapResponseSchema.parse(
        (await request(server()).get('/public/sitemap').set(asVisitor())).body,
      );

      expect(sitemap.entries[0]!.lastModified).toBeNull();
    });

    it('moves the last-modified when the manager publishes a revision, and not before', async () => {
      // A DRAFT EDIT IS NOT A MODIFICATION OF THE PUBLISHED PAGE, so it must not
      // tell a crawler that one happened. `lastmod` is a statement about what a
      // visitor can read, and until the manager publishes, what a visitor can
      // read has not changed.
      const id = await publishArticle('revised-article');

      const atPublication = publicSitemapResponseSchema.parse(
        (await request(server()).get('/public/sitemap').set(asVisitor())).body,
      );

      await request(server())
        .patch(`/content/articles/${id}`)
        .set(as(receptionist))
        .send({ ...articleDraft('revised-article'), title: 'Synthetic revised title' });

      const afterDraftEdit = publicSitemapResponseSchema.parse(
        (await request(server()).get('/public/sitemap').set(asVisitor())).body,
      );

      await request(server())
        .patch(`/content/articles/${id}/publication`)
        .set(as(manager))
        .send({ isPublic: true });

      const afterApproval = publicSitemapResponseSchema.parse(
        (await request(server()).get('/public/sitemap').set(asVisitor())).body,
      );

      expect(atPublication.entries[0]!.lastModified).not.toBeNull();
      expect(afterDraftEdit.entries[0]!.lastModified).toBe(atPublication.entries[0]!.lastModified);
      expect(Date.parse(afterApproval.entries[0]!.lastModified!)).toBeGreaterThan(
        Date.parse(atPublication.entries[0]!.lastModified!),
      );
    });

    it('carries no path, no host and no internal identifier', async () => {
      // The route structure belongs to the web tier, which owns its router and
      // is the only tier that can be wrong about it.
      await publishArticle('sitemap-shape');

      const sitemap = await request(server()).get('/public/sitemap').set(asVisitor());
      const entry = publicSitemapResponseSchema.parse(sitemap.body).entries[0]!;

      expect(Object.keys(entry).sort()).toEqual(['kind', 'lastModified', 'slug']);
      expect(JSON.stringify(sitemap.body)).not.toContain('http');
      expect(JSON.stringify(sitemap.body)).not.toContain('/articles/');
    });
  });

  describe('the public reads still hold no permission', () => {
    it('answers a caller with the internal key and no session', async () => {
      await publishArticle('no-session-needed');

      for (const path of [
        '/public/articles',
        '/public/articles/no-session-needed',
        '/public/testimonials',
        '/public/sitemap',
      ]) {
        const response = await request(server()).get(path).set(asVisitor());
        expect(response.status).toBe(200);
      }
    });

    it('refuses the same caller without the internal key', async () => {
      // "Public" describes the audience of the FACTS, not the reachability of
      // the route. A visitor's browser never speaks to NestJS.
      for (const path of ['/public/articles', '/public/testimonials', '/public/sitemap']) {
        const response = await request(server()).get(path);
        expect(response.status).toBe(401);
        expect(response.body.error.code).toBe('AUTH_INTERNAL_KEY_INVALID');
      }
    });
  });
});
