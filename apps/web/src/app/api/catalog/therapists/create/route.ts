import { NextResponse, type NextRequest } from 'next/server';
import { createTherapistRequestSchema } from '@clinic/contracts';
import { api } from '@/server/api-client';
import { therapistFormToRequest } from '@/server/catalog-forms';
import {
  failureRedirect,
  guardFailureResponse,
  guardStateChanging,
  readBodyWithLists,
  sessionTokenFrom,
} from '@/server/handler-support';
import { secureRedirect } from '@/server/security-headers';

export const runtime = 'nodejs';

/**
 * Create a therapist.
 *
 * `readBodyWithLists` because the supported services are checkboxes sharing one
 * name: the flat reader keeps only the last, which would silently assign one
 * service when several were ticked.
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

  const candidate = therapistFormToRequest(body, lists['serviceIds'] ?? []);
  const parsed = createTherapistRequestSchema.safeParse(candidate);

  if (!parsed.success) return failureRedirect(request, '/therapists/new', 'VALIDATION_FAILED');

  const result = await api.createTherapist(parsed.data, { sessionToken });

  if (!result.ok) return failureRedirect(request, '/therapists/new', result.code);

  return secureRedirect(request, '/therapists');
}
