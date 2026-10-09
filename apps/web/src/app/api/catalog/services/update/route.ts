import { NextResponse, type NextRequest } from 'next/server';
import { updateServiceRequestSchema } from '@clinic/contracts';
import { api } from '@/server/api-client';
import { serviceFormToRequest, servicePublicAddressValid } from '@/server/catalog-forms';
import {
  failureRedirect,
  guardFailureResponse,
  guardStateChanging,
  readBody,
  sessionTokenFrom,
} from '@/server/handler-support';
import { secureRedirect } from '@/server/security-headers';
import { invalidateServicePublication } from '@/server/public-cache-invalidation';

export const runtime = 'nodejs';

/**
 * Edit a service.
 *
 * A failure returns to this service's own edit page, so the manager sees the
 * reason next to the form they were filling in. `SERVICE_DURATION_IN_USE` is
 * the case that matters: the whole edit rolled back in PostgreSQL, so the form
 * they return to still shows the durations that are actually stored.
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
  // Typed as a rooted path because the redirect helpers only accept one: the id
  // is encoded into a literal shape here, never taken from a caller-supplied
  // destination.
  const editPath: `/${string}` = `/catalog/services/${encodeURIComponent(id)}/edit`;

  const parsed = updateServiceRequestSchema.safeParse(serviceFormToRequest(body));

  if (!parsed.success || !servicePublicAddressValid(body))
    return failureRedirect(request, editPath, 'VALIDATION_FAILED');

  const result = await api.updateService(id, parsed.data, { sessionToken });

  if (!result.ok) return failureRedirect(request, editPath, result.code);
  if (result.data.publication.affectsPublicCache)
    invalidateServicePublication(result.data.publication.publicSlug);

  return secureRedirect(request, '/catalog/services');
}
