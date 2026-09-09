import { createHash } from 'node:crypto';
import request from 'supertest';
import {
  DEFAULT_MEDIA_FRAMING,
  mediaAssetResponseSchema,
  publicTherapistProfileResponseSchema,
  type MediaAsset,
} from '@clinic/contracts';
import { uuidv7 } from '../src/common/uuid';
import { createHarness, resetDatabase, type Harness } from './harness';
import { as, asVisitor, auditActionsFor, loginAs } from './website-support';
import { storedMasterBytes, uploadPhoto } from './media-support';

/**
 * FRAMING: CHANGING HOW A PHOTOGRAPH IS COMPOSED WITHOUT TOUCHING THE
 * PHOTOGRAPH.
 *
 * Milestone 9.5, checkpoint A5, coordinator revision. The frozen product rule
 * has three parts and this file proves each of them against a real database and
 * real files on disk:
 *
 *  1. ONE STORED MASTER CAN BE RE-FRAMED WITHOUT RE-UPLOADING. The only input to
 *     a re-frame is six numbers.
 *  2. RE-FRAMING NEITHER DESTROYS NOR REWRITES THE SOURCE MASTER. Asserted by
 *     hashing the master's bytes before and after — not by reading a column that
 *     says it did not change.
 *  3. FRAMING BELONGS TO THE USE, NOT THE ASSET. Two attachments of one
 *     photograph carry two framings, and changing one does not move the other.
 *
 * WHY THAT IS ENOUGH FOR A LIVE CROP PREVIEW IN THE WEB LANE. Framing is
 * normalised fractions of the whole frame, and the stored renditions are always
 * the whole frame — so a crop handle can move at sixty frames a second against
 * an image the browser already holds, and the save at the end is one request.
 * Nothing in this suite prescribes that interface; it proves the state it needs
 * exists and survives.
 *
 * Everything is synthetic. See `media-support.ts`.
 */
describe('media framing (real PostgreSQL)', () => {
  let harness: Harness;
  let manager: string;
  let receptionist: string;
  let therapistId: string;
  let secondTherapistId: string;

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

    const actorId = (
      await harness.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM app_user WHERE role = 'MANAGER'::user_role LIMIT 1
      `
    )[0]!.id;

    therapistId = uuidv7();
    secondTherapistId = uuidv7();

    for (const [id, slug, name] of [
      [therapistId, 'framed-colleague', 'همکار نمونه'],
      [secondTherapistId, 'second-colleague', 'همکار دوم'],
    ] as const) {
      await harness.prisma.$executeRaw`
        INSERT INTO therapist (
          id, full_name, specialty, status, created_at, created_by_user_id,
          is_public, public_slug, public_display_name,
          -- Checkpoint A6: what the website says is the PUBLISHED name, and it
          -- is what the profile CHECK constraint reads. A published fixture
          -- carries both, exactly as the manager opt-in leaves the row.
          published_public_display_name, public_display_order
        ) VALUES (
          ${id}::uuid, ${name}, 'گفتاردرمانی', 'ACTIVE'::catalog_status,
          transaction_timestamp(), ${actorId}::uuid,
          TRUE, ${slug}, ${name}, ${name}, 0
        )
      `;
    }
  });

  const attach = async (mediaId: string, ownerId: string): Promise<MediaAsset> => {
    const response = await request(harness.app.getHttpServer())
      .post(`/media/${mediaId}/attachments`)
      .set(as(receptionist))
      .send({ ownerType: 'THERAPIST_PROFILE', ownerId, position: 0 });

    expect(response.status).toBe(201);
    return mediaAssetResponseSchema.parse(response.body).media;
  };

  const reframe = (attachmentId: string, body: object, token = receptionist) =>
    request(harness.app.getHttpServer())
      .patch(`/media/attachments/${attachmentId}/framing`)
      .set(as(token))
      .send(body);

  const publish = (attachmentId: string, isPublished: boolean) =>
    request(harness.app.getHttpServer())
      .patch(`/media/attachments/${attachmentId}/publication`)
      .set(as(manager))
      .send({ isPublished });

  it('starts every attachment at the centre of the frame with no crop', async () => {
    // An attachment nobody has framed behaves exactly as an unframed image
    // always did, which is what makes framing additive rather than a migration
    // of behaviour.
    const asset = await uploadPhoto(harness, receptionist);
    const attached = await attach(asset.id, therapistId);

    expect(attached.attachments[0]?.framing).toEqual(DEFAULT_MEDIA_FRAMING);
  });

  it('re-frames one stored master repeatedly, with no re-upload and no new bytes', async () => {
    const asset = await uploadPhoto(harness, receptionist);
    const attached = await attach(asset.id, therapistId);
    const attachmentId = attached.attachments[0]!.id;

    // THE PROOF THAT THE SOURCE SURVIVES: the master's bytes are hashed before
    // any framing exists, and compared after three different framings. A column
    // saying the master is unchanged would prove nothing; these are the bytes.
    const masterBefore = await storedMasterBytes(harness, asset.id);
    const masterHashBefore = createHash('sha256').update(masterBefore).digest('hex');

    const renditionsBefore = attached.renditions.map((r) => `${r.id}:${r.contentHash}`).sort();

    const framings = [
      { focalX: 0.2, focalY: 0.8, crop: null },
      { focalX: 0.5, focalY: 0.1, crop: { x: 0.1, y: 0, width: 0.8, height: 0.6 } },
      { focalX: 0.75, focalY: 0.25, crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } },
    ];

    for (const framing of framings) {
      const response = await reframe(attachmentId, framing);

      expect(response.status).toBe(200);
      const media = mediaAssetResponseSchema.parse(response.body).media;
      expect(media.attachments[0]?.framing).toEqual(framing);
    }

    // Back to no crop at all. Framing is reversible for ever precisely because
    // it was never encoded into anything.
    const cleared = await reframe(attachmentId, DEFAULT_MEDIA_FRAMING);
    expect(cleared.status).toBe(200);
    expect(mediaAssetResponseSchema.parse(cleared.body).media.attachments[0]?.framing).toEqual(
      DEFAULT_MEDIA_FRAMING,
    );

    const masterAfter = await storedMasterBytes(harness, asset.id);
    expect(createHash('sha256').update(masterAfter).digest('hex')).toBe(masterHashBefore);
    expect(masterAfter.byteLength).toBe(masterBefore.byteLength);

    // AND NO RENDITION WAS RE-DERIVED. Same ids, same content hashes: four
    // re-framings produced no encode, so re-framing is free and can be done as
    // often as somebody likes.
    const after = mediaAssetResponseSchema.parse(
      (await request(harness.app.getHttpServer()).get(`/media/${asset.id}`).set(as(manager))).body,
    ).media;

    expect(after.renditions.map((r) => `${r.id}:${r.contentHash}`).sort()).toEqual(
      renditionsBefore,
    );
    expect(after.bytesPurgedAt).toBeNull();
  });

  it('keeps framing per use: one photograph, two attachments, two framings', async () => {
    // THE REASON FRAMING IS NOT ON THE ASSET. The same portrait is a square tile
    // on one profile and framed differently on another; framing on the asset
    // would make the second choice silently overwrite the first.
    const asset = await uploadPhoto(harness, receptionist);

    await attach(asset.id, therapistId);
    const both = await attach(asset.id, secondTherapistId);

    const first = both.attachments.find((a) => a.ownerId === therapistId)!;
    const second = both.attachments.find((a) => a.ownerId === secondTherapistId)!;

    await reframe(first.id, { focalX: 0.1, focalY: 0.1, crop: null });

    const after = mediaAssetResponseSchema.parse(
      (await request(harness.app.getHttpServer()).get(`/media/${asset.id}`).set(as(manager))).body,
    ).media;

    expect(after.attachments.find((a) => a.id === first.id)?.framing).toEqual({
      focalX: 0.1,
      focalY: 0.1,
      crop: null,
    });
    expect(after.attachments.find((a) => a.id === second.id)?.framing).toEqual(
      DEFAULT_MEDIA_FRAMING,
    );
  });

  it('publishes the framing to the world alongside the renditions', async () => {
    // What Agent B renders: the whole frame in every width, plus the numbers
    // saying which part of it matters.
    const asset = await uploadPhoto(harness, receptionist);
    const attached = await attach(asset.id, therapistId);
    const attachmentId = attached.attachments[0]!.id;

    const framing = { focalX: 0.3, focalY: 0.15, crop: { x: 0, y: 0, width: 0.6, height: 0.9 } };
    expect((await reframe(attachmentId, framing)).status).toBe(200);
    expect((await publish(attachmentId, true)).status).toBe(200);

    const response = await request(harness.app.getHttpServer())
      .get('/public/team/framed-colleague')
      .set(asVisitor());

    const photo = publicTherapistProfileResponseSchema.parse(response.body).therapist.photo!;

    expect(photo.framing).toEqual(framing);
    // The renditions are still the WHOLE FRAME. Nothing was cropped on the way
    // out, so the web tier can change its mind about the crop without the API.
    expect(photo.renditions.length).toBeGreaterThan(0);
    expect(photo.width).toBeGreaterThan(0);
  });

  it('refuses to re-frame a published attachment, so the weaker authority cannot move a live page', async () => {
    const asset = await uploadPhoto(harness, receptionist);
    const attached = await attach(asset.id, therapistId);
    const attachmentId = attached.attachments[0]!.id;

    expect((await publish(attachmentId, true)).status).toBe(200);

    const refused = await reframe(attachmentId, { focalX: 0.9, focalY: 0.9, crop: null });

    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('MEDIA_ATTACHMENT_PUBLISHED');

    // A manager re-frames by unpublishing first — three audited acts rather than
    // one silent change to what visitors are looking at.
    expect((await publish(attachmentId, false)).status).toBe(200);
    expect((await reframe(attachmentId, { focalX: 0.9, focalY: 0.9, crop: null })).status).toBe(
      200,
    );
  });

  it('refuses framing outside the frame, and a crop that is only half stated', async () => {
    const asset = await uploadPhoto(harness, receptionist);
    const attached = await attach(asset.id, therapistId);
    const attachmentId = attached.attachments[0]!.id;

    const refusals = [
      { focalX: 1.5, focalY: 0.5, crop: null },
      { focalX: 0.5, focalY: -1, crop: null },
      { focalX: 0.5, focalY: 0.5, crop: { x: 0.8, y: 0, width: 0.5, height: 1 } },
      { focalX: 0.5, focalY: 0.5, crop: { x: 0, y: 0, width: 0, height: 1 } },
      { focalX: 0.5, focalY: 0.5, crop: { x: 0, y: 0, width: 0.5 } },
      // Pixels, which is the mistake the normalised design exists to prevent.
      { focalX: 640, focalY: 480, crop: null },
    ];

    for (const framing of refusals) {
      const response = await reframe(attachmentId, framing);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('cannot publish, detach or re-point an attachment through the framing route', async () => {
    // The narrowness of the request is the authority boundary. Extra keys are
    // refused by the strict contract rather than ignored.
    const asset = await uploadPhoto(harness, receptionist);
    const attached = await attach(asset.id, therapistId);
    const attachmentId = attached.attachments[0]!.id;

    const response = await reframe(attachmentId, {
      focalX: 0.5,
      focalY: 0.5,
      crop: null,
      isPublished: true,
      ownerId: secondTherapistId,
      position: 9,
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');

    const after = mediaAssetResponseSchema.parse(
      (await request(harness.app.getHttpServer()).get(`/media/${asset.id}`).set(as(manager))).body,
    ).media;

    expect(after.attachments[0]?.publishedAt).toBeNull();
    expect(after.attachments[0]?.ownerId).toBe(therapistId);
    expect(after.attachments[0]?.position).toBe(0);
  });

  it('records a re-frame as its own audited act, carrying composition and no content', async () => {
    const asset = await uploadPhoto(harness, receptionist);
    const attached = await attach(asset.id, therapistId);
    const attachmentId = attached.attachments[0]!.id;

    await reframe(attachmentId, { focalX: 0.2, focalY: 0.4, crop: null });

    expect(await auditActionsFor(harness, 'media_attachment', attachmentId)).toContain(
      'media.reframed',
    );

    const rows = await harness.prisma.$queryRaw<{ before: unknown; after: unknown }[]>`
      SELECT before, after FROM audit_log
      WHERE action = 'media.reframed' AND entity_id = ${attachmentId}::uuid
    `;

    // Six numbers describing a rectangle: no image data, nothing about a family,
    // nothing that could not be read off the published page.
    expect(rows[0]?.before).toEqual({
      focalX: 0.5,
      focalY: 0.5,
      cropX: null,
      cropY: null,
      cropWidth: null,
      cropHeight: null,
    });
    expect(rows[0]?.after).toEqual({
      focalX: 0.2,
      focalY: 0.4,
      cropX: null,
      cropY: null,
      cropWidth: null,
      cropHeight: null,
    });
  });
});
