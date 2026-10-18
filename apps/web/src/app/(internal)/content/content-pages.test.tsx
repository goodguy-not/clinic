import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Article, MediaAsset, Testimonial } from '@clinic/contracts';
import { ArticleImageEditor, imagesForArticle } from './article-image-editor';
import { ArticleForm } from './article-form';
import { EditorialWorkspace } from './editorial-workspace';
import { TestimonialForm } from './testimonial-form';
import { imagesForTestimonial, TestimonialImageEditor } from './testimonial-image-editor';
import { WITHDRAWAL_CONFIRMATION } from './consent-withdrawal-form';

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
  kind: 'TYPED',
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

const HANDWRITTEN_DRAFT: Testimonial = {
  ...TESTIMONIAL_DRAFT,
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d87',
  body: 'رونویسی انسانیِ ساختگی از یک یادداشت آزمایشی.',
  kind: 'HANDWRITTEN',
};

const ARTICLE_MEDIA: MediaAsset = {
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d84',
  altText: 'کودک در حال تمرین با توپ ساختگی',
  status: 'ACTIVE',
  width: 1600,
  height: 1000,
  byteSize: 140000,
  sourceContentType: 'image/jpeg',
  sourceByteSize: 220000,
  isPubliclyServed: false,
  renditions: [
    {
      id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d85',
      path: 'media/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d85',
      format: 'webp',
      width: 1200,
      height: 750,
      byteSize: 90000,
      contentHash: 'synthetic-article-image-hash',
    },
  ],
  attachments: [
    {
      id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d86',
      ownerType: 'PUBLIC_ARTICLE',
      ownerId: ARTICLE.id,
      position: 0,
      attachedAt: '2026-08-04T08:00:00.000Z',
      publishedAt: null,
      ownerIsPublic: ARTICLE.isPublic,
      framing: {
        focalX: 0.7,
        focalY: 0.4,
        crop: { x: 0.2, y: 0, width: 0.7, height: 1 },
      },
    },
  ],
  createdAt: '2026-08-04T08:00:00.000Z',
  archivedAt: null,
  bytesPurgedAt: null,
};

const TESTIMONIAL_MEDIA: MediaAsset = {
  ...ARTICLE_MEDIA,
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d88',
  altText: 'یادداشت دست‌نویس ساختگی روی کاغذ سفید',
  renditions: [
    {
      ...ARTICLE_MEDIA.renditions[0]!,
      id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d89',
      path: 'media/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d89',
    },
  ],
  attachments: [
    {
      ...ARTICLE_MEDIA.attachments[0]!,
      id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d90',
      ownerType: 'PUBLIC_TESTIMONIAL',
      ownerId: HANDWRITTEN_DRAFT.id,
      framing: { focalX: 0.5, focalY: 0.5, crop: { x: 0, y: 0, width: 1, height: 0.8 } },
    },
  ],
};

function workspace(authority: 'receptionist' | 'manager'): string {
  const manager = authority === 'manager';
  return renderToStaticMarkup(
    createElement(EditorialWorkspace, {
      articles: [ARTICLE],
      testimonials: [TESTIMONIAL_DRAFT, TESTIMONIAL_APPROVED],
      withdrawals: manager
        ? [
            {
              id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d99',
              consentWithdrawnAt: '2026-09-01T08:00:00.000Z',
              contentErasedAt: null,
              erasureDueBy: '2026-09-08T08:00:00.000Z',
            },
            {
              id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d98',
              consentWithdrawnAt: '2026-08-01T08:00:00.000Z',
              contentErasedAt: '2026-08-02T08:00:00.000Z',
              erasureDueBy: '2026-08-08T08:00:00.000Z',
            },
          ]
        : [],
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
    expect(markup).not.toContain('/api/content/testimonials/consent-withdrawal');
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
    expect(markup).toContain('action="/api/content/testimonials/consent-withdrawal"');
    expect(markup).toContain(WITHDRAWAL_CONFIRMATION);
    expect(WITHDRAWAL_CONFIRMATION).toContain('همین حالا از سایت برداشته می‌شود');
    expect(WITHDRAWAL_CONFIRMATION).toContain('معمولاً همان شب و در هر صورت حداکثر تا ۷ روز');
    expect(WITHDRAWAL_CONFIRMATION).toContain('این کار برگشت‌پذیر نیست');
    expect(WITHDRAWAL_CONFIRMATION).not.toContain('امشب');
    expect(markup).toContain('required="" name="confirmed" value="yes"');
    expect(markup).toContain('برداشتن از سایت');
    expect(markup).not.toContain('href="/api/content/');
    expect(markup).toContain('سوابق پس‌گرفتن رضایت');
    expect(markup).toContain('در انتظار پاک‌سازی؛ حداکثر تا');
    expect(markup).toContain('معمولاً همان شب و در هر صورت حداکثر تا ۷');
    expect(markup).toContain('پاک‌شده در');
  });

  it('carries one CSRF token in every authority form', () => {
    const authorityForms =
      markup.match(
        /action="\/api\/content\/(?:articles\/publication|testimonials\/(?:approval|publication|consent-withdrawal))"/g,
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
    expect(article).not.toContain('name="publicSlug"');
    expect(article).not.toContain('name="isPublic"');
    expect(testimonial).toContain('action="/api/content/testimonials/create"');
    expect(testimonial).toContain('name="kind"');
    expect(testimonial).toContain('value="HANDWRITTEN"');
    expect(testimonial).toContain('رونویسی / متن نقل‌قول');
    expect(testimonial).not.toContain('name="approved"');
    expect(testimonial).not.toContain('name="isPublic"');
  });
});

describe('handwritten testimonial editor', () => {
  function editor(authority: 'receptionist' | 'manager'): string {
    return renderToStaticMarkup(
      createElement(TestimonialImageEditor, {
        testimonial: HANDWRITTEN_DRAFT,
        images: imagesForTestimonial([TESTIMONIAL_MEDIA], HANDWRITTEN_DRAFT.id),
        csrfToken: CSRF,
        canApprove: authority === 'manager',
        canPublishMedia: authority === 'manager',
      }),
    );
  }

  it('shows Receptionist the persisted private preview and no manager act', () => {
    const markup = editor('receptionist');

    expect(markup).toContain(
      `/api/media/renditions/${TESTIMONIAL_MEDIA.renditions[0]!.id}/preview`,
    );
    expect(markup).not.toContain(`/${TESTIMONIAL_MEDIA.renditions[0]!.path}`);
    expect(markup).toContain(TESTIMONIAL_MEDIA.altText);
    expect(markup).toContain('آماده؛ در انتظار انتشار مدیر');
    expect(markup).not.toContain('/api/media/publication');
    expect(markup).not.toContain('/api/content/testimonials/approval');
    expect(markup).not.toContain('/api/content/testimonials/publication');
  });

  it('lets Manager compare transcription and image, then use each separate gate', () => {
    const markup = editor('manager');

    expect(markup).toContain(HANDWRITTEN_DRAFT.body);
    expect(markup).toContain('تصویر بالا را با رونویسی زیر مقایسه کنید');
    expect(markup).toContain('action="/api/media/publication"');
    expect(markup).toContain(`name="testimonialId" value="${HANDWRITTEN_DRAFT.id}"`);
    expect(markup).toContain('action="/api/content/testimonials/approval"');
    expect(markup).not.toContain('action="/api/content/testimonials/publication"');
  });

  it('offers Manager testimonial placement only after privacy approval', () => {
    const approved = renderToStaticMarkup(
      createElement(TestimonialImageEditor, {
        testimonial: {
          ...HANDWRITTEN_DRAFT,
          status: 'APPROVED',
          approvedAt: '2026-09-20T08:00:00.000Z',
        },
        images: imagesForTestimonial([TESTIMONIAL_MEDIA], HANDWRITTEN_DRAFT.id),
        csrfToken: CSRF,
        canApprove: true,
        canPublishMedia: true,
      }),
    );

    expect(approved).toContain('برداشتن تأیید حریم خصوصی');
    expect(approved).toContain('action="/api/content/testimonials/publication"');
    expect(approved).toContain('قرار دادن نقل‌قول روی سایت');
  });

  it('renders upload and framing only for an unprepared handwritten draft', () => {
    const markup = renderToStaticMarkup(
      createElement(TestimonialImageEditor, {
        testimonial: HANDWRITTEN_DRAFT,
        images: [],
        csrfToken: CSRF,
        canApprove: false,
        canPublishMedia: false,
      }),
    );

    expect(markup).toContain('انتخاب از گوشی یا رایانه');
    expect(markup).toContain('در این عکس چه چیزی دیده می‌شود؟');
    expect(markup).toContain('قاب عمودی');
  });
});

describe('article image editor', () => {
  function images(authority: 'receptionist' | 'manager'): string {
    return renderToStaticMarkup(
      createElement(ArticleImageEditor, {
        article: ARTICLE,
        images: imagesForArticle([ARTICLE_MEDIA], ARTICLE.id),
        csrfToken: CSRF,
        canPublishMedia: authority === 'manager',
        canPublishArticle: authority === 'manager',
      }),
    );
  }

  it('shows persisted framing through the authenticated preview and no public fallback', () => {
    const markup = images('receptionist');

    expect(markup).toContain(`/api/media/renditions/${ARTICLE_MEDIA.renditions[0]!.id}/preview`);
    expect(markup).not.toContain(`/${ARTICLE_MEDIA.renditions[0]!.path}`);
    expect(markup).toContain('left:-28.571428571428573%');
    expect(markup).toContain('آماده؛ در انتظار انتشار مدیر');
    expect(markup).toContain('این عکس هنوز عمومی نیست');
  });

  it('reuses upload/framing and withholds every publication control from Receptionist', () => {
    const markup = images('receptionist');

    expect(markup).toContain('انتخاب از گوشی یا رایانه');
    expect(markup).toContain('در این عکس چه چیزی دیده می‌شود؟');
    expect(markup).not.toContain('/api/media/publication');
    expect(markup).not.toContain('/api/content/articles/publication');
  });

  it('gives Manager only the separate image-publication control on this editor', () => {
    const markup = images('manager');

    expect(markup).toContain('action="/api/media/publication"');
    expect(markup).toContain(`name="articleId" value="${ARTICLE.id}"`);
    expect(markup).toContain('انتشار عکس پس از بررسی');
    expect(markup).not.toContain('/api/content/articles/publication');
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
    expect(source('./articles/[id]/edit/page.tsx')).toContain('api.listMedia(context)');
    expect(source('./testimonials/new/page.tsx')).toContain(
      "requirePermission: 'testimonial.draft'",
    );
    expect(source('./testimonials/[id]/edit/page.tsx')).toContain(
      "requirePermission: 'testimonial.draft'",
    );
    expect(source('./testimonials/[id]/edit/page.tsx')).toContain('api.listMedia(context)');
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
