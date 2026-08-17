import { NextResponse, type NextRequest } from 'next/server';
import { cancelPromiseRequestSchema } from '@clinic/contracts';
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
  const sessionToken = sessionTokenFrom(request);
  if (sessionToken === null) return secureRedirect(request, '/session-expired');
  try {
    guardStateChanging(request, body, { sessionToken });
  } catch (error) {
    const refusal = guardFailureResponse(error);
    if (refusal !== null) return refusal;
    throw error;
  }

  const ids = z
    .strictObject({ familyId: z.uuid(), promiseId: z.uuid() })
    .safeParse({ familyId: body['familyId'], promiseId: body['promiseId'] });
  if (!ids.success) return failureRedirect(request, '/families', 'VALIDATION_FAILED');
  const promisesPath = `/families/${ids.data.familyId}/promises` as const;
  const parsed = cancelPromiseRequestSchema.safeParse({ reason: body['reason']?.trim() ?? '' });
  if (!parsed.success) return failureRedirect(request, promisesPath, 'VALIDATION_FAILED');

  const result = await api.cancelPromise(ids.data.promiseId, parsed.data, { sessionToken });
  if (!result.ok) return failureRedirect(request, promisesPath, result.code);
  return secureRedirect(request, `${promisesPath}?success=promise-cancelled`);
}
