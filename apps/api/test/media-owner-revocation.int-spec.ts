import request from 'supertest';
import {
  articleResponseSchema,
  clinicContentResponseSchema,
  mediaAssetResponseSchema,
  serviceMutationResponseSchema,
  spaceResponseSchema,
  testimonialResponseSchema,
  type MediaAsset,
  type MediaAttachmentOwner,
} from '@clinic/contracts';
import { uuidv7 } from '../src/common/uuid';
import { createHarness, resetDatabase, type Harness } from './harness';
import { uploadPhoto } from './media-support';
import {
  articleDraft,
  as,
  asVisitor,
  assignedSlug,
  loginAs,
  spaceDraft,
  testimonialDraft,
} from './website-support';

/**
 * EVERY OWNER KIND, TAKEN OFF THE SITE BY ITS OWN REAL ACT, TAKES ITS
 * PHOTOGRAPH WITH IT.
 *
 * Milestone 9.5 stabilisation. The rule under test: a photograph is anonymously
 * servable only while its owner would appear in its public projection. Each
 * case below publishes an owner and its photograph, proves the bytes are
 * served AND the projection names them, then performs the one act a colleague
 * would really perform to take that owner down — through the HTTP route, never
 * by writing a column — and proves the very next anonymous request is refused
 * and the projection no longer names the owner. Where the act is reversible
 * the case reverses it and proves the bytes come back, so a refusal cannot be
 * passing for an unrelated reason.
 *
 * The media attachment itself is never touched after it is published. What
 * revokes the bytes is the owner, and nothing else.
 *
 * Every photograph is generated in code by `media-support.ts`.
 */
describe('owner revocation takes the photograph with it (real PostgreSQL)', () => {
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

  const visitorGet = (path: string) => request(server()).get(path).set(asVisitor());

  /** Uploads, attaches and publishes one photograph; returns a rendition path. */
  async function publishedPhotoOn(
    ownerType: MediaAttachmentOwner,
    ownerId: string | null,
  ): Promise<string> {
    const asset = await uploadPhoto(harness, receptionist);
    const attached = await request(server())
      .post(`/media/${asset.id}/attachments`)
      .set(as(receptionist))
      .send({ ownerType, ownerId, position: 0 });
    expect(attached.status).toBe(201);

    const attachment = mediaAssetResponseSchema
      .parse(attached.body)
      .media.attachments.find((item) => item.ownerType === ownerType && item.ownerId === ownerId);
    expect(attachment).toBeDefined();

    const published = await request(server())
      .patch(`/media/attachments/${attachment!.id}/publication`)
      .set(as(manager))
      .send({ isPublished: true });
    expect(published.status).toBe(200);

    return pathOf(asset);
  }

  const pathOf = (asset: MediaAsset): string => `media/${asset.renditions[0]!.id}`;

  const bytesStatus = async (path: string): Promise<number> =>
    (await visitorGet(`/public/${path}`)).status;

  /** Whether the serialised public read mentions this rendition path at all. */
  const projectionNames = async (route: string, path: string): Promise<boolean> =>
    JSON.stringify((await visitorGet(route)).body).includes(path);

  async function expectLive(route: string, path: string): Promise<void> {
    expect(await bytesStatus(path)).toBe(200);
    expect(await projectionNames(route, path)).toBe(true);
  }

  async function expectGone(route: string, path: string): Promise<void> {
    expect(await bytesStatus(path)).toBe(404);
    expect(await projectionNames(route, path)).toBe(false);
  }

  it('THERAPIST_PROFILE: deactivating the colleague refuses the portrait; reactivating restores it', async () => {
    const actorId = (
      await harness.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM app_user WHERE role = 'MANAGER'::user_role LIMIT 1
      `
    )[0]!.id;
    const therapistId = uuidv7();
    await harness.prisma.$executeRaw`
      INSERT INTO therapist (id, full_name, specialty, status, created_at, created_by_user_id)
      VALUES (
        ${therapistId}::uuid, 'Synthetic Colleague', 'Synthetic Specialty',
        'ACTIVE'::catalog_status, transaction_timestamp(), ${actorId}::uuid
      )
    `;
    await request(server())
      .patch(`/catalog/therapists/${therapistId}/public-profile`)
      .set(as(manager))
      .send({
        displayName: 'Synthetic Display Name',
        title: 'Synthetic Public Title',
        bio: 'Synthetic biography written for a test.',
        displayOrder: 10,
      })
      .expect(200);
    await request(server())
      .patch(`/catalog/therapists/${therapistId}/public-profile/visibility`)
      .set(as(manager))
      .send({ isPublic: true })
      .expect(200);

    const path = await publishedPhotoOn('THERAPIST_PROFILE', therapistId);
    await expectLive('/public/team', path);

    const setStatus = (status: 'ACTIVE' | 'INACTIVE') =>
      request(server())
        .patch(`/catalog/therapists/${therapistId}/status`)
        .set(as(manager))
        .send({ status })
        .expect(200);

    // The act a manager performs when a colleague leaves. It writes `status`
    // and leaves `is_public` exactly where it was.
    await setStatus('INACTIVE');
    const [row] = await harness.prisma.$queryRaw<{ is_public: boolean }[]>`
      SELECT is_public FROM therapist WHERE id = ${therapistId}::uuid
    `;
    expect(row!.is_public).toBe(true);
    await expectGone('/public/team', path);
    expect(
      (await visitorGet(`/public/team/${await assignedSlug(harness, 'therapist', therapistId)}`))
        .status,
    ).toBe(404);

    await setStatus('ACTIVE');
    await expectLive('/public/team', path);
  }, 60_000);

  it('PUBLIC_SERVICE: deactivating the service refuses its photograph; reactivating restores it', async () => {
    const created = await request(server())
      .post('/catalog/services')
      .set(as(manager))
      .send({
        name: 'Synthetic revocation service',
        publicDescription: 'Synthetic public description.',
        isPublic: true,
        allowedDurationsMinutes: [45],
      })
      .expect(201);
    const serviceId = serviceMutationResponseSchema.parse(created.body).service.id;

    const path = await publishedPhotoOn('PUBLIC_SERVICE', serviceId);
    await expectLive('/public/services', path);

    const setStatus = (status: 'ACTIVE' | 'INACTIVE') =>
      request(server())
        .patch(`/catalog/services/${serviceId}/status`)
        .set(as(manager))
        .send({ status })
        .expect(200);

    await setStatus('INACTIVE');
    await expectGone('/public/services', path);

    await setStatus('ACTIVE');
    await expectLive('/public/services', path);
  }, 60_000);

  it('PUBLIC_ARTICLE: unpublishing the article refuses its illustration; republishing restores it', async () => {
    const draft = await request(server())
      .post('/content/articles')
      .set(as(receptionist))
      .send(articleDraft('synthetic-revocation-article'))
      .expect(201);
    const articleId = articleResponseSchema.parse(draft.body).article.id;

    const setPublic = (isPublic: boolean) =>
      request(server())
        .patch(`/content/articles/${articleId}/publication`)
        .set(as(manager))
        .send({ isPublic })
        .expect(200);

    await setPublic(true);
    const path = await publishedPhotoOn('PUBLIC_ARTICLE', articleId);
    await expectLive('/public/articles', path);

    await setPublic(false);
    await expectGone('/public/articles', path);

    await setPublic(true);
    await expectLive('/public/articles', path);
  }, 60_000);

  it('PUBLIC_TESTIMONIAL: withdrawing approval refuses the photographed note', async () => {
    const draft = await request(server())
      .post('/content/testimonials')
      .set(as(receptionist))
      .send(testimonialDraft())
      .expect(201);
    const testimonialId = testimonialResponseSchema.parse(draft.body).testimonial.id;

    await request(server())
      .patch(`/content/testimonials/${testimonialId}/approval`)
      .set(as(manager))
      .send({ approved: true })
      .expect(200);
    await request(server())
      .patch(`/content/testimonials/${testimonialId}/publication`)
      .set(as(manager))
      .send({ isPublic: true })
      .expect(200);

    const path = await publishedPhotoOn('PUBLIC_TESTIMONIAL', testimonialId);
    await expectLive('/public/testimonials', path);

    await request(server())
      .patch(`/content/testimonials/${testimonialId}/approval`)
      .set(as(manager))
      .send({ approved: false })
      .expect(200);
    await expectGone('/public/testimonials', path);
  }, 60_000);

  it('PUBLIC_SPACE: unpublishing the space refuses its photograph; republishing restores it', async () => {
    const created = await request(server())
      .post('/content/spaces')
      .set(as(receptionist))
      .send(spaceDraft())
      .expect(201);
    const spaceId = spaceResponseSchema.parse(created.body).space.id;

    const setPublic = (isPublic: boolean) =>
      request(server())
        .patch(`/content/spaces/${spaceId}/publication`)
        .set(as(manager))
        .send({ isPublic })
        .expect(200);

    await setPublic(true);
    const path = await publishedPhotoOn('PUBLIC_SPACE', spaceId);
    await expectLive('/public/spaces', path);

    await setPublic(false);
    await expectGone('/public/spaces', path);

    await setPublic(true);
    await expectLive('/public/spaces', path);
  }, 60_000);

  it('CLINIC_CONTENT_ENTRY: clearing the block refuses its photograph; rewriting restores it', async () => {
    const listed = await request(server())
      .get('/content/clinic-profile/entries')
      .set(as(manager))
      .expect(200);
    const entry = clinicContentResponseSchema.parse(listed.body).entries[0]!;

    const save = (body: Record<string, string | null>) =>
      request(server())
        .put(`/content/clinic-profile/entries/${entry.id}`)
        .set(as(manager))
        .send(body)
        .expect(200);

    const written = {
      label: 'Synthetic label',
      eyebrow: 'Synthetic kicker',
      heading: 'Synthetic heading',
      body: 'Synthetic paragraph about a clinic that does not exist.',
    };

    await save(written);
    const path = await publishedPhotoOn('CLINIC_CONTENT_ENTRY', entry.id);
    await expectLive('/public/clinic-content', path);

    await save({ label: null, eyebrow: null, heading: null, body: null });
    await expectGone('/public/clinic-content', path);

    await save(written);
    await expectLive('/public/clinic-content', path);
  }, 60_000);

  it('CLINIC_OPEN_GRAPH: served while published, because the always-live profile reads it', async () => {
    const path = await publishedPhotoOn('CLINIC_OPEN_GRAPH', null);

    await expectLive('/public/clinic-content', path);
  }, 60_000);

  it('CLINIC_SPACE: never served, even published, because no projection reads it', async () => {
    const path = await publishedPhotoOn('CLINIC_SPACE', null);

    expect(await bytesStatus(path)).toBe(404);
    for (const route of [
      '/public/clinic-profile',
      '/public/clinic-content',
      '/public/spaces',
      '/public/services',
      '/public/team',
      '/public/articles',
      '/public/testimonials',
    ]) {
      expect(await projectionNames(route, path)).toBe(false);
    }
  }, 60_000);
});
