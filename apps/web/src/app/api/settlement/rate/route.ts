import { NextResponse, type NextRequest } from 'next/server';
import { rateSessionRequestSchema } from '@clinic/contracts';
import { z } from 'zod';
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
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await readBody(request);
  const token = sessionTokenFrom(request);
  if (token === null) return secureRedirect(request, '/session-expired');
  try {
    guardStateChanging(request, body, { sessionToken: token });
  } catch (error) {
    const refusal = guardFailureResponse(error);
    if (refusal !== null) return refusal;
    throw error;
  }
  const ids = z
    .strictObject({ familyId: z.uuid(), chargeId: z.uuid() })
    .safeParse({ familyId: body['familyId'], chargeId: body['chargeId'] });
  const parsed = rateSessionRequestSchema.safeParse({ reason: body['reason'] ?? '' });
  if (!ids.success || !parsed.success)
    return failureRedirect(request, '/families', 'VALIDATION_FAILED');
  const path = `/families/${ids.data.familyId}/account` as const;
  const result = await api.rateSession(ids.data.chargeId, parsed.data, { sessionToken: token });
  if (!result.ok) return failureRedirect(request, path, result.code);
  return secureRedirect(request, `${path}?success=session-rated`);
}
