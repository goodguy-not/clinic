import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { metadataDescription, privatePublicMetadata, publicMetadata } from '@/server/public-seo';
import { robotsForPublicOrigin } from './robots';
import { sitemapFromPublicEntries } from './sitemap';

const reads = vi.hoisted(() => ({
  article: vi.fn(),
  service: vi.fn(),
  therapist: vi.fn(),
}));

vi.mock('@/server/public-site', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/server/public-site')>();
  return {
    ...original,
    getPublicArticle: reads.article,
    getPublicService: reads.service,
    getPublicTherapist: reads.therapist,
  };
});

import { generateMetadata as articleMetadata } from './(public)/articles/[slug]/page';
import { generateMetadata as serviceMetadata } from './(public)/services/[slug]/page';
import { generateMetadata as therapistMetadata } from './(public)/team/[slug]/page';

const ORIGIN = 'https://clinic.test';

beforeEach(() => {
  reads.article.mockReset();
  reads.service.mockReset();
  reads.therapist.mockReset();
});

describe('M9 B5 public metadata policy', () => {
  it('builds self-referential Persian metadata and branded Open Graph basics', () => {
    const metadata = publicMetadata(
      {
        title: 'خدمات توانبخشی | والا',
        description: 'خدمات عمومی و منتشرشدهٔ والا.',
        path: '/services',
      },
      ORIGIN,
    );

    expect(metadata.alternates).toEqual({ canonical: `${ORIGIN}/services` });
    expect(metadata.robots).toEqual({ index: true, follow: true });
    expect(metadata.openGraph).toMatchObject({
      type: 'website',
      locale: 'fa_IR',
      siteName: 'کلینیک توانبخشی والا',
      url: `${ORIGIN}/services`,
      title: 'خدمات توانبخشی | والا',
      description: 'خدمات عمومی و منتشرشدهٔ والا.',
      images: [{ url: `${ORIGIN}/icon.png`, alt: 'نشان والا' }],
    });
  });

  it('does not give unavailable or non-public details a canonical or social card', () => {
    expect(privatePublicMetadata('خدمت | والا')).toEqual({
      title: 'خدمت | والا',
      robots: { index: false, follow: false, nocache: true },
    });
  });

  it('keeps approved descriptions concise without inventing replacement copy', () => {
    expect(metadataDescription('  متن   کوتاه\nتأییدشده  ')).toBe('متن کوتاه تأییدشده');
    const long = metadataDescription('ت'.repeat(200));
    expect(Array.from(long ?? '')).toHaveLength(160);
    expect(long?.endsWith('…')).toBe(true);
    expect(metadataDescription(null)).toBeUndefined();
  });

  it('derives each dynamic title, description and canonical from its public projection', async () => {
    reads.service.mockResolvedValue({
      status: 'ready',
      data: {
        slug: 'speech-therapy',
        name: 'گفتاردرمانی',
        description: 'توضیح عمومی تأییدشده',
        sessionDurationsMinutes: [45],
      },
    });
    reads.therapist.mockResolvedValue({
      status: 'ready',
      data: {
        slug: 'public-person',
        displayName: 'درمانگر عمومی',
        title: 'عنوان عمومی',
        bio: 'زندگی‌نامهٔ عمومی تأییدشده',
        photoPath: null,
      },
    });
    reads.article.mockResolvedValue({
      status: 'ready',
      data: {
        slug: 'first-visit',
        title: 'جلسهٔ اول',
        summary: 'خلاصهٔ منتشرشده',
        publishedAt: '2026-08-01T08:00:00.000Z',
        body: 'متن منتشرشده',
      },
    });

    const [service, therapist, article] = await Promise.all([
      serviceMetadata({ params: Promise.resolve({ slug: 'speech-therapy' }) }),
      therapistMetadata({ params: Promise.resolve({ slug: 'public-person' }) }),
      articleMetadata({ params: Promise.resolve({ slug: 'first-visit' }) }),
    ]);

    expect(service).toMatchObject({
      title: 'گفتاردرمانی | والا',
      description: 'توضیح عمومی تأییدشده',
      alternates: { canonical: 'http://localhost:3000/services/speech-therapy' },
    });
    expect(therapist).toMatchObject({
      title: 'درمانگر عمومی | والا',
      description: 'زندگی‌نامهٔ عمومی تأییدشده',
      alternates: { canonical: 'http://localhost:3000/team/public-person' },
    });
    expect(article).toMatchObject({
      title: 'جلسهٔ اول | والا',
      description: 'خلاصهٔ منتشرشده',
      alternates: { canonical: 'http://localhost:3000/articles/first-visit' },
      openGraph: { type: 'article', publishedTime: '2026-08-01T08:00:00.000Z' },
    });
  });

  it('keeps every failed public detail read noindex and free of entity metadata', async () => {
    const hidden = { status: 'not-found', data: null };
    reads.service.mockResolvedValue(hidden);
    reads.therapist.mockResolvedValue(hidden);
    reads.article.mockResolvedValue(hidden);

    const results = await Promise.all([
      serviceMetadata({ params: Promise.resolve({ slug: 'private-service' }) }),
      therapistMetadata({ params: Promise.resolve({ slug: 'private-person' }) }),
      articleMetadata({ params: Promise.resolve({ slug: 'draft-article' }) }),
    ]);

    for (const metadata of results) {
      expect(metadata.robots).toEqual({ index: false, follow: false, nocache: true });
      expect(metadata.alternates).toBeUndefined();
      expect(metadata.openGraph).toBeUndefined();
      expect(JSON.stringify(metadata)).not.toMatch(/private|draft/i);
    }
  });

  it('covers every static public route without adding metadata to the received state', () => {
    const publicRoot = join(__dirname, '(public)');
    const indexable = [
      ['page.tsx', "path: '/'"],
      ['services', 'page.tsx', "path: '/services'"],
      ['team', 'page.tsx', "path: '/team'"],
      ['about', 'page.tsx', "path: '/about'"],
      ['testimonials', 'page.tsx', "path: '/testimonials'"],
      ['articles', 'page.tsx', "path: '/articles'"],
      ['contact', 'page.tsx', "path: '/contact'"],
      ['privacy', 'page.tsx', "path: '/privacy'"],
      ['request', 'page.tsx', "path: '/request'"],
    ] as const;

    for (const parts of indexable) {
      const expected = parts.at(-1)!;
      const source = readFileSync(join(publicRoot, ...parts.slice(0, -1)), 'utf8');
      expect(source).toContain('publicMetadata');
      expect(source).toContain(expected);
    }

    const received = readFileSync(join(publicRoot, 'request', 'received', 'page.tsx'), 'utf8');
    expect(received).toContain('index: false, follow: false, nocache: true');
    expect(received).not.toContain('publicMetadata');
    expect(received).not.toMatch(/contactName|contactMobile|child/i);
  });
});

describe('M9 B5 discovery documents', () => {
  it('builds a truthful sitemap from static routes and only A2 public entries', () => {
    const sitemap = sitemapFromPublicEntries(
      [
        { kind: 'service', slug: 'speech-therapy', lastModified: null },
        {
          kind: 'therapist',
          slug: 'public-person',
          lastModified: '2026-08-20T08:00:00.000Z',
        },
        { kind: 'article', slug: 'published-article', lastModified: null },
      ],
      ORIGIN,
    );
    const urls = sitemap.map((entry) => entry.url);

    expect(urls).toEqual([
      ORIGIN,
      `${ORIGIN}/services`,
      `${ORIGIN}/team`,
      `${ORIGIN}/about`,
      `${ORIGIN}/testimonials`,
      `${ORIGIN}/articles`,
      `${ORIGIN}/contact`,
      `${ORIGIN}/privacy`,
      `${ORIGIN}/request`,
      `${ORIGIN}/services/speech-therapy`,
      `${ORIGIN}/team/public-person`,
      `${ORIGIN}/articles/published-article`,
    ]);
    expect(JSON.stringify(sitemap)).not.toMatch(
      /received|dashboard|website-request|famil(?:y|ies)|staff|testimonial\/|draft/i,
    );
    expect(sitemap.at(-2)?.lastModified).toBe('2026-08-20T08:00:00.000Z');

    const source = readFileSync(join(__dirname, 'sitemap.ts'), 'utf8');
    expect(source).toContain('getPublicSitemap');
    expect(source).not.toMatch(/getPublic(?:Articles|Services|Team|Testimonials)/);
    expect(sitemapFromPublicEntries([], ORIGIN)).toHaveLength(9);
  });

  it('allows only named public trees, blocks everything else, and points to the canonical sitemap', () => {
    const robots = robotsForPublicOrigin(ORIGIN);
    const serialized = JSON.stringify(robots);

    expect(robots.sitemap).toBe(`${ORIGIN}/sitemap.xml`);
    expect(robots.host).toBe(ORIGIN);
    expect(robots.rules).toEqual([
      expect.objectContaining({
        userAgent: '*',
        allow: expect.arrayContaining(['/services/', '/team/', '/articles/', '/request$']),
        disallow: ['/', '/request/received'],
      }),
    ]);
    expect(serialized).not.toMatch(/dashboard|family|staff|website-request|api/i);
  });
});
