import { Prisma } from '@prisma/client';

/**
 * WHETHER AN OWNER ROW IS ON THE PUBLIC SITE — ONE DEFINITION PER OWNER KIND,
 * READ BY THE PUBLIC PROJECTION AND BY THE MEDIA SERVING PREDICATE ALIKE.
 *
 * Milestone 9.5 stabilisation checkpoint. Before it, every public projection
 * in `PublicSiteService` wrote its own WHERE clause and `media-visibility.ts`
 * restated a shorter one. They drifted: the team page required
 * `status = 'ACTIVE'` and the portrait gate read `is_public` alone, so a
 * deactivated colleague left the website while their photograph stayed
 * anonymously servable. The rule is now stated once, here, and both readers
 * interpolate the same fragment, so a condition added to a projection is a
 * condition added to its pictures.
 *
 * EACH FUNCTION TAKES THE ALIAS THE CALLER GAVE THE OWNER TABLE. The alias
 * reaches `Prisma.raw`, so it is checked rather than trusted — every caller
 * passes a literal from this repository.
 *
 * WHAT IS DELIBERATELY NOT HERE. Lookup conditions (`public_slug = $1`),
 * ordering, and the ownerless kinds. `CLINIC_OPEN_GRAPH` hangs off the
 * always-live clinic profile and `GET /public/clinic-content` always reads it;
 * `CLINIC_SPACE` is read by no projection at all. Both are decided in
 * `media-visibility.ts`, where the owner kinds are enumerated.
 */

function alias(name: string): Prisma.Sql {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Invalid SQL alias: ${name}`);
  return Prisma.raw(name);
}

/** `GET /public/services`, `/public/services/:slug`, and the sitemap. */
export function serviceIsPublic(name: string): Prisma.Sql {
  const s = alias(name);
  return Prisma.sql`(
    ${s}.is_public IS TRUE
    AND ${s}.status = 'ACTIVE'::catalog_status
    AND ${s}.public_slug IS NOT NULL
  )`;
}

/**
 * `GET /public/team`, `/public/team/:slug`, and the sitemap. `status` is the
 * condition the portrait gate used to miss: deactivating a therapist writes
 * `status` alone and leaves `is_public` standing.
 */
export function therapistIsPublic(name: string): Prisma.Sql {
  const t = alias(name);
  return Prisma.sql`(
    ${t}.is_public IS TRUE
    AND ${t}.status = 'ACTIVE'::catalog_status
    AND ${t}.public_slug IS NOT NULL
    AND ${t}.published_public_display_name IS NOT NULL
  )`;
}

/** `GET /public/articles`, `/public/articles/:slug`, and the sitemap. */
export function articleIsPublic(name: string): Prisma.Sql {
  const a = alias(name);
  return Prisma.sql`(
    ${a}.is_public IS TRUE
    AND ${a}.public_first_published_at IS NOT NULL
  )`;
}

/** `GET /public/testimonials`. Approval is part of being public. */
export function testimonialIsPublic(name: string): Prisma.Sql {
  const t = alias(name);
  return Prisma.sql`(
    ${t}.is_public IS TRUE
    AND ${t}.status = 'APPROVED'::testimonial_status
    AND ${t}.approved_at IS NOT NULL
  )`;
}

/** `GET /public/spaces`. */
export function spaceIsPublic(name: string): Prisma.Sql {
  const s = alias(name);
  return Prisma.sql`(
    ${s}.is_public IS TRUE
    AND ${s}.published_name IS NOT NULL
    AND ${s}.public_first_published_at IS NOT NULL
  )`;
}

/** `GET /public/clinic-content`. An unwritten block is on no page. */
export function contentEntryIsPublic(name: string): Prisma.Sql {
  const e = alias(name);
  return Prisma.sql`(${e}.heading IS NOT NULL)`;
}
