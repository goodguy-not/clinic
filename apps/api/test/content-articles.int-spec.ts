import request from 'supertest';
import {
  articleResponseSchema,
  articleListResponseSchema,
  publicArticleDetailResponseSchema,
} from '@clinic/contracts';
import {
  createHarness,
  internalHeaders,
  resetDatabase,
  type Harness,
  ownerPrisma,
} from './harness';
import { articleDraft, as, auditActionsFor, loginAs } from './website-support';

/**
 * Articles: who may write one, who may publish one, and what the trail says.
 *
 * Milestone 9, checkpoint A2, over real HTTP against real PostgreSQL.
 *
 * THE SUITE IS ORGANISED AROUND THE ONE DEFECT THIS CHECKPOINT CANNOT SHIP
 * WITH: a draft becoming visible to a visitor without a manager deciding it
 * should. Every authority test therefore has both halves — what the role may
 * do, and what it may not — because a test that only proves the receptionist
 * can write would pass just as well if they could also publish.
 *
 * Everything is synthetic.
 */
describe('article drafting and publication (real PostgreSQL)', () => {
  let harness: Harness;
  let manager: string;
  let receptionist: string;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    manager = await loginAs(harness, 'MANAGER');
    receptionist = await loginAs(harness, 'RECEPTIONIST');
  });

  const server = () => harness.app.getHttpServer();

  async function createDraft(session: string, slug: string): Promise<string> {
    const response = await request(server())
      .post('/content/articles')
      .set(as(session))
      .send(articleDraft(slug));

    expect(response.status).toBe(201);
    return articleResponseSchema.parse(response.body).article.id;
  }

  async function publish(session: string, id: string, isPublic: boolean) {
    return request(server())
      .patch(`/content/articles/${id}/publication`)
      .set(as(session))
      .send({ isPublic });
  }

  describe('the authority split', () => {
    it('lets a receptionist create, read and edit a draft', async () => {
      const id = await createDraft(receptionist, 'first-draft');

      const list = await request(server()).get('/content/articles').set(as(receptionist));
      const one = await request(server()).get(`/content/articles/${id}`).set(as(receptionist));
      const edited = await request(server())
        .patch(`/content/articles/${id}`)
        .set(as(receptionist))
        .send({ ...articleDraft('first-draft'), title: 'Synthetic corrected title' });

      expect(list.status).toBe(200);
      expect(articleListResponseSchema.parse(list.body).articles).toHaveLength(1);
      expect(one.status).toBe(200);
      expect(edited.status).toBe(200);
      expect(articleResponseSchema.parse(edited.body).article.title).toBe(
        'Synthetic corrected title',
      );
    });

    it('creates every article as a draft, whoever created it', async () => {
      // Not "defaults to": there is no field on the request that could say
      // otherwise, which is what makes the rule hold for a caller nobody has
      // written yet.
      const byReceptionist = await request(server())
        .post('/content/articles')
        .set(as(receptionist))
        .send(articleDraft('drafted-by-receptionist'));
      const byManager = await request(server())
        .post('/content/articles')
        .set(as(manager))
        .send(articleDraft('drafted-by-manager'));

      expect(articleResponseSchema.parse(byReceptionist.body).article.isPublic).toBe(false);
      expect(articleResponseSchema.parse(byManager.body).article.isPublic).toBe(false);
    });

    it('refuses a receptionist publishing an article', async () => {
      const id = await createDraft(receptionist, 'refused-publication');

      const attempt = await publish(receptionist, id, true);

      expect(attempt.status).toBe(403);
      expect(attempt.body.error.code).toBe('AUTH_FORBIDDEN');

      // AND THE ROW DID NOT MOVE. A 403 that nevertheless wrote would be the
      // worst possible outcome of this test passing.
      const after = await request(server()).get(`/content/articles/${id}`).set(as(manager));
      expect(articleResponseSchema.parse(after.body).article.isPublic).toBe(false);
    });

    it('refuses a receptionist UNpublishing an article', async () => {
      // The other direction of the same authority. Taking the clinic's page
      // down is not a lesser act than putting it up.
      const id = await createDraft(manager, 'refused-withdrawal');
      expect((await publish(manager, id, true)).status).toBe(200);

      const attempt = await publish(receptionist, id, false);

      expect(attempt.status).toBe(403);
      const after = await request(server()).get(`/content/articles/${id}`).set(as(manager));
      expect(articleResponseSchema.parse(after.body).article.isPublic).toBe(true);
    });

    it('lets a manager publish and withdraw', async () => {
      const id = await createDraft(manager, 'manager-publishes');

      const published = await publish(manager, id, true);
      const withdrawn = await publish(manager, id, false);

      expect(articleResponseSchema.parse(published.body).article.isPublic).toBe(true);
      expect(articleResponseSchema.parse(published.body).article.firstPublishedAt).not.toBeNull();
      expect(articleResponseSchema.parse(withdrawn.body).article.isPublic).toBe(false);
      // The stamp survives the withdrawal: it records that the URL was once
      // real, which is what makes the slug immutable afterwards.
      expect(articleResponseSchema.parse(withdrawn.body).article.firstPublishedAt).not.toBeNull();
    });
  });

  describe('the public slug', () => {
    it('may be corrected freely before the first publication', async () => {
      const id = await createDraft(receptionist, 'typo-caught-early');

      const corrected = await request(server())
        .patch(`/content/articles/${id}`)
        .set(as(receptionist))
        .send(articleDraft('typo-corrected'));

      expect(corrected.status).toBe(200);
      expect(articleResponseSchema.parse(corrected.body).article.publicSlug).toBe('typo-corrected');
    });

    it('is refused a rename once the URL has been reachable', async () => {
      const id = await createDraft(manager, 'promised-address');
      await publish(manager, id, true);

      const renamed = await request(server())
        .patch(`/content/articles/${id}`)
        .set(as(manager))
        .send(articleDraft('a-different-address'));

      expect(renamed.status).toBe(409);
      expect(renamed.body.error.code).toBe('PUBLIC_SLUG_IMMUTABLE');
    });

    it('refuses the unpublish-rename-republish round trip', async () => {
      // The same silent URL change with an extra step (DECISION_LOG,
      // 2026-08-21). The stamp survives the round trip, so this is refused for
      // the same reason a direct rename is.
      const id = await createDraft(manager, 'round-trip-address');
      await publish(manager, id, true);
      await publish(manager, id, false);

      const renamed = await request(server())
        .patch(`/content/articles/${id}`)
        .set(as(manager))
        .send(articleDraft('round-trip-renamed'));

      expect(renamed.status).toBe(409);
      expect(renamed.body.error.code).toBe('PUBLIC_SLUG_IMMUTABLE');
    });

    it('still allows editing the DRAFT of a published article', async () => {
      // An article is the clinic's own writing, unlike a testimonial, so
      // preparing a correction stays open to whoever holds `article.draft`.
      // What that edit may NOT do is change the live page — see the whole
      // "revising a live article" block below, which is the authority rule this
      // one only establishes the first half of.
      const id = await createDraft(manager, 'live-article');
      await publish(manager, id, true);

      const edited = await request(server())
        .patch(`/content/articles/${id}`)
        .set(as(manager))
        .send({ ...articleDraft('live-article'), body: 'Synthetic corrected body text.' });

      expect(edited.status).toBe(200);
      expect(articleResponseSchema.parse(edited.body).article.body).toBe(
        'Synthetic corrected body text.',
      );
      expect(articleResponseSchema.parse(edited.body).article.hasUnpublishedChanges).toBe(true);
    });

    it('refuses a slug another article already holds, published or not', async () => {
      await createDraft(manager, 'taken-address');

      const collision = await request(server())
        .post('/content/articles')
        .set(as(manager))
        .send(articleDraft('taken-address'));

      expect(collision.status).toBe(409);
      expect(collision.body.error.code).toBe('PUBLIC_SLUG_TAKEN');
    });
  });

  describe('what may be stored', () => {
    it('refuses markup in a title, a summary and a body alike', async () => {
      for (const field of ['title', 'summary', 'body'] as const) {
        const response = await request(server())
          .post('/content/articles')
          .set(as(manager))
          .send({ ...articleDraft(`markup-${field}`), [field]: '<script>alert(1)</script>' });

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('refuses markup at the database too, not only in the schema', async () => {
      // Two tiers state this rule, and this is the one that survives the other
      // being edited. Written as raw SQL because no route can produce it.
      const managerId = (
        await harness.prisma.$queryRaw<{ id: string }[]>`
          SELECT id FROM app_user WHERE role = 'MANAGER'::user_role LIMIT 1
        `
      )[0]!.id;

      await expect(
        harness.prisma.$executeRaw`
          INSERT INTO public_article (id, public_slug, title, body, created_by_user_id)
          VALUES (gen_random_uuid(), 'sql-markup', 'Synthetic', '<b>no</b>', ${managerId}::uuid)
        `,
      ).rejects.toThrow();
    });

    it('refuses a slug that is not a slug', async () => {
      for (const slug of ['Not Lowercase', 'trailing-', 'double--hyphen', 'a', 'سلام']) {
        const response = await request(server())
          .post('/content/articles')
          .set(as(manager))
          .send({ ...articleDraft('placeholder'), publicSlug: slug });

        expect(response.status).toBe(400);
      }
    });
  });

  describe('revising a live article', () => {
    // THE AUTHORITY RULE THIS CHECKPOINT WAS REVISED TO HOLD.
    //
    // The first shape of this service kept one set of content columns and left
    // a published article editable, which meant a receptionist could rewrite
    // the live page and a visitor saw the new words immediately, with no
    // manager act anywhere in the sequence. Refusing the edit instead would
    // have been the opposite error: an article nobody can correct without a
    // manager doing the typing.
    //
    // What the product requires is neither, and every test here is one half of
    // it: the draft moves freely, the page does not move at all, and only a
    // manager can close the gap between them.

    async function publishedArticle(slug: string): Promise<string> {
      const id = await createDraft(receptionist, slug);
      expect((await publish(manager, id, true)).status).toBe(200);
      return id;
    }

    const visitorSees = async (slug: string) =>
      request(server()).get(`/public/articles/${slug}`).set(internalHeaders());

    it('leaves the live page untouched while a receptionist prepares a change', async () => {
      const id = await publishedArticle('live-and-revised');
      const published = await visitorSees('live-and-revised');

      const edit = await request(server())
        .patch(`/content/articles/${id}`)
        .set(as(receptionist))
        .send({
          ...articleDraft('live-and-revised'),
          title: 'Synthetic unreviewed title',
          summary: 'Synthetic unreviewed standfirst.',
          body: 'Synthetic prose that no manager has read.',
        });

      const after = await visitorSees('live-and-revised');

      expect(edit.status).toBe(200);
      // Byte for byte what it was before the edit.
      expect(publicArticleDetailResponseSchema.parse(after.body).article).toEqual(
        publicArticleDetailResponseSchema.parse(published.body).article,
      );
      expect(publicArticleDetailResponseSchema.parse(after.body).article.body).not.toContain(
        'no manager has read',
      );
    });

    it('reports the outstanding publication without saying what changed', async () => {
      const id = await publishedArticle('pending-change');

      const before = await request(server()).get(`/content/articles/${id}`).set(as(manager));
      await request(server())
        .patch(`/content/articles/${id}`)
        .set(as(receptionist))
        .send({ ...articleDraft('pending-change'), body: 'Synthetic prepared body.' });
      const after = await request(server()).get(`/content/articles/${id}`).set(as(manager));

      expect(articleResponseSchema.parse(before.body).article.hasUnpublishedChanges).toBe(false);
      expect(articleResponseSchema.parse(after.body).article.hasUnpublishedChanges).toBe(true);
    });

    it('refuses the receptionist the act that would make the change public', async () => {
      const id = await publishedArticle('receptionist-cannot-approve');
      await request(server())
        .patch(`/content/articles/${id}`)
        .set(as(receptionist))
        .send({ ...articleDraft('receptionist-cannot-approve'), body: 'Synthetic prepared body.' });

      // The article is ALREADY public, so this is not "may they publish?" — it
      // is "may they approve new words onto a page that is already up?". The
      // answer has to be the same, and this is the assertion that says so.
      const attempt = await publish(receptionist, id, true);
      const visitor = await visitorSees('receptionist-cannot-approve');

      expect(attempt.status).toBe(403);
      expect(attempt.body.error.code).toBe('AUTH_FORBIDDEN');
      expect(publicArticleDetailResponseSchema.parse(visitor.body).article.body).not.toContain(
        'Synthetic prepared body',
      );
    });

    it('publishes the prepared change when the manager approves it', async () => {
      const id = await publishedArticle('manager-approves');
      await request(server())
        .patch(`/content/articles/${id}`)
        .set(as(receptionist))
        .send({
          ...articleDraft('manager-approves'),
          title: 'Synthetic approved title',
          body: 'Synthetic approved body.',
        });

      const approved = await publish(manager, id, true);
      const visitor = await visitorSees('manager-approves');
      const article = publicArticleDetailResponseSchema.parse(visitor.body).article;

      expect(approved.status).toBe(200);
      expect(articleResponseSchema.parse(approved.body).article.hasUnpublishedChanges).toBe(false);
      expect(article.title).toBe('Synthetic approved title');
      expect(article.body).toBe('Synthetic approved body.');
    });

    it('keeps the address and the first-published date across a revision', async () => {
      // Republishing is not a new page. The URL is the same promise it always
      // was, and the date a reader judges the article by is the date it first
      // appeared, not the date somebody fixed a typo.
      const id = await publishedArticle('stable-across-revision');
      const first = publicArticleDetailResponseSchema.parse(
        (await visitorSees('stable-across-revision')).body,
      ).article;

      await request(server())
        .patch(`/content/articles/${id}`)
        .set(as(receptionist))
        .send({ ...articleDraft('stable-across-revision'), body: 'Synthetic revised body.' });
      await publish(manager, id, true);

      const second = publicArticleDetailResponseSchema.parse(
        (await visitorSees('stable-across-revision')).body,
      ).article;

      expect(second.slug).toBe(first.slug);
      expect(second.publishedAt).toBe(first.publishedAt);
      expect(second.body).toBe('Synthetic revised body.');
    });

    it('does not restore a withdrawn version by withdrawing a prepared change', async () => {
      // Unpublishing takes the page down; it does not roll the draft back. The
      // published copy stays on the row so the trail is honest about what the
      // clinic last said, and republishing deliberately replaces it with the
      // current draft rather than silently restoring the old one.
      const id = await publishedArticle('withdraw-then-republish');
      await request(server())
        .patch(`/content/articles/${id}`)
        .set(as(receptionist))
        .send({ ...articleDraft('withdraw-then-republish'), body: 'Synthetic second body.' });

      await publish(manager, id, false);
      expect((await visitorSees('withdraw-then-republish')).status).toBe(404);

      await publish(manager, id, true);
      const visitor = await visitorSees('withdraw-then-republish');

      expect(publicArticleDetailResponseSchema.parse(visitor.body).article.body).toBe(
        'Synthetic second body.',
      );
    });

    it('records the draft work and the approval as different facts', async () => {
      const id = await publishedArticle('audited-revision');
      await request(server())
        .patch(`/content/articles/${id}`)
        .set(as(receptionist))
        .send({ ...articleDraft('audited-revision'), body: 'Synthetic revised body.' });
      await publish(manager, id, true);

      expect(await auditActionsFor(harness, 'public_article', id)).toEqual([
        'public_article.created',
        'public_article.published',
        'public_article.updated',
        'public_article.published',
      ]);

      // The two publication rows are distinguishable by WHAT crossed the
      // boundary, not only by when: the second names the revised text.
      const rows = await harness.prisma.$queryRaw<{ after: Record<string, unknown> }[]>`
        SELECT after FROM audit_log
        WHERE entity_type = 'public_article'
          AND entity_id = ${id}::uuid
          AND action = 'public_article.published'
        ORDER BY id ASC
      `;

      expect(rows).toHaveLength(2);
      expect(rows[0]!.after).toMatchObject({ isPublic: true });
      expect(rows[1]!.after).toMatchObject({
        isPublic: true,
        publishedBodyLength: 'Synthetic revised body.'.length,
      });
    });
  });

  describe('the audit trail', () => {
    it('records drafting, editing, publishing and withdrawing as four different facts', async () => {
      const id = await createDraft(receptionist, 'audited-article');
      await request(server())
        .patch(`/content/articles/${id}`)
        .set(as(receptionist))
        .send({ ...articleDraft('audited-article'), title: 'Synthetic second title' });
      await publish(manager, id, true);
      await publish(manager, id, false);

      expect(await auditActionsFor(harness, 'public_article', id)).toEqual([
        'public_article.created',
        'public_article.updated',
        'public_article.published',
        'public_article.unpublished',
      ]);
    });

    it('writes no audit row for a publication that changes nothing', async () => {
      const id = await createDraft(manager, 'idempotent-publication');
      await publish(manager, id, true);
      await publish(manager, id, true);

      expect(await auditActionsFor(harness, 'public_article', id)).toEqual([
        'public_article.created',
        'public_article.published',
      ]);
    });

    it('records the body as a length and never as a copy of the text', async () => {
      // `audit_log` can never be pruned or deleted. Copying every draft of
      // twenty thousand characters of prose into it would BE the revision
      // history this checkpoint declines to build.
      const id = await createDraft(manager, 'audit-payload');

      const rows = await harness.prisma.$queryRaw<{ after: Record<string, unknown> }[]>`
        SELECT after FROM audit_log
        WHERE entity_type = 'public_article' AND entity_id = ${id}::uuid
      `;

      expect(rows[0]!.after).toMatchObject({
        publicSlug: 'audit-payload',
        bodyLength: expect.any(Number),
      });
      expect(JSON.stringify(rows[0]!.after)).not.toContain('Synthetic body text');
    });

    it('refuses to delete an article outright', async () => {
      const id = await createDraft(manager, 'undeletable');

      await expect(
        ownerPrisma().$executeRaw`DELETE FROM public_article WHERE id = ${id}::uuid`,
      ).rejects.toThrow();
    });
  });
});
