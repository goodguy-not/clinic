import { type NextRequest, type NextResponse } from 'next/server';
import { updateMediaAltTextRequestSchema } from '@clinic/contracts';
import { z } from 'zod';
import { api } from '@/server/api-client';
import {
  failureRedirect,
  guardFailureResponse,
  guardStateChanging,
  readBody,
  sessionTokenFrom,
} from '@/server/handler-support';
import { invalidateMediaPublication } from '@/server/public-cache-invalidation';
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

  const mediaId = z.uuid().safeParse(body['mediaId']);
  const therapistId = z.uuid().safeParse(body['therapistId']);
  const spaceId = z.uuid().safeParse(body['spaceId']);
  const serviceId = z.uuid().safeParse(body['serviceId']);
  const articleId = z.uuid().safeParse(body['articleId']);
  const testimonialId = z.uuid().safeParse(body['testimonialId']);
  const clinicProfile = body['clinicProfile'] === 'true';
  const mediaLibrary = body['mediaLibrary'] === 'true';
  const path: `/${string}` = mediaLibrary
    ? '/media'
    : clinicProfile
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
  const parsed = updateMediaAltTextRequestSchema.safeParse({ altText: body['altText'] });
  const hasReturnTarget =
    mediaLibrary ||
    clinicProfile ||
    therapistId.success ||
    serviceId.success ||
    spaceId.success ||
    articleId.success ||
    testimonialId.success;

  if (!mediaId.success || !hasReturnTarget || !parsed.success)
    return failureRedirect(request, path, 'MEDIA_ALT_TEXT_INVALID');

  const result = await api.updateMediaAltText(mediaId.data, parsed.data, {
    sessionToken: token,
  });
  if (!result.ok) {
    return failureRedirect(
      request,
      path,
      result.code === 'AUTH_FORBIDDEN' ? 'MEDIA_ALT_TEXT_MANAGER_REQUIRED' : result.code,
    );
  }

  for (const publication of result.data.publications) invalidateMediaPublication(publication);
  return secureRedirect(request, `${path}?success=photo-description-corrected`);
}
