import { type NextRequest, type NextResponse } from 'next/server';
import { createTestimonialRequestSchema } from '@clinic/contracts';
import { api } from '@/server/api-client';
import { testimonialFormToRequest } from '@/server/content-forms';
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
  const sessionToken = sessionTokenFrom(request);
  if (sessionToken === null) return secureRedirect(request, '/session-expired');

  try {
    guardStateChanging(request, body, { sessionToken });
  } catch (error) {
    const refusal = guardFailureResponse(error);
    if (refusal !== null) return refusal;
    throw error;
  }

  const parsed = createTestimonialRequestSchema.safeParse(testimonialFormToRequest(body));
  if (!parsed.success) {
    return failureRedirect(request, '/content/testimonials/new', 'VALIDATION_FAILED');
  }

  const result = await api.createTestimonial(parsed.data, { sessionToken });
  if (!result.ok) return failureRedirect(request, '/content/testimonials/new', result.code);

  return secureRedirect(request, '/content?success=testimonial-created');
}
