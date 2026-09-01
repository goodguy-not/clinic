import { NextResponse, type NextRequest } from 'next/server';
import { createFamilyRequestSchema, duplicateBlockedDetailsSchema } from '@clinic/contracts';
import { z } from 'zod';
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

/**
 * Registers a family.
 *
 * A blocked write never reaches a page directly: NestJS returns
 * `FAMILY_POSSIBLE_DUPLICATE` with the candidates and a draft token in the
 * body, this handler puts the token in an HttpOnly cookie — never in a
 * redirect target, a hidden field or anywhere else the browser could read the
 * raw value — and sends the receptionist to `/families/confirm`.
 */
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

  const parsed = createFamilyRequestSchema.safeParse(familyFormToRequest(body));
  const websiteRequestId =
    body['websiteRequestId'] === undefined
      ? null
      : z.uuid().safeParse(body['websiteRequestId']).success
        ? body['websiteRequestId']!
        : null;
  const newPath =
    websiteRequestId === null
      ? ('/families/new' as const)
      : (`/families/new?fromWebsiteRequest=${websiteRequestId}` as const);
  if (body['websiteRequestId'] !== undefined && websiteRequestId === null)
    return failureRedirect(request, '/families/new', 'VALIDATION_FAILED');
  if (!parsed.success) return failureRedirect(request, newPath, 'VALIDATION_FAILED');

  const result = await api.createFamily(parsed.data, { sessionToken });

  if (!result.ok) {
    if (result.code === 'FAMILY_POSSIBLE_DUPLICATE') {
      const details = duplicateBlockedDetailsSchema.safeParse(result.details);
      if (!details.success) return failureRedirect(request, newPath, 'INTERNAL_ERROR');

      const response = secureRedirect(
        request,
        websiteRequestId === null
          ? '/families/confirm'
          : `/families/confirm?fromWebsiteRequest=${websiteRequestId}`,
      );
      setDraftCookie(response, details.data.draftToken, details.data.draftExpiresAt);
      return response;
    }

    return failureRedirect(request, newPath, result.code);
  }

  if (websiteRequestId !== null) {
    const linked = await api.linkWebsiteRequest(
      websiteRequestId,
      { familyId: result.data.family.id },
      { sessionToken },
    );
    if (!linked.ok)
      return failureRedirect(request, `/website-requests/${websiteRequestId}`, linked.code);

    const notice = result.data.nonBlockingWarnings[0];
    return secureRedirect(
      request,
      `/website-requests/${websiteRequestId}?outcome=linked${notice === undefined ? '' : `&notice=${notice}`}`,
    );
  }

  if (result.data.nonBlockingWarnings.length > 0) {
    return noticeRedirect(
      request,
      `/families/${result.data.family.id}`,
      result.data.nonBlockingWarnings,
    );
  }

  return secureRedirect(request, `/families/${result.data.family.id}`);
}
