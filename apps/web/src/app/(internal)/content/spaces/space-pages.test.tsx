import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MediaAsset, Space } from '@clinic/contracts';
import { SpaceForm } from './space-form';
import { SpacePhotoEditor, photosForSpace } from './space-photo-editor';
import { SpaceWorkspace } from './space-workspace';

const CSRF = 'synthetic-space-csrf';
const SPACE_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d71';
const SPACE: Space = {
  id: SPACE_ID,
  name: 'فضای ساختگی روشن',
  description: 'توضیح ساختگی برای آزمون رابط.',
  displayOrder: 2,
  isPublic: true,
  hasUnpublishedChanges: true,
  firstPublishedAt: '2026-09-01T08:00:00.000Z',
  publicRevisedAt: '2026-09-01T08:00:00.000Z',
  createdAt: '2026-08-30T08:00:00.000Z',
};

const MEDIA: MediaAsset = {
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d72',
  altText: 'نمای ساختگی فضای روشن',
  status: 'ACTIVE',
  width: 1200,
  height: 800,
  byteSize: 120000,
  sourceContentType: 'image/jpeg',
  sourceByteSize: 180000,
  isPubliclyServed: false,
  renditions: [],
  attachments: [
    {
      id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d73',
      ownerType: 'PUBLIC_SPACE',
      ownerId: SPACE_ID,
      position: 0,
      attachedAt: '2026-09-02T08:00:00.000Z',
      publishedAt: null,
      ownerIsPublic: true,
      framing: {
        focalX: 0.5,
        focalY: 0.5,
        crop: { x: 0, y: 0.125, width: 1, height: 0.75 },
      },
    },
  ],
  createdAt: '2026-09-02T08:00:00.000Z',
  archivedAt: null,
  bytesPurgedAt: null,
};

function workspace(authority: 'receptionist' | 'manager'): string {
  return renderToStaticMarkup(
    createElement(SpaceWorkspace, {
      spaces: [SPACE],
      csrfToken: CSRF,
      errorMessage: null,
      successMessage: null,
      canDraft: true,
      canPublish: authority === 'manager',
    }),
  );
}

function photos(authority: 'receptionist' | 'manager'): string {
  return renderToStaticMarkup(
    createElement(SpacePhotoEditor, {
      space: SPACE,
      photos: photosForSpace([MEDIA], SPACE_ID),
      csrfToken: CSRF,
      canPublishMedia: authority === 'manager',
      canPublishSpace: authority === 'manager',
    }),
  );
}

describe('receptionist public-space workspace', () => {
  it('makes draft/live state clear and keeps the draft and photograph actions', () => {
    const markup = workspace('receptionist');
    const photoMarkup = photos('receptionist');

    expect(markup).toContain('تغییرات منتشرنشده');
    expect(markup).toContain('خانواده‌ها هنوز نسخهٔ پیشین را می‌بینند');
    expect(markup).toContain('/content/spaces/new');
    expect(markup).toContain(`/content/spaces/${SPACE_ID}/edit`);
    expect(photoMarkup).toContain('انتخاب از گوشی یا رایانه');
    expect(photoMarkup).toContain('قاب پهن، شکل اصلی نمایش');
    expect(photoMarkup).toContain('آماده؛ هنوز منتشر نشده');
  });

  it('contains no space or photograph publication control', () => {
    const markup = `${workspace('receptionist')}${photos('receptionist')}`;

    expect(markup).not.toContain('/api/content/spaces/publication');
    expect(markup).not.toContain('/api/media/publication');
    expect(markup).not.toContain('قرار دادن فضا روی سایت');
    expect(markup).not.toContain('تأیید عکس برای سایت');
  });
});

describe('manager public-space workspace', () => {
  it('offers separate photograph and space publication/withdrawal acts', () => {
    const markup = `${workspace('manager')}${photos('manager')}`;

    expect(markup).toContain('action="/api/media/publication"');
    expect(markup).toContain('تأیید عکس برای سایت');
    expect(markup).toContain('action="/api/content/spaces/publication"');
    expect(markup).toContain('انتشار تغییرات');
    expect(markup).toContain('برداشتن از سایت');
  });
});

describe('public-space draft form and route boundaries', () => {
  it('has only editorial draft fields and no publication or operational-room field', () => {
    const markup = renderToStaticMarkup(
      createElement(SpaceForm, {
        csrfToken: CSRF,
        errorMessage: null,
      }),
    );

    expect(markup).toContain('action="/api/content/spaces/create"');
    expect(markup).toContain('name="name"');
    expect(markup).toContain('name="description"');
    expect(markup).toContain('name="displayOrder"');
    expect(markup).not.toContain('name="isPublic"');
    expect(markup).not.toContain('name="roomId"');
    expect(markup).not.toContain('allowedService');
  });

  it('gates pages and navigation on the accepted public-space permissions', () => {
    const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
    const header = readFileSync(
      new URL('../../../../components/app-header.tsx', import.meta.url),
      'utf8',
    );

    expect(source('./page.tsx')).toContain("requirePermission: 'public_space.read'");
    expect(source('./new/page.tsx')).toContain("requirePermission: 'public_space.draft'");
    expect(source('./[id]/edit/page.tsx')).toContain("requirePermission: 'public_space.draft'");
    expect(header).toContain("user.permissions.includes('public_space.read')");
    expect(header).toContain("href: '/content/spaces'");
  });
});
