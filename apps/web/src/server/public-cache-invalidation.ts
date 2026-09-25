import 'server-only';
import { revalidatePath, revalidateTag } from 'next/cache';
import {
  PUBLIC_ARTICLE_CACHE_TAG_PREFIX,
  PUBLIC_CACHE_TAGS,
  PUBLIC_MEDIA_CACHE_TAG_PREFIX,
  PUBLIC_SERVICE_CACHE_TAG_PREFIX,
  PUBLIC_THERAPIST_CACHE_TAG_PREFIX,
  type MediaPublicationIdentity,
} from '@clinic/contracts';

const IMMEDIATE_EXPIRY = { expire: 0 } as const;

function invalidate(tags: readonly string[]): void {
  for (const tag of new Set(tags)) revalidateTag(tag, IMMEDIATE_EXPIRY);
}

export function servicePublicationTags(publicSlug: string | null): string[] {
  return [
    PUBLIC_CACHE_TAGS.services,
    ...(publicSlug === null ? [] : [`${PUBLIC_SERVICE_CACHE_TAG_PREFIX}${publicSlug}`]),
    PUBLIC_CACHE_TAGS.sitemap,
  ];
}

export function therapistPublicationTags(publicSlug: string | null): string[] {
  return [
    PUBLIC_CACHE_TAGS.team,
    ...(publicSlug === null ? [] : [`${PUBLIC_THERAPIST_CACHE_TAG_PREFIX}${publicSlug}`]),
    PUBLIC_CACHE_TAGS.sitemap,
  ];
}

export function articlePublicationTags(publicSlug: string): string[] {
  return [
    PUBLIC_CACHE_TAGS.articles,
    `${PUBLIC_ARTICLE_CACHE_TAG_PREFIX}${publicSlug}`,
    PUBLIC_CACHE_TAGS.sitemap,
  ];
}

export function invalidateServicePublication(publicSlug: string | null): void {
  invalidate(servicePublicationTags(publicSlug));
}

export function invalidateTherapistPublication(publicSlug: string | null): void {
  invalidate(therapistPublicationTags(publicSlug));
}

export function invalidateArticlePublication(publicSlug: string): void {
  invalidate(articlePublicationTags(publicSlug));
}

export function invalidateTestimonialsPublication(): void {
  invalidate([PUBLIC_CACHE_TAGS.testimonials]);
}

export function invalidateSpacesPublication(): void {
  invalidate([PUBLIC_CACHE_TAGS.spaces]);
}

export function invalidateClinicPublication(): void {
  invalidate([PUBLIC_CACHE_TAGS.clinicProfile]);
}

/** Archive/restore is asset-wide, so every possible public owner is expired. */
export function invalidateMediaArchive(): void {
  invalidate(Object.values(PUBLIC_CACHE_TAGS));
  revalidatePath('/', 'layout');
}

/**
 * Invalidates one media publication decision from the canonical attachment
 * returned by NestJS. Browser-supplied owner ids are deliberately irrelevant.
 */
export function invalidateMediaPublication(publication: MediaPublicationIdentity): void {
  const renditionTags = publication.renditionIds.map(
    (renditionId) => `${PUBLIC_MEDIA_CACHE_TAG_PREFIX}${renditionId}`,
  );

  // A publication decision on media prepared for a draft owner changes no
  // public projection yet. The rendition tags are still exact and cheap; the
  // owner collection/detail and sitemap wait until the owner gate is live.
  if (!publication.ownerIsPublic) {
    invalidate(renditionTags);
    return;
  }

  switch (publication.ownerType) {
    case 'PUBLIC_SERVICE':
      invalidate([...renditionTags, ...servicePublicationTags(publication.publicSlug)]);
      return;
    case 'THERAPIST_PROFILE':
      invalidate([...renditionTags, ...therapistPublicationTags(publication.publicSlug)]);
      return;
    case 'PUBLIC_ARTICLE':
      invalidate([
        ...renditionTags,
        PUBLIC_CACHE_TAGS.articles,
        ...(publication.publicSlug === null
          ? []
          : [`${PUBLIC_ARTICLE_CACHE_TAG_PREFIX}${publication.publicSlug}`]),
        PUBLIC_CACHE_TAGS.sitemap,
      ]);
      return;
    case 'PUBLIC_TESTIMONIAL':
      invalidate([...renditionTags, PUBLIC_CACHE_TAGS.testimonials]);
      return;
    case 'PUBLIC_SPACE':
      invalidate([...renditionTags, PUBLIC_CACHE_TAGS.spaces]);
      return;
    case 'CLINIC_CONTENT_ENTRY':
    case 'CLINIC_OPEN_GRAPH':
      invalidate([...renditionTags, PUBLIC_CACHE_TAGS.clinicProfile]);
      return;
  }
}
