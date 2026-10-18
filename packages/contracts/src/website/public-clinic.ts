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
 *
 * AND NO PHOTOGRAPHS OF THE CLINIC'S ROOMS, DELIBERATELY, AFTER MILESTONE 9.5.
 * The media subsystem can hold, attach and publish a clinic-space photograph —
 * `CLINIC_SPACE` is one of the attachment targets — but since the Milestone 9.5
 * stabilisation its bytes are never anonymously servable, because no public
 * projection reads that owner. Public room photographs are `PUBLIC_SPACE` (A7).
 * What is NOT decided is where those photographs appear, in what order, under
 * what heading, and whether they belong to this profile at all rather than to a
 * page of their own. That is public-space product design, it belongs to the
 * checkpoint that builds it, and a `spacePhotos` array on this shape would have
 * settled it here by accident — exactly the freezing this comment has warned
 * about since Milestone 9 checkpoint A1.
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
