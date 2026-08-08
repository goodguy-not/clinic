import { NextResponse, type NextRequest } from 'next/server';
import { api } from '@/server/api-client';
import { deleteDraftCookie, draftTokenFromRequest } from '@/server/draft-cookie';
import {
  guardFailureResponse,
  guardStateChanging,
  readBody,
  sessionTokenFrom,
} from '@/server/handler-support';
import { secureRedirect } from '@/server/security-headers';

export const runtime = 'nodejs';

/**
 * "It is the same family (or child) after all." Abandons the draft and sends
 * the receptionist back to search, where the existing record can be found.
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

  const draftToken = draftTokenFromRequest(request);
  if (draftToken !== null) {
    // Best effort: the cookie is cleared regardless, so a stale token cannot
    // be resubmitted from this browser even if the server call fails.
    await api.discardDraft({ sessionToken, draftToken });
  }

  const response = secureRedirect(request, '/families');
  deleteDraftCookie(response);
  return response;
}
