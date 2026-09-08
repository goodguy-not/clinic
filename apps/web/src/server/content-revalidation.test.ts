import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PUBLIC_ARTICLE_CACHE_TAG_PREFIX,
  PUBLIC_CACHE_TAGS,
  type Article,
} from '@clinic/contracts';

const revalidateTag = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ revalidateTag }));

import { revalidateArticle, revalidateTestimonials } from './content-revalidation';

const ARTICLE: Article = {
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4db1',
  publicSlug: 'synthetic-guide',
  title: 'عنوان ساختگی',
  summary: null,
  body: 'متن ساختگی',
  isPublic: false,
  hasUnpublishedChanges: false,
  firstPublishedAt: null,
  publicRevisedAt: null,
  createdAt: '2026-08-01T08:00:00.000Z',
};

beforeEach(() => revalidateTag.mockReset());

describe('content public projection revalidation', () => {
  it('invalidates only the accepted article collection, detail, and sitemap tags', () => {
    revalidateArticle(ARTICLE);
    expect(revalidateTag.mock.calls).toEqual([
      [PUBLIC_CACHE_TAGS.articles, { expire: 0 }],
      [`${PUBLIC_ARTICLE_CACHE_TAG_PREFIX}${ARTICLE.publicSlug}`, { expire: 0 }],
      [PUBLIC_CACHE_TAGS.sitemap, { expire: 0 }],
    ]);
  });

  it('invalidates only the testimonial collection', () => {
    revalidateTestimonials();
    expect(revalidateTag).toHaveBeenCalledExactlyOnceWith(PUBLIC_CACHE_TAGS.testimonials, {
      expire: 0,
    });
  });
});
