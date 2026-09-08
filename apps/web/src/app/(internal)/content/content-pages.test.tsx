import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Article, Testimonial } from '@clinic/contracts';
import { ArticleForm } from './article-form';
import { EditorialWorkspace } from './editorial-workspace';
import { TestimonialForm } from './testimonial-form';

const CSRF = 'synthetic-content-csrf';

const ARTICLE: Article = {
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d81',
  publicSlug: 'synthetic-guide',
  title: 'راهنمای آزمایشی',
  summary: 'خلاصهٔ کاملاً ساختگی',
  body: 'متن ساختگی برای آزمون رابط کاربری.',
  isPublic: true,
  hasUnpublishedChanges: true,
  firstPublishedAt: '2026-08-01T08:00:00.000Z',
  publicRevisedAt: '2026-08-01T08:00:00.000Z',
  createdAt: '2026-07-30T08:00:00.000Z',
};

const TESTIMONIAL_DRAFT: Testimonial = {
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d82',
  authorLabel: 'گویندهٔ آزمایشی',
  body: 'نقل‌قول ساختگی برای آزمون.',
  status: 'DRAFT',
  approvedAt: null,
  isPublic: false,
  firstPublishedAt: null,
  publicRevisedAt: null,
  createdAt: '2026-08-02T08:00:00.000Z',
};

const TESTIMONIAL_APPROVED: Testimonial = {
  ...TESTIMONIAL_DRAFT,
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d83',
  status: 'APPROVED',
  approvedAt: '2026-08-03T08:00:00.000Z',
  isPublic: true,
  firstPublishedAt: '2026-08-03T09:00:00.000Z',
  publicRevisedAt: '2026-08-03T09:00:00.000Z',
};

function workspace(authority: 'receptionist' | 'manager'): string {
  const manager = authority === 'manager';
  return renderToStaticMarkup(
    createElement(EditorialWorkspace, {
      articles: [ARTICLE],
      testimonials: [TESTIMONIAL_DRAFT, TESTIMONIAL_APPROVED],
      csrfToken: CSRF,
      errorMessage: null,
      successMessage: null,
      canDraftArticles: true,
      canPublishArticles: manager,
      canDraftTestimonials: true,
      canApproveTestimonials: manager,
    }),
  );
}

describe('receptionist editorial workspace', () => {
  const markup = workspace('receptionist');

  it('makes draft and live state explicit while preserving draft actions', () => {
    expect(markup).toContain('تغییرات منتشرنشده');
    expect(markup).toContain('سایت اکنون نسخهٔ پیشین را نشان می‌دهد');
    expect(markup).toContain('در انتظار بررسی مدیر');
    expect(markup).toContain('/content/articles/new');
    expect(markup).toContain('/content/testimonials/new');
    expect(markup).toContain('ویرایش پیش‌نویس');
  });

  it('contains no manager publication, approval, or privacy action', () => {
    expect(markup).not.toContain('/api/content/articles/publication');
    expect(markup).not.toContain('/api/content/testimonials/approval');
    expect(markup).not.toContain('/api/content/testimonials/publication');
    expect(markup).not.toContain('انتشار تغییرات');
    expect(markup).not.toContain('تأیید پس از بررسی');
    expect(markup).not.toContain('برداشتن تأیید');
  });

  it('does not offer an edit link for approved testimonial text', () => {
    expect(markup).not.toContain(`/content/testimonials/${TESTIMONIAL_APPROVED.id}/edit`);
    expect(markup).toContain(`/content/testimonials/${TESTIMONIAL_DRAFT.id}/edit`);
  });
});

describe('manager editorial workspace', () => {
  const markup = workspace('manager');

  it('offers each accepted manager act as a POST form', () => {
    expect(markup).toContain('action="/api/content/articles/publication"');
    expect(markup).toContain('انتشار تغییرات');
    expect(markup).toContain('action="/api/content/testimonials/approval"');
    expect(markup).toContain('تأیید پس از بررسی');
    expect(markup).toContain('برداشتن تأیید');
    expect(markup).toContain('action="/api/content/testimonials/publication"');
    expect(markup).toContain('برداشتن از سایت');
    expect(markup).not.toContain('href="/api/content/');
  });

  it('carries one CSRF token in every authority form', () => {
    const authorityForms =
      markup.match(
        /action="\/api\/content\/(?:articles\/publication|testimonials\/(?:approval|publication))"/g,
      )?.length ?? 0;
    const tokens = markup.match(new RegExp(`value="${CSRF}"`, 'g'))?.length ?? 0;
    expect(tokens).toBe(authorityForms);
  });
});

describe('draft forms', () => {
  it('contain no publication or approval controls', () => {
    const article = renderToStaticMarkup(
      createElement(ArticleForm, { csrfToken: CSRF, errorMessage: null }),
    );
    const testimonial = renderToStaticMarkup(
      createElement(TestimonialForm, { csrfToken: CSRF, errorMessage: null }),
    );

    expect(article).toContain('action="/api/content/articles/create"');
    expect(article).toContain('name="publicSlug"');
    expect(article).not.toContain('name="isPublic"');
    expect(testimonial).toContain('action="/api/content/testimonials/create"');
    expect(testimonial).not.toContain('name="approved"');
    expect(testimonial).not.toContain('name="isPublic"');
  });
});

describe('page and navigation boundaries', () => {
  const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');

  it('gates the workspace and draft forms on the accepted permissions', () => {
    expect(source('./page.tsx')).toContain(
      "requirePermission: ['article.read', 'testimonial.read']",
    );
    expect(source('./articles/new/page.tsx')).toContain("requirePermission: 'article.draft'");
    expect(source('./articles/[id]/edit/page.tsx')).toContain("requirePermission: 'article.draft'");
    expect(source('./testimonials/new/page.tsx')).toContain(
      "requirePermission: 'testimonial.draft'",
    );
    expect(source('./testimonials/[id]/edit/page.tsx')).toContain(
      "requirePermission: 'testimonial.draft'",
    );
  });

  it('shows navigation only when both content-read permissions are present', () => {
    const header = readFileSync(
      new URL('../../../components/app-header.tsx', import.meta.url),
      'utf8',
    );
    expect(header).toContain("user.permissions.includes('article.read')");
    expect(header).toContain("user.permissions.includes('testimonial.read')");
    expect(header).toContain("href: '/content'");
  });
});
