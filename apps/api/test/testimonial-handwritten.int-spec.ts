import request from 'supertest';
import { publicTestimonialListResponseSchema, testimonialResponseSchema } from '@clinic/contracts';
import { createHarness, resetDatabase, seedUser, type Harness } from './harness';
import { uploadPhoto } from './media-support';
import { as, asVisitor, loginAs, testimonialDraft } from './website-support';
import { uuidv7 } from '../src/common/uuid';

/**
 * Handwritten testimonials: the transcription is the meaning, and the
 * photograph never is.
 *
 * Milestone 9.5, checkpoint A7, over real HTTP against real PostgreSQL.
 *
 * THE DEFECT THIS SUITE EXISTS TO PREVENT: a photograph of a family's
 * handwriting reaching the website as a testimonial whose words nobody read.
 * It is worse than an ordinary publication mistake, because the clinic would
 * then be publishing something it has not understood — about somebody's child,
 * in their own hand.
 *
 * SO THE RULE IS ATTACKED AT FOUR LAYERS IN TURN, and the last one is the one
 * that matters most:
 *
 *   1. the request contract — a body is required for both kinds;
 *   2. the service — nothing writes a row without one;
 *   3. the DATABASE — raw SQL, past every guard in the application, is refused;
 *   4. the public read — an unapproved testimonial and its picture are absent.
 *
 * NO OCR EXISTS ANYWHERE IN THIS PRODUCT, and one test asserts that no column
 * in the schema could hold its output.
 *
 * Every image here is generated in code. NO REAL HANDWRITING, no real family's
 * words and no photograph of anything real appears in this repository.
 */
describe('handwritten testimonials (real PostgreSQL)', () => {
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

  async function create(session: string, overrides: Record<string, unknown> = {}): Promise<string> {
    const response = await request(server())
      .post('/content/testimonials')
      .set(as(session))
      .send(testimonialDraft(overrides));

    expect(response.status).toBe(201);
    return testimonialResponseSchema.parse(response.body).testimonial.id;
  }

  async function approveAndPublish(id: string) {
    const approved = await request(server())
      .patch(`/content/testimonials/${id}/approval`)
      .set(as(manager))
      .send({ approved: true });
    expect(approved.status).toBe(200);

    const published = await request(server())
      .patch(`/content/testimonials/${id}/publication`)
      .set(as(manager))
      .send({ isPublic: true });
    expect(published.status).toBe(200);
  }

  async function publicTestimonials() {
    const response = await request(server()).get('/public/testimonials').set(asVisitor());
    expect(response.status).toBe(200);
    return publicTestimonialListResponseSchema.parse(response.body).testimonials;
  }

  /** Attaches a generated photograph to a testimonial, as a receptionist. */
  async function attachPhoto(testimonialId: string): Promise<string> {
    const asset = await uploadPhoto(harness, receptionist);

    const attached = await request(server())
      .post(`/media/${asset.id}/attachments`)
      .set(as(receptionist))
      .send({ ownerType: 'PUBLIC_TESTIMONIAL', ownerId: testimonialId, position: 0 });

    expect(attached.status).toBe(201);

    const attachment = attached.body.media.attachments.find(
      (item: { ownerType: string; ownerId: string | null }) =>
        item.ownerType === 'PUBLIC_TESTIMONIAL' && item.ownerId === testimonialId,
    );

    return attachment.id as string;
  }

  describe('a typed testimonial is unchanged', () => {
    it('is valid with no image at all, exactly as before', async () => {
      // The A2 case, and the regression guard: A7 must not have made a
      // photograph necessary for the kind that never needed one.
      const id = await create(receptionist, { kind: 'TYPED' });
      await approveAndPublish(id);

      const published = await publicTestimonials();

      expect(published).toHaveLength(1);
      expect(published[0]?.kind).toBe('TYPED');
      expect(published[0]?.image).toBeNull();
    });

    it('defaults to TYPED when the request says nothing about kind', async () => {
      const response = await request(server())
        .post('/content/testimonials')
        .set(as(receptionist))
        .send({ authorLabel: null, body: 'Synthetic words for a test. Nobody is named.' });

      expect(response.status).toBe(201);
      expect(testimonialResponseSchema.parse(response.body).testimonial.kind).toBe('TYPED');
    });
  });

  describe('a handwritten testimonial needs the words', () => {
    it('refuses a handwritten testimonial with an empty body', async () => {
      const refused = await request(server())
        .post('/content/testimonials')
        .set(as(receptionist))
        .send({ authorLabel: null, body: '', kind: 'HANDWRITTEN' });

      expect(refused.status).toBe(400);
      expect(refused.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses a handwritten testimonial whose body is only whitespace', async () => {
      const refused = await request(server())
        .post('/content/testimonials')
        .set(as(receptionist))
        .send({ authorLabel: null, body: '   \n  ', kind: 'HANDWRITTEN' });

      expect(refused.status).toBe(400);
    });

    it('refuses a handwritten testimonial with no body field at all', async () => {
      // THE "IMAGE ALONE" REQUEST, IN ITS MOST LITERAL FORM: a caller declaring
      // a photographed note and offering nothing to read.
      const refused = await request(server())
        .post('/content/testimonials')
        .set(as(receptionist))
        .send({ authorLabel: null, kind: 'HANDWRITTEN' });

      expect(refused.status).toBe(400);

      const rows = await harness.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count FROM public_testimonial
      `;
      expect(Number(rows[0]?.count)).toBe(0);
    });

    it('refuses one written straight into PostgreSQL, past every guard', async () => {
      // LAYER THREE, AND THE ONE THAT DOES NOT DEPEND ON THE APPLICATION BEING
      // RIGHT. The question worth answering is not "does the service refuse
      // this?" but "could this row exist at all?".
      const actorId = (await seedUser(harness, { role: 'MANAGER' })).id;

      await expect(
        harness.prisma.$executeRaw`
          INSERT INTO public_testimonial (
            id, author_label, body, kind, status, is_public, created_at, created_by_user_id
          ) VALUES (
            ${uuidv7()}::uuid, NULL, '   ', 'HANDWRITTEN'::testimonial_kind,
            'DRAFT'::testimonial_status, FALSE, transaction_timestamp(), ${actorId}::uuid
          )
        `,
      ).rejects.toThrow();
    });

    it('accepts a handwritten testimonial that carries its transcription', async () => {
      const id = await create(receptionist, {
        kind: 'HANDWRITTEN',
        body: 'Synthetic transcription of a note that does not exist. It names nobody.',
      });

      const one = await request(server()).get(`/content/testimonials/${id}`).set(as(receptionist));

      expect(testimonialResponseSchema.parse(one.body).testimonial.kind).toBe('HANDWRITTEN');
    });
  });

  describe('the privacy gate holds for both kinds', () => {
    it('keeps an unapproved handwritten testimonial and its photograph unreachable', async () => {
      // THE FULL PRIVACY PATH. A manager has published the ATTACHMENT — the
      // strongest thing that can be true short of approving the words — and a
      // visitor still gets nothing, because the testimonial itself has not
      // passed the privacy review.
      const id = await create(receptionist, {
        kind: 'HANDWRITTEN',
        body: 'Synthetic transcription written for a test.',
      });
      const attachmentId = await attachPhoto(id);

      await request(server())
        .patch(`/media/attachments/${attachmentId}/publication`)
        .set(as(manager))
        .send({ isPublished: true });

      expect(await publicTestimonials()).toEqual([]);
    });

    it('publishes the words and the picture only after approval AND publication', async () => {
      const id = await create(receptionist, {
        kind: 'HANDWRITTEN',
        body: 'Synthetic transcription written for a test.',
      });
      const attachmentId = await attachPhoto(id);
      await request(server())
        .patch(`/media/attachments/${attachmentId}/publication`)
        .set(as(manager))
        .send({ isPublished: true });

      await approveAndPublish(id);

      const published = await publicTestimonials();

      expect(published).toHaveLength(1);
      expect(published[0]?.kind).toBe('HANDWRITTEN');
      // THE WORDS ARE THE TRANSCRIPTION AND NOT THE PICTURE.
      expect(published[0]?.body).toBe('Synthetic transcription written for a test.');
      expect(published[0]?.image).not.toBeNull();
    });

    it('takes the picture down with the words when approval is withdrawn', async () => {
      const id = await create(receptionist, {
        kind: 'HANDWRITTEN',
        body: 'Synthetic transcription written for a test.',
      });
      const attachmentId = await attachPhoto(id);
      await request(server())
        .patch(`/media/attachments/${attachmentId}/publication`)
        .set(as(manager))
        .send({ isPublished: true });
      await approveAndPublish(id);

      const path = (await publicTestimonials())[0]?.image?.renditions[0]?.path as string;
      expect((await request(server()).get(`/public/${path}`).set(asVisitor())).status).toBe(200);

      // Withdrawing the review unpublishes the quotation in the same
      // transaction, and the photograph goes with it at the origin.
      const revoked = await request(server())
        .patch(`/content/testimonials/${id}/approval`)
        .set(as(manager))
        .send({ approved: false });
      expect(revoked.status).toBe(200);

      expect(await publicTestimonials()).toEqual([]);
      expect((await request(server()).get(`/public/${path}`).set(asVisitor())).status).toBe(404);
    });

    it('refuses a receptionist the approval and the publication routes', async () => {
      const id = await create(receptionist, {
        kind: 'HANDWRITTEN',
        body: 'Synthetic transcription written for a test.',
      });

      const approval = await request(server())
        .patch(`/content/testimonials/${id}/approval`)
        .set(as(receptionist))
        .send({ approved: true });
      const publication = await request(server())
        .patch(`/content/testimonials/${id}/publication`)
        .set(as(receptionist))
        .send({ isPublic: true });

      expect(approval.status).toBe(403);
      expect(publication.status).toBe(403);
      expect(await publicTestimonials()).toEqual([]);
    });
  });

  describe('no OCR, and no field that could hold its output', () => {
    it('adds no machine-read, transcription-source or confidence column', async () => {
      // A7 froze this: OCR may only ever be a Web-side drafting aid that a human
      // reviews and saves, and an authoritative machine-derived field is exactly
      // what must not exist. Asserted against the real catalogue rather than by
      // reading the model, because the model is one edit away from disagreeing.
      const columns = await harness.prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'public_testimonial'
        ORDER BY column_name
      `;

      expect(columns.map((column) => column.column_name)).toEqual([
        'approved_at',
        'author_label',
        'body',
        'created_at',
        'created_by_user_id',
        'id',
        'is_public',
        'kind',
        'public_first_published_at',
        'public_revised_at',
        'status',
      ]);
    });

    it('adds no identifying or clinical field', async () => {
      // The A2 privacy-by-absence model, restated as a negative after A7 added
      // a column. `kind` says how the words arrived; nothing here says who
      // wrote them or what happened in a session.
      const columns = await harness.prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'public_testimonial'
      `;
      const names = columns.map((column) => column.column_name);

      for (const forbidden of [
        'family_id',
        'child_id',
        'child_name',
        'person_name',
        'full_name',
        'age',
        'diagnosis',
        'condition',
        'service_id',
        'therapist_id',
        'treated_at',
        'treatment_date',
        'ocr_text',
        'transcription_confidence',
      ]) {
        expect(names).not.toContain(forbidden);
      }
    });
  });
});
