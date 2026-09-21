import 'server-only';
import type {
  Article,
  MediaAsset,
  MediaAttachmentOwner,
  PublicArticleDetail,
  PublicImage,
  PublicServiceDetail,
  PublicSpace,
  PublicTestimonial,
  PublicTherapistProfile,
  Service,
  ServicePublicCopy,
  Space,
  Testimonial,
  TherapistProfileCopy,
  TherapistPublicProfile,
} from '@clinic/contracts';

/**
 * Draft images use the authenticated same-origin rendition route. No preview
 * projection can accidentally address `/public/*` or the anonymous media URL.
 */
export function previewImagesForOwner(
  media: readonly MediaAsset[],
  ownerType: MediaAttachmentOwner,
  ownerId: string,
): PublicImage[] {
  return media
    .filter((asset) => asset.status === 'ACTIVE')
    .flatMap((asset) =>
      asset.attachments
        .filter(
          (attachment) => attachment.ownerType === ownerType && attachment.ownerId === ownerId,
        )
        .map((attachment) => ({ asset, attachment })),
    )
    .sort(
      (left, right) =>
        left.attachment.position - right.attachment.position ||
        left.attachment.id.localeCompare(right.attachment.id),
    )
    .map(({ asset, attachment }) => ({
      mediaId: asset.id,
      alt: asset.altText,
      width: asset.width,
      height: asset.height,
      framing: attachment.framing,
      renditions: asset.renditions.map((rendition) => ({
        path: `api/media/renditions/${rendition.id}/preview`,
        format: rendition.format,
        width: rendition.width,
        height: rendition.height,
        byteSize: rendition.byteSize,
      })),
    }))
    .filter((image) => image.renditions.length > 0);
}

export function serviceDraftPreview(
  copy: ServicePublicCopy,
  service: Service,
  media: readonly MediaAsset[],
): PublicServiceDetail {
  return {
    slug: copy.publicSlug ?? 'draft-preview',
    name: copy.name,
    description: copy.description,
    image: previewImagesForOwner(media, 'PUBLIC_SERVICE', copy.serviceId)[0] ?? null,
    sessionDurationsMinutes: service.allowedDurationsMinutes,
  };
}

export function therapistDraftPreview(
  copy: TherapistProfileCopy,
  profile: TherapistPublicProfile,
  media: readonly MediaAsset[],
): PublicTherapistProfile {
  return {
    slug: profile.publicSlug ?? 'draft-preview',
    displayName: copy.displayName ?? 'نام عمومی هنوز آماده نشده است',
    title: copy.title,
    bio: copy.bio,
    photoPath: profile.photoPath,
    photo: previewImagesForOwner(media, 'THERAPIST_PROFILE', copy.therapistId)[0] ?? null,
  };
}

export function articleDraftPreview(
  article: Article,
  media: readonly MediaAsset[],
): PublicArticleDetail {
  return {
    slug: article.publicSlug,
    title: article.title,
    summary: article.summary,
    body: article.body,
    publishedAt: article.firstPublishedAt ?? article.createdAt,
    images: previewImagesForOwner(media, 'PUBLIC_ARTICLE', article.id),
  };
}

export function testimonialDraftPreview(
  testimonial: Testimonial,
  media: readonly MediaAsset[],
): PublicTestimonial {
  return {
    authorLabel: testimonial.authorLabel,
    body: testimonial.body,
    kind: testimonial.kind,
    image: previewImagesForOwner(media, 'PUBLIC_TESTIMONIAL', testimonial.id)[0] ?? null,
  };
}

export function spaceDraftPreview(space: Space, media: readonly MediaAsset[]): PublicSpace {
  return {
    name: space.name,
    description: space.description,
    images: previewImagesForOwner(media, 'PUBLIC_SPACE', space.id),
  };
}
