import { NextResponse, type NextRequest } from 'next/server';
import { confirmDraftRequestSchema, duplicateBlockedDetailsSchema } from '@clinic/contracts';
import { z } from 'zod';
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

/**
 * Completes a family registration that was refused as a possible duplicate.
 *
 * The token never appears in the submitted form: it travels only in the
 * HttpOnly cookie this server set when the write was first blocked, read here
 * and forwarded to NestJS as `x-draft-token`. The body carries only the ids
 * somebody ticked.
 */
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
  if (draftToken === null) return failureRedirect(request, '/families/new', 'DRAFT_NOT_FOUND');

  const parsed = confirmDraftRequestSchema.safeParse({
    acknowledgedDuplicateIds: lists['acknowledgedDuplicateIds'] ?? [],
  });
  const websiteRequestId =
    body['websiteRequestId'] === undefined
      ? null
      : z.uuid().safeParse(body['websiteRequestId']).success
        ? body['websiteRequestId']!
        : null;
  const confirmPath =
    websiteRequestId === null
      ? ('/families/confirm' as const)
      : (`/families/confirm?fromWebsiteRequest=${websiteRequestId}` as const);
  const newPath =
    websiteRequestId === null
      ? ('/families/new' as const)
      : (`/families/new?fromWebsiteRequest=${websiteRequestId}` as const);
  if (body['websiteRequestId'] !== undefined && websiteRequestId === null)
    return failureRedirect(request, '/families/new', 'VALIDATION_FAILED');
  if (!parsed.success) return failureRedirect(request, confirmPath, 'VALIDATION_FAILED');

  const result = await api.confirmFamilyRegistration(parsed.data, { sessionToken, draftToken });

  if (!result.ok) {
    if (result.code === 'FAMILY_POSSIBLE_DUPLICATE') {
      // Same token, re-armed with the situation as it stands now.
      const details = duplicateBlockedDetailsSchema.safeParse(result.details);
      const response = secureRedirect(request, confirmPath);
      if (details.success)
        setDraftCookie(response, details.data.draftToken, details.data.draftExpiresAt);
      return response;
    }

    const response = failureRedirect(request, newPath, result.code);
    deleteDraftCookie(response);
    return response;
  }

  if (websiteRequestId !== null) {
    const linked = await api.linkWebsiteRequest(
      websiteRequestId,
      { familyId: result.data.family.id },
      { sessionToken },
    );
    const response = linked.ok
      ? secureRedirect(request, `/website-requests/${websiteRequestId}?outcome=linked`)
      : failureRedirect(request, `/website-requests/${websiteRequestId}`, linked.code);
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
