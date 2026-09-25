import { type NextRequest, type NextResponse } from 'next/server';
import { updateMediaArchiveRequestSchema } from '@clinic/contracts';
import { z } from 'zod';
import { api } from '@/server/api-client';
import {
  failureRedirect,
  guardFailureResponse,
  guardStateChanging,
  readBody,
  sessionTokenFrom,
} from '@/server/handler-support';
import { invalidateMediaArchive } from '@/server/public-cache-invalidation';
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
  const archivedValue =
    body['archived'] === 'true' ? true : body['archived'] === 'false' ? false : body['archived'];
  const parsed = updateMediaArchiveRequestSchema.safeParse({ archived: archivedValue });
  if (!mediaId.success || !parsed.success)
    return failureRedirect(request, '/media', 'VALIDATION_FAILED');

  const result = await api.updateMediaArchive(mediaId.data, parsed.data, { sessionToken: token });
  if (!result.ok) return failureRedirect(request, '/media', result.code);
  invalidateMediaArchive();
  return secureRedirect(
    request,
    `/media?success=${parsed.data.archived ? 'archived' : 'restored'}`,
  );
}
