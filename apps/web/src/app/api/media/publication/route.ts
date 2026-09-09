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
  const parsed = updateMediaPublicationRequestSchema.safeParse({
    isPublished: body['isPublished'] === 'true',
  });
  const path: `/${string}` = `/content/therapists/${encodeURIComponent(body['therapistId'] ?? '')}`;
  if (!attachmentId.success || !therapistId.success || !parsed.success)
    return failureRedirect(request, path, 'VALIDATION_FAILED');
  const result = await api.updateMediaPublication(attachmentId.data, parsed.data, {
    sessionToken: token,
  });
  if (!result.ok) return failureRedirect(request, path, result.code);
  return secureRedirect(
    request,
    `${path}?success=${parsed.data.isPublished ? 'photo-published' : 'photo-withdrawn'}`,
  );
}
