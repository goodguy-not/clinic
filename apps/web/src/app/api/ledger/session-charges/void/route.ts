import { NextResponse, type NextRequest } from 'next/server';
import { voidSessionChargeRequestSchema } from '@clinic/contracts';
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

/** Manager-only correction: withdraw a charge without deleting its history. */
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
    .strictObject({ familyId: z.uuid(), chargeId: z.uuid() })
    .safeParse({ familyId: body['familyId'], chargeId: body['chargeId'] });
  if (!ids.success) return failureRedirect(request, '/families', 'VALIDATION_FAILED');

  const accountPath = `/families/${ids.data.familyId}/account` as const;
  const parsed = voidSessionChargeRequestSchema.safeParse({ reason: body['reason'] ?? '' });
  if (!parsed.success) return failureRedirect(request, accountPath, 'VALIDATION_FAILED');

  const result = await api.voidSessionCharge(ids.data.chargeId, parsed.data, { sessionToken });
  if (!result.ok) return failureRedirect(request, accountPath, result.code);

  return secureRedirect(request, `${accountPath}?success=charge-voided`);
}
