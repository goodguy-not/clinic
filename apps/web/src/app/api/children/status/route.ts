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

/** Activates or deactivates a child. Never a delete: a child is named by session history. */
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

  const result = await api.changeChildStatus(id, status.data, { sessionToken });

  if (!result.ok) return failureRedirect(request, '/families', result.code);

  return secureRedirect(request, `/families/${result.data.family.id}`);
}
