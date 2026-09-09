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

/**
 * How the family gave the clinic these words.
 *
 * Milestone 9.5, checkpoint A7. TWO VALUES, AND THE SECOND ONE EXISTS TO MAKE
 * ONE RULE STATEABLE: A HANDWRITTEN TESTIMONIAL MAY NOT BE PUBLISHED FROM
 * PIXELS ALONE.
 *
 * `TYPED` is a quotation somebody typed — the A2 case, unchanged in every
 * respect, and still the default for every row this product creates.
 *
 * `HANDWRITTEN` is a note a family wrote by hand and the clinic photographed.
 * The photograph may accompany it, and `publicTestimonialSchema.image` is where
 * it appears. IT IS NEVER THE MEANING. `body` — a transcription a human read
 * the note and typed — is the authoritative public text, it is required, and a
 * handwritten testimonial with nothing written down is refused as
 * `VALIDATION_FAILED` rather than stored as a picture waiting to be understood.
 *
 * THERE IS NO OCR IN THIS PRODUCT AND NO FIELD THAT COULD HOLD ITS OUTPUT.
 * Nothing in the API reads a photograph, and no column anywhere records what a
 * machine thought a note said. If the web tier ever offers transcription as a
 * DRAFTING AID, what it saves is what a human read, corrected and accepted
 * through the ordinary draft route — which is indistinguishable, here, from
 * typing. An authoritative machine-derived field would be the opposite: a
 * family's words about their child published because software was confident.
 *
 * IT IS NOT A PRIVACY GATE AND DOES NOT WEAKEN ONE. `status` remains the
 * manager's privacy review and `isPublic` remains placement, for both kinds.
 *
 * IT IS NOT IDENTIFYING AND IT IS NOT CLINICAL. It says how the words arrived,
 * and nothing about who wrote them, which child they concern, or anything that
 * happened in a session. The A2 privacy-by-absence model is unchanged: no
 * family, no child, no age, no diagnosis, no service, no therapist, no date.
 */
export const TESTIMONIAL_KINDS = ['TYPED', 'HANDWRITTEN'] as const;

export type TestimonialKind = (typeof TESTIMONIAL_KINDS)[number];

export const testimonialKindSchema = z.enum(TESTIMONIAL_KINDS);

export const testimonialSchema = z.strictObject({
  id: z.uuid(),
  /**
   * An anonymised description of who is speaking, or nothing at all. Never a
   * name: see `publicTestimonialSchema` for why the public shape carries no
   * identity, and this column is the only thing behind it.
   */
  authorLabel: z.string().nullable(),
  /**
   * The authoritative words, whatever the kind.
   *
   * For a `HANDWRITTEN` testimonial this is the human transcription, and it is
   * what a visitor reads: the photograph beside it is an illustration of a note
   * whose meaning is already here.
   */
  body: z.string(),
  kind: testimonialKindSchema,
  status: testimonialStatusSchema,
  approvedAt: z.iso.datetime().nullable(),
  isPublic: z.boolean(),
  firstPublishedAt: z.iso.datetime().nullable(),
  publicRevisedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export type Testimonial = z.infer<typeof testimonialSchema>;

/**
 * Creating one always creates a `DRAFT`, for the reason an article does.
 *
 * `body` IS REQUIRED FOR BOTH KINDS AND THAT IS THE HANDWRITTEN RULE. There is
 * no shape of this request that carries a `HANDWRITTEN` kind and no words, so
 * "the image alone is insufficient" is a property of the contract rather than a
 * check somebody has to remember: `publicProseSchema` is a trimmed, non-empty
 * string, and the column behind it is NOT NULL with the same CHECK.
 *
 * THERE IS NO IMAGE FIELD HERE, for either kind. A photograph is attached
 * through the media subsystem under `media.attach` and published under
 * `media.publish`, so this request cannot reference one, cannot require one and
 * cannot publish one.
 */
export const createTestimonialRequestSchema = z.strictObject({
  authorLabel: publicHeadingSchema.nullable(),
  body: publicProseSchema,
  /**
   * Defaulted to `TYPED`, so every existing caller keeps its meaning and a
   * request that says nothing about kind gets the kind that needs no picture.
   */
  kind: testimonialKindSchema.default('TYPED'),
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
