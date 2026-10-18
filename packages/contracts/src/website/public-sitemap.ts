import { z } from 'zod';
import { publicSlugSchema } from './common';

/**
 * The URL facts a sitemap is built from, and nothing that builds one.
 *
 * Milestone 9, checkpoint A2. Agent B's `sitemap.ts` is Next.js behaviour and
 * is not implemented here; what this contract states is the only thing the web
 * tier cannot work out for itself — WHICH DATA-DRIVEN PAGES CURRENTLY EXIST.
 *
 * IT IS DERIVED FROM THE SAME ROWS THE PAGES ARE. Every entry below comes out
 * of the same predicate as the read that renders the page it names, so a
 * sitemap cannot advertise a URL that answers 404, and a published page cannot
 * be missing from it. That is why this is an API read rather than a list the
 * web tier assembles from its own five fetches: five reads assembled by hand is
 * five chances to disagree with the site.
 *
 * IT CARRIES NO PATH AND NO HOST. `kind` plus `slug` is what the API knows; the
 * route structure — `/services/[slug]`, `/team/[slug]`, `/articles/[slug]` —
 * belongs to the web tier, which owns its own router and is the only tier that
 * can be wrong about it. A path string here would be the API asserting a URL it
 * cannot verify.
 *
 * IT LISTS ONLY DATA-DRIVEN PAGES. Home, about, contact, the privacy notice and
 * the request form exist whether or not anybody publishes anything; they are
 * routes in the web tier's own table and it needs no help enumerating them. A
 * testimonial is deliberately absent for the reason it has no slug: it is not a
 * page.
 *
 * `lastModified` IS NULLABLE AND THE NULL IS HONEST. It is the instant the
 * published content of that row last changed, recorded by the manager write
 * paths of this checkpoint. A row published before those paths existed — by the
 * synthetic dev seeder, or by a migration — genuinely has no such instant, and
 * a sitemap entry with no `lastmod` is a correct sitemap entry. Inventing one
 * from the publication stamp would tell a crawler that a page it has cached is
 * older than it is.
 */
export const PUBLIC_SITEMAP_KINDS = ['service', 'therapist', 'article'] as const;

export type PublicSitemapKind = (typeof PUBLIC_SITEMAP_KINDS)[number];

export const publicSitemapEntrySchema = z.strictObject({
  kind: z.enum(PUBLIC_SITEMAP_KINDS),
  slug: publicSlugSchema,
  lastModified: z.iso.datetime().nullable(),
});

export type PublicSitemapEntry = z.infer<typeof publicSitemapEntrySchema>;

export const publicSitemapResponseSchema = z.strictObject({
  entries: z.array(publicSitemapEntrySchema),
});

export type PublicSitemapResponse = z.infer<typeof publicSitemapResponseSchema>;
