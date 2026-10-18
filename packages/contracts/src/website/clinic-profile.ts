import { z } from 'zod';
import { PUBLIC_PLAIN_TEXT_PATTERN } from './common';

/**
 * The manager's write path over the clinic's own public facts.
 *
 * Milestone 9, checkpoint A2. A1 created the row empty and gave it no writer;
 * this is that writer, and after it nothing about the address, telephone number
 * or opening-hours line on a live website needs SQL, a seed or a deployment.
 *
 * THE READ IS THE PUBLIC SHAPE ITSELF (`publicClinicProfileSchema`), which is
 * the one place in this milestone where an internal and a public projection are
 * the same type — deliberately, because every column on this row IS a public
 * fact. There is nothing to hide from a visitor and therefore nothing to
 * project away, and inventing a second identical schema would be two things to
 * keep in step for no gain. It still needs its own permission
 * (`clinic_profile.read`): seeing what the site publishes is internal
 * administration even when the facts are not secret.
 *
 * ALL THIRTEEN FIELDS EVERY TIME, ALL NULLABLE. A partial update would have to
 * distinguish "leave the fax number alone" from "clear it", and this is one
 * form on one screen with thirteen boxes on it: what the manager submits is
 * what the clinic says.
 *
 * THE SHAPES ARE THE DATABASE'S, RESTATED. The bounds, the `https`-only links,
 * the both-or-neither map pin and the e-mail shape are all CHECK constraints
 * A1 wrote; these are the same rules in the tier that can produce a readable
 * error instead of a 500. The database remains the authority.
 *
 * NOTHING HERE IS INVENTED. No default name, no placeholder address, no sample
 * telephone number: the real values are owner-supplied (PROJECT_SPEC.md 17),
 * and an unconfigured clinic reads as thirteen nulls.
 */
const line = (max: number) =>
  z.string().trim().min(1).max(max).regex(PUBLIC_PLAIN_TEXT_PATTERN, 'must not contain markup');

/**
 * A telephone number exactly as the clinic wants it dialled: not normalised,
 * not validated against a national format, not rewritten. It is the number
 * printed on the door.
 */
const phone = z.string().trim().min(1).max(40).regex(PUBLIC_PLAIN_TEXT_PATTERN);

/** `https` only. These two are rendered as links with a browser on the far end. */
const httpsUrl = z
  .url()
  .max(300)
  .refine((value) => value.startsWith('https://'), 'must be an https URL');

export const updateClinicProfileRequestSchema = z.strictObject({
  displayName: line(120).nullable(),
  tagline: line(200).nullable(),
  about: line(4000).nullable(),
  addressLine: line(300).nullable(),
  cityLabel: line(120).nullable(),
  phonePrimary: phone.nullable(),
  phoneSecondary: phone.nullable(),
  email: z.email().max(200).nullable(),
  workingHoursNote: line(300).nullable(),
  mapLatitude: z.number().min(-90).max(90).nullable(),
  mapLongitude: z.number().min(-180).max(180).nullable(),
  instagramUrl: httpsUrl.nullable(),
  telegramUrl: httpsUrl.nullable(),
});

export type UpdateClinicProfileRequest = z.infer<typeof updateClinicProfileRequestSchema>;
