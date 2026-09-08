import { z } from 'zod';
import { publicImageSchema } from '../media/common';

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
  /**
   * Photographs of the clinic's own rooms, in the clinic's own order.
   *
   * Milestone 9.5, checkpoint A5, and THE ONE FIELD ON THIS SHAPE THAT IS NOT
   * OWNER-TYPED TEXT. It is here rather than on a separate read because these
   * pictures are a fact about the clinic in exactly the way its address is, and
   * a page that has to make two requests to lay out one section will eventually
   * render half of it.
   *
   * ITS PUBLICATION RULE IS THE EXCEPTION IN THE MEDIA SUBSYSTEM, and the
   * exception is honest. Every other public photograph hangs off a record that
   * is itself either public or not; this one hangs off the clinic profile,
   * which is a single row that is always live — editing it IS publishing
   * (Milestone 9, checkpoint A2). So a clinic-space photograph is visible
   * exactly while a manager has published its attachment, and manager authority
   * over that attachment is the whole of the control. An empty array is the
   * normal state and is not an error.
   *
   * NO PHOTOGRAPH OF A PERSON BELONGS HERE. This is rooms and equipment. A
   * colleague's portrait is a decision about a named human being and lives on
   * their own profile, behind their own permission; nothing in the schema can
   * enforce the difference, which is why it is stated here and reviewed by the
   * manager who publishes.
   */
  spacePhotos: z.array(publicImageSchema),
});

export type PublicClinicProfile = z.infer<typeof publicClinicProfileSchema>;

export const publicClinicProfileResponseSchema = z.strictObject({
  clinic: publicClinicProfileSchema,
});

export type PublicClinicProfileResponse = z.infer<typeof publicClinicProfileResponseSchema>;
