import { describe, expect, it } from 'vitest';
import type { MediaAsset } from '@clinic/contracts';
import { articleDraftPreview, previewImagesForOwner } from './draft-preview';

const ARTICLE_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d91';
const RENDITION_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d92';

const media: MediaAsset[] = [
  {
    id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d93',
    altText: 'تصویر ساختگی پیش‌نمایش',
    status: 'ACTIVE',
    width: 1280,
    height: 800,
    byteSize: 100,
    sourceContentType: 'image/jpeg',
    sourceByteSize: 120,
    isPubliclyServed: false,
    renditions: [
      {
        id: RENDITION_ID,
        path: `media/${RENDITION_ID}`,
        format: 'jpeg',
        width: 640,
        height: 400,
        byteSize: 100,
        contentHash: 'synthetic',
      },
    ],
    attachments: [
      {
        id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d94',
        ownerType: 'PUBLIC_ARTICLE',
        ownerId: ARTICLE_ID,
        position: 0,
        attachedAt: '2026-09-01T00:00:00.000Z',
        publishedAt: null,
        ownerIsPublic: false,
        framing: { focalX: 0.5, focalY: 0.5, crop: null },
      },
    ],
    createdAt: '2026-09-01T00:00:00.000Z',
    archivedAt: null,
    bytesPurgedAt: null,
  },
];

describe('authenticated draft preview projection', () => {
  it('renders working copy and unpublished media through the authenticated preview route', () => {
    const preview = articleDraftPreview(
      {
        id: ARTICLE_ID,
        publicSlug: 'synthetic-article',
        title: 'عنوان آمادهٔ ساختگی',
        summary: 'خلاصهٔ آمادهٔ ساختگی',
        body: 'متن آمادهٔ ساختگی',
        isPublic: false,
        hasUnpublishedChanges: false,
        firstPublishedAt: null,
        publicRevisedAt: null,
        createdAt: '2026-09-01T00:00:00.000Z',
      },
      media,
    );

    expect(preview.title).toBe('عنوان آمادهٔ ساختگی');
    expect(preview.images[0]?.renditions[0]?.path).toBe(
      `api/media/renditions/${RENDITION_ID}/preview`,
    );
    expect(JSON.stringify(preview)).not.toContain('/public/');
  });

  it('does not require an attachment to be published before a Manager can preview it', () => {
    expect(previewImagesForOwner(media, 'PUBLIC_ARTICLE', ARTICLE_ID)).toHaveLength(1);
  });

  it('does not render archived media in a draft preview', () => {
    expect(
      previewImagesForOwner([{ ...media[0]!, status: 'ARCHIVED' }], 'PUBLIC_ARTICLE', ARTICLE_ID),
    ).toEqual([]);
  });
});
