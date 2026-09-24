import { beforeEach, describe, expect, it, vi } from 'vitest';

const revalidateTag = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ revalidateTag }));

import {
  invalidateArticlePublication,
  invalidateClinicPublication,
  invalidateMediaPublication,
  invalidateServicePublication,
  invalidateSpacesPublication,
  invalidateTestimonialsPublication,
  invalidateTherapistPublication,
} from './public-cache-invalidation';

beforeEach(() => revalidateTag.mockReset());

describe('public cache invalidation', () => {
  it('invalidates an article collection, exact detail and sitemap immediately', () => {
    invalidateArticlePublication('synthetic-guide');

    expect(revalidateTag.mock.calls).toEqual([
      ['public-articles', { expire: 0 }],
      ['public-article:synthetic-guide', { expire: 0 }],
      ['public-sitemap', { expire: 0 }],
    ]);
  });

  it('does not churn the sitemap for a testimonial publication', () => {
    invalidateTestimonialsPublication();

    expect(revalidateTag).toHaveBeenCalledOnce();
    expect(revalidateTag).toHaveBeenCalledWith('public-testimonials', { expire: 0 });
  });

  it.each([
    [
      'service',
      () => invalidateServicePublication('synthetic-service'),
      ['public-services', 'public-service:synthetic-service', 'public-sitemap'],
    ],
    [
      'therapist',
      () => invalidateTherapistPublication('synthetic-therapist'),
      ['public-team', 'public-therapist:synthetic-therapist', 'public-sitemap'],
    ],
    ['spaces', invalidateSpacesPublication, ['public-spaces']],
    ['clinic profile/content', invalidateClinicPublication, ['public-clinic-profile']],
  ])('invalidates the exact %s tags', (_label, act, expectedTags) => {
    act();

    expect(revalidateTag.mock.calls.map(([tag]) => tag)).toEqual(expectedTags);
  });

  it('omits an unavailable detail tag but still refreshes the collection and sitemap', () => {
    invalidateServicePublication(null);

    expect(revalidateTag.mock.calls.map(([tag]) => tag)).toEqual([
      'public-services',
      'public-sitemap',
    ]);
  });

  it('uses the returned media owner and rendition identities, not form context', () => {
    invalidateMediaPublication({
      attachmentId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d93',
      ownerType: 'PUBLIC_SERVICE',
      ownerId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d94',
      publicSlug: 'synthetic-service',
      ownerIsPublic: true,
      renditionIds: ['0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d92'],
    });

    expect(revalidateTag.mock.calls).toEqual([
      ['public-media:0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d92', { expire: 0 }],
      ['public-services', { expire: 0 }],
      ['public-service:synthetic-service', { expire: 0 }],
      ['public-sitemap', { expire: 0 }],
    ]);
  });

  it.each([
    ['PUBLIC_TESTIMONIAL', 'public-testimonials'],
    ['PUBLIC_SPACE', 'public-spaces'],
    ['CLINIC_CONTENT_ENTRY', 'public-clinic-profile'],
    ['CLINIC_OPEN_GRAPH', 'public-clinic-profile'],
  ] as const)('invalidates the exact %s owner tag for media', (ownerType, ownerTag) => {
    invalidateMediaPublication({
      attachmentId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d93',
      ownerType,
      ownerId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d94',
      publicSlug: null,
      ownerIsPublic: true,
      renditionIds: ['0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d92'],
    });

    expect(revalidateTag.mock.calls.map(([tag]) => tag)).toEqual([
      'public-media:0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d92',
      ownerTag,
    ]);
  });

  it('does not churn owner or sitemap tags when media belongs to a draft owner', () => {
    invalidateMediaPublication({
      attachmentId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d93',
      ownerType: 'PUBLIC_ARTICLE',
      ownerId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d94',
      publicSlug: 'synthetic-draft',
      ownerIsPublic: false,
      renditionIds: ['0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d92'],
    });

    expect(revalidateTag.mock.calls.map(([tag]) => tag)).toEqual([
      'public-media:0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d92',
    ]);
  });

  it('treats the ownerless clinic-space slot as preview-only', () => {
    invalidateMediaPublication({
      attachmentId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d93',
      ownerType: 'CLINIC_SPACE',
      ownerId: null,
      publicSlug: null,
      ownerIsPublic: false,
      renditionIds: ['0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d92'],
    });

    expect(revalidateTag.mock.calls.map(([tag]) => tag)).toEqual([
      'public-media:0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d92',
    ]);
  });
});
