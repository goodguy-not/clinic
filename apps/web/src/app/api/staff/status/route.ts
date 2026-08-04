import { NextResponse, type NextRequest } from 'next/server';
import { userStatusSchema } from '@clinic/contracts';
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
 * Enable or disable an account.
 *
 * Disabling revokes the target's live sessions inside the same PostgreSQL
 * transaction, and the account is never deleted — records with history are
 * deactivated (PROJECT_SPEC.md 5).
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

  const status = userStatusSchema.safeParse(body['status']);
  if (!status.success) return failureRedirect(request, '/staff', 'VALIDATION_FAILED');

  const result = await api.changeStatus(body['id'] ?? '', status.data, { sessionToken });

  if (!result.ok) return failureRedirect(request, '/staff', result.code);

  return secureRedirect(request, '/staff');
}
