import { NextResponse, type NextRequest } from 'next/server';
import { voidPaymentRequestSchema } from '@clinic/contracts';
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
    .strictObject({ familyId: z.uuid(), paymentId: z.uuid() })
    .safeParse({ familyId: body['familyId'], paymentId: body['paymentId'] });
  if (!ids.success) return failureRedirect(request, '/families', 'VALIDATION_FAILED');

  const paymentsPath = `/families/${ids.data.familyId}/payments` as const;
  const parsed = voidPaymentRequestSchema.safeParse({ reason: body['reason'] ?? '' });
  if (!parsed.success) return failureRedirect(request, paymentsPath, 'VALIDATION_FAILED');

  const result = await api.voidPayment(ids.data.paymentId, parsed.data, { sessionToken });
  if (!result.ok) return failureRedirect(request, paymentsPath, result.code);

  return secureRedirect(request, `${paymentsPath}?success=payment-voided`);
}
