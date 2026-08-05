import { NextResponse, type NextRequest } from 'next/server';
import { catalogStatusSchema } from '@clinic/contracts';
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
 * Activate or deactivate a therapist. Never a delete: a therapist is named by
 * tariffs now and by appointment and settlement history later.
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

  const status = catalogStatusSchema.safeParse(body['status']);
  if (!status.success) return failureRedirect(request, '/therapists', 'VALIDATION_FAILED');

  const result = await api.changeTherapistStatus(body['id'] ?? '', status.data, { sessionToken });

  if (!result.ok) return failureRedirect(request, '/therapists', result.code);

  return secureRedirect(request, '/therapists');
}
