import { type NextRequest, type NextResponse } from 'next/server';
import { updateTherapistPublicProfileRequestSchema } from '@clinic/contracts';
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
  const path: `/${string}` = `/content/therapists/${encodeURIComponent(body['id'] ?? '')}`;
  if (!id.success) return failureRedirect(request, path, 'VALIDATION_FAILED');
  const current = await api.getTherapistPublicProfile(id.data, { sessionToken: token });
  if (!current.ok) return failureRedirect(request, path, current.code);
  const slug = (body['publicSlug'] ?? '').trim();
  const parsed = updateTherapistPublicProfileRequestSchema.safeParse({
    publicSlug: slug === '' ? null : slug,
    displayName: current.data.profile.displayName,
    title: current.data.profile.title,
    bio: current.data.profile.bio,
    photoPath: current.data.profile.photoPath,
    displayOrder: Number(body['displayOrder']),
  });
  if (!parsed.success) return failureRedirect(request, path, 'VALIDATION_FAILED');
  const result = await api.updateTherapistPublicProfile(id.data, parsed.data, {
    sessionToken: token,
  });
  if (!result.ok) return failureRedirect(request, path, result.code);
  if (result.data.profile.isPublic) invalidateTherapistPublication(result.data.profile.publicSlug);
  return secureRedirect(request, `${path}?success=settings-saved`);
}
