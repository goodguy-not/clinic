import { NextResponse, type NextRequest } from 'next/server';
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

  const exceptionId = z.uuid().safeParse(body['exceptionId']);
  if (!exceptionId.success) return failureRedirect(request, pagePath, 'VALIDATION_FAILED');

  const result = await api.removeAvailabilityException(therapistId, exceptionId.data, {
    sessionToken,
  });
  if (!result.ok) return failureRedirect(request, pagePath, result.code);

  return secureRedirect(request, `${pagePath}?success=exception-removed`);
}
