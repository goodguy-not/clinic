import request from 'supertest';
import { publicTestimonialListResponseSchema, testimonialResponseSchema } from '@clinic/contracts';
import {
  createHarness,
  internalHeaders,
  resetDatabase,
  type Harness,
  ownerPrisma,
} from './harness';
import { as, auditActionsFor, loginAs, testimonialDraft } from './website-support';

/**
 * Testimonials: the privacy review, and everything that depends on it.
 *
 * Milestone 9, checkpoint A2, over real HTTP against real PostgreSQL.
 *
 * PROJECT_SPEC.md 11 requires that testimonials and stories be approved before
 * they are used and that no identifying child or clinical data be published.
 * The first of those is a state machine and is tested here in both directions;
 * the second is tested by the fact that there is no column to violate it with,
 * which `public-content-schema.int-spec.ts` pins.
 *
 * Everything is synthetic. No real family's words appear in any fixture.
 */
describe('testimonial approval and publication (real PostgreSQL)', () => {
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

  async function createDraft(session: string): Promise<string> {
    const response = await request(server())
      .post('/content/testimonials')
      .set(as(session))
      .send(testimonialDraft());

    expect(response.status).toBe(201);
    return testimonialResponseSchema.parse(response.body).testimonial.id;
  }

  const approve = (session: string, id: string, approved: boolean) =>
    request(server())
      .patch(`/content/testimonials/${id}/approval`)
      .set(as(session))
      .send({ approved });

  const publish = (session: string, id: string, isPublic: boolean) =>
    request(server())
      .patch(`/content/testimonials/${id}/publication`)
      .set(as(session))
      .send({ isPublic });

  describe('a record existing is not approval', () => {
    it('creates every testimonial as an unapproved, unpublished draft', async () => {
      const byManager = await request(server())
        .post('/content/testimonials')
        .set(as(manager))
        .send(testimonialDraft());

      const testimonial = testimonialResponseSchema.parse(byManager.body).testimonial;

      // Even created by the person who could approve it. Approval is an act,
      // not a side effect of who happened to type the words in.
      expect(testimonial.status).toBe('DRAFT');
      expect(testimonial.isPublic).toBe(false);
      expect(testimonial.approvedAt).toBeNull();
    });

    it('refuses publication of anything the review has not passed', async () => {
      const id = await createDraft(receptionist);

      const attempt = await publish(manager, id, true);

      expect(attempt.status).toBe(409);
      expect(attempt.body.error.code).toBe('TESTIMONIAL_NOT_APPROVED');
    });

    it('refuses the same thing at the database, not only in the service', async () => {
      // `public_testimonial_approval_chk`. This is the guarantee that survives
      // a hand-written UPDATE, a data fix or a future service that forgets.
      const id = await createDraft(receptionist);

      await expect(
        harness.prisma
          .$executeRaw`UPDATE public_testimonial SET is_public = TRUE WHERE id = ${id}::uuid`,
      ).rejects.toThrow();
    });
  });

  describe('the authority split', () => {
    it('lets a receptionist draft and edit, and refuses them the review', async () => {
      const id = await createDraft(receptionist);

      const edited = await request(server())
        .patch(`/content/testimonials/${id}`)
        .set(as(receptionist))
        .send({ ...testimonialDraft(), body: 'Synthetic revised wording.' });
      const approval = await approve(receptionist, id, true);
      const publication = await publish(receptionist, id, true);

      expect(edited.status).toBe(200);
      expect(approval.status).toBe(403);
      expect(approval.body.error.code).toBe('AUTH_FORBIDDEN');
      expect(publication.status).toBe(403);

      const after = await request(server()).get(`/content/testimonials/${id}`).set(as(manager));
      expect(testimonialResponseSchema.parse(after.body).testimonial.status).toBe('DRAFT');
    });

    it('lets a manager approve, publish, unpublish and revoke', async () => {
      const id = await createDraft(receptionist);

      const approved = await approve(manager, id, true);
      const published = await publish(manager, id, true);
      const unpublished = await publish(manager, id, false);
      const revoked = await approve(manager, id, false);

      expect(testimonialResponseSchema.parse(approved.body).testimonial.status).toBe('APPROVED');
      expect(testimonialResponseSchema.parse(approved.body).testimonial.approvedAt).not.toBeNull();
      expect(testimonialResponseSchema.parse(published.body).testimonial.isPublic).toBe(true);
      expect(testimonialResponseSchema.parse(unpublished.body).testimonial.isPublic).toBe(false);
      expect(testimonialResponseSchema.parse(revoked.body).testimonial.status).toBe('DRAFT');
      expect(testimonialResponseSchema.parse(revoked.body).testimonial.approvedAt).toBeNull();
    });
  });

  describe('approved words are frozen', () => {
    it('refuses an edit once the manager has approved the wording', async () => {
      // Otherwise approved-and-published text can be rewritten into something
      // nobody reviewed, which is exactly what the approval exists to prevent.
      const id = await createDraft(receptionist);
      await approve(manager, id, true);

      const edit = await request(server())
        .patch(`/content/testimonials/${id}`)
        .set(as(receptionist))
        .send({ ...testimonialDraft(), body: 'Synthetic text nobody reviewed.' });
      const managerEdit = await request(server())
        .patch(`/content/testimonials/${id}`)
        .set(as(manager))
        .send({ ...testimonialDraft(), body: 'Synthetic text nobody reviewed.' });

      // REFUSED FOR THE MANAGER TOO. This is not an authority rule — it is what
      // "approved" means, and a manager who wants different words withdraws the
      // approval and reads the new ones.
      expect(edit.status).toBe(409);
      expect(edit.body.error.code).toBe('TESTIMONIAL_APPROVED');
      expect(managerEdit.status).toBe(409);
    });

    it('gives a receptionist no way to change what a visitor is reading', async () => {
      // THE MIRROR OF THE ARTICLE AUTHORITY RULE, and the reason a testimonial
      // needs no draft-and-published pair to hold it. An article is the
      // clinic's own writing, so a live one has to stay revisable and the two
      // versions have to be kept apart; a testimonial is somebody else's words,
      // approved as THOSE EXACT WORDS, so the correct answer to "may this be
      // rewritten while it is up?" is simply no.
      //
      // The consequence is the same in both models: nothing a receptionist
      // types reaches a visitor without a manager acting.
      const id = await createDraft(receptionist);
      await approve(manager, id, true);
      await publish(manager, id, true);

      const before = await request(server()).get('/public/testimonials').set(internalHeaders());

      const edit = await request(server())
        .patch(`/content/testimonials/${id}`)
        .set(as(receptionist))
        .send({ ...testimonialDraft(), body: 'Synthetic words nobody reviewed.' });

      const after = await request(server()).get('/public/testimonials').set(internalHeaders());

      expect(edit.status).toBe(409);
      expect(publicTestimonialListResponseSchema.parse(after.body).testimonials).toEqual(
        publicTestimonialListResponseSchema.parse(before.body).testimonials,
      );
    });

    it('requires a fresh manager approval before corrected words go back up', async () => {
      // The whole correction round trip, from the visitor's side. Withdrawing
      // the approval takes the quotation down; the rewritten text is invisible
      // until a manager reads it and approves it, and invisible again until a
      // manager puts it back on the page.
      const id = await createDraft(receptionist);
      await approve(manager, id, true);
      await publish(manager, id, true);

      await approve(manager, id, false);
      await request(server())
        .patch(`/content/testimonials/${id}`)
        .set(as(receptionist))
        .send({ ...testimonialDraft(), body: 'Synthetic corrected wording.' });

      const whileUnapproved = await request(server())
        .get('/public/testimonials')
        .set(internalHeaders());

      // A receptionist can neither approve the new wording nor put it back up.
      expect((await approve(receptionist, id, true)).status).toBe(403);
      expect((await publish(receptionist, id, true)).status).toBe(403);

      await approve(manager, id, true);
      const afterApprovalOnly = await request(server())
        .get('/public/testimonials')
        .set(internalHeaders());

      await publish(manager, id, true);
      const afterPublication = await request(server())
        .get('/public/testimonials')
        .set(internalHeaders());

      expect(publicTestimonialListResponseSchema.parse(whileUnapproved.body).testimonials).toEqual(
        [],
      );
      // Approval alone does not put it back on the page.
      expect(
        publicTestimonialListResponseSchema.parse(afterApprovalOnly.body).testimonials,
      ).toEqual([]);
      expect(
        publicTestimonialListResponseSchema.parse(afterPublication.body).testimonials[0]!.body,
      ).toBe('Synthetic corrected wording.');
    });

    it('makes the words editable again once the approval is withdrawn', async () => {
      const id = await createDraft(receptionist);
      await approve(manager, id, true);
      await approve(manager, id, false);

      const edit = await request(server())
        .patch(`/content/testimonials/${id}`)
        .set(as(receptionist))
        .send({ ...testimonialDraft(), body: 'Synthetic rewritten wording.' });

      expect(edit.status).toBe(200);
    });
  });

  describe('withdrawing approval takes the quotation off the website', () => {
    it('unpublishes in the same act', async () => {
      const id = await createDraft(receptionist);
      await approve(manager, id, true);
      await publish(manager, id, true);

      const revoked = await approve(manager, id, false);
      const testimonial = testimonialResponseSchema.parse(revoked.body).testimonial;

      expect(testimonial.status).toBe('DRAFT');
      expect(testimonial.isPublic).toBe(false);
    });

    it('records both facts, and only when the second one happened', async () => {
      const published = await createDraft(receptionist);
      await approve(manager, published, true);
      await publish(manager, published, true);
      await approve(manager, published, false);

      const neverPublished = await createDraft(receptionist);
      await approve(manager, neverPublished, true);
      await approve(manager, neverPublished, false);

      expect(await auditActionsFor(harness, 'public_testimonial', published)).toEqual([
        'public_testimonial.created',
        'public_testimonial.approved',
        'public_testimonial.published',
        'public_testimonial.approval_revoked',
        'public_testimonial.unpublished',
      ]);

      // No `unpublished` here: nothing came off a page, because nothing was on
      // one. An audit trail that recorded it anyway would be describing an
      // event that did not occur.
      expect(await auditActionsFor(harness, 'public_testimonial', neverPublished)).toEqual([
        'public_testimonial.created',
        'public_testimonial.approved',
        'public_testimonial.approval_revoked',
      ]);
    });
  });

  describe('the audit trail', () => {
    it("records the family's words and the attribution as lengths", async () => {
      const id = await createDraft(receptionist);

      const rows = await harness.prisma.$queryRaw<{ after: Record<string, unknown> }[]>`
        SELECT after FROM audit_log
        WHERE entity_type = 'public_testimonial' AND entity_id = ${id}::uuid
      `;

      // The quotation is somebody else's account of their child's therapy, and
      // `audit_log` is the one table that can never be pruned. Since Milestone
      // 10 A3 the attribution is a length as well: a family may withdraw
      // consent, both are then erased, and a copy here could never be.
      expect(rows[0]!.after).toMatchObject({
        authorLabelLength: 'Synthetic parent label'.length,
        bodyLength: expect.any(Number),
        status: 'DRAFT',
        isPublic: false,
      });
      expect(JSON.stringify(rows[0]!.after)).not.toContain('Synthetic testimonial text');
      expect(JSON.stringify(rows[0]!.after)).not.toContain('Synthetic parent label');
    });

    it('refuses to delete a testimonial outright', async () => {
      const id = await createDraft(manager);

      await expect(
        ownerPrisma().$executeRaw`DELETE FROM public_testimonial WHERE id = ${id}::uuid`,
      ).rejects.toThrow();
    });
  });
});
