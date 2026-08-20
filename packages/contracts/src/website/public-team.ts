import { z } from 'zod';
import { publicMediaPathSchema, publicSlugSchema } from './common';

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
  photoPath: publicMediaPathSchema.nullable(),
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
