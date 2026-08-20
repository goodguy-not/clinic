import { z } from 'zod';

/**
 * The clinic's own public profile: the narrow set of owner-supplied facts the
 * about, contact and location pages are built from.
 *
 * EVERY FIELD IS NULLABLE, AND THE READ ALWAYS SUCCEEDS. There is exactly one
 * clinic, so this is one row rather than a collection, and it exists from the
 * migration that creates it — empty. A missing profile is therefore never a
 * 404 the website has to render a page around; it is a profile whose fields are
 * null, which the web tier can lay out deliberately. Nothing here is invented:
 * the real address, telephone number, hours and links are owner-supplied data
 * this repository does not hold, and every fixture that fills them is
 * synthetic.
 *
 * WHAT IS NOT HERE. No branding assets, no copy blocks, no page structure, no
 * navigation, no SEO strings: those are content and design, they belong to the
 * checkpoints that build them, and inventing a column for each would freeze a
 * page layout in the database.
 */
export const publicClinicProfileSchema = z.strictObject({
  /** The name the clinic presents itself under, which need not be its legal name. */
  displayName: z.string().nullable(),
  tagline: z.string().nullable(),
  about: z.string().nullable(),
  addressLine: z.string().nullable(),
  cityLabel: z.string().nullable(),
  /**
   * Two numbers at most, stated exactly as the clinic wants them dialled. Not
   * normalised and not validated against a national format: this is the number
   * printed on the door, and rewriting it would be the product deciding it
   * knows better than the owner.
   */
  phonePrimary: z.string().nullable(),
  phoneSecondary: z.string().nullable(),
  email: z.email().nullable(),
  /**
   * Opening hours as one owner-written line, NOT a machine-readable schedule.
   * The clinic's real working pattern is therapist availability, which is
   * internal scheduling configuration and is never published; a visitor is told
   * when to telephone, and books through a person.
   */
  workingHoursNote: z.string().nullable(),
  /** A map pin, or neither. Degrees, WGS 84. */
  mapLatitude: z.number().min(-90).max(90).nullable(),
  mapLongitude: z.number().min(-180).max(180).nullable(),
  instagramUrl: z.url().nullable(),
  telegramUrl: z.url().nullable(),
});

export type PublicClinicProfile = z.infer<typeof publicClinicProfileSchema>;

export const publicClinicProfileResponseSchema = z.strictObject({
  clinic: publicClinicProfileSchema,
});

export type PublicClinicProfileResponse = z.infer<typeof publicClinicProfileResponseSchema>;
