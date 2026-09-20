import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicImage, PublicServiceDetail, PublicServiceSummary } from '@clinic/contracts';
import { PublicServiceExplorer } from '@/components/public-service-explorer';

const reads = vi.hoisted(() => ({ service: vi.fn(), context: vi.fn() }));

vi.mock('@/server/public-site', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/server/public-site')>();
  return {
    ...original,
    getPublicService: reads.service,
    getPublicMetadataContext: reads.context,
  };
});

import ServiceDetailPage from './(public)/services/[slug]/page';

const IMAGE: PublicImage = {
  mediaId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a71',
  alt: 'اتاق روشن گفتاردرمانی با میز و صندلی',
  width: 1200,
  height: 800,
  renditions: [
    {
      path: 'media/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a72',
      format: 'webp',
      width: 640,
      height: 427,
      byteSize: 12000,
    },
    {
      path: 'media/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a73',
      format: 'jpeg',
      width: 1200,
      height: 800,
      byteSize: 31000,
    },
  ],
  framing: { focalX: 0.35, focalY: 0.55, crop: null },
};

const SUMMARY: PublicServiceSummary = {
  slug: 'speech-therapy',
  name: 'گفتاردرمانی',
  description: 'توضیح عمومی خدمت',
  image: IMAGE,
};

const DETAIL: PublicServiceDetail = { ...SUMMARY, sessionDurationsMinutes: [45] };

beforeEach(() => {
  reads.service.mockReset();
  reads.context.mockReset();
  reads.context.mockResolvedValue({ clinicName: 'کلینیک نمونه', openGraphImage: null });
});

describe('A9 public service image rendering', () => {
  it('renders the published responsive image in the existing home service slot', () => {
    const html = renderToStaticMarkup(<PublicServiceExplorer services={[SUMMARY]} />);

    expect(html).toContain(IMAGE.alt);
    expect(html).toContain(IMAGE.renditions[0]!.path);
    expect(html).toContain('sizes="100vw"');
    expect(html).not.toContain('تصویر عمومی برای این خدمت منتشر نشده است');
    expect(html).not.toContain(IMAGE.mediaId);
  });

  it('keeps the Persian empty state when the public projection has no image', () => {
    const html = renderToStaticMarkup(
      <PublicServiceExplorer services={[{ ...SUMMARY, image: null }]} />,
    );

    expect(html).toContain('تصویر عمومی برای این خدمت منتشر نشده است');
    expect(html).not.toContain(IMAGE.renditions[0]!.path);
  });

  it('renders the published image in the existing service-detail hero', async () => {
    reads.service.mockResolvedValue({ status: 'ready', data: DETAIL });
    const html = renderToStaticMarkup(
      await ServiceDetailPage({ params: Promise.resolve({ slug: DETAIL.slug }) }),
    );

    expect(html).toContain(IMAGE.alt);
    expect(html).toContain(IMAGE.renditions[1]!.path);
    expect(html).toContain('fetchPriority="high"');
    expect(html).not.toContain('تصویر عمومی برای این خدمت منتشر نشده است');
    expect(html).not.toContain(IMAGE.mediaId);
  });

  it('keeps the detail hero empty when the image is unpublished from the projection', async () => {
    reads.service.mockResolvedValue({ status: 'ready', data: { ...DETAIL, image: null } });
    const html = renderToStaticMarkup(
      await ServiceDetailPage({ params: Promise.resolve({ slug: DETAIL.slug }) }),
    );

    expect(html).toContain('تصویر عمومی برای این خدمت منتشر نشده است');
    expect(html).not.toContain(IMAGE.renditions[0]!.path);
  });
});
