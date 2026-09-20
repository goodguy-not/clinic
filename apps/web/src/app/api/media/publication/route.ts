import { type NextRequest, type NextResponse } from 'next/server';
import { updateMediaPublicationRequestSchema } from '@clinic/contracts';
import { z } from 'zod';
import { api } from '@/server/api-client';
import {
  failureRedirect,
  guardFailureResponse,
  guardStateChanging,
  readBody,
  sessionTokenFrom,
} from '@/server/handler-support';
import { secureRedirect } from '@/server/security-headers';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await readBody(request);
  const token = sessionTokenFrom(request);
  if (token === null) return secureRedirect(request, '/session-expired');
  try {
    guardStateChanging(request, body, { sessionToken: token });
  } catch (error) {
    const refusal = guardFailureResponse(error);
    if (refusal !== null) return refusal;
    throw error;
  }
  const attachmentId = z.uuid().safeParse(body['attachmentId']);
  const therapistId = z.uuid().safeParse(body['therapistId']);
  const spaceId = z.uuid().safeParse(body['spaceId']);
  const serviceId = z.uuid().safeParse(body['serviceId']);
  const articleId = z.uuid().safeParse(body['articleId']);
  const testimonialId = z.uuid().safeParse(body['testimonialId']);
  const clinicProfile = body['clinicProfile'] === 'true';
  const publicationValue =
    body['isPublished'] === 'true'
      ? true
      : body['isPublished'] === 'false'
        ? false
        : body['isPublished'];
  const parsed = updateMediaPublicationRequestSchema.safeParse({
    isPublished: publicationValue,
  });
  const path: `/${string}` = clinicProfile
    ? '/content/clinic-profile'
    : serviceId.success
      ? `/content/services/${encodeURIComponent(serviceId.data)}`
      : spaceId.success
        ? `/content/spaces/${encodeURIComponent(spaceId.data)}/edit`
        : articleId.success
          ? `/content/articles/${encodeURIComponent(articleId.data)}/edit`
          : testimonialId.success
            ? `/content/testimonials/${encodeURIComponent(testimonialId.data)}/edit`
            : therapistId.success
              ? `/content/therapists/${encodeURIComponent(therapistId.data)}`
              : '/content';
  if (
    !attachmentId.success ||
    (!clinicProfile &&
      !therapistId.success &&
      !serviceId.success &&
      !spaceId.success &&
      !articleId.success &&
      !testimonialId.success) ||
    !parsed.success
  )
    return failureRedirect(request, path, 'VALIDATION_FAILED');
  const result = await api.updateMediaPublication(attachmentId.data, parsed.data, {
    sessionToken: token,
  });
  if (!result.ok) return failureRedirect(request, path, result.code);
  const success = clinicProfile
    ? parsed.data.isPublished
      ? 'image-published'
      : 'image-withdrawn'
    : serviceId.success
      ? parsed.data.isPublished
        ? 'service-image-published'
        : 'service-image-withdrawn'
      : spaceId.success
        ? parsed.data.isPublished
          ? 'space-photo-published'
          : 'space-photo-withdrawn'
        : articleId.success
          ? parsed.data.isPublished
            ? 'article-image-published'
            : 'article-image-withdrawn'
          : testimonialId.success
            ? parsed.data.isPublished
              ? 'testimonial-image-published'
              : 'testimonial-image-withdrawn'
            : parsed.data.isPublished
              ? 'photo-published'
              : 'photo-withdrawn';
  return secureRedirect(request, `${path}?success=${success}`);
}
