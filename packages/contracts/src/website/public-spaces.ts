import { z } from 'zod';
import { publicImageSchema } from '../media/common';

/**
 * A public space as the website states it.
 *
 * Milestone 9.5, checkpoint A7. THREE FIELDS, AND THE LIST IS SHORT FOR THE
 * REASON EVERY PUBLIC PROJECTION IN THIS PRODUCT IS SHORT: a shape that reused
 * the internal one would carry `id`, `isPublic`, `displayOrder` and three draft
 * columns to the website the first time somebody rendered it.
 *
 * NO OPERATIONAL FACT CAN REACH THIS SHAPE, AND NOT BECAUSE IT IS FILTERED OUT.
 * There is no room id, no room name, no room status, no service restriction, no
 * availability, no capacity and no scheduling meaning here — and there is none
 * on the row behind it either, because `public_space` holds no reference to
 * `room` and the two tables cannot be joined. A leak would require a new column
 * and a migration, not a widened `SELECT`.
 *
 * NO ID OF ANY KIND. A published space is content, not a resource an anonymous
 * caller addresses: the gallery is one read and the entries are ordered by the
 * clinic's own published ordering. The photographs carry a `mediaId`, which is
 * the media subsystem's opaque handle and is not an address (see
 * `publicImageSchema`).
 *
 * NO SLUG AND NO URL, for the reason `publicTestimonialSchema` has none.
 *
 * `name` AND `description` ARE THE PUBLISHED COPY AND NEVER THE DRAFT. The two
 * differ whenever somebody has prepared a change, and reading the draft here is
 * exactly the defect the split exists to prevent.
 */
export const publicSpaceSchema = z.strictObject({
  name: z.string(),
  description: z.string().nullable(),
  /**
   * The photographs a manager has published for this space, in the clinic's own
   * order.
   *
   * AN EMPTY ARRAY IS THE NORMAL STATE. A space may be published with words and
   * no picture, and a picture prepared for it stays invisible until a manager
   * publishes that attachment as well — two separate manager acts, exactly as
   * an article and its illustrations.
   *
   * THE PHOTOGRAPHS ARE OF ROOMS AND CORRIDORS, NOT OF PEOPLE. Nothing in this
   * product decides what a clinic points a camera at, and nothing here should
   * be read as permission to publish a photograph containing a child: that is a
   * consent question the clinic's owner answers, and it is out of scope here
   * exactly as testimonial consent is (PROJECT_SPEC.md 17).
   */
  images: z.array(publicImageSchema),
});

export type PublicSpace = z.infer<typeof publicSpaceSchema>;

export const publicSpaceListResponseSchema = z.strictObject({
  spaces: z.array(publicSpaceSchema),
});

export type PublicSpaceListResponse = z.infer<typeof publicSpaceListResponseSchema>;
