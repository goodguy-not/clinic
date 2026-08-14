import { NextResponse, type NextRequest } from 'next/server';
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

/** Explicitly post or re-post the server-priced charge for one participant. */
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
    .strictObject({ appointmentId: z.uuid(), participantId: z.uuid() })
    .safeParse({ appointmentId: body['appointmentId'], participantId: body['participantId'] });
  if (!ids.success) return failureRedirect(request, '/appointments', 'VALIDATION_FAILED');

  const detailPath = `/appointments/${ids.data.appointmentId}` as const;
  const result = await api.postSessionCharge(ids.data.participantId, { sessionToken });
  if (!result.ok) return failureRedirect(request, detailPath, result.code);

  const success = result.data.outcome === 'POSTED' ? 'charge-posted' : 'charge-already-posted';
  return secureRedirect(request, `${detailPath}?success=${success}`);
}
