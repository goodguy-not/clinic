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

export const runtime = 'nodejs';

/**
 * Sign a user out everywhere.
 *
 * NestJS marks the sessions revoked with `MANAGER_REVOKED` rather than deleting
 * the rows: the row is the evidence that a session existed and when it ended.
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

  const result = await api.revokeUserSessions(body['id'] ?? '', { sessionToken });

  if (!result.ok) return failureRedirect(request, '/staff', result.code);

  return secureRedirect(request, '/staff');
}
