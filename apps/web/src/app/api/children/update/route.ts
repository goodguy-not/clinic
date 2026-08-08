import { NextResponse, type NextRequest } from 'next/server';
import { updateChildRequestSchema, duplicateBlockedDetailsSchema } from '@clinic/contracts';
import { api } from '@/server/api-client';
import { childFormToRequest } from '@/server/family-forms';
import { setDraftCookie } from '@/server/draft-cookie';
import { jalaliToIsoDate } from '@/server/jalali';
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

/** Edits a child. `familyId` is never accepted here: reassignment is out of scope. */
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
  const editPath = `/children/${id}/edit` as const;

  if (id === '') return failureRedirect(request, '/families', 'VALIDATION_FAILED');

  const form = childFormToRequest(body, jalaliToIsoDate);
  if (!form.ok) return failureRedirect(request, editPath, 'VALIDATION_FAILED');

  const parsed = updateChildRequestSchema.safeParse(form.payload);
  if (!parsed.success) return failureRedirect(request, editPath, 'VALIDATION_FAILED');

  const result = await api.updateChild(id, parsed.data, { sessionToken });

  if (!result.ok) {
    if (result.code === 'CHILD_POSSIBLE_DUPLICATE') {
      const details = duplicateBlockedDetailsSchema.safeParse(result.details);
      if (!details.success) return failureRedirect(request, editPath, 'INTERNAL_ERROR');

      const response = secureRedirect(request, '/families/confirm');
      setDraftCookie(response, details.data.draftToken, details.data.draftExpiresAt);
      return response;
    }

    return failureRedirect(request, editPath, result.code);
  }

  const familyId = result.data.family.id;

  if (result.data.nonBlockingWarnings.length > 0) {
    return noticeRedirect(request, `/families/${familyId}`, result.data.nonBlockingWarnings);
  }

  return secureRedirect(request, `/families/${familyId}`);
}
