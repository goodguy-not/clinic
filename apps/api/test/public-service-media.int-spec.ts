import request from 'supertest';
import {
  mediaAssetResponseSchema,
  publicServiceDetailResponseSchema,
  publicServiceListResponseSchema,
  serviceResponseSchema,
} from '@clinic/contracts';
import { uuidv7 } from '../src/common/uuid';
import { createHarness, resetDatabase, type Harness } from './harness';
import { renditionPathsOf, uploadPhoto } from './media-support';
import { as, asVisitor, loginAs } from './website-support';

/**
 * A photograph illustrating a service, and the gates between it and a stranger.
 *
 * Milestone 9.5, checkpoint A9, over real HTTP against real PostgreSQL.
 *
 * THE A5 SYSTEM IS USED, NOT REDESIGNED, AND THIS SUITE PROVES THE JOIN. A
 * service's image is an ordinary `media_attachment` under an ordinary owner
 * type, so it inherits every A5 invariant — the master is unservable, EXIF is
 * stripped, attaching is drafting, a refusal is always `MEDIA_NOT_FOUND`.
 *
 * WHAT A9 ADDS IS AN OWNER GATE OF THREE CONDITIONS RATHER THAN A FLAG, AND
 * THAT IS WHAT MOST OF THIS FILE ATTACKS. A service is on the website when it
 * is public AND active AND addressable; the projection has required all three
 * since Milestone 9 checkpoint A1, and `LIVE_ATTACHMENT_PREDICATE` now requires
 * the same three. The case worth the file is the SECOND one: deactivating a
 * service writes `status` alone and leaves `is_public` standing, so a
 * photograph gated on the flag by itself would outlive the page it illustrates.
 *
 * SO THERE ARE TWO GATES, AND THE SUITE OPENS AND CLOSES EACH ONE
 * INDEPENDENTLY:
 *
 *   attachment published?   — `media.publish`
 *   service reachable?      — `service.update` / `service.update_status`
 *
 * Both are the manager's, both must be open, and either one closing revokes the
 * bytes at the origin on the very next request.
 *
 * Every photograph here is generated in code by `media-support.ts`. No real
 * clinic room, no real person and no real service photograph appears anywhere.
 */
describe('public service imagery (real PostgreSQL)', () => {
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

  /** A synthetic service body. The name and the slug are unique per call. */
  function serviceDraft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const suffix = uuidv7().slice(-8);

    return {
      name: `Synthetic service ${suffix}`,
      publicDescription: 'Synthetic public description. It names nobody and prices nothing.',
      isPublic: true,
      publicSlug: `synthetic-service-${suffix}`,
      allowedDurationsMinutes: [45],
      ...overrides,
    };
  }

  /** Creates a service and returns its internal id, the body it was made with, and its slug. */
  async function createService(
    overrides: Record<string, unknown> = {},
  ): Promise<{ id: string; body: Record<string, unknown>; slug: string | null }> {
    const body = serviceDraft(overrides);
    const response = await request(server()).post('/catalog/services').set(as(manager)).send(body);

    expect(response.status).toBe(201);
    const service = serviceResponseSchema.parse(response.body).service;

    return { id: service.id, body, slug: service.publicSlug };
  }

  const updateService = (id: string, body: Record<string, unknown>) =>
    request(server()).patch(`/catalog/services/${id}`).set(as(manager)).send(body);

  const setStatus = (id: string, status: 'ACTIVE' | 'INACTIVE') =>
    request(server()).patch(`/catalog/services/${id}/status`).set(as(manager)).send({ status });

  /** Uploads a photograph and attaches it to a service, as a receptionist. */
  async function attachTo(serviceId: string): Promise<{ mediaId: string; attachmentId: string }> {
    const asset = await uploadPhoto(harness, receptionist);

    const attached = await request(server())
      .post(`/media/${asset.id}/attachments`)
      .set(as(receptionist))
      .send({ ownerType: 'PUBLIC_SERVICE', ownerId: serviceId, position: 0 });

    expect(attached.status).toBe(201);

    const attachment = attached.body.media.attachments.find(
      (item: { ownerType: string; ownerId: string | null }) =>
        item.ownerType === 'PUBLIC_SERVICE' && item.ownerId === serviceId,
    );

    expect(attachment).toBeDefined();
    return { mediaId: asset.id, attachmentId: attachment.id as string };
  }

  const publishAttachment = (attachmentId: string, isPublished: boolean) =>
    request(server())
      .patch(`/media/attachments/${attachmentId}/publication`)
      .set(as(manager))
      .send({ isPublished });

  /** Every rendition path the anonymous service list currently offers. */
  async function listPaths(): Promise<string[]> {
    const response = await request(server()).get('/public/services').set(asVisitor());
    const services = publicServiceListResponseSchema.parse(response.body).services;

    return services.flatMap((service) =>
      (service.image?.renditions ?? []).map((rendition) => rendition.path),
    );
  }

  /**
   * Asks for one rendition's bytes as a visitor would.
   *
   * The projection returns the relative path `media/<renditionId>`; the API
   * route is `/public/` + that, which is the resolution the web tier performs.
   */
  const fetchBytes = (path: string) => request(server()).get(`/public/${path}`).set(asVisitor());

  describe('attaching is drafting', () => {
    it('makes nothing visible when a receptionist attaches a photograph', async () => {
      const service = await createService();
      await attachTo(service.id);

      // The service is live; the picture is not. Attaching cannot publish, and
      // there is no field on the attach request that could ask it to.
      const response = await request(server()).get('/public/services').set(asVisitor());
      const services = publicServiceListResponseSchema.parse(response.body).services;

      expect(services).toHaveLength(1);
      expect(services[0]?.image).toBeNull();
    });

    it('refuses a receptionist the attachment publication route', async () => {
      const service = await createService();
      const { attachmentId } = await attachTo(service.id);

      const refused = await request(server())
        .patch(`/media/attachments/${attachmentId}/publication`)
        .set(as(receptionist))
        .send({ isPublished: true });

      expect(refused.status).toBe(403);
      expect(await listPaths()).toEqual([]);
    });

    it('lets the manager publish, and only then are there bytes', async () => {
      const service = await createService();
      const { attachmentId } = await attachTo(service.id);

      expect(await listPaths()).toEqual([]);

      expect((await publishAttachment(attachmentId, true)).status).toBe(200);

      const paths = await listPaths();
      expect(paths.length).toBeGreaterThan(0);

      const served = await fetchBytes(paths[0] as string);
      expect(served.status).toBe(200);
      expect(served.headers['content-type']).toMatch(/^image\/(webp|jpeg)$/);
    });
  });

  describe('the service gate is three conditions, not one', () => {
    /** A service with a manager-published photograph on it. */
    async function liveServiceImage(overrides: Record<string, unknown> = {}) {
      const service = await createService(overrides);
      const { mediaId, attachmentId } = await attachTo(service.id);
      await publishAttachment(attachmentId, true);

      return { service, mediaId, attachmentId };
    }

    it('revokes the bytes the moment the service is made private', async () => {
      const { service } = await liveServiceImage();
      const path = (await listPaths())[0] as string;
      expect((await fetchBytes(path)).status).toBe(200);

      expect((await updateService(service.id, { ...service.body, isPublic: false })).status).toBe(
        200,
      );

      // No interval and no warm-up: the predicate is re-derived per request.
      const refused = await fetchBytes(path);
      expect(refused.status).toBe(404);
      expect(refused.body.error.code).toBe('MEDIA_NOT_FOUND');
      expect(await listPaths()).toEqual([]);

      // And it comes back, which is what makes this a gate rather than a
      // deletion.
      expect((await updateService(service.id, { ...service.body, isPublic: true })).status).toBe(
        200,
      );
      expect((await fetchBytes(path)).status).toBe(200);
    });

    it('revokes the bytes the moment the service is DEACTIVATED, flag untouched', async () => {
      // THE CONDITION THIS CHECKPOINT EXISTS FOR. `service.update_status`
      // writes `status` and leaves `is_public` exactly where it was, so this
      // service is still flagged public throughout — and the public list has
      // never shown a retired service. A media predicate that read the flag
      // alone would take the page down and go on handing out the photograph.
      const { service } = await liveServiceImage();
      const path = (await listPaths())[0] as string;
      expect((await fetchBytes(path)).status).toBe(200);

      expect((await setStatus(service.id, 'INACTIVE')).status).toBe(200);

      // The flag really is untouched: this is the deactivation gate closing,
      // not the publication one.
      const after = await request(server()).get(`/catalog/services/${service.id}`).set(as(manager));
      const retired = serviceResponseSchema.parse(after.body).service;
      expect(retired.isPublic).toBe(true);
      expect(retired.status).toBe('INACTIVE');

      const refused = await fetchBytes(path);
      expect(refused.status).toBe(404);
      expect(refused.body.error.code).toBe('MEDIA_NOT_FOUND');
      expect(await listPaths()).toEqual([]);

      expect((await setStatus(service.id, 'ACTIVE')).status).toBe(200);
      expect((await fetchBytes(path)).status).toBe(200);
    });

    it('serves nothing for a service that has no public address yet', async () => {
      // The third condition. A service may be flagged public and active and
      // still have no slug — it is simply not reachable, and nor is its
      // photograph.
      const { service } = await liveServiceImage({ publicSlug: null });

      expect(await listPaths()).toEqual([]);

      const library = await request(server()).get('/media').set(as(manager));
      const rendition = library.body.media[0].renditions[0].path as string;

      const refused = await fetchBytes(rendition);
      expect(refused.status).toBe(404);
      expect(refused.body.error.code).toBe('MEDIA_NOT_FOUND');

      // Given an address, the same photograph becomes reachable — no
      // re-upload, no re-attachment, no republication.
      expect(
        (
          await updateService(service.id, {
            ...service.body,
            publicSlug: `synthetic-late-${uuidv7().slice(-8)}`,
          })
        ).status,
      ).toBe(200);

      expect(await listPaths()).toContain(rendition);
      expect((await fetchBytes(rendition)).status).toBe(200);
    });

    it('revokes the bytes when the ATTACHMENT is unpublished, service untouched', async () => {
      const { attachmentId } = await liveServiceImage();
      const path = (await listPaths())[0] as string;
      expect((await fetchBytes(path)).status).toBe(200);

      expect((await publishAttachment(attachmentId, false)).status).toBe(200);

      expect((await fetchBytes(path)).status).toBe(404);
      expect(await listPaths()).toEqual([]);
    });

    it('revokes the bytes when the asset is archived', async () => {
      const { mediaId } = await liveServiceImage();
      const path = (await listPaths())[0] as string;

      const archived = await request(server())
        .patch(`/media/${mediaId}/archive`)
        .set(as(manager))
        .send({ archived: true });

      expect(archived.status).toBe(200);
      expect((await fetchBytes(path)).status).toBe(404);
      expect(await listPaths()).toEqual([]);
    });
  });

  describe('the owner rule', () => {
    it('refuses a PUBLIC_SERVICE attachment that names no service', async () => {
      const asset = await uploadPhoto(harness, receptionist);

      const refused = await request(server())
        .post(`/media/${asset.id}/attachments`)
        .set(as(receptionist))
        .send({ ownerType: 'PUBLIC_SERVICE', ownerId: null, position: 0 });

      expect(refused.status).toBe(400);
      expect(refused.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses a PUBLIC_SERVICE attachment naming a service that does not exist', async () => {
      const asset = await uploadPhoto(harness, receptionist);

      const refused = await request(server())
        .post(`/media/${asset.id}/attachments`)
        .set(as(receptionist))
        .send({
          ownerType: 'PUBLIC_SERVICE',
          ownerId: '00000000-0000-4000-8000-000000000000',
          position: 0,
        });

      expect(refused.status).toBe(404);
      expect(refused.body.error.code).toBe('SERVICE_NOT_FOUND');
    });

    it('accepts a photograph prepared for a service nobody has published', async () => {
      // Drafting is exactly this: preparing a picture for a service that is
      // still private. Attach time asks only that the service EXISTS; whether
      // the picture ever reaches a visitor is decided on every read.
      const service = await createService({ isPublic: false, publicSlug: null });
      const { attachmentId } = await attachTo(service.id);

      expect((await publishAttachment(attachmentId, true)).status).toBe(200);
      expect(await listPaths()).toEqual([]);
    });

    it('leaves the ownerless CLINIC_SPACE slot out of the service reads', async () => {
      // The web tier parks an uploaded but unplaced photograph on the ownerless
      // slot. A9 must not have turned that drafting sandbox into a service
      // illustration.
      const asset = await uploadPhoto(harness, receptionist);

      const attached = await request(server())
        .post(`/media/${asset.id}/attachments`)
        .set(as(receptionist))
        .send({ ownerType: 'CLINIC_SPACE', ownerId: null, position: 0 });

      expect(attached.status).toBe(201);
      await publishAttachment(attached.body.media.attachments[0].id as string, true);

      await createService();

      const response = await request(server()).get('/public/services').set(asVisitor());
      const services = publicServiceListResponseSchema.parse(response.body).services;

      expect(services).toHaveLength(1);
      expect(services[0]?.image).toBeNull();
    });
  });

  describe('the public projection', () => {
    it('carries the photograph on the detail read too, and no operational fact', async () => {
      const service = await createService();
      const { attachmentId } = await attachTo(service.id);
      await publishAttachment(attachmentId, true);

      const response = await request(server())
        .get(`/public/services/${service.slug as string}`)
        .set(asVisitor());

      expect(response.status).toBe(200);

      // A strict schema, so anything the projection grew that nobody decided on
      // fails here rather than reaching a visitor.
      const detail = publicServiceDetailResponseSchema.parse(response.body).service;

      expect(Object.keys(response.body.service).sort()).toEqual([
        'description',
        'image',
        'name',
        'sessionDurationsMinutes',
        'slug',
      ]);

      // The internal id is the join key for the media lookup and must not have
      // travelled with it.
      expect(JSON.stringify(response.body)).not.toContain(service.id);
      expect(detail.image).not.toBeNull();
      expect(detail.image?.renditions.length).toBeGreaterThan(0);
      expect(detail.image?.framing).toEqual({ focalX: 0.5, focalY: 0.5, crop: null });

      // `publicImageSchema` is strict; this states the absence in the assertion
      // as well as in the parse.
      expect(Object.keys(response.body.service.image).sort()).toEqual([
        'alt',
        'framing',
        'height',
        'renditions',
        'width',
      ]);
    });

    it('shows one photograph per service and keeps them apart', async () => {
      const first = await createService();
      const second = await createService();

      const a = await attachTo(first.id);
      const b = await attachTo(second.id);
      await publishAttachment(a.attachmentId, true);
      await publishAttachment(b.attachmentId, true);

      const response = await request(server()).get('/public/services').set(asVisitor());
      const services = publicServiceListResponseSchema.parse(response.body).services;

      expect(services).toHaveLength(2);

      const bySlug = new Map(services.map((service) => [service.slug, service]));
      // Told apart by rendition paths: the public image carries no asset id
      // (checkpoint A10).
      const pathsOf = async (mediaId: string) =>
        renditionPathsOf(
          mediaAssetResponseSchema.parse(
            (await request(server()).get(`/media/${mediaId}`).set(as(manager))).body,
          ).media,
        );
      expect(renditionPathsOf(bySlug.get(first.slug as string)!.image!)).toEqual(
        await pathsOf(a.mediaId),
      );
      expect(renditionPathsOf(bySlug.get(second.slug as string)!.image!)).toEqual(
        await pathsOf(b.mediaId),
      );
      expect(JSON.stringify(response.body)).not.toContain(a.mediaId);
      expect(JSON.stringify(response.body)).not.toContain(b.mediaId);
    });
  });
});
