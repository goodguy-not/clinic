import type { MetadataRoute } from 'next';
import { allowedOrigins, loadServerEnv } from '@/env';

export default function robots(): MetadataRoute.Robots {
  const origin = allowedOrigins(loadServerEnv())[0] ?? 'http://localhost:3000';
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/login', '/dashboard'] }],
    sitemap: `${origin}/sitemap.xml`,
  };
}
