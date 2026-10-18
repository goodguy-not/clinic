import { NextResponse, type NextRequest } from 'next/server';
import { createAvailabilityExceptionRequestSchema } from '@clinic/contracts';
import { api } from '@/server/api-client';
import { availabilityExceptionFromBody, jalaliDateFromBody } from '@/server/availability-forms';
import {
  failureRedirect,
  guardFailureResponse,
  guardStateChanging,
  readBody,
  sessionTokenFrom,
} from '@/server/handler-support';
import { secureRedirect } from '@/server/security-headers';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ therapistId: string }> },
): Promise<NextResponse> {
  const body = await readBody(request);
  const sessionToken = sessionTokenFrom(request);
  const { therapistId } = await params;
  const pagePath = `/therapists/${encodeURIComponent(therapistId)}/availability` as const;

  if (sessionToken === null) return secureRedirect(request, '/session-expired');

  try {
    guardStateChanging(request, body, { sessionToken });
  } catch (error) {
    const refusal = guardFailureResponse(error);
    if (refusal !== null) return refusal;
    throw error;
  }

  const kind = body['kind'];
  if ((kind === 'closed' || kind === 'extra') && jalaliDateFromBody(body, kind) === null) {
    return failureRedirect(request, pagePath, 'AVAILABILITY_DATE_INVALID');
  }

  const parsed = createAvailabilityExceptionRequestSchema.safeParse(
    availabilityExceptionFromBody(body),
  );
  if (!parsed.success) return failureRedirect(request, pagePath, 'VALIDATION_FAILED');

  const result = await api.addAvailabilityException(therapistId, parsed.data, { sessionToken });
  if (!result.ok) return failureRedirect(request, pagePath, result.code);

  return secureRedirect(
    request,
    `${pagePath}?success=exception-added${parsed.data.isAvailable ? '' : `&closed=${parsed.data.exceptionDate}`}`,
  );
}
