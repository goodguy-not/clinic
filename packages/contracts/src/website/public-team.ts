import { z } from 'zod';
import { publicSlugSchema } from './common';
import { publicImageSchema } from '../media/common';

/**
 * A therapist as the website states them, and ONLY a therapist who asked to be
 * stated.
 *
 * PUBLIC VISIBILITY IS OPT-IN AND DEFAULTS OFF. An active therapist is not a
 * public one: appearing on the website is a separate, explicit, manager-recorded
 * fact about a person, and a product that inferred it from employment would
 * publish somebody who never agreed to be published.
 *
 * EVERY FIELD HERE IS OWNER-APPROVED PUBLIC CONTENT, AND NOTHING FALLS BACK TO
 * AN INTERNAL ONE. `displayName` is the name approved for the website, not the
 * `fullName` on the personnel row; `title` is the approved public title, not the
 * `specialty` the diary sorts by. When the approved content is missing the
 * therapist is simply not public — the internal value is never substituted,
 * because a substitution is a publication decision nobody made.
 *
 * ABSENT, AS EVERYWHERE ELSE ON THIS SURFACE: the internal id, the catalog
 * status, the deactivation timestamp, the visibility flag itself, the display
 * ordering (it is expressed by the ORDER of the array, not by a number a
 * visitor has to interpret), the supported service ids, and every settlement,
 * appointment and share fact that exists about this person.
 */
export const publicTherapistProfileSchema = z.strictObject({
  slug: publicSlugSchema,
  displayName: z.string(),
  title: z.string().nullable(),
  bio: z.string().nullable(),
  /**
   * The uploaded portrait, in every size the browser may choose between.
   *
   * Milestone 9.5, checkpoint A5. Since the Milestone 9.5 stabilisation it is
   * the ONLY portrait field: the manager-typed legacy `photoPath` was removed,
   * column and field. A profile may have no portrait at all.
   *
   * IT IS PRESENT ONLY WHILE EVERY GATE IS OPEN. The asset is active, the
   * attachment to this therapist is undetached and published, and this
   * therapist is public — which they must be to appear in this projection at
   * all. Any one of those changing makes this null on the next read and makes
   * the bytes a refusal at the origin on the next request.
   */
  photo: publicImageSchema.nullable(),
});

export type PublicTherapistProfile = z.infer<typeof publicTherapistProfileSchema>;

/** The team page. Ordered by the clinic's own public ordering. */
export const publicTeamResponseSchema = z.strictObject({
  therapists: z.array(publicTherapistProfileSchema),
});

export type PublicTeamResponse = z.infer<typeof publicTeamResponseSchema>;

export const publicTherapistProfileResponseSchema = z.strictObject({
  therapist: publicTherapistProfileSchema,
});

export type PublicTherapistProfileResponse = z.infer<typeof publicTherapistProfileResponseSchema>;
