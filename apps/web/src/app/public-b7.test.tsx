import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PublicImage } from '@clinic/contracts';
import { PublicConcernGuide } from '@/components/public-concern-guide';
import { PublicSpaceTeaser } from '@/components/public-space-teaser';
import { PublicTestimonialGrid } from '@/components/public-testimonial-grid';

const IMAGE: PublicImage = {
  mediaId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d71',
  alt: 'عکس عمومی تأییدشده',
  width: 960,
  height: 640,
  renditions: [
    {
      path: 'media/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d72',
      format: 'webp',
      width: 640,
      height: 427,
      byteSize: 12000,
    },
    {
      path: 'media/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d73',
      format: 'jpeg',
      width: 960,
      height: 640,
      byteSize: 31000,
    },
  ],
  framing: { focalX: 0.3, focalY: 0.6, crop: null },
};

describe('M9.5 B7 managed public rendering', () => {
  it('renders A8 home copy without serialising slot identifiers or synthetic media', () => {
    const html = renderToStaticMarkup(
      <PublicConcernGuide
        clinicName="کلینیک نمونه"
        cityLabel="تهران"
        hero={{
          label: null,
          eyebrow: 'همراه شما',
          heading: 'از کجا شروع کنیم؟',
          body: 'متن مدیریت‌شدهٔ صفحهٔ اصلی',
          image: null,
        }}
        concerns={[
          {
            label: 'شرح مدیریت‌شدهٔ نگرانی',
            eyebrow: 'راهنمای شروع',
            heading: 'پاسخ منتشرشدهٔ کلینیک',
            body: 'روند عمومی منتشرشده',
            image: IMAGE,
          },
        ]}
      />,
    );

    expect(html).toContain('متن مدیریت‌شدهٔ صفحهٔ اصلی');
    expect(html).toContain('شرح مدیریت‌شدهٔ نگرانی');
    expect(html).toContain(IMAGE.renditions[0]!.path);
    expect(html).not.toMatch(/HOME_HERO|HOME_CONCERN|\/dev\/vala-synthetic/);
  });

  it('renders A7 public spaces in API order with responsive renditions and no room facts', () => {
    const html = renderToStaticMarkup(
      <PublicSpaceTeaser
        spaces={[
          { name: 'فضای عمومی اول', description: 'توضیح منتشرشدهٔ اول', images: [IMAGE] },
          { name: 'فضای عمومی دوم', description: 'توضیح منتشرشدهٔ دوم', images: [] },
        ]}
      />,
    );

    expect(html.indexOf('فضای عمومی اول')).toBeLessThan(html.indexOf('فضای عمومی دوم'));
    expect(html).toContain('sizes="(max-width: 47.99rem) 82vw');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain(IMAGE.renditions[0]!.path);
    expect(html).not.toMatch(
      /roomId|capacity|availability|restrictions|\/dev\/vala-synthetic|original/i,
    );
  });

  it('keeps handwritten transcription readable beside its approved image', () => {
    const html = renderToStaticMarkup(
      <PublicTestimonialGrid
        testimonials={[
          {
            authorLabel: 'یکی از همراهان',
            body: 'رونویسی انسانی و تأییدشدهٔ دست‌نوشته',
            kind: 'HANDWRITTEN',
            image: IMAGE,
          },
        ]}
        showDevelopmentExamples={false}
      />,
    );

    expect(html).toContain('<blockquote>«رونویسی انسانی و تأییدشدهٔ دست‌نوشته»</blockquote>');
    expect(html).toContain(IMAGE.renditions[1]!.path);
    expect(html).not.toContain('نمونهٔ توسعه');
  });

  it('does not compile synthetic photos into populated service, therapist, or article pages', () => {
    const publicRoot = join(__dirname, '(public)');
    const files = [
      join(publicRoot, 'services', 'page.tsx'),
      join(publicRoot, 'services', '[slug]', 'page.tsx'),
      join(publicRoot, 'team', 'page.tsx'),
      join(publicRoot, 'team', '[slug]', 'page.tsx'),
      join(publicRoot, 'articles', 'page.tsx'),
      join(publicRoot, 'articles', '[slug]', 'page.tsx'),
    ];
    const source = files.map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(source).not.toContain('/dev/vala-synthetic');
    expect(source).not.toContain('SITE_NAME');
  });
});
