import request from 'supertest';
import {
  MEDIA_PREVIEW_CACHE_CONTROL,
  MEDIA_RENDITION_CONTENT_TYPE,
  PUBLIC_MEDIA_MAX_AGE_SECONDS,
  articleResponseSchema,
  mediaAssetResponseSchema,
  serviceResponseSchema,
  testimonialResponseSchema,
  type MediaAsset,
} from '@clinic/contracts';
import { uuidv7 } from '../src/common/uuid';
import { createHarness, resetDatabase, type Harness, ownerPrisma } from './harness';
import { articleDraft, as, asVisitor, loginAs, testimonialDraft } from './website-support';
import {
  metadataFingerprintsIn,
  storedMasterBytes,
  storedRenditionBytes,
  syntheticPhonePhoto,
  uploadPhoto,
} from './media-support';

/**
 * STAFF PREVIEW OF PERSISTED, UNPUBLISHED MEDIA.
 *
 * Milestone 9.5, the staff-preview checkpoint. Written as the A5 suite is — as
 * an attack — with one addition: the cross-session review that motivated the
 * route. A receptionist uploads, attaches and frames a synthetic photograph and
 * then logs out, taking any browser-local preview with them; a manager in a
 * separate session must still see the persisted rendition, while a visitor
 * must go on seeing nothing at all.
 *
 * Everything is synthetic. See `media-support.ts`.
 */
describe('staff media preview (real PostgreSQL)', () => {
  let harness: Harness;
  let manager: string;
  let receptionist: string;

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
  });

  const server = () => harness.app.getHttpServer();

  const preview = (renditionId: string, headers: Record<string, string>) =>
    request(server())
      .get(`/media/renditions/${renditionId}/preview`)
      .set(headers)
      .responseType('blob');

  const fetchPublic = (renditionId: string) =>
    request(server()).get(`/public/media/${renditionId}`).set(asVisitor()).responseType('blob');

  const attach = (mediaId: string, body: Record<string, unknown>, session = receptionist) =>
    request(server()).post(`/media/${mediaId}/attachments`).set(as(session)).send(body);

  const firstAttachmentId = (response: request.Response): string =>
    mediaAssetResponseSchema.parse(response.body).media.attachments[0]!.id;

  const renditionOf = (asset: MediaAsset): string => asset.renditions[0]!.id;

  async function draftArticle(): Promise<string> {
    const response = await request(server())
      .post('/content/articles')
      .set(as(receptionist))
      .send(articleDraft(`synthetic-preview-${uuidv7().slice(-8)}`));
    expect(response.status).toBe(201);
    return articleResponseSchema.parse(response.body).article.id;
  }

  /** Receptionist: upload + attach to a draft article + frame. Nothing published. */
  async function preparedArticleImage(): Promise<{ asset: MediaAsset; attachmentId: string }> {
    const articleId = await draftArticle();
    const asset = await uploadPhoto(harness, receptionist);
    const attached = await attach(asset.id, { ownerType: 'PUBLIC_ARTICLE', ownerId: articleId });
    expect(attached.status).toBe(201);
    const attachmentId = firstAttachmentId(attached);

    const framed = await request(server())
      .patch(`/media/attachments/${attachmentId}/framing`)
      .set(as(receptionist))
      .send({ focalX: 0.3, focalY: 0.6, crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.7 } });
    expect(framed.status).toBe(200);

    return { asset, attachmentId };
  }

  function expectPrivatePreview(response: request.Response): void {
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe(MEDIA_PREVIEW_CACHE_CONTROL);
    expect(response.headers['cache-control']).not.toContain('public');
    expect(response.headers['cache-control']).not.toContain('max-age');
    expect(response.headers['etag']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-disposition']).toBe('inline');
  }

  function expectNotFound(response: request.Response): void {
    expect(response.status).toBe(404);
    expect(JSON.parse((response.body as Buffer).toString('utf8')).error.code).toBe(
      'MEDIA_NOT_FOUND',
    );
    expect(response.headers['cache-control']).toBe('no-store');
  }

  // --- the product outcome ----------------------------------------------------

  it('lets a manager in a separate session review a draft image the uploader prepared', async () => {
    const { asset } = await preparedArticleImage();
    const renditionId = renditionOf(asset);

    // The uploader's session — and with it any browser-local object URL — ends.
    const logout = await request(server()).post('/auth/logout').set(as(receptionist));
    expect(logout.status).toBe(204);
    expect((await preview(renditionId, as(receptionist))).status).toBe(401);

    // Before publication, the world sees nothing ...
    expectNotFound(await fetchPublic(renditionId));

    // ... and the manager, separately signed in, sees the persisted rendition.
    const reviewed = await preview(renditionId, as(manager));
    expectPrivatePreview(reviewed);
    expect(reviewed.headers['content-type']).toBe(
      MEDIA_RENDITION_CONTENT_TYPE[asset.renditions[0]!.format],
    );
    expect(
      Buffer.compare(reviewed.body as Buffer, await storedRenditionBytes(harness, renditionId)),
    ).toBe(0);

    // Every size the web tier might ask for is reviewable, not just the first.
    for (const rendition of asset.renditions) {
      expectPrivatePreview(await preview(rendition.id, as(manager)));
    }

    // Reviewing is not publishing: the world still sees nothing afterwards.
    expectNotFound(await fetchPublic(renditionId));
  });

  it('lets a manager review a handwritten-testimonial image before approval', async () => {
    const created = await request(server())
      .post('/content/testimonials')
      .set(as(receptionist))
      .send(
        testimonialDraft({
          kind: 'HANDWRITTEN',
          body: 'Synthetic transcription of a note that does not exist. It names nobody.',
        }),
      );
    expect(created.status).toBe(201);
    const testimonialId = testimonialResponseSchema.parse(created.body).testimonial.id;

    const asset = await uploadPhoto(harness, receptionist);
    expect(
      (await attach(asset.id, { ownerType: 'PUBLIC_TESTIMONIAL', ownerId: testimonialId })).status,
    ).toBe(201);

    expectPrivatePreview(await preview(renditionOf(asset), as(manager)));
    expectPrivatePreview(await preview(renditionOf(asset), as(receptionist)));
    expectNotFound(await fetchPublic(renditionOf(asset)));
  });

  // --- the request matrix -----------------------------------------------------

  it('refuses a request without a session, and one without the internal key', async () => {
    const { asset } = await preparedArticleImage();
    const renditionId = renditionOf(asset);

    const anonymous = await preview(renditionId, asVisitor());
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers['content-type']).toContain('application/json');
    expect(JSON.parse((anonymous.body as Buffer).toString('utf8')).error.code).toMatch(/^AUTH_/);
    expect(anonymous.headers['cache-control']).toBe('no-store');

    const bogusSession = await preview(renditionId, as('not-a-real-session-token'));
    expect(bogusSession.status).toBe(401);

    const noKey = await request(server())
      .get(`/media/renditions/${renditionId}/preview`)
      .set({ 'x-session-id': manager });
    expect(noKey.status).toBe(401);
    expect(noKey.body.error.code).toBe('AUTH_INTERNAL_KEY_INVALID');
  });

  it('lets both roles review a draft SERVICE image, and shows a visitor nothing', async () => {
    // Milestone 9.5, checkpoint A9. A service photograph adds no permission:
    // `service.draft_public_copy` is the editorial read of a service's public
    // copy, the receptionist and the manager both hold it, and a draft
    // photograph for that service is part of the same draft. The service here
    // is private and unaddressed — which is what preparing one looks like.
    const created = await request(server())
      .post('/catalog/services')
      .set(as(manager))
      .send({
        name: `Synthetic service ${uuidv7().slice(-8)}`,
        publicDescription: 'Synthetic draft copy. It names nobody.',
        isPublic: false,
        allowedDurationsMinutes: [45],
      });
    expect(created.status).toBe(201);
    const serviceId = serviceResponseSchema.parse(created.body).service.id;

    const asset = await uploadPhoto(harness, receptionist);
    expect(
      (await attach(asset.id, { ownerType: 'PUBLIC_SERVICE', ownerId: serviceId })).status,
    ).toBe(201);

    expectPrivatePreview(await preview(renditionOf(asset), as(receptionist)));
    expectPrivatePreview(await preview(renditionOf(asset), as(manager)));

    // Reviewing is not publishing, and the service is not even public.
    expectNotFound(await fetchPublic(renditionOf(asset)));
  });

  it('refuses staff who cannot read the owning content, and serves those who can', async () => {
    // The clinic's social-preview slot is the manager's surface (`clinic_profile.read`).
    // A receptionist can attach to it under `media.attach` but cannot read it.
    const asset = await uploadPhoto(harness, receptionist);
    expect((await attach(asset.id, { ownerType: 'CLINIC_OPEN_GRAPH', ownerId: null })).status).toBe(
      201,
    );

    expectNotFound(await preview(renditionOf(asset), as(receptionist)));
    expectPrivatePreview(await preview(renditionOf(asset), as(manager)));
    expectNotFound(await fetchPublic(renditionOf(asset)));

    // The same asset ALSO placed where the receptionist can read is theirs to see:
    // the rule is "some standing attachment you may read", not a per-asset flag.
    const articleId = await draftArticle();
    expect(
      (await attach(asset.id, { ownerType: 'PUBLIC_ARTICLE', ownerId: articleId })).status,
    ).toBe(201);
    expectPrivatePreview(await preview(renditionOf(asset), as(receptionist)));
  });

  it('refuses an unattached upload and one whose only attachment was detached', async () => {
    const asset = await uploadPhoto(harness, receptionist);
    expectNotFound(await preview(renditionOf(asset), as(manager)));

    const articleId = await draftArticle();
    const attached = await attach(asset.id, { ownerType: 'PUBLIC_ARTICLE', ownerId: articleId });
    expectPrivatePreview(await preview(renditionOf(asset), as(manager)));

    const detached = await request(server())
      .delete(`/media/attachments/${firstAttachmentId(attached)}`)
      .set(as(receptionist));
    expect(detached.status).toBe(200);
    expectNotFound(await preview(renditionOf(asset), as(manager)));
  });

  it('refuses an archived asset until it is restored', async () => {
    const { asset } = await preparedArticleImage();
    const renditionId = renditionOf(asset);

    const archive = (archived: boolean) =>
      request(server()).patch(`/media/${asset.id}/archive`).set(as(manager)).send({ archived });

    expect((await archive(true)).status).toBe(200);
    expectNotFound(await preview(renditionId, as(manager)));
    expectNotFound(await preview(renditionId, as(receptionist)));

    expect((await archive(false)).status).toBe(200);
    expectPrivatePreview(await preview(renditionId, as(manager)));
  });

  it('refuses erased bytes', async () => {
    const { asset } = await preparedArticleImage();
    const renditionId = renditionOf(asset);

    await ownerPrisma().$executeRaw`
      UPDATE media_rendition
      SET storage_key = NULL, bytes_purged_at = transaction_timestamp()
      WHERE id = ${renditionId}::uuid
    `;

    expectNotFound(await preview(renditionId, as(manager)));
  });

  it('cannot name the master, an asset, or an unknown id', async () => {
    const { asset } = await preparedArticleImage();

    expectNotFound(await preview(asset.id, as(manager)));
    expectNotFound(await preview(uuidv7(), as(manager)));

    const malformed = await preview('not-a-uuid', as(manager));
    expect(malformed.status).toBe(400);
    expect(JSON.parse((malformed.body as Buffer).toString('utf8')).error.code).toBe(
      'VALIDATION_FAILED',
    );
  });

  // --- privacy ----------------------------------------------------------------

  it('serves only the stored re-encoded rendition: no source bytes, no metadata, no names', async () => {
    const source = await syntheticPhonePhoto();
    expect(metadataFingerprintsIn(source).length).toBeGreaterThan(0);

    const articleId = await draftArticle();
    const asset = await uploadPhoto(harness, receptionist, {
      bytes: source,
      fileName: 'Synthetic-Family-Surname.jpg',
    });
    await attach(asset.id, { ownerType: 'PUBLIC_ARTICLE', ownerId: articleId });

    const master = await storedMasterBytes(harness, asset.id);
    const storageKeys = await harness.prisma.$queryRaw<{ storage_key: string }[]>`
      SELECT storage_key FROM media_rendition WHERE media_asset_id = ${asset.id}::uuid
    `;

    for (const rendition of asset.renditions) {
      const response = await preview(rendition.id, as(manager));
      expectPrivatePreview(response);

      const body = response.body as Buffer;
      expect(metadataFingerprintsIn(body)).toEqual([]);
      expect(Buffer.compare(body, source)).not.toBe(0);
      expect(Buffer.compare(body, master)).not.toBe(0);
      expect(Buffer.compare(body, await storedRenditionBytes(harness, rendition.id))).toBe(0);

      const headers = JSON.stringify(response.headers);
      expect(headers).not.toContain('Synthetic-Family-Surname');
      for (const { storage_key } of storageKeys) {
        expect(headers).not.toContain(storage_key);
      }
      expect(headers).not.toContain(asset.id.replace(/-/g, '').slice(0, 4));
    }
  });

  // --- the public boundary, unchanged -----------------------------------------

  it('leaves the public route exactly as it was once the image is really live', async () => {
    const { asset, attachmentId } = await preparedArticleImage();
    const renditionId = renditionOf(asset);
    const articleId = mediaAssetResponseSchema.parse(
      (await request(server()).get(`/media/${asset.id}`).set(as(manager))).body,
    ).media.attachments[0]!.ownerId!;

    // Attachment published, article still a draft: the world still sees nothing.
    expect(
      (
        await request(server())
          .patch(`/media/attachments/${attachmentId}/publication`)
          .set(as(manager))
          .send({ isPublished: true })
      ).status,
    ).toBe(200);
    expectNotFound(await fetchPublic(renditionId));

    // Article published: the public route serves with its own, unchanged policy.
    expect(
      (
        await request(server())
          .patch(`/content/articles/${articleId}/publication`)
          .set(as(manager))
          .send({ isPublic: true })
      ).status,
    ).toBe(200);

    const live = await fetchPublic(renditionId);
    expect(live.status).toBe(200);
    expect(live.headers['cache-control']).toBe(
      `public, max-age=${PUBLIC_MEDIA_MAX_AGE_SECONDS}, s-maxage=${PUBLIC_MEDIA_MAX_AGE_SECONDS}, must-revalidate`,
    );
    expect(live.headers['etag']).toBe(`"${asset.renditions[0]!.contentHash}"`);

    // The preview of a live image is still private, and still the same bytes.
    const previewed = await preview(renditionId, as(manager));
    expectPrivatePreview(previewed);
    expect(Buffer.compare(previewed.body as Buffer, live.body as Buffer)).toBe(0);
  });
});
