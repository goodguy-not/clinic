import { NextResponse, type NextRequest } from 'next/server';
import { recordStatusSchema } from '@clinic/contracts';
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
 * Activates or deactivates a family. Never a delete: a family holds the
 * balance and is named by every charge from Milestone 5 onward.
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

  const id = body['id'] ?? '';
  const status = recordStatusSchema.safeParse(body['status']);
  if (!status.success || id === '')
    return failureRedirect(request, '/families', 'VALIDATION_FAILED');

  const result = await api.changeFamilyStatus(id, status.data, { sessionToken });

  if (!result.ok) return failureRedirect(request, `/families/${id}`, result.code);

  return secureRedirect(request, `/families/${id}`);
}
