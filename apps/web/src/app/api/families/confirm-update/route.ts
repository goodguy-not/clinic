import { NextResponse, type NextRequest } from 'next/server';
import { confirmDraftRequestSchema, duplicateBlockedDetailsSchema } from '@clinic/contracts';
import { api } from '@/server/api-client';
import { deleteDraftCookie, draftTokenFromRequest, setDraftCookie } from '@/server/draft-cookie';
import {
  failureRedirect,
  guardFailureResponse,
  guardStateChanging,
  readBodyWithLists,
  sessionTokenFrom,
} from '@/server/handler-support';
import { noticeRedirect } from '@/server/notices';
import { secureRedirect } from '@/server/security-headers';

export const runtime = 'nodejs';

/** Completes a family edit that was refused as a possible duplicate. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const { body, lists } = await readBodyWithLists(request);
  const sessionToken = sessionTokenFrom(request);

  if (sessionToken === null) return secureRedirect(request, '/session-expired');

  try {
    guardStateChanging(request, body, { sessionToken });
  } catch (error) {
    const refusal = guardFailureResponse(error);
    if (refusal !== null) return refusal;
    throw error;
  }

  const draftToken = draftTokenFromRequest(request);
  if (draftToken === null) return failureRedirect(request, '/families', 'DRAFT_NOT_FOUND');

  const parsed = confirmDraftRequestSchema.safeParse({
    acknowledgedDuplicateIds: lists['acknowledgedDuplicateIds'] ?? [],
  });
  if (!parsed.success) return failureRedirect(request, '/families/confirm', 'VALIDATION_FAILED');

  const result = await api.confirmFamilyUpdate(parsed.data, { sessionToken, draftToken });

  if (!result.ok) {
    if (result.code === 'FAMILY_POSSIBLE_DUPLICATE') {
      const details = duplicateBlockedDetailsSchema.safeParse(result.details);
      const response = secureRedirect(request, '/families/confirm');
      if (details.success)
        setDraftCookie(response, details.data.draftToken, details.data.draftExpiresAt);
      return response;
    }

    const response = failureRedirect(request, '/families', result.code);
    deleteDraftCookie(response);
    return response;
  }

  const response =
    result.data.nonBlockingWarnings.length > 0
      ? noticeRedirect(
          request,
          `/families/${result.data.family.id}`,
          result.data.nonBlockingWarnings,
        )
      : secureRedirect(request, `/families/${result.data.family.id}`);
  deleteDraftCookie(response);
  return response;
}
