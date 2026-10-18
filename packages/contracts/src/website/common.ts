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
 * is implemented on either side. NOTHING IN `apps/api` READS THESE, INCLUDING
 * AFTER CHECKPOINT A2: the manager write paths return the row they wrote —
 * slug and publication flag included — which is everything the web tier needs
 * to work out which tags a successful mutation invalidated. An API that named
 * the tags in its responses would be a second, quieter answer to a question the
 * response body already answers, and would put a web caching concern inside the
 * domain layer.
 *
 * FIVE NAMES FOR THE FIVE PUBLIC COLLECTIONS, plus three prefixes for the three
 * reads that are keyed by slug. The prefixes are strings rather than functions
 * because this package contains no logic: the caller concatenates the slug it
 * already holds.
 *
 * WHICH TAGS A SUCCESSFUL MANAGER MUTATION AFFECTS — the handshake Agent B
 * builds against, stated once, here:
 *
 *   service create/update ......... `services`, and `public-service:` + slug
 *   therapist public profile ...... `team`, and `public-therapist:` + slug
 *   therapist public visibility ... `team`, and `public-therapist:` + slug
 *   article create/update ......... `articles`, and `public-article:` + slug
 *   article publish/unpublish ..... `articles`, and `public-article:` + slug
 *   testimonial write/approve ..... `testimonials`
 *   testimonial publish ........... `testimonials`
 *   clinic profile update ......... `clinicProfile`
 *
 * MILESTONE 9.5, CHECKPOINT A5 ADDS THREE LINES TO THAT TABLE, and they are
 * the media acts rather than new content acts:
 *
 *   media attachment published/unpublished ... the OWNER's tags, exactly as
 *                                              editing that owner does
 *   media asset archived/restored ............ the tags of every owner it is
 *                                              attached to
 *   media detached ........................... the OWNER's tags
 *
 * MILESTONE 9.5, CHECKPOINT A8 ADDS NO TAG AND TWO LINES TO THAT TABLE. The
 * clinic's editorial blocks and its Open Graph photograph are part of the
 * clinic-profile surface, so they drop the tag that surface already has:
 *
 *   clinic content entry update .............. `clinicProfile`
 *   media attachment published/unpublished/
 *     detached on `CLINIC_CONTENT_ENTRY` or
 *     `CLINIC_OPEN_GRAPH` ..................... `clinicProfile`
 *
 * ONE NAME FOR ONE SURFACE, DELIBERATELY. `GET /public/clinic-profile` and
 * `GET /public/clinic-content` are two reads of one thing a manager maintains
 * on one screen, and a second tag would be a second thing to remember to drop
 * when the same manager act changes both. Neither affects `sitemap`: the clinic
 * profile is not a data-driven page and an editorial block has no URL.
 *
 * A media act therefore invalidates the same page data a content act does,
 * because the projection listing the photograph is part of that page's data.
 * The BYTES are tagged separately, under `PUBLIC_MEDIA_CACHE_TAG_PREFIX` plus
 * the rendition id, because a page's data goes stale when its copy changes
 * while a rendition's bytes go stale only when it stops being public.
 *
 * EVERY ONE OF THOSE ALSO AFFECTS `sitemap`, except the testimonial and clinic
 * rows: a testimonial has no URL of its own and the clinic profile is not a
 * data-driven page. The sitemap read is derived from the same rows as the pages
 * it lists, so a publication that changes a page and leaves the sitemap stale
 * would advertise a URL that no longer answers.
 */
export const PUBLIC_CACHE_TAGS = {
  services: 'public-services',
  team: 'public-team',
  clinicProfile: 'public-clinic-profile',
  /** Milestone 9, checkpoint A2. */
  articles: 'public-articles',
  /** Milestone 9, checkpoint A2. */
  testimonials: 'public-testimonials',
  /** Milestone 9, checkpoint A2 — the derived URL list, not a page. */
  sitemap: 'public-sitemap',
  /**
   * Milestone 9.5, checkpoint A7. The published clinic-space gallery.
   *
   * IT HAS NO PER-SLUG PREFIX BESIDE IT, because a space has no address of its
   * own: the gallery is one read, so one tag is the whole of it.
   *
   * WHICH ACTS DROP IT: a space published or unpublished, and a media
   * attachment on a space published, unpublished or detached — the same rule
   * the A5 table already states for an article and its illustrations. A space
   * DRAFT edit drops nothing, because no public read can see one. It never
   * affects `sitemap`: a space is not a data-driven page and appears in no URL
   * list.
   */
  spaces: 'public-spaces',
} as const;

/** `public-service:` + the service slug. */
export const PUBLIC_SERVICE_CACHE_TAG_PREFIX = 'public-service:';

/** `public-therapist:` + the therapist slug. */
export const PUBLIC_THERAPIST_CACHE_TAG_PREFIX = 'public-therapist:';

/** `public-article:` + the article slug. Milestone 9, checkpoint A2. */
export const PUBLIC_ARTICLE_CACHE_TAG_PREFIX = 'public-article:';

/**
 * PUBLIC COPY IS PLAIN TEXT, AND THE ABSENCE OF `<` IS WHAT MAKES THAT TRUE.
 *
 * Milestone 9, checkpoint A2. Article titles, summaries and bodies and
 * testimonial text are written by a manager and rendered to strangers, which is
 * the exact shape of a stored-cross-site-scripting defect. Every other product
 * answers it with an HTML sanitiser in front of the renderer; this one answers
 * it by refusing to STORE markup at all, in the shared contract and again in a
 * database CHECK, so there is no sanitiser to misconfigure and no path by which
 * a `<script>` reaches a column.
 *
 * The web tier can therefore render these values as text — paragraphs split on
 * blank lines — with no `dangerouslySetInnerHTML` anywhere near them.
 *
 * The cost is a character a Persian clinical article will essentially never
 * need. If real copy ever does, the answer is a deliberate markup decision with
 * a renderer behind it, not relaxing this to "usually safe".
 */
export const PUBLIC_PLAIN_TEXT_PATTERN = /^[^<]*$/;

const plainText = (max: number) =>
  z.string().trim().min(1).max(max).regex(PUBLIC_PLAIN_TEXT_PATTERN, 'must not contain markup');

/** A public heading or short label. */
export const publicHeadingSchema = plainText(200);

/** A public standfirst: what a listing and a meta description show. */
export const publicSummarySchema = plainText(400);

/** A public prose body. */
export const publicProseSchema = plainText(20000);
