import type { MetadataRoute } from 'next';
import { allowedOrigins, loadServerEnv } from '@/env';
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
] as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = allowedOrigins(loadServerEnv())[0] ?? 'http://localhost:3000';
  const read = await getPublicSitemap();
  const dynamic = read.data.map((entry) => ({
    url: `${origin}/${entry.kind === 'therapist' ? 'team' : `${entry.kind}s`}/${entry.slug}`,
    lastModified: entry.lastModified ?? undefined,
  }));

  return [...staticPaths.map((path) => ({ url: `${origin}${path}` })), ...dynamic];
}
