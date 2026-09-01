import type { MetadataRoute } from 'next';
import { publicSiteOrigin } from '@/env';

export function robotsForPublicOrigin(origin = publicSiteOrigin()): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: [
          '/$',
          '/services$',
          '/services/',
          '/team$',
          '/team/',
          '/about$',
          '/testimonials$',
          '/articles$',
          '/articles/',
          '/contact$',
          '/privacy$',
          '/request$',
        ],
        disallow: ['/', '/request/received'],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}

export default function robots(): MetadataRoute.Robots {
  return robotsForPublicOrigin();
}
