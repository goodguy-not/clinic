import { z } from 'zod';
import { publicHeadingSchema, publicProseSchema } from './common';

/**
 * A testimonial as the people who handle it see it.
 *
 * Milestone 9, checkpoint A2.
 *
 * TWO STATES AND ONE FLAG, AND EACH OF THE THREE EARNS ITS PLACE.
 *
 * `status` is the PRIVACY REVIEW. PROJECT_SPEC.md 11 requires that testimonials
 * and stories be approved before they are used, and an approval that is not a
 * recorded state is an approval nobody can prove happened. A record existing is
 * NOT approval: `DRAFT` is what every testimonial starts as, whoever wrote it.
 *
 * `isPublic` is PLACEMENT ON A PAGE, and it is separate from approval because
 * withdrawing a testimonial from the website is not the same act as declaring
 * that its privacy review was wrong. Collapsing the two would mean that taking
 * a quotation off the home page erased the fact that a manager had once read it
 * and approved it — and would make the reverse, putting it back, look like a
 * fresh approval that never happened. The database enforces the ordering
 * between them: `isPublic` cannot be true unless `status` is `APPROVED`.
 *
 * APPROVED CONTENT IS FROZEN. Editing the words of an approved testimonial is
 * refused (`TESTIMONIAL_APPROVED`); the manager withdraws the approval first,
 * which also takes it off the site. Any other rule lets approved-and-published
 * text be rewritten into something no one reviewed, which is precisely the
 * failure the approval exists to prevent — and it is the rule that makes
 * "approved" mean "these exact words were read by a manager".
 *
 * NOTHING HERE IS A CRM AND NOTHING HERE IS A CONSENT REGISTER. There is no
 * family link, no contact detail, no consent document, no signature, no expiry
 * and no follow-up state. The consent that permits a family's words to be
 * published is an owner-held document (PROJECT_SPEC.md 17); modelling half of
 * it here would suggest this system is the record of it.
 */
export const TESTIMONIAL_STATUSES = ['DRAFT', 'APPROVED'] as const;

export type TestimonialStatus = (typeof TESTIMONIAL_STATUSES)[number];

export const testimonialStatusSchema = z.enum(TESTIMONIAL_STATUSES);

export const testimonialSchema = z.strictObject({
  id: z.uuid(),
  /**
   * An anonymised description of who is speaking, or nothing at all. Never a
   * name: see `publicTestimonialSchema` for why the public shape carries no
   * identity, and this column is the only thing behind it.
   */
  authorLabel: z.string().nullable(),
  body: z.string(),
  status: testimonialStatusSchema,
  approvedAt: z.iso.datetime().nullable(),
  isPublic: z.boolean(),
  firstPublishedAt: z.iso.datetime().nullable(),
  publicRevisedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export type Testimonial = z.infer<typeof testimonialSchema>;

/** Creating one always creates a `DRAFT`, for the reason an article does. */
export const createTestimonialRequestSchema = z.strictObject({
  authorLabel: publicHeadingSchema.nullable(),
  body: publicProseSchema,
});

export type CreateTestimonialRequest = z.infer<typeof createTestimonialRequestSchema>;

export const updateTestimonialRequestSchema = createTestimonialRequestSchema;

export type UpdateTestimonialRequest = z.infer<typeof updateTestimonialRequestSchema>;

/**
 * The privacy review, in both directions.
 *
 * Withdrawing approval also takes the testimonial off the website, in the same
 * transaction: an approved-and-published quotation whose approval is revoked
 * cannot be left on a public page while somebody remembers to unpublish it
 * separately.
 */
export const updateTestimonialApprovalRequestSchema = z.strictObject({
  approved: z.boolean(),
});

export type UpdateTestimonialApprovalRequest = z.infer<
  typeof updateTestimonialApprovalRequestSchema
>;

export const updateTestimonialPublicationRequestSchema = z.strictObject({
  isPublic: z.boolean(),
});

export type UpdateTestimonialPublicationRequest = z.infer<
  typeof updateTestimonialPublicationRequestSchema
>;

export const testimonialResponseSchema = z.strictObject({ testimonial: testimonialSchema });

export type TestimonialResponse = z.infer<typeof testimonialResponseSchema>;

export const testimonialListResponseSchema = z.strictObject({
  testimonials: z.array(testimonialSchema),
});

export type TestimonialListResponse = z.infer<typeof testimonialListResponseSchema>;
