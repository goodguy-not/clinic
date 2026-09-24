import request from 'supertest';
import {
  PUBLIC_MEDIA_MAX_AGE_SECONDS,
  PUBLIC_MEDIA_REVOCATION_WINDOW_SECONDS,
  articleResponseSchema,
  mediaAssetResponseSchema,
  mediaPublicationResponseSchema,
  publicArticleDetailResponseSchema,
  publicClinicProfileResponseSchema,
  publicTeamResponseSchema,
  publicTestimonialListResponseSchema,
  publicTherapistProfileResponseSchema,
  testimonialResponseSchema,
  type MediaAsset,
} from '@clinic/contracts';
import { uuidv7 } from '../src/common/uuid';
import { createHarness, resetDatabase, type Harness } from './harness';
import {
  articleDraft,
  as,
  asVisitor,
  auditActionsFor,
  loginAs,
  testimonialDraft,
} from './website-support';
import { metadataFingerprintsIn, uploadPhoto } from './media-support';

/**
 * THE REFUSAL MATRIX. What a stranger can and cannot fetch, and how quickly a
 * decision to take something down takes effect.
 *
 * Milestone 9.5, checkpoint A5, and this file is WRITTEN AS AN ATTACK, exactly
 * as the A1 and A2 public suites are. The serving rule has four conditions —
 * the asset is in circulation, the attachment stands, a manager published it,
 * and the owner is itself public — and almost every test below satisfies three
 * of them and breaks the fourth.
 *
 * THE ONE ANSWER TO EVERY FAILURE IS 404 `MEDIA_NOT_FOUND`. Two answers would
 * let a stranger walk the identifier space and learn which photographs the
 * clinic is holding back, which is the disclosure the publication rule exists
 * to prevent.
 *
 * Everything is synthetic. See `media-support.ts`.
 */
describe('anonymous media access (real PostgreSQL)', () => {
  let harness: Harness;
  let manager: string;
  let receptionist: string;
  let actorId: string;
  let therapistId: string;

  beforeAll(async () => {
    harness = await createHarness();
  }, 60_000);

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

  const attach = (
    mediaId: string,
    body: Record<string, unknown>,
    session = receptionist,
  ): request.Test =>
    request(server()).post(`/media/${mediaId}/attachments`).set(as(session)).send(body);

  const setPublished = (attachmentId: string, isPublished: boolean, session = manager) =>
    request(server())
      .patch(`/media/attachments/${attachmentId}/publication`)
      .set(as(session))
      .send({ isPublished });

  const setArchived = (mediaId: string, archived: boolean, session = manager) =>
    request(server()).patch(`/media/${mediaId}/archive`).set(as(session)).send({ archived });

  const detach = (attachmentId: string, session = receptionist) =>
    request(server()).delete(`/media/attachments/${attachmentId}`).set(as(session));

  const fetchMedia = (renditionId: string) =>
    request(server()).get(`/public/media/${renditionId}`).set(asVisitor());

  const firstRenditionOf = (asset: MediaAsset): string => {
    const rendition = asset.renditions[0];
    if (rendition === undefined) throw new Error('no rendition');
    return rendition.id;
  };

  /** A published therapist carrying a published portrait. Returns both ids. */
  async function publishedTherapistPortrait(): Promise<{
    asset: MediaAsset;
    attachmentId: string;
  }> {
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

    const uploaded = await uploadPhoto(harness, receptionist);
    const attached = await attach(uploaded.id, {
      ownerType: 'THERAPIST_PROFILE',
      ownerId: therapistId,
    });

    const attachmentId = mediaAssetResponseSchema.parse(attached.body).media.attachments[0]!.id;
    const published = await setPublished(attachmentId, true);

    return { asset: mediaPublicationResponseSchema.parse(published.body).media, attachmentId };
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

  async function approvedTestimonial(): Promise<string> {
    const draft = await request(server())
      .post('/content/testimonials')
      .set(as(receptionist))
      .send(testimonialDraft());

    const id = testimonialResponseSchema.parse(draft.body).testimonial.id;

    await request(server())
      .patch(`/content/testimonials/${id}/approval`)
      .set(as(manager))
      .send({ approved: true });
    await request(server())
      .patch(`/content/testimonials/${id}/publication`)
      .set(as(manager))
      .send({ isPublic: true });

    return id;
  }

  // --- criterion 6: published media IS retrievable ------------------------

  describe('a published photograph', () => {
    it('is retrievable by a visitor with no session', async () => {
      const { asset } = await publishedTherapistPortrait();
      const rendition = asset.renditions.find((item) => item.format === 'webp')!;

      const response = await fetchMedia(rendition.id);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('image/webp');
      expect(Number(response.headers['content-length'])).toBe(rendition.byteSize);
      expect(response.body).toBeInstanceOf(Buffer);
      expect((response.body as Buffer).byteLength).toBe(rendition.byteSize);
    }, 60_000);

    it('carries no metadata in the bytes a visitor actually receives', async () => {
      const { asset } = await publishedTherapistPortrait();

      const response = await fetchMedia(firstRenditionOf(asset));

      expect(metadataFingerprintsIn(response.body as Buffer)).toEqual([]);
    }, 60_000);

    it('is served with the stated revocation window and nothing longer', async () => {
      // THE CACHE PROMISE, ASSERTED. One number governs both the header and the
      // window the product states, so a future edit that lengthened the cache
      // without re-stating the promise fails here.
      const { asset } = await publishedTherapistPortrait();

      const response = await fetchMedia(firstRenditionOf(asset));
      const cacheControl = String(response.headers['cache-control']);

      expect(PUBLIC_MEDIA_MAX_AGE_SECONDS).toBe(PUBLIC_MEDIA_REVOCATION_WINDOW_SECONDS);
      expect(cacheControl).toContain('public');
      expect(cacheControl).toContain(`max-age=${PUBLIC_MEDIA_REVOCATION_WINDOW_SECONDS}`);
      expect(cacheControl).toContain(`s-maxage=${PUBLIC_MEDIA_REVOCATION_WINDOW_SECONDS}`);
      expect(cacheControl).toContain('must-revalidate');
      expect(cacheControl).not.toContain('immutable');

      // Anything longer than the stated window would be a promise the product
      // cannot keep.
      for (const directive of cacheControl.split(',')) {
        const match = /(?:s-)?max-age=(\d+)/.exec(directive.trim());
        if (match !== null) {
          expect(Number(match[1])).toBeLessThanOrEqual(PUBLIC_MEDIA_REVOCATION_WINDOW_SECONDS);
        }
      }
    }, 60_000);

    it('is served as an inline image the browser may not re-sniff', async () => {
      const { asset } = await publishedTherapistPortrait();

      const response = await fetchMedia(firstRenditionOf(asset));

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['content-disposition']).toBe('inline');
      // The uploader's file name is very often a family's surname and is
      // recorded nowhere, so it cannot appear here either.
      expect(response.headers['content-disposition']).not.toContain('filename');
    }, 60_000);

    it('revalidates to 304 on the content hash', async () => {
      const { asset } = await publishedTherapistPortrait();
      const rendition = asset.renditions[0]!;

      const first = await fetchMedia(rendition.id);
      const etag = String(first.headers.etag);
      expect(etag).toBe(`"${rendition.contentHash}"`);

      const second = await request(server())
        .get(`/public/media/${rendition.id}`)
        .set(asVisitor())
        .set('if-none-match', etag);

      expect(second.status).toBe(304);
      // The revalidation is a REVOCATION check as much as a freshness one: the
      // 304 is reached only after the publication predicate has said yes.
      expect(second.headers['cache-control']).toContain(
        `max-age=${PUBLIC_MEDIA_REVOCATION_WINDOW_SECONDS}`,
      );
    }, 60_000);
  });

  // --- criterion 5: the refusal matrix ------------------------------------

  describe('the refusal matrix', () => {
    const expectRefused = (response: request.Response) => {
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('MEDIA_NOT_FOUND');
      // A refusal is never cacheable: a stored 404 would outlive a manager
      // changing their mind.
      expect(response.headers['cache-control']).toBe('no-store');
    };

    it('refuses a rendition id that has never existed', async () => {
      expectRefused(await fetchMedia(uuidv7()));
    });

    it('refuses UNATTACHED media', async () => {
      const asset = await uploadPhoto(harness, receptionist);

      expectRefused(await fetchMedia(firstRenditionOf(asset)));
    }, 60_000);

    it('refuses DRAFT-ATTACHED media on a published owner', async () => {
      // Three of the four conditions hold: the asset is active, the attachment
      // stands, the therapist is public. Only the manager's publication is
      // missing, and that is the whole of the draft/publish split.
      await request(server())
        .patch(`/catalog/therapists/${therapistId}/public-profile`)
        .set(as(manager))
        .send({
          publicSlug: 'synthetic-colleague',
          displayName: 'Synthetic Display Name',
          title: null,
          bio: null,
          displayOrder: 0,
        });
      await request(server())
        .patch(`/catalog/therapists/${therapistId}/public-profile/visibility`)
        .set(as(manager))
        .send({ isPublic: true });

      const asset = await uploadPhoto(harness, receptionist);
      await attach(asset.id, { ownerType: 'THERAPIST_PROFILE', ownerId: therapistId });

      expectRefused(await fetchMedia(firstRenditionOf(asset)));
    }, 60_000);

    it('refuses a PUBLISHED attachment on an UNPUBLISHED owner', async () => {
      // The mirror image: the manager published the picture, the article is
      // still a draft. An image on an unpublished page is not public.
      const articleId = await publishedArticle('media-owner-article');
      const asset = await uploadPhoto(harness, receptionist);

      const attached = await attach(asset.id, {
        ownerType: 'PUBLIC_ARTICLE',
        ownerId: articleId,
      });
      const attachmentId = mediaAssetResponseSchema.parse(attached.body).media.attachments[0]!.id;
      await setPublished(attachmentId, true);

      expect((await fetchMedia(firstRenditionOf(asset))).status).toBe(200);

      await request(server())
        .patch(`/content/articles/${articleId}/publication`)
        .set(as(manager))
        .send({ isPublic: false });

      expectRefused(await fetchMedia(firstRenditionOf(asset)));
    }, 60_000);

    it('refuses ARCHIVED media, whatever it is attached to', async () => {
      const { asset } = await publishedTherapistPortrait();

      expect((await fetchMedia(firstRenditionOf(asset))).status).toBe(200);

      await setArchived(asset.id, true);

      // EVERY rendition, not merely the one asked for first.
      for (const rendition of asset.renditions) {
        expectRefused(await fetchMedia(rendition.id));
      }
    }, 60_000);

    it('refuses a previously published URL after the attachment is unpublished', async () => {
      const { asset, attachmentId } = await publishedTherapistPortrait();
      const renditionId = firstRenditionOf(asset);

      expect((await fetchMedia(renditionId)).status).toBe(200);

      await setPublished(attachmentId, false);

      // THE VERY NEXT REQUEST. The origin holds no cached answer of its own, so
      // there is no interval and no warm-up.
      expectRefused(await fetchMedia(renditionId));
    }, 60_000);

    it('refuses a DETACHED attachment', async () => {
      const { asset, attachmentId } = await publishedTherapistPortrait();
      const renditionId = firstRenditionOf(asset);

      // Detaching a published attachment is refused outright — the weaker
      // authority may not undo the stronger one's decision.
      const refused = await detach(attachmentId);
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('MEDIA_ATTACHMENT_PUBLISHED');
      expect((await fetchMedia(renditionId)).status).toBe(200);

      await setPublished(attachmentId, false);
      const detached = await detach(attachmentId);
      expect(detached.status).toBe(200);

      expectRefused(await fetchMedia(renditionId));
    }, 60_000);

    it('refuses a portrait once the therapist s public flag is cleared, without touching the media', async () => {
      // Clearing the opt-in takes the colleague off the website; their
      // photograph goes with them, because the public projection they hang off
      // stops returning them. (This used to be named "deactivated", which it
      // never was: it clears `is_public`. Deactivation is the next test.)
      const { asset } = await publishedTherapistPortrait();

      await request(server())
        .patch(`/catalog/therapists/${therapistId}/public-profile/visibility`)
        .set(as(manager))
        .send({ isPublic: false })
        .expect(200);

      expectRefused(await fetchMedia(firstRenditionOf(asset)));
    }, 60_000);

    it('refuses a deactivated therapist s portrait, while their public flag stays set', async () => {
      // Milestone 9.5 stabilisation. Deactivation writes `status` alone and
      // leaves `is_public` standing; the team page has always dropped an
      // inactive colleague, and now the portrait goes with them.
      const { asset } = await publishedTherapistPortrait();
      expect((await fetchMedia(firstRenditionOf(asset))).status).toBe(200);

      await request(server())
        .patch(`/catalog/therapists/${therapistId}/status`)
        .set(as(manager))
        .send({ status: 'INACTIVE' })
        .expect(200);

      const [row] = await harness.prisma.$queryRaw<{ is_public: boolean }[]>`
        SELECT is_public FROM therapist WHERE id = ${therapistId}::uuid
      `;
      expect(row!.is_public).toBe(true);
      expectRefused(await fetchMedia(firstRenditionOf(asset)));
    }, 60_000);

    it('refuses a testimonial photograph the moment its approval is withdrawn', async () => {
      // The most sensitive image this product serves: somebody's handwriting
      // about their own child. Withdrawing the privacy review unpublishes the
      // testimonial in the same transaction, and the picture goes with it.
      const testimonialId = await approvedTestimonial();
      const asset = await uploadPhoto(harness, receptionist);

      const attached = await attach(asset.id, {
        ownerType: 'PUBLIC_TESTIMONIAL',
        ownerId: testimonialId,
      });
      const attachmentId = mediaAssetResponseSchema.parse(attached.body).media.attachments[0]!.id;
      await setPublished(attachmentId, true);

      expect((await fetchMedia(firstRenditionOf(asset))).status).toBe(200);

      await request(server())
        .patch(`/content/testimonials/${testimonialId}/approval`)
        .set(as(manager))
        .send({ approved: false });

      expectRefused(await fetchMedia(firstRenditionOf(asset)));
    }, 60_000);

    it('gives a stranger the same answer for every reason', async () => {
      // The point of the matrix: an attacker walking the identifier space
      // cannot tell an unpublished photograph from one that does not exist.
      const unattached = await uploadPhoto(harness, receptionist);

      const answers = [
        await fetchMedia(uuidv7()),
        await fetchMedia(firstRenditionOf(unattached)),
      ].map((response) => ({ status: response.status, code: response.body.error.code }));

      expect(answers[0]).toEqual(answers[1]);
    }, 60_000);
  });

  // --- criterion 7: restoring works too -----------------------------------

  describe('restoring', () => {
    it('brings the same URL back, so a correction does not orphan a page', async () => {
      const { asset, attachmentId } = await publishedTherapistPortrait();
      const renditionId = firstRenditionOf(asset);

      await setArchived(asset.id, true);
      expect((await fetchMedia(renditionId)).status).toBe(404);

      await setArchived(asset.id, false);
      expect((await fetchMedia(renditionId)).status).toBe(200);

      await setPublished(attachmentId, false);
      expect((await fetchMedia(renditionId)).status).toBe(404);

      await setPublished(attachmentId, true);
      expect((await fetchMedia(renditionId)).status).toBe(200);
    }, 60_000);
  });

  // --- the public projections ---------------------------------------------

  describe('the public projections carry only published photographs', () => {
    it('puts a published portrait on the team page and the profile', async () => {
      const { asset } = await publishedTherapistPortrait();

      const team = publicTeamResponseSchema.parse(
        (await request(server()).get('/public/team').set(asVisitor())).body,
      );
      const profile = publicTherapistProfileResponseSchema.parse(
        (await request(server()).get('/public/team/synthetic-colleague').set(asVisitor())).body,
      );

      expect(team.therapists[0]?.photo?.mediaId).toBe(asset.id);
      expect(profile.therapist.photo?.mediaId).toBe(asset.id);
      expect(profile.therapist.photo?.renditions.length).toBe(asset.renditions.length);
      // The intrinsic size is the widest rendition's, which is what a layout
      // needs in order to reserve space.
      expect(profile.therapist.photo?.width).toBe(asset.width);
      expect(profile.therapist.photo?.height).toBe(asset.height);
    }, 60_000);

    it('omits a draft-attached portrait entirely', async () => {
      await request(server())
        .patch(`/catalog/therapists/${therapistId}/public-profile`)
        .set(as(manager))
        .send({
          publicSlug: 'synthetic-colleague',
          displayName: 'Synthetic Display Name',
          title: null,
          bio: null,
          displayOrder: 0,
        });
      await request(server())
        .patch(`/catalog/therapists/${therapistId}/public-profile/visibility`)
        .set(as(manager))
        .send({ isPublic: true });

      const asset = await uploadPhoto(harness, receptionist);
      await attach(asset.id, { ownerType: 'THERAPIST_PROFILE', ownerId: therapistId });

      const profile = publicTherapistProfileResponseSchema.parse(
        (await request(server()).get('/public/team/synthetic-colleague').set(asVisitor())).body,
      );

      expect(profile.therapist.photo).toBeNull();
    }, 60_000);

    it('puts published illustrations on an article, in the clinic s own order', async () => {
      const articleId = await publishedArticle('illustrated-article');

      const first = await uploadPhoto(harness, receptionist);
      const second = await uploadPhoto(harness, receptionist);

      for (const [asset, position] of [
        [second, 0],
        [first, 5],
      ] as const) {
        const attached = await attach(asset.id, {
          ownerType: 'PUBLIC_ARTICLE',
          ownerId: articleId,
          position,
        });
        const attachmentId = mediaAssetResponseSchema.parse(attached.body).media.attachments[0]!.id;
        await setPublished(attachmentId, true);
      }

      const article = publicArticleDetailResponseSchema.parse(
        (await request(server()).get('/public/articles/illustrated-article').set(asVisitor())).body,
      );

      expect(article.article.images.map((image) => image.mediaId)).toEqual([second.id, first.id]);
    }, 60_000);

    /**
     * `CLINIC_SPACE` IS A STAGING SLOT, AND NO PAGE READS IT.
     *
     * Milestone 9.5 stabilisation reverses what A5 froze here. A5 served a
     * published clinic-space photograph to anybody holding its rendition id
     * although no projection named it; the rule is now that bytes are servable
     * only while their owner is in its public projection, and this owner is in
     * none. Publishing is still accepted — it records a manager's intent — and
     * reaches nothing a visitor can fetch.
     */
    it('never serves a clinic-space photograph, published or not, and projects it onto no page', async () => {
      const asset = await uploadPhoto(harness, receptionist);

      const attached = await attach(asset.id, { ownerType: 'CLINIC_SPACE', ownerId: null });
      const attachmentId = mediaAssetResponseSchema.parse(attached.body).media.attachments[0]!.id;

      expect((await fetchMedia(firstRenditionOf(asset))).status).toBe(404);

      const published = await setPublished(attachmentId, true);
      expect(published.status).toBe(200);
      const identity = mediaPublicationResponseSchema.parse(published.body).publication;
      expect(identity.ownerIsPublic).toBe(false);

      expect((await fetchMedia(firstRenditionOf(asset))).status).toBe(404);

      // AND THE CLINIC PROFILE IS UNTOUCHED BY ANY OF IT. Thirteen owner-typed
      // facts, no gallery key, nothing about media at all.
      const clinic = publicClinicProfileResponseSchema.parse(
        (await request(server()).get('/public/clinic-profile').set(asVisitor())).body,
      );

      expect(Object.keys(clinic.clinic)).not.toContain('spacePhotos');
      expect(Object.values(clinic.clinic).every((value) => value === null)).toBe(true);
    }, 60_000);

    it('puts a published photograph on an approved testimonial and nowhere else', async () => {
      const testimonialId = await approvedTestimonial();
      const asset = await uploadPhoto(harness, receptionist);

      const attached = await attach(asset.id, {
        ownerType: 'PUBLIC_TESTIMONIAL',
        ownerId: testimonialId,
      });
      const attachmentId = mediaAssetResponseSchema.parse(attached.body).media.attachments[0]!.id;
      await setPublished(attachmentId, true);

      const testimonials = publicTestimonialListResponseSchema.parse(
        (await request(server()).get('/public/testimonials').set(asVisitor())).body,
      );

      expect(testimonials.testimonials[0]?.image?.mediaId).toBe(asset.id);
      // The projection is still four fields: no id, no date, no status.
      // `kind` is Milestone 9.5 checkpoint A7's only addition, and it says how
      // the words arrived rather than anything about who wrote them.
      expect(Object.keys(testimonials.testimonials[0]!).sort()).toEqual([
        'authorLabel',
        'body',
        'image',
        'kind',
      ]);
    }, 60_000);

    it('never names an internal media fact in a public projection', async () => {
      await publishedTherapistPortrait();

      const body = JSON.stringify(
        (await request(server()).get('/public/team').set(asVisitor())).body,
      );

      for (const internal of [
        'storageKey',
        'storage_key',
        'masterStorageKey',
        'attachments',
        'publishedAt',
        'isPubliclyServed',
        'sourceByteSize',
        'contentHash',
      ]) {
        expect(body).not.toContain(internal);
      }
    }, 60_000);
  });

  // --- criterion 10: the authority boundary --------------------------------

  describe('the authority boundary', () => {
    it('refuses a receptionist the publish, unpublish and archive routes', async () => {
      const asset = await uploadPhoto(harness, receptionist);
      const attached = await attach(asset.id, { ownerType: 'CLINIC_SPACE', ownerId: null });
      const attachmentId = mediaAssetResponseSchema.parse(attached.body).media.attachments[0]!.id;

      const publish = await setPublished(attachmentId, true, receptionist);
      expect(publish.status).toBe(403);
      expect(publish.body.error.code).toBe('AUTH_FORBIDDEN');

      const archive = await setArchived(asset.id, true, receptionist);
      expect(archive.status).toBe(403);

      // And nothing happened: the picture is still invisible.
      expect((await fetchMedia(firstRenditionOf(asset))).status).toBe(404);
    }, 60_000);

    it('creates every attachment unpublished, whoever attaches it', async () => {
      // Even a manager. There is no field on the attach request that could ask
      // for publication, so the two acts are always two audited decisions.
      const asset = await uploadPhoto(harness, manager);
      const attached = await attach(
        asset.id,
        { ownerType: 'CLINIC_SPACE', ownerId: null },
        manager,
      );
      const media = mediaAssetResponseSchema.parse(attached.body).media;

      expect(media.attachments[0]?.publishedAt).toBeNull();
      expect(media.isPubliclyServed).toBe(false);
    }, 60_000);

    it('audits attaching, publishing, unpublishing and archiving as separate acts', async () => {
      const { asset, attachmentId } = await publishedTherapistPortrait();

      await setPublished(attachmentId, false);
      await setArchived(asset.id, true);
      await setArchived(asset.id, false);

      expect(await auditActionsFor(harness, 'media_attachment', attachmentId)).toEqual([
        'media.attached',
        'media.published',
        'media.unpublished',
      ]);
      expect(await auditActionsFor(harness, 'media_asset', asset.id)).toEqual([
        'media.uploaded',
        'media.archived',
        'media.restored',
      ]);
    }, 60_000);

    it('refuses attaching an archived photograph', async () => {
      const asset = await uploadPhoto(harness, receptionist);
      await setArchived(asset.id, true);

      const response = await attach(asset.id, { ownerType: 'CLINIC_SPACE', ownerId: null });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('MEDIA_ARCHIVED');
    }, 60_000);

    it('refuses attaching the same photograph to one owner twice', async () => {
      const asset = await uploadPhoto(harness, receptionist);
      await attach(asset.id, { ownerType: 'CLINIC_SPACE', ownerId: null });

      const second = await attach(asset.id, { ownerType: 'CLINIC_SPACE', ownerId: null });

      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('MEDIA_ALREADY_ATTACHED');
    }, 60_000);

    it('refuses an attachment whose owner does not exist', async () => {
      const asset = await uploadPhoto(harness, receptionist);

      const response = await attach(asset.id, {
        ownerType: 'PUBLIC_ARTICLE',
        ownerId: uuidv7(),
      });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('ARTICLE_NOT_FOUND');
    }, 60_000);

    it('refuses an owner id on a clinic-space attachment, and its absence elsewhere', async () => {
      const asset = await uploadPhoto(harness, receptionist);

      const withOwner = await attach(asset.id, {
        ownerType: 'CLINIC_SPACE',
        ownerId: therapistId,
      });
      expect(withOwner.status).toBe(400);

      const withoutOwner = await attach(asset.id, {
        ownerType: 'THERAPIST_PROFILE',
        ownerId: null,
      });
      expect(withoutOwner.status).toBe(400);
    }, 60_000);
  });
});
