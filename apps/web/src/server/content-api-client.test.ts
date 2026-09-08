import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api-client';

type Captured = { url: string; init: RequestInit };
let captured: Captured[] = [];

const ARTICLE_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4da1';
const TESTIMONIAL_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4da2';
const ARTICLE = {
  id: ARTICLE_ID,
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
const TESTIMONIAL = {
  id: TESTIMONIAL_ID,
  authorLabel: null,
  body: 'نقل‌قول ساختگی',
  status: 'DRAFT',
  approvedAt: null,
  isPublic: false,
  firstPublishedAt: null,
  publicRevisedAt: null,
  createdAt: '2026-08-01T08:00:00.000Z',
};

function answer(payload: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      captured.push({ url, init });
      return Promise.resolve(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
}

beforeEach(() => {
  captured = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('named internal content API client', () => {
  it('uses only the accepted article routes and keeps publication separate', async () => {
    answer({ articles: [ARTICLE] });
    await api.listArticles({ sessionToken: 'synthetic-token' });
    answer({ article: ARTICLE });
    await api.getArticle(ARTICLE_ID, { sessionToken: 'synthetic-token' });
    await api.createArticle(
      { publicSlug: 'synthetic-guide', title: 'عنوان ساختگی', summary: null, body: 'متن ساختگی' },
      { sessionToken: 'synthetic-token' },
    );
    await api.updateArticle(
      ARTICLE_ID,
      { publicSlug: 'synthetic-guide', title: 'عنوان ساختگی', summary: null, body: 'متن ساختگی' },
      { sessionToken: 'synthetic-token' },
    );
    await api.updateArticlePublication(
      ARTICLE_ID,
      { isPublic: true },
      { sessionToken: 'synthetic-token' },
    );

    expect(captured.map((entry) => [entry.init.method, new URL(entry.url).pathname])).toEqual([
      ['GET', '/content/articles'],
      ['GET', `/content/articles/${ARTICLE_ID}`],
      ['POST', '/content/articles'],
      ['PATCH', `/content/articles/${ARTICLE_ID}`],
      ['PATCH', `/content/articles/${ARTICLE_ID}/publication`],
    ]);
    expect(JSON.parse(String(captured[2]?.init.body))).not.toHaveProperty('isPublic');
    expect(JSON.parse(String(captured[4]?.init.body))).toEqual({ isPublic: true });
  });

  it('uses distinct testimonial draft, approval, and publication routes', async () => {
    answer({ testimonials: [TESTIMONIAL] });
    await api.listTestimonials({ sessionToken: 'synthetic-token' });
    answer({ testimonial: TESTIMONIAL });
    await api.getTestimonial(TESTIMONIAL_ID, { sessionToken: 'synthetic-token' });
    await api.createTestimonial(
      { authorLabel: null, body: 'نقل‌قول ساختگی' },
      { sessionToken: 'synthetic-token' },
    );
    await api.updateTestimonial(
      TESTIMONIAL_ID,
      { authorLabel: null, body: 'نقل‌قول ساختگی' },
      { sessionToken: 'synthetic-token' },
    );
    await api.updateTestimonialApproval(
      TESTIMONIAL_ID,
      { approved: true },
      { sessionToken: 'synthetic-token' },
    );
    await api.updateTestimonialPublication(
      TESTIMONIAL_ID,
      { isPublic: true },
      { sessionToken: 'synthetic-token' },
    );

    expect(captured.map((entry) => new URL(entry.url).pathname)).toEqual([
      '/content/testimonials',
      `/content/testimonials/${TESTIMONIAL_ID}`,
      '/content/testimonials',
      `/content/testimonials/${TESTIMONIAL_ID}`,
      `/content/testimonials/${TESTIMONIAL_ID}/approval`,
      `/content/testimonials/${TESTIMONIAL_ID}/publication`,
    ]);
    expect(JSON.parse(String(captured[2]?.init.body))).toEqual({
      authorLabel: null,
      body: 'نقل‌قول ساختگی',
    });
    expect(JSON.parse(String(captured[4]?.init.body))).toEqual({ approved: true });
    expect(JSON.parse(String(captured[5]?.init.body))).toEqual({ isPublic: true });
  });
});
