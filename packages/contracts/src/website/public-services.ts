import { z } from 'zod';
import { durationMinutesSchema } from '../catalog/common';
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
