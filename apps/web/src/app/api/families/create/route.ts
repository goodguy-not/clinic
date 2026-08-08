import { NextResponse, type NextRequest } from 'next/server';
import { createFamilyRequestSchema, duplicateBlockedDetailsSchema } from '@clinic/contracts';
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
  if (!parsed.success) return failureRedirect(request, '/families/new', 'VALIDATION_FAILED');

  const result = await api.createFamily(parsed.data, { sessionToken });

  if (!result.ok) {
    if (result.code === 'FAMILY_POSSIBLE_DUPLICATE') {
      const details = duplicateBlockedDetailsSchema.safeParse(result.details);
      if (!details.success) return failureRedirect(request, '/families/new', 'INTERNAL_ERROR');

      const response = secureRedirect(request, '/families/confirm');
      setDraftCookie(response, details.data.draftToken, details.data.draftExpiresAt);
      return response;
    }

    return failureRedirect(request, '/families/new', result.code);
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
