import { notFound } from 'next/navigation';
import { DraftPublicPreview, type DraftPublicPreviewData } from '@/components/draft-public-preview';
import { api } from '@/server/api-client';
import { callerContext, readSessionToken, requireManagerSession } from '@/server/auth-session';
import {
  articleDraftPreview,
  serviceDraftPreview,
  spaceDraftPreview,
  testimonialDraftPreview,
  therapistDraftPreview,
} from '@/server/draft-preview';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ContentDraftPreviewPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>;
}) {
  await requireManagerSession();
  const { kind, id } = await params;
  const token = await readSessionToken();
  const context = await callerContext(token ?? undefined);
  const mediaResult = await api.listMedia(context);
  if (!mediaResult.ok) throw new Error(`Failed to load preview media: ${mediaResult.code}`);
  const media = mediaResult.data.media;
  let data: DraftPublicPreviewData;

  switch (kind) {
    case 'services': {
      const [copy, service] = await Promise.all([
        api.getServicePublicCopy(id, context),
        api.getService(id, context),
      ]);
      if (!copy.ok || !service.ok) notFound();
      data = { kind, service: serviceDraftPreview(copy.data.copy, service.data.service, media) };
      break;
    }
    case 'therapists': {
      const [copy, profile] = await Promise.all([
        api.getTherapistProfileCopy(id, context),
        api.getTherapistPublicProfile(id, context),
      ]);
      if (!copy.ok || !profile.ok) notFound();
      data = {
        kind,
        therapist: therapistDraftPreview(copy.data.copy, profile.data.profile, media),
      };
      break;
    }
    case 'articles': {
      const article = await api.getArticle(id, context);
      if (!article.ok) notFound();
      data = { kind, article: articleDraftPreview(article.data.article, media) };
      break;
    }
    case 'testimonials': {
      const testimonial = await api.getTestimonial(id, context);
      if (!testimonial.ok) notFound();
      data = {
        kind,
        testimonial: testimonialDraftPreview(testimonial.data.testimonial, media),
      };
      break;
    }
    case 'spaces': {
      const space = await api.getSpace(id, context);
      if (!space.ok) notFound();
      data = { kind, space: spaceDraftPreview(space.data.space, media) };
      break;
    }
    default:
      notFound();
  }

  return <DraftPublicPreview data={data} />;
}
