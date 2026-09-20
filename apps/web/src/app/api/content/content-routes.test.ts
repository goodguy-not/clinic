import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cookieConfigFor } from '@/server/cookie-config';
import { issueCsrfToken } from '@/server/csrf';
import { signSessionCookie } from '@/server/session-cookie';

const mocks = vi.hoisted(() => ({
  createArticle: vi.fn(),
  updateArticle: vi.fn(),
  updateArticlePublication: vi.fn(),
  createTestimonial: vi.fn(),
  updateTestimonial: vi.fn(),
  updateTestimonialApproval: vi.fn(),
  updateTestimonialPublication: vi.fn(),
}));

vi.mock('@/server/api-client', () => ({ api: mocks }));

import { POST as createArticle } from './articles/create/route';
import { POST as publishArticle } from './articles/publication/route';
import { POST as updateArticle } from './articles/update/route';
import { POST as approveTestimonial } from './testimonials/approval/route';
import { POST as createTestimonial } from './testimonials/create/route';
import { POST as publishTestimonial } from './testimonials/publication/route';
import { POST as updateTestimonial } from './testimonials/update/route';

const ORIGIN = 'http://localhost:3000';
const SECRET = process.env['SESSION_COOKIE_SECRET'] as string;
const SESSION_TOKEN = 'synthetic-content-session-token';
const ARTICLE_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d91';
const TESTIMONIAL_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d92';
const COOKIES = cookieConfigFor('non-production');

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
  kind: 'TYPED',
  status: 'DRAFT',
  approvedAt: null,
  isPublic: false,
  firstPublishedAt: null,
  publicRevisedAt: null,
  createdAt: '2026-08-01T08:00:00.000Z',
};

function request(path: string, body: Record<string, string>, origin = ORIGIN): NextRequest {
  const csrfToken = issueCsrfToken(SECRET, { sessionToken: SESSION_TOKEN }, 1800);
  const cookie = [
    `${COOKIES.session.name}=${signSessionCookie(SECRET, SESSION_TOKEN)}`,
    `${COOKIES.csrf.name}=${csrfToken}`,
  ].join('; ');
  return new NextRequest(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { origin, cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...body, csrfToken }).toString(),
  });
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.createArticle.mockResolvedValue({ ok: true, data: { article: ARTICLE } });
  mocks.updateArticle.mockResolvedValue({ ok: true, data: { article: ARTICLE } });
  mocks.updateArticlePublication.mockResolvedValue({
    ok: true,
    data: { article: { ...ARTICLE, isPublic: true } },
  });
  mocks.createTestimonial.mockResolvedValue({ ok: true, data: { testimonial: TESTIMONIAL } });
  mocks.updateTestimonial.mockResolvedValue({ ok: true, data: { testimonial: TESTIMONIAL } });
  mocks.updateTestimonialApproval.mockResolvedValue({
    ok: true,
    data: { testimonial: { ...TESTIMONIAL, status: 'APPROVED' } },
  });
  mocks.updateTestimonialPublication.mockResolvedValue({
    ok: true,
    data: { testimonial: { ...TESTIMONIAL, status: 'APPROVED', isPublic: true } },
  });
});

describe('content draft handlers', () => {
  it('constructs article drafts without accepting a smuggled publication flag', async () => {
    const response = await createArticle(
      request('/api/content/articles/create', {
        publicSlug: ' synthetic-guide ',
        title: ' عنوان ساختگی ',
        summary: ' ',
        body: ' متن ساختگی ',
        isPublic: 'true',
      }),
    );

    expect(mocks.createArticle).toHaveBeenCalledWith(
      {
        publicSlug: 'synthetic-guide',
        title: 'عنوان ساختگی',
        summary: null,
        body: 'متن ساختگی',
      },
      { sessionToken: SESSION_TOKEN },
    );
    expect(response.headers.get('location')).toBe(`${ORIGIN}/content/articles/${ARTICLE_ID}/edit`);
  });

  it('constructs testimonial drafts without accepting approval or publication flags', async () => {
    await createTestimonial(
      request('/api/content/testimonials/create', {
        authorLabel: ' ',
        body: ' نقل‌قول ساختگی ',
        approved: 'true',
        isPublic: 'true',
      }),
    );

    expect(mocks.createTestimonial).toHaveBeenCalledWith(
      { authorLabel: null, body: 'نقل‌قول ساختگی', kind: 'TYPED' },
      { sessionToken: SESSION_TOKEN },
    );
  });

  it('updates both draft kinds through their named endpoints', async () => {
    await updateArticle(
      request('/api/content/articles/update', {
        id: ARTICLE_ID,
        publicSlug: 'synthetic-guide',
        title: 'عنوان ساختگی',
        summary: '',
        body: 'متن ساختگی',
      }),
    );
    await updateTestimonial(
      request('/api/content/testimonials/update', {
        id: TESTIMONIAL_ID,
        authorLabel: '',
        body: 'نقل‌قول ساختگی',
      }),
    );

    expect(mocks.updateArticle).toHaveBeenCalledWith(
      ARTICLE_ID,
      expect.objectContaining({ title: 'عنوان ساختگی' }),
      { sessionToken: SESSION_TOKEN },
    );
    expect(mocks.updateTestimonial).toHaveBeenCalledWith(
      TESTIMONIAL_ID,
      { authorLabel: null, body: 'نقل‌قول ساختگی', kind: 'TYPED' },
      { sessionToken: SESSION_TOKEN },
    );
  });
});

describe('manager authority handlers', () => {
  it('passes explicit publication and review booleans through separate API calls', async () => {
    await publishArticle(
      request('/api/content/articles/publication', { id: ARTICLE_ID, isPublic: 'true' }),
    );
    await approveTestimonial(
      request('/api/content/testimonials/approval', { id: TESTIMONIAL_ID, approved: 'true' }),
    );
    await publishTestimonial(
      request('/api/content/testimonials/publication', {
        id: TESTIMONIAL_ID,
        isPublic: 'true',
      }),
    );

    expect(mocks.updateArticlePublication).toHaveBeenCalledWith(
      ARTICLE_ID,
      { isPublic: true },
      { sessionToken: SESSION_TOKEN },
    );
    expect(mocks.updateTestimonialApproval).toHaveBeenCalledWith(
      TESTIMONIAL_ID,
      { approved: true },
      { sessionToken: SESSION_TOKEN },
    );
    expect(mocks.updateTestimonialPublication).toHaveBeenCalledWith(
      TESTIMONIAL_ID,
      { isPublic: true },
      { sessionToken: SESSION_TOKEN },
    );
  });

  it('preserves the backend receptionist refusal', async () => {
    mocks.updateArticlePublication.mockResolvedValueOnce({ ok: false, code: 'AUTH_FORBIDDEN' });
    mocks.updateTestimonialApproval.mockResolvedValueOnce({ ok: false, code: 'AUTH_FORBIDDEN' });

    const article = await publishArticle(
      request('/api/content/articles/publication', { id: ARTICLE_ID, isPublic: 'true' }),
    );
    const testimonial = await approveTestimonial(
      request('/api/content/testimonials/approval', { id: TESTIMONIAL_ID, approved: 'true' }),
    );

    expect(article.headers.get('location')).toBe(`${ORIGIN}/content?error=AUTH_FORBIDDEN`);
    expect(testimonial.headers.get('location')).toBe(`${ORIGIN}/content?error=AUTH_FORBIDDEN`);
  });

  it('rejects bad origin and malformed authority values before calling the API', async () => {
    const badOrigin = await publishArticle(
      request(
        '/api/content/articles/publication',
        { id: ARTICLE_ID, isPublic: 'true' },
        'https://evil.example',
      ),
    );
    const malformed = await approveTestimonial(
      request('/api/content/testimonials/approval', {
        id: TESTIMONIAL_ID,
        approved: 'yes',
      }),
    );

    expect(badOrigin.status).toBe(403);
    expect(malformed.headers.get('location')).toContain('error=VALIDATION_FAILED');
    expect(mocks.updateArticlePublication).not.toHaveBeenCalled();
    expect(mocks.updateTestimonialApproval).not.toHaveBeenCalled();
  });
});
