import { z } from 'zod';
import { publicImageSchema } from '../media/common';
import { testimonialKindSchema } from './testimonials';

/**
 * A testimonial as the website states it.
 *
 * Milestone 9, checkpoint A2. TWO FIELDS, AND THE SHORTNESS IS THE POINT.
 *
 * NO SLUG AND NO URL OF ITS OWN. Every other published thing in this product is
 * addressable; a testimonial deliberately is not. An addressable testimonial is
 * a page about one family, linkable, quotable and indexable on its own, and the
 * only way to make that safe would be to reason about what the URL implies. A
 * list on one page implies nothing about anybody.
 *
 * NO CHILD, NO FAMILY, NO SERVICE, NO THERAPIST, NO DATE, NO AGE, NO DIAGNOSIS
 * AND NO OUTCOME. None of those is a column on the row behind this shape, so
 * none of them can arrive here by a widened query. PROJECT_SPEC.md 11 forbids
 * publishing identifying child or clinical data, and the narrowest way to obey
 * a rule about a category of data is not to hold it.
 *
 * `authorLabel` IS AN ANONYMISED DESCRIPTION AND NEVER A NAME. "A parent",
 * "the mother of one of our families" — what the clinic writes, reviewed by a
 * manager before it is approved, and nullable because an unattributed quotation
 * is the safest form there is. Nothing in this repository fills it: every
 * fixture is synthetic and the real words are owner-supplied.
 *
 * Approval is not a field here. An unapproved testimonial is not in the read
 * that builds this shape (`PublicSiteService`), and its approval state is
 * internal — telling a visitor that unapproved testimonials exist would be a
 * fact about the clinic's queue rather than about the clinic.
 */
export const publicTestimonialSchema = z.strictObject({
  authorLabel: z.string().nullable(),
  /**
   * THE AUTHORITATIVE PUBLIC TEXT, FOR BOTH KINDS.
   *
   * For a `HANDWRITTEN` testimonial this is the transcription a human read off
   * the note and typed, and a manager approved. It is never derived from the
   * photograph, and a handwritten testimonial with no words cannot exist.
   */
  body: z.string(),
  /**
   * How the family gave the clinic these words, so the web tier can present a
   * photographed note as a photographed note rather than as decoration.
   *
   * Milestone 9.5, checkpoint A7. It is presentation information and nothing
   * more: it says nothing about who wrote the words, which child they concern,
   * or anything clinical, and it changes no privacy gate — an unapproved
   * testimonial of either kind is absent from this read entirely.
   */
  kind: testimonialKindSchema,
  /**
   * A photograph of the note the family actually wrote, or nothing.
   *
   * Milestone 9.5, checkpoint A5, and it is the most sensitive image this
   * product will ever serve — somebody's handwriting about their own child.
   *
   * IT PASSES THROUGH THE SAME PRIVACY REVIEW AS THE WORDS. The testimonial
   * must be `APPROVED` and public before this projection exists at all, and the
   * attachment must additionally have been published by a manager. Withdrawing
   * the approval unpublishes the testimonial in the same transaction, which
   * makes this null and makes the bytes a refusal at the origin.
   *
   * THE PHOTOGRAPH IS NOT READ BY THIS PRODUCT AND IS NOT THE `body`. Whatever
   * the note says, the words a visitor is given are the anonymised text a
   * manager reviewed and typed; nothing infers `body` from the picture, and
   * nothing stores what the picture depicts.
   */
  image: publicImageSchema.nullable(),
});

export type PublicTestimonial = z.infer<typeof publicTestimonialSchema>;

export const publicTestimonialListResponseSchema = z.strictObject({
  testimonials: z.array(publicTestimonialSchema),
});

export type PublicTestimonialListResponse = z.infer<typeof publicTestimonialListResponseSchema>;
