import { type NextRequest, type NextResponse } from 'next/server';
import { updateTestimonialApprovalRequestSchema } from '@clinic/contracts';
import { z } from 'zod';
import { api } from '@/server/api-client';
import { explicitBoolean } from '@/server/content-forms';
import { revalidateTestimonials } from '@/server/content-revalidation';
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

  const id = z.uuid().safeParse(body['id']);
  const parsed = updateTestimonialApprovalRequestSchema.safeParse({
    approved: explicitBoolean(body['approved']),
  });
  if (!id.success || !parsed.success)
    return failureRedirect(request, '/content', 'VALIDATION_FAILED');

  const result = await api.updateTestimonialApproval(id.data, parsed.data, { sessionToken });
  if (!result.ok) return failureRedirect(request, '/content', result.code);

  revalidateTestimonials();
  return secureRedirect(
    request,
    parsed.data.approved
      ? '/content?success=testimonial-approved'
      : '/content?success=testimonial-approval-revoked',
  );
}
