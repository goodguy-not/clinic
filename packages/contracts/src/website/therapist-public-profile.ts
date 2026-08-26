import { z } from 'zod';
import { publicMediaPathSchema, publicProseSchema, publicSlugSchema } from './common';
import { publicHeadingSchema } from './common';

/**
 * A therapist's public profile, as the manager who maintains it sees it.
 *
 * Milestone 9, checkpoint A2. This closes the write path A1 left deliberately
 * open: the columns existed and only the dev seeder wrote them.
 *
 * IT IS A SEPARATE READ FROM `therapistSchema`, NOT A FEW MORE FIELDS ON IT.
 * `therapist.read` is the diary's read — a receptionist holds it to choose who
 * a session is with — and the public profile is `therapist.publish_profile`, an
 * authority A1 separated precisely so that "may correct a misspelt specialty"
 * and "may put a colleague's photograph on the internet" are not the same
 * grant. Folding these fields into the personnel shape would hand the second to
 * everybody holding the first.
 *
 * `therapistId` IS PRESENT HERE AND ABSENT FROM THE PUBLIC SHAPE. This is the
 * internal surface: the manager screen addresses the person by the id it
 * already holds. The website addresses them by slug and never learns the id.
 */
export const therapistPublicProfileSchema = z.strictObject({
  therapistId: z.uuid(),
  publicSlug: publicSlugSchema.nullable(),
  displayName: z.string().nullable(),
  title: z.string().nullable(),
  bio: z.string().nullable(),
  photoPath: publicMediaPathSchema.nullable(),
  displayOrder: z.number().int(),
  isPublic: z.boolean(),
  firstPublishedAt: z.iso.datetime().nullable(),
  publicRevisedAt: z.iso.datetime().nullable(),
});

export type TherapistPublicProfile = z.infer<typeof therapistPublicProfileSchema>;

/**
 * The approved public content, WITHOUT the opt-in.
 *
 * Preparing what a colleague's page would say and deciding that it goes live
 * are two acts, which is exactly what A1's `therapist_public_profile_chk`
 * permits by requiring the content for the flag but not the flag for the
 * content. Two requests, two audit rows, and a manager who writes a biography
 * has not thereby published anybody.
 *
 * Every field is nullable because a profile may be half-prepared, and the
 * database refuses the publication rather than the preparation.
 *
 * `displayOrder` is here rather than on the visibility request because it is
 * content: it is how the clinic wants its team introduced, and it is worth
 * setting before anyone is visible.
 */
export const updateTherapistPublicProfileRequestSchema = z.strictObject({
  publicSlug: publicSlugSchema.nullable(),
  displayName: publicHeadingSchema.max(120).nullable(),
  title: publicHeadingSchema.max(120).nullable(),
  bio: publicProseSchema.max(4000).nullable(),
  photoPath: publicMediaPathSchema.nullable(),
  displayOrder: z.number().int().min(-1000).max(1000),
});

export type UpdateTherapistPublicProfileRequest = z.infer<
  typeof updateTherapistPublicProfileRequestSchema
>;

/** The opt-in itself. One decision about one person. */
export const updateTherapistPublicVisibilityRequestSchema = z.strictObject({
  isPublic: z.boolean(),
});

export type UpdateTherapistPublicVisibilityRequest = z.infer<
  typeof updateTherapistPublicVisibilityRequestSchema
>;

export const therapistPublicProfileResponseSchema = z.strictObject({
  profile: therapistPublicProfileSchema,
});

export type TherapistPublicProfileResponse = z.infer<typeof therapistPublicProfileResponseSchema>;
