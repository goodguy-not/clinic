import request from 'supertest';
import { publicSpaceListResponseSchema, spaceResponseSchema } from '@clinic/contracts';
import { createHarness, resetDatabase, type Harness } from './harness';
import { uploadPhoto } from './media-support';
import { as, asVisitor, loginAs, spaceDraft } from './website-support';

/**
 * A photograph of the clinic's building, and the two gates between it and a
 * stranger.
 *
 * Milestone 9.5, checkpoint A7, over real HTTP against real PostgreSQL.
 *
 * THE A5 SYSTEM IS USED, NOT REDESIGNED, AND THIS SUITE PROVES THE JOIN. A
 * space's image is an ordinary `media_attachment` under an ordinary owner type,
 * so it inherits every A5 invariant — the master is unservable, EXIF is
 * stripped, attaching is drafting, a refusal is always `MEDIA_NOT_FOUND`. What
 * A7 adds is the FOURTH condition of the serving predicate finally having a row
 * to consult for a space: the picture is reachable only while the SPACE is
 * published too.
 *
 * SO THERE ARE TWO MANAGER GATES, AND THE SUITE OPENS AND CLOSES EACH ONE
 * INDEPENDENTLY:
 *
 *   attachment published?  — `media.publish`
 *   space published?       — `public_space.publish`
 *
 * Both must be open. Either one closing revokes the bytes at the origin on the
 * very next request.
 *
 * Every photograph here is generated in code by `media-support.ts`. No real
 * clinic room, no real person and no real handwriting appears anywhere.
 */
describe('public space imagery (real PostgreSQL)', () => {
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

  async function createSpace(session: string): Promise<string> {
    const response = await request(server())
      .post('/content/spaces')
      .set(as(session))
      .send(spaceDraft());

    expect(response.status).toBe(201);
    return spaceResponseSchema.parse(response.body).space.id;
  }

  async function publishSpace(id: string, isPublic: boolean) {
    return request(server())
      .patch(`/content/spaces/${id}/publication`)
      .set(as(manager))
      .send({ isPublic });
  }

  /** Uploads a photograph and attaches it to a space, as a receptionist. */
  async function attachTo(spaceId: string): Promise<{ mediaId: string; attachmentId: string }> {
    const asset = await uploadPhoto(harness, receptionist);

    const attached = await request(server())
      .post(`/media/${asset.id}/attachments`)
      .set(as(receptionist))
      .send({ ownerType: 'PUBLIC_SPACE', ownerId: spaceId, position: 0 });

    expect(attached.status).toBe(201);

    const attachment = attached.body.media.attachments.find(
      (item: { ownerType: string; ownerId: string | null }) =>
        item.ownerType === 'PUBLIC_SPACE' && item.ownerId === spaceId,
    );

    expect(attachment).toBeDefined();
    return { mediaId: asset.id, attachmentId: attachment.id as string };
  }

  async function publishAttachment(attachmentId: string, isPublished: boolean) {
    return request(server())
      .patch(`/media/attachments/${attachmentId}/publication`)
      .set(as(manager))
      .send({ isPublished });
  }

  /** Every rendition path the anonymous gallery currently offers for a space. */
  async function galleryPaths(): Promise<string[]> {
    const response = await request(server()).get('/public/spaces').set(asVisitor());
    const spaces = publicSpaceListResponseSchema.parse(response.body).spaces;

    return spaces.flatMap((space) =>
      space.images.flatMap((image) => image.renditions.map((rendition) => rendition.path)),
    );
  }

  /**
   * Asks for one rendition's bytes as a visitor would.
   *
   * The projection returns the relative path `media/<renditionId>`; the API
   * route is `/public/` + that, which is the resolution the web tier performs.
   */
  async function fetchBytes(path: string) {
    return request(server()).get(`/public/${path}`).set(asVisitor());
  }

  describe('attaching is drafting', () => {
    it('makes nothing visible when a receptionist attaches a photograph', async () => {
      const spaceId = await createSpace(receptionist);
      await publishSpace(spaceId, true);

      await attachTo(spaceId);

      // The space is live; the picture is not. Attaching cannot publish, and
      // there is no field on the attach request that could ask it to.
      const response = await request(server()).get('/public/spaces').set(asVisitor());
      const spaces = publicSpaceListResponseSchema.parse(response.body).spaces;

      expect(spaces).toHaveLength(1);
      expect(spaces[0]?.images).toEqual([]);
    });

    it('refuses a receptionist the attachment publication route', async () => {
      const spaceId = await createSpace(receptionist);
      await publishSpace(spaceId, true);
      const { attachmentId } = await attachTo(spaceId);

      const refused = await request(server())
        .patch(`/media/attachments/${attachmentId}/publication`)
        .set(as(receptionist))
        .send({ isPublished: true });

      expect(refused.status).toBe(403);
      expect(await galleryPaths()).toEqual([]);
    });
  });

  describe('both gates, independently', () => {
    it('serves the bytes only when the attachment AND the space are published', async () => {
      const spaceId = await createSpace(receptionist);
      const { attachmentId } = await attachTo(spaceId);

      // Neither gate open.
      expect(await galleryPaths()).toEqual([]);

      // Attachment published, space still a draft. A manager may legitimately
      // approve a photograph on a space nobody has published yet — it is
      // silent, and it is exactly what preparing a launch looks like.
      await publishAttachment(attachmentId, true);
      expect(await galleryPaths()).toEqual([]);

      // Both gates open.
      await publishSpace(spaceId, true);
      const paths = await galleryPaths();
      expect(paths.length).toBeGreaterThan(0);

      const served = await fetchBytes(paths[0] as string);
      expect(served.status).toBe(200);
      expect(served.headers['content-type']).toMatch(/^image\/(webp|jpeg)$/);
    });

    it('revokes the bytes at the origin the moment the SPACE is withdrawn', async () => {
      // THE A7 GATE, PROVED AS BYTES RATHER THAN AS A PROJECTION. The
      // attachment stays published throughout; only the space changes. This is
      // the condition that could not exist before A7, because a clinic-space
      // photograph had no owner row to consult.
      const spaceId = await createSpace(receptionist);
      const { attachmentId } = await attachTo(spaceId);
      await publishAttachment(attachmentId, true);
      await publishSpace(spaceId, true);

      const path = (await galleryPaths())[0] as string;
      expect((await fetchBytes(path)).status).toBe(200);

      await publishSpace(spaceId, false);

      // No interval and no warm-up: the predicate is re-derived per request.
      const refused = await fetchBytes(path);
      expect(refused.status).toBe(404);
      expect(refused.body.error.code).toBe('MEDIA_NOT_FOUND');
      expect(await galleryPaths()).toEqual([]);

      // And it comes back when the manager republishes, which is what makes
      // this a gate rather than a deletion.
      await publishSpace(spaceId, true);
      expect((await fetchBytes(path)).status).toBe(200);
    });

    it('revokes the bytes when the ATTACHMENT is unpublished, space untouched', async () => {
      const spaceId = await createSpace(receptionist);
      const { attachmentId } = await attachTo(spaceId);
      await publishAttachment(attachmentId, true);
      await publishSpace(spaceId, true);

      const path = (await galleryPaths())[0] as string;
      expect((await fetchBytes(path)).status).toBe(200);

      await publishAttachment(attachmentId, false);

      expect((await fetchBytes(path)).status).toBe(404);
      expect(await galleryPaths()).toEqual([]);
    });

    it('revokes the bytes when the asset is archived', async () => {
      const spaceId = await createSpace(receptionist);
      const { mediaId, attachmentId } = await attachTo(spaceId);
      await publishAttachment(attachmentId, true);
      await publishSpace(spaceId, true);

      const path = (await galleryPaths())[0] as string;

      const archived = await request(server())
        .patch(`/media/${mediaId}/archive`)
        .set(as(manager))
        .send({ archived: true });

      expect(archived.status).toBe(200);
      expect((await fetchBytes(path)).status).toBe(404);
    });
  });

  describe('the owner rule', () => {
    it('refuses a PUBLIC_SPACE attachment that names no space', async () => {
      // `PUBLIC_SPACE` is not `CLINIC_SPACE`. The names are similar and the
      // rules are opposite: one requires an owner id, the other refuses one.
      const asset = await uploadPhoto(harness, receptionist);

      const refused = await request(server())
        .post(`/media/${asset.id}/attachments`)
        .set(as(receptionist))
        .send({ ownerType: 'PUBLIC_SPACE', ownerId: null, position: 0 });

      expect(refused.status).toBe(400);
    });

    it('refuses a PUBLIC_SPACE attachment naming a space that does not exist', async () => {
      const asset = await uploadPhoto(harness, receptionist);

      const refused = await request(server())
        .post(`/media/${asset.id}/attachments`)
        .set(as(receptionist))
        .send({
          ownerType: 'PUBLIC_SPACE',
          ownerId: '00000000-0000-4000-8000-000000000000',
          position: 0,
        });

      expect(refused.status).toBe(404);
      expect(refused.body.error.code).toBe('PUBLIC_SPACE_NOT_FOUND');
    });

    it('leaves the A5 ownerless CLINIC_SPACE slot exactly as it was', async () => {
      // THE CROSS-LANE PROMISE, PINNED. The web tier parks an uploaded and
      // framed photograph on the ownerless slot before it has been placed
      // anywhere, and A7 must not have turned that drafting sandbox into a live
      // public-gallery target. So: the slot still accepts a null owner id, and
      // publishing one still puts nothing in the space gallery.
      const asset = await uploadPhoto(harness, receptionist);

      const attached = await request(server())
        .post(`/media/${asset.id}/attachments`)
        .set(as(receptionist))
        .send({ ownerType: 'CLINIC_SPACE', ownerId: null, position: 0 });

      expect(attached.status).toBe(201);

      const attachment = attached.body.media.attachments.find(
        (item: { ownerType: string; ownerId: string | null }) =>
          item.ownerType === 'CLINIC_SPACE' && item.ownerId === null,
      );
      expect(attachment).toBeDefined();

      await publishAttachment(attachment.id as string, true);

      // A published space exists, so the gallery is a real read rather than an
      // empty one — and the ownerless photograph is still not in it.
      const spaceId = await createSpace(receptionist);
      await publishSpace(spaceId, true);

      const response = await request(server()).get('/public/spaces').set(asVisitor());
      const spaces = publicSpaceListResponseSchema.parse(response.body).spaces;

      expect(spaces).toHaveLength(1);
      expect(spaces[0]?.images).toEqual([]);
    });
  });
});
