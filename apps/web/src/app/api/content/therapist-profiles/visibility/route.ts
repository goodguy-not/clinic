import { type NextRequest, type NextResponse } from 'next/server';
import { updateTherapistPublicVisibilityRequestSchema } from '@clinic/contracts';
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
import { invalidateTherapistPublication } from '@/server/public-cache-invalidation';

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
  const id = z.uuid().safeParse(body['id']);
  const parsed = updateTherapistPublicVisibilityRequestSchema.safeParse({
    isPublic: body['isPublic'] === 'true',
  });
  const path: `/${string}` = `/content/therapists/${encodeURIComponent(body['id'] ?? '')}`;
  if (!id.success || !parsed.success) return failureRedirect(request, path, 'VALIDATION_FAILED');
  const result = await api.updateTherapistPublicVisibility(id.data, parsed.data, {
    sessionToken: token,
  });
  if (!result.ok) return failureRedirect(request, path, result.code);
  invalidateTherapistPublication(result.data.profile.publicSlug);
  return secureRedirect(
    request,
    `${path}?success=${parsed.data.isPublic ? 'published' : 'withdrawn'}`,
  );
}
