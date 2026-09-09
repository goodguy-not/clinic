import request from 'supertest';
import { articleResponseSchema, publicArticleDetailResponseSchema } from '@clinic/contracts';
import { createHarness, resetDatabase, type Harness } from './harness';
import { uploadPhoto } from './media-support';
import { articleDraft, as, asVisitor, loginAs } from './website-support';

/**
 * Article imagery, held to the same draft-and-publish discipline as article
 * text.
 *
 * Milestone 9.5, checkpoint A7, over real HTTP against real PostgreSQL.
 *
 * THIS SUITE ADDS NO MECHANISM AND CHANGES NOTHING. Everything it exercises was
 * built in checkpoint A5 and A2; what A7 owes is the PROOF that the two
 * disciplines are actually the same one, stated as the property the checkpoint
 * requires rather than as two separate features that happen to coexist:
 *
 *   a draft change does not affect public output;
 *   the manager's publication is what makes the prepared image reachable.
 *
 * THE TWO GATES ARE INDEPENDENT AND BOTH ARE THE MANAGER'S — `media.publish`
 * for the picture in this place, `article.publish` for the page. The
 * interesting sequence is the one a launch actually takes: a receptionist
 * prepares an illustration on an unpublished article, a manager approves the
 * picture silently, and the words and the picture become reachable together at
 * the single moment the manager publishes the ARTICLE.
 *
 * Every photograph is generated in code. Nothing real appears.
 */
describe('article imagery (real PostgreSQL)', () => {
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
    await resetDatabase(harness.prisma);
    manager = await loginAs(harness, 'MANAGER');
    receptionist = await loginAs(harness, 'RECEPTIONIST');
  });

  const server = () => harness.app.getHttpServer();

  async function createArticle(slug: string): Promise<string> {
    const response = await request(server())
      .post('/content/articles')
      .set(as(receptionist))
      .send(articleDraft(slug));

    expect(response.status).toBe(201);
    return articleResponseSchema.parse(response.body).article.id;
  }

  async function publishArticle(id: string, isPublic: boolean) {
    return request(server())
      .patch(`/content/articles/${id}/publication`)
      .set(as(manager))
      .send({ isPublic });
  }

  /** A receptionist prepares an illustration. This is DRAFTING. */
  async function prepareImage(articleId: string): Promise<string> {
    const asset = await uploadPhoto(harness, receptionist);

    const attached = await request(server())
      .post(`/media/${asset.id}/attachments`)
      .set(as(receptionist))
      .send({ ownerType: 'PUBLIC_ARTICLE', ownerId: articleId, position: 0 });

    expect(attached.status).toBe(201);

    const attachment = attached.body.media.attachments.find(
      (item: { ownerType: string; ownerId: string | null }) =>
        item.ownerType === 'PUBLIC_ARTICLE' && item.ownerId === articleId,
    );

    // The receptionist's act produced a DRAFT attachment and nothing more.
    expect(attachment.publishedAt).toBeNull();

    return attachment.id as string;
  }

  async function approveImage(attachmentId: string, isPublished: boolean) {
    return request(server())
      .patch(`/media/attachments/${attachmentId}/publication`)
      .set(as(manager))
      .send({ isPublished });
  }

  async function publicArticle(slug: string) {
    const response = await request(server()).get(`/public/articles/${slug}`).set(asVisitor());
    if (response.status !== 200) return null;
    return publicArticleDetailResponseSchema.parse(response.body).article;
  }

  it('does not make a prepared image anonymously reachable as article content', async () => {
    const id = await createArticle('draft-with-image');
    await prepareImage(id);
    await publishArticle(id, true);

    // The page is live and the prepared picture is not on it: attaching is
    // drafting, and a receptionist cannot move what a visitor sees.
    expect((await publicArticle('draft-with-image'))?.images).toEqual([]);
  });

  it('makes the approved prepared image public at the moment the article is published', async () => {
    // THE LAUNCH SEQUENCE. The manager approves the picture while the article
    // is still a draft — legal, silent, and exactly what preparing a launch
    // looks like — and then one act publishes the words and the picture
    // together.
    const id = await createArticle('launch-together');
    const attachmentId = await prepareImage(id);

    await approveImage(attachmentId, true);

    // Approving the picture on a draft article publishes nothing at all.
    expect(await publicArticle('launch-together')).toBeNull();

    await publishArticle(id, true);

    const article = await publicArticle('launch-together');
    expect(article?.images).toHaveLength(1);

    const path = article?.images[0]?.renditions[0]?.path as string;
    expect((await request(server()).get(`/public/${path}`).set(asVisitor())).status).toBe(200);
  });

  it('takes the imagery down with the article when the manager unpublishes', async () => {
    const id = await createArticle('withdrawn-with-image');
    const attachmentId = await prepareImage(id);
    await approveImage(attachmentId, true);
    await publishArticle(id, true);

    const path = (await publicArticle('withdrawn-with-image'))?.images[0]?.renditions[0]
      ?.path as string;
    expect((await request(server()).get(`/public/${path}`).set(asVisitor())).status).toBe(200);

    await publishArticle(id, false);

    // The A5 reachability rule: unpublishing the OWNER revokes its pictures at
    // the origin on the very next request, with no interval.
    expect(await publicArticle('withdrawn-with-image')).toBeNull();
    expect((await request(server()).get(`/public/${path}`).set(asVisitor())).status).toBe(404);
  });

  it('follows the A5 replacement rule when an image is swapped', async () => {
    // Replacement is unpublish, detach, attach, publish — four acts, of which
    // the two that change what a visitor sees are the manager's. The old
    // rendition stops being reachable and the new one is a different resource
    // with a different id.
    const id = await createArticle('replaced-image');
    const first = await prepareImage(id);
    await approveImage(first, true);
    await publishArticle(id, true);

    const oldPath = (await publicArticle('replaced-image'))?.images[0]?.renditions[0]
      ?.path as string;

    // A receptionist cannot detach a published attachment — that would be the
    // weaker authority taking something off a live page.
    const refused = await request(server())
      .delete(`/media/attachments/${first}`)
      .set(as(receptionist));
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('MEDIA_ATTACHMENT_PUBLISHED');

    await approveImage(first, false);
    const detached = await request(server())
      .delete(`/media/attachments/${first}`)
      .set(as(receptionist));
    expect(detached.status).toBe(200);

    const second = await prepareImage(id);
    await approveImage(second, true);

    const newPath = (await publicArticle('replaced-image'))?.images[0]?.renditions[0]
      ?.path as string;

    expect(newPath).not.toBe(oldPath);
    expect((await request(server()).get(`/public/${oldPath}`).set(asVisitor())).status).toBe(404);
    expect((await request(server()).get(`/public/${newPath}`).set(asVisitor())).status).toBe(200);
  });

  it('refuses a receptionist the image publication route', async () => {
    const id = await createArticle('receptionist-cannot-publish');
    const attachmentId = await prepareImage(id);
    await publishArticle(id, true);

    const refused = await request(server())
      .patch(`/media/attachments/${attachmentId}/publication`)
      .set(as(receptionist))
      .send({ isPublished: true });

    expect(refused.status).toBe(403);
    expect((await publicArticle('receptionist-cannot-publish'))?.images).toEqual([]);
  });
});
