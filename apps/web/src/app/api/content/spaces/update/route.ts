import { type NextRequest, type NextResponse } from 'next/server';
import { updateSpaceRequestSchema } from '@clinic/contracts';
import { z } from 'zod';
import { api } from '@/server/api-client';
import { spaceFormToRequest } from '@/server/content-forms';
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
  const parsed = updateSpaceRequestSchema.safeParse(spaceFormToRequest(body));
  const path: `/${string}` = id.success
    ? `/content/spaces/${encodeURIComponent(id.data)}/edit`
    : '/content/spaces';
  if (!id.success || !parsed.success) return failureRedirect(request, path, 'VALIDATION_FAILED');

  const result = await api.updateSpace(id.data, parsed.data, { sessionToken });
  if (!result.ok) return failureRedirect(request, path, result.code);
  return secureRedirect(request, `${path}?success=space-updated`);
}
