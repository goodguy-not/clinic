import { NextResponse, type NextRequest } from 'next/server';
import { api } from '@/server/api-client';
import {
  failureRedirect,
  guardFailureResponse,
  guardStateChanging,
  readBody,
  sessionTokenFrom,
} from '@/server/handler-support';
import { secureRedirect } from '@/server/security-headers';
import { temporaryPasswordResponse } from '@/server/temporary-password-page';

export const runtime = 'nodejs';

/**
 * Issue a new temporary password for a staff account.
 *
 * NestJS forces a change at next sign-in and revokes the target's live
 * sessions, so the old credential dies with the reset.
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

  const result = await api.resetUserPassword(body['id'] ?? '', { sessionToken });

  if (!result.ok) return failureRedirect(request, '/staff', result.code);

  // The username is echoed from the form purely as a label on the result page;
  // it is escaped before rendering and nothing is looked up by it.
  return temporaryPasswordResponse(body['username'] ?? '', result.data.temporaryPassword);
}
