import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRequestSchema } from '@clinic/contracts';
import { api } from '@/server/api-client';
import {
  failureRedirect,
  guardFailureResponse,
  guardStateChanging,
  readBody,
  sessionTokenFrom,
} from '@/server/handler-support';
import { serviceFormToRequest } from '@/server/catalog-forms';
import { secureRedirect } from '@/server/security-headers';

export const runtime = 'nodejs';

/** Create a clinic service. */
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

  const candidate = serviceFormToRequest(body);
  const parsed = createServiceRequestSchema.safeParse(candidate);

  if (!parsed.success)
    return failureRedirect(request, '/catalog/services/new', 'VALIDATION_FAILED');

  const result = await api.createService(parsed.data, { sessionToken });

  if (!result.ok) return failureRedirect(request, '/catalog/services/new', result.code);

  return secureRedirect(request, '/catalog/services');
}
