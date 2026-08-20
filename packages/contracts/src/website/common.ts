import { z } from 'zod';

/**
 * The vocabulary the public website shares with the API, and nothing else.
 *
 * Milestone 9, checkpoint A1. Everything in this directory is a PUBLIC-FACING
 * PROJECTION: a purpose-built shape describing what the clinic has decided to
 * say to the world. None of it reuses an internal catalog schema, and that is
 * the whole design — `serviceSchema` carries `id`, `status`, `deactivatedAt`
 * and `isPublic`, all of which are facts about how the clinic administers a
 * service rather than facts a visitor is owed. A projection that reused it
 * would leak those four the moment somebody rendered the object, and would keep
 * leaking whatever the internal schema gained next.
 */

/**
 * A public identifier: lowercase ASCII words joined by single hyphens.
 *
 * ASCII ONLY, DELIBERATELY, IN A PERSIAN PRODUCT. The slug is the URL, and a
 * URL is compared byte for byte by every cache, log, sitemap and canonical tag
 * that will ever see it. Persian text in a path is percent-encoded by the
 * browser and normalised differently by different clients, so two links to one
 * page would stop being one string — which is exactly what a stable public
 * identity may not do. The Persian the visitor READS lives in the display
 * fields beside it; the slug is machinery.
 *
 * No leading, trailing or doubled hyphen, so one page has exactly one spelling.
 * Two characters minimum: a single-letter path is almost always a typo, and
 * nothing in the accepted route structure needs one.
 */
export const PUBLIC_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const publicSlugSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(PUBLIC_SLUG_PATTERN, 'must be lowercase ASCII words joined by single hyphens');

export type PublicSlug = z.infer<typeof publicSlugSchema>;

/**
 * A path to an owner-supplied public image, relative to wherever the web tier
 * serves public media from.
 *
 * Relative, and it may not climb: no scheme, no leading slash, no `..`
 * segment. A public profile photo is a value a manager types, and this is the
 * narrowest shape that cannot be turned into a request to somewhere else.
 * Resolving it to a URL is the web tier's job, which is why nothing here names
 * a host.
 */
export const PUBLIC_MEDIA_PATH_PATTERN = /^[a-z0-9][a-z0-9/._-]*$/;

export const publicMediaPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(PUBLIC_MEDIA_PATH_PATTERN, 'must be a relative lowercase media path')
  .refine((value) => !value.includes('..'), 'must not contain a parent-directory segment');

/**
 * THE CACHE VOCABULARY, AND ONLY THE VOCABULARY.
 *
 * The public site is read far more often than it changes, so the web tier will
 * cache these reads and drop them again when a manager publishes something.
 * That caching is Next.js behaviour and belongs to the web lane; what has to be
 * agreed ACROSS the lanes is the set of names, because a page that tags its
 * fetch `public-services` and a revalidation that clears `publicServices` would
 * be a bug nothing fails on — the site would simply go stale and nobody would
 * know for how long.
 *
 * So the names are frozen here, where both tiers can read them, and no caching
 * is implemented on either side of this checkpoint.
 *
 * FOUR NAMES FOR THE FOUR PUBLIC FACTS, plus two prefixes for the two reads
 * that are keyed by slug. The prefixes are strings rather than functions
 * because this package contains no logic: the caller concatenates the slug it
 * already holds.
 */
export const PUBLIC_CACHE_TAGS = {
  services: 'public-services',
  team: 'public-team',
  clinicProfile: 'public-clinic-profile',
} as const;

/** `public-service:` + the service slug. */
export const PUBLIC_SERVICE_CACHE_TAG_PREFIX = 'public-service:';

/** `public-therapist:` + the therapist slug. */
export const PUBLIC_THERAPIST_CACHE_TAG_PREFIX = 'public-therapist:';
