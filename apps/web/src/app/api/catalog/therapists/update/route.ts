import { NextResponse, type NextRequest } from 'next/server';
import { updateTherapistRequestSchema } from '@clinic/contracts';
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
 * Edit a therapist, replacing the supported-service set in the same request.
 *
 * NestJS applies the name, specialty and association changes in one
 * transaction, so a rejected service id leaves the previous set exactly as it
 * was rather than half-applied.
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

  const id = body['id'] ?? '';
  // Typed as a rooted path because the redirect helpers only accept one: the id
  // is encoded into a literal shape here, never taken from a caller-supplied
  // destination.
  const editPath: `/${string}` = `/therapists/${encodeURIComponent(id)}/edit`;

  const parsed = updateTherapistRequestSchema.safeParse(
    therapistFormToRequest(body, lists['serviceIds'] ?? []),
  );

  if (!parsed.success) return failureRedirect(request, editPath, 'VALIDATION_FAILED');

  const result = await api.updateTherapist(id, parsed.data, { sessionToken });

  if (!result.ok) return failureRedirect(request, editPath, result.code);

  return secureRedirect(request, '/therapists');
}
