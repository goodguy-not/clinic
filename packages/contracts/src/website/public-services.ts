import { z } from 'zod';
import { durationMinutesSchema } from '../catalog/common';
import { publicImageSchema } from '../media/common';
import { publicSlugSchema } from './common';

/**
 * A service as the website states it.
 *
 * FOUR FIELDS FOR THE LIST AND ONE MORE FOR THE DETAIL, and every one of them
 * is a fact the clinic chose to publish. What is absent is the point:
 *
 *   * NO `id`. The public identity of a service is its slug. Publishing the
 *     internal UUID would hand every visitor the key that names the same row in
 *     the tariff, appointment and charge tables, for no public purpose at all.
 *   * NO `status`, NO `deactivatedAt`, NO `isPublic`. These say how the clinic
 *     ADMINISTERS the service. A visitor sees a service or does not; they are
 *     never told that one exists but is switched off.
 *   * NO `createdAt` and no actor of any kind. When a service was entered, and
 *     by whom, is internal history.
 *   * NO PRICE, AND NO AVAILABILITY. Both are deliberate product decisions, not
 *     omissions to be filled in later: the tariff is effective-dated and may be
 *     therapist-specific, and appointment slots belong to a diary the public
 *     site does not read. A number here would be a promise the clinic has not
 *     made.
 */
export const publicServiceSummarySchema = z.strictObject({
  slug: publicSlugSchema,
  name: z.string(),
  description: z.string().nullable(),
  /**
   * The photograph a manager has published for this service, or `null`.
   *
   * Milestone 9.5, checkpoint A9. `null` IS THE NORMAL STATE and is not an
   * error: a service may be published with words and no picture, and a picture
   * prepared for it stays invisible until a manager publishes that attachment
   * as well. Render the empty state rather than a placeholder image.
   *
   * ONE PHOTOGRAPH, NOT A GALLERY, and the singular is the contract rather
   * than an accident of the data. A service page has one illustration in the
   * accepted design; the attachment table can hold more, and this field is the
   * first of them by the clinic's own `position`. It mirrors
   * `publicTestimonialSchema.image` exactly, for the same reason.
   *
   * IT IS SUBJECT TO BOTH PUBLICATION ACTS. A photograph reaches this field
   * only while a manager has published the attachment AND the service is
   * itself publicly reachable; withdrawing either takes it away at the origin
   * on the very next request. See `MEDIA_ATTACHMENT_OWNERS.PUBLIC_SERVICE`.
   *
   * THE PHOTOGRAPHS ARE OF ROOMS, EQUIPMENT AND ACTIVITIES, NOT OF PEOPLE.
   * Nothing in this product decides what a clinic points a camera at, and
   * nothing here should be read as permission to publish a photograph
   * containing a child: that is a consent question the clinic's owner answers,
   * exactly as for a public space (PROJECT_SPEC.md 17).
   */
  image: publicImageSchema.nullable(),
});

export type PublicServiceSummary = z.infer<typeof publicServiceSummarySchema>;

/**
 * The detail read adds the session lengths the service is offered in.
 *
 * A session length is not a price and not an available slot: it is what the
 * clinic offers, the same fact a receptionist would state on the telephone, and
 * a family planning their week needs it. It is the only field the detail has
 * that the list does not, which keeps the two projections one decision apart.
 */
export const publicServiceDetailSchema = publicServiceSummarySchema.extend({
  sessionDurationsMinutes: z.array(durationMinutesSchema),
});

export type PublicServiceDetail = z.infer<typeof publicServiceDetailSchema>;

export const publicServiceListResponseSchema = z.strictObject({
  services: z.array(publicServiceSummarySchema),
});

export type PublicServiceListResponse = z.infer<typeof publicServiceListResponseSchema>;

export const publicServiceDetailResponseSchema = z.strictObject({
  service: publicServiceDetailSchema,
});

export type PublicServiceDetailResponse = z.infer<typeof publicServiceDetailResponseSchema>;
