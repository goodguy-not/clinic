import request from 'supertest';
import {
  articleResponseSchema,
  mediaAltTextResponseSchema,
  mediaAssetResponseSchema,
  mediaPublicationResponseSchema,
  publicArticleDetailResponseSchema,
  publicTeamResponseSchema,
  publicTherapistProfileResponseSchema,
  type MediaAsset,
} from '@clinic/contracts';
import { uuidv7 } from '../src/common/uuid';
import { createHarness, resetDatabase, type Harness } from './harness';
import { articleDraft, as, asVisitor, auditActionsFor, loginAs } from './website-support';
import { uploadPhoto } from './media-support';

/**
 * Correcting a photograph's description (Milestone 9.5 stabilisation).
 *
 * The description is the ASSET's, and who may change it follows the
 * publication boundary: anybody holding `media.attach` while no stranger can
 * be served the photograph, and only `media.publish` once one can. A change to
 * a served photograph returns the publication identity of every live page it
 * is on, so the Web tier can invalidate them.
 *
 * Everything is synthetic. See `media-support.ts`.
 */
describe('media description correction (real PostgreSQL)', () => {
  let harness: Harness;
  let manager: string;
  let receptionist: string;
  let therapistId: string;

  beforeAll(async () => {
    harness = await createHarness();
  }, 60_000);

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    manager = await loginAs(harness, 'MANAGER');
    receptionist = await loginAs(harness, 'RECEPTIONIST');

    const actorId = (
      await harness.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM app_user WHERE role = 'MANAGER'::user_role LIMIT 1
      `
    )[0]!.id;

    therapistId = uuidv7();
    await harness.prisma.$executeRaw`
      INSERT INTO therapist (id, full_name, specialty, status, created_at, created_by_user_id)
      VALUES (
        ${therapistId}::uuid, 'Synthetic Colleague', 'Synthetic Specialty',
        'ACTIVE'::catalog_status, transaction_timestamp(), ${actorId}::uuid
      )
    `;
  });

  const server = () => harness.app.getHttpServer();

  // --- fixtures -----------------------------------------------------------

  const describeAs = (mediaId: string, altText: unknown, session: string) =>
    request(server()).patch(`/media/${mediaId}/alt-text`).set(as(session)).send({ altText });

  const attach = async (mediaId: string, body: Record<string, unknown>): Promise<string> => {
    const attached = await request(server())
      .post(`/media/${mediaId}/attachments`)
      .set(as(receptionist))
      .send(body);
    const attachment = mediaAssetResponseSchema
      .parse(attached.body)
      .media.attachments.find(
        (item) => item.ownerType === body['ownerType'] && item.ownerId === body['ownerId'],
      );
    if (attachment === undefined) throw new Error('attachment not created');
    return attachment.id;
  };

  const publish = async (attachmentId: string, isPublished = true) => {
    const response = await request(server())
      .patch(`/media/attachments/${attachmentId}/publication`)
      .set(as(manager))
      .send({ isPublished });
    return mediaPublicationResponseSchema.parse(response.body);
  };

  async function publicTherapist(): Promise<void> {
    await request(server())
      .patch(`/catalog/therapists/${therapistId}/public-profile`)
      .set(as(manager))
      .send({
        publicSlug: 'synthetic-colleague',
        displayName: 'Synthetic Display Name',
        title: 'Synthetic Public Title',
        bio: 'Synthetic biography written for a test.',
        displayOrder: 10,
      });
    await request(server())
      .patch(`/catalog/therapists/${therapistId}/public-profile/visibility`)
      .set(as(manager))
      .send({ isPublic: true });
  }

  async function publishedArticle(slug: string): Promise<string> {
    const draft = await request(server())
      .post('/content/articles')
      .set(as(receptionist))
      .send(articleDraft(slug));
    const id = articleResponseSchema.parse(draft.body).article.id;
    await request(server())
      .patch(`/content/articles/${id}/publication`)
      .set(as(manager))
      .send({ isPublic: true });
    return id;
  }

  /** A portrait published on a public therapist: served to strangers. */
  async function servedPortrait(): Promise<{ asset: MediaAsset; attachmentId: string }> {
    await publicTherapist();
    const asset = await uploadPhoto(harness, receptionist, { altText: 'تصویر با غلط تایپی' });
    const attachmentId = await attach(asset.id, {
      ownerType: 'THERAPIST_PROFILE',
      ownerId: therapistId,
    });
    const published = await publish(attachmentId);
    expect(published.media.isPubliclyServed).toBe(true);
    return { asset: published.media, attachmentId };
  }

  async function auditRows(mediaId: string) {
    return harness.prisma.$queryRaw<
      {
        action: string;
        role: string;
        before: unknown;
        after: unknown;
        metadata: unknown;
      }[]
    >`
      SELECT a.action, u.role::text AS role, a.before, a.after, a.metadata
      FROM audit_log a JOIN app_user u ON u.id = a.actor_user_id
      WHERE a.entity_type = 'media_asset' AND a.entity_id = ${mediaId}::uuid
        AND a.action = 'media.alt_text_updated'
      ORDER BY a.id
    `;
  }

  // --- not publicly served: the drafting authority suffices ---------------

  describe('a photograph no stranger can be served', () => {
    it('lets a receptionist correct an unattached photograph, audited', async () => {
      const asset = await uploadPhoto(harness, receptionist, { altText: 'تصویر با غلط تایپی' });

      const response = await describeAs(asset.id, '  تصویر اصلاح‌شده  ', receptionist);

      expect(response.status).toBe(200);
      const body = mediaAltTextResponseSchema.parse(response.body);
      // Same canonicalisation as at upload: trimmed.
      expect(body.media.altText).toBe('تصویر اصلاح‌شده');
      expect(body.publications).toEqual([]);

      expect(await auditRows(asset.id)).toEqual([
        {
          action: 'media.alt_text_updated',
          role: 'RECEPTIONIST',
          before: { altTextLength: 'تصویر با غلط تایپی'.length },
          after: { altTextLength: 'تصویر اصلاح‌شده'.length },
          metadata: { isPubliclyServed: false },
        },
      ]);
    }, 60_000);

    it('lets a receptionist correct a photograph published on a DRAFT owner', async () => {
      // Three of the four serving conditions hold — in circulation, attached,
      // published by a manager — but the therapist is not public, so nothing
      // is served and the description is still draft material.
      const asset = await uploadPhoto(harness, receptionist);
      const attachmentId = await attach(asset.id, {
        ownerType: 'THERAPIST_PROFILE',
        ownerId: therapistId,
      });
      expect((await publish(attachmentId)).media.isPubliclyServed).toBe(false);

      const response = await describeAs(asset.id, 'توضیح تازه', receptionist);

      expect(response.status).toBe(200);
      const body = mediaAltTextResponseSchema.parse(response.body);
      expect(body.media.altText).toBe('توضیح تازه');
      // The draft owner's slug is a manager publication setting; a receptionist
      // is never handed it.
      expect(body.publications).toEqual([]);
    }, 60_000);

    it('lets a receptionist correct a photograph again once a manager unpublishes it', async () => {
      const { asset, attachmentId } = await servedPortrait();
      await publish(attachmentId, false);

      const response = await describeAs(asset.id, 'پس از برداشتن از صفحه', receptionist);

      expect(response.status).toBe(200);
      expect(mediaAltTextResponseSchema.parse(response.body).media.altText).toBe(
        'پس از برداشتن از صفحه',
      );
    }, 60_000);
  });

  // --- publicly served: the manager's alone -------------------------------

  describe('a publicly served photograph', () => {
    it('refuses a receptionist, changes nothing and audits nothing', async () => {
      const { asset } = await servedPortrait();

      const response = await describeAs(asset.id, 'تغییر بدون اجازه', receptionist);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('AUTH_FORBIDDEN');

      const after = mediaAssetResponseSchema.parse(
        (await request(server()).get(`/media/${asset.id}`).set(as(manager))).body,
      ).media;
      expect(after.altText).toBe('تصویر با غلط تایپی');
      expect(await auditRows(asset.id)).toEqual([]);

      const team = publicTeamResponseSchema.parse(
        (await request(server()).get('/public/team').set(asVisitor())).body,
      );
      expect(team.therapists[0]?.photo?.alt).toBe('تصویر با غلط تایپی');
    }, 60_000);

    it('lets a manager change it, returns the live page identity, and the public read follows', async () => {
      const { asset, attachmentId } = await servedPortrait();

      const response = await describeAs(asset.id, 'تصویر درمانگر در اتاق درمان', manager);

      expect(response.status).toBe(200);
      const body = mediaAltTextResponseSchema.parse(response.body);
      expect(body.media.altText).toBe('تصویر درمانگر در اتاق درمان');
      expect(body.publications).toEqual([
        {
          attachmentId,
          ownerType: 'THERAPIST_PROFILE',
          ownerId: therapistId,
          publicSlug: 'synthetic-colleague',
          ownerIsPublic: true,
          renditionIds: asset.renditions.map((rendition) => rendition.id).sort(),
        },
      ]);

      expect(await auditRows(asset.id)).toEqual([
        {
          action: 'media.alt_text_updated',
          role: 'MANAGER',
          before: { altTextLength: 'تصویر با غلط تایپی'.length },
          after: { altTextLength: 'تصویر درمانگر در اتاق درمان'.length },
          metadata: { isPubliclyServed: true },
        },
      ]);

      const team = publicTeamResponseSchema.parse(
        (await request(server()).get('/public/team').set(asVisitor())).body,
      );
      expect(team.therapists[0]?.photo?.alt).toBe('تصویر درمانگر در اتاق درمان');

      const profile = publicTherapistProfileResponseSchema.parse(
        (await request(server()).get('/public/team/synthetic-colleague').set(asVisitor())).body,
      );
      expect(profile.therapist.photo?.alt).toBe('تصویر درمانگر در اتاق درمان');
    }, 60_000);

    it('corrects every page a shared photograph is on, and names each live one', async () => {
      // ONE DESCRIPTION PER ASSET: the consequence of the design, pinned. A
      // photograph on the team page and on an article is described once, and
      // one correction reaches both.
      const { asset, attachmentId } = await servedPortrait();
      const articleId = await publishedArticle('shared-photo-article');
      const articleAttachmentId = await attach(asset.id, {
        ownerType: 'PUBLIC_ARTICLE',
        ownerId: articleId,
      });
      await publish(articleAttachmentId);

      // A third, unpublished use: not live, so not named.
      await request(server())
        .post('/content/articles')
        .set(as(receptionist))
        .send(articleDraft('draft-article'))
        .then(async (draft) => {
          const draftId = articleResponseSchema.parse(draft.body).article.id;
          await attach(asset.id, { ownerType: 'PUBLIC_ARTICLE', ownerId: draftId });
        });

      const response = await describeAs(asset.id, 'یک توضیح برای همه‌جا', manager);
      const body = mediaAltTextResponseSchema.parse(response.body);

      expect(body.publications.map((item) => item.attachmentId).sort()).toEqual(
        [attachmentId, articleAttachmentId].sort(),
      );
      expect(
        body.publications.find((item) => item.ownerType === 'PUBLIC_ARTICLE')?.publicSlug,
      ).toBe('shared-photo-article');

      const article = publicArticleDetailResponseSchema.parse(
        (await request(server()).get('/public/articles/shared-photo-article').set(asVisitor()))
          .body,
      );
      expect(article.article.images[0]?.alt).toBe('یک توضیح برای همه‌جا');

      const team = publicTeamResponseSchema.parse(
        (await request(server()).get('/public/team').set(asVisitor())).body,
      );
      expect(team.therapists[0]?.photo?.alt).toBe('یک توضیح برای همه‌جا');
    }, 60_000);
  });

  // --- the request itself -------------------------------------------------

  describe('the request', () => {
    it('applies the upload rules: plain text, 1 to 200 characters', async () => {
      const asset = await uploadPhoto(harness, receptionist);

      for (const invalid of ['', '   ', '<b>توضیح</b>', 'ا'.repeat(201), null, 42]) {
        const response = await describeAs(asset.id, invalid, manager);
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      }

      const extra = await request(server())
        .patch(`/media/${asset.id}/alt-text`)
        .set(as(manager))
        .send({ altText: 'توضیح', isPublished: true });
      expect(extra.status).toBe(400);

      expect((await describeAs(asset.id, 'ا'.repeat(200), manager)).status).toBe(200);
    }, 60_000);

    it('writes nothing when the description is unchanged', async () => {
      const { asset } = await servedPortrait();

      const response = await describeAs(asset.id, 'تصویر با غلط تایپی', manager);

      expect(response.status).toBe(200);
      expect(mediaAltTextResponseSchema.parse(response.body).publications).toEqual([]);
      expect(await auditRows(asset.id)).toEqual([]);
    }, 60_000);

    it('is MEDIA_NOT_FOUND for an unknown photograph', async () => {
      const response = await describeAs(uuidv7(), 'توضیح', manager);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('MEDIA_NOT_FOUND');
    });

    it('requires a session and media.attach', async () => {
      const asset = await uploadPhoto(harness, receptionist);

      const anonymous = await request(server())
        .patch(`/media/${asset.id}/alt-text`)
        .set(asVisitor())
        .send({ altText: 'توضیح' });

      expect(anonymous.status).toBe(401);
      expect(await auditActionsFor(harness, 'media_asset', asset.id)).toEqual(['media.uploaded']);
    }, 60_000);
  });
});
