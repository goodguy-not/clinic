import { type NextRequest, type NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/server/api-client';
import {
  failureRedirect,
  guardFailureResponse,
  guardStateChanging,
  readBody,
  sessionTokenFrom,
} from '@/server/handler-support';
import { secureJson, secureRedirect } from '@/server/security-headers';
import {
  invalidateTestimonialsPublication,
  invalidateMediaArchive,
} from '@/server/public-cache-invalidation';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await readBody(request);
  const sessionToken = sessionTokenFrom(request);
  if (sessionToken === null) return secureRedirect(request, '/session-expired');

  try {
    guardStateChanging(request, body, { sessionToken });
  } catch (error) {
    const refusal = guardFailureResponse(error);
    if (refusal !== null) return refusal;
    throw error;
  }

  const id = z.uuid().safeParse(body['id']);
  if (!id.success || body['confirmed'] !== 'yes')
    return failureRedirect(request, '/content', 'VALIDATION_FAILED');

  const result = await api.withdrawTestimonialConsent(id.data, { sessionToken });
  if (!result.ok) {
    if (result.status === 403) {
      return secureJson({ error: { code: 'AUTH_FORBIDDEN' } }, 403);
    }
    return failureRedirect(request, '/content', result.code);
  }
  invalidateTestimonialsPublication();
  invalidateMediaArchive();
  return secureRedirect(request, '/content?success=testimonial-consent-withdrawn');
}
