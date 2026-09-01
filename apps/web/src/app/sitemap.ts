import type { MetadataRoute } from 'next';
import { publicSiteOrigin } from '@/env';
import { getPublicSitemap } from '@/server/public-site';

const staticPaths = [
  '',
  '/services',
  '/team',
  '/about',
  '/testimonials',
  '/articles',
  '/contact',
  '/privacy',
  '/request',
] as const;

export function sitemapFromPublicEntries(
  entries: Awaited<ReturnType<typeof getPublicSitemap>>['data'],
  origin = publicSiteOrigin(),
): MetadataRoute.Sitemap {
  const dynamic = entries.map((entry) => ({
    url: `${origin}/${entry.kind === 'therapist' ? 'team' : `${entry.kind}s`}/${entry.slug}`,
    lastModified: entry.lastModified ?? undefined,
  }));

  return [...staticPaths.map((path) => ({ url: `${origin}${path}` })), ...dynamic];
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const read = await getPublicSitemap();
  return sitemapFromPublicEntries(read.data);
}
