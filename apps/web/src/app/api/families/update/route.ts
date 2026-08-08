import { NextResponse, type NextRequest } from 'next/server';
import { updateFamilyRequestSchema, duplicateBlockedDetailsSchema } from '@clinic/contracts';
import { api } from '@/server/api-client';
import { familyFormToRequest } from '@/server/family-forms';
import { setDraftCookie } from '@/server/draft-cookie';
import {
  failureRedirect,
  guardFailureResponse,
  guardStateChanging,
  readBody,
  sessionTokenFrom,
} from '@/server/handler-support';
import { noticeRedirect } from '@/server/notices';
import { secureRedirect } from '@/server/security-headers';

export const runtime = 'nodejs';

/** Edits a family and replaces its guardian set. Same duplicate handling as creation. */
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

  const id = body['id'] ?? '';
  const editPath = `/families/${id}/edit` as const;

  const parsed = updateFamilyRequestSchema.safeParse(familyFormToRequest(body));
  if (!parsed.success || id === '') return failureRedirect(request, editPath, 'VALIDATION_FAILED');

  const result = await api.updateFamily(id, parsed.data, { sessionToken });

  if (!result.ok) {
    if (result.code === 'FAMILY_POSSIBLE_DUPLICATE') {
      const details = duplicateBlockedDetailsSchema.safeParse(result.details);
      if (!details.success) return failureRedirect(request, editPath, 'INTERNAL_ERROR');

      const response = secureRedirect(request, '/families/confirm');
      setDraftCookie(response, details.data.draftToken, details.data.draftExpiresAt);
      return response;
    }

    return failureRedirect(request, editPath, result.code);
  }

  if (result.data.nonBlockingWarnings.length > 0) {
    return noticeRedirect(request, `/families/${id}`, result.data.nonBlockingWarnings);
  }

  return secureRedirect(request, `/families/${id}`);
}
