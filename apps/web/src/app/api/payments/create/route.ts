import { NextResponse, type NextRequest } from 'next/server';
import { createPaymentRequestSchema } from '@clinic/contracts';
import { z } from 'zod';
import { api } from '@/server/api-client';
import {
  failureRedirect,
  guardFailureResponse,
  guardStateChanging,
  readBody,
  sessionTokenFrom,
} from '@/server/handler-support';
import { paymentFormCandidate } from '@/payments/form';
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

  const familyId = z.uuid().safeParse(body['familyId']);
  if (!familyId.success) return failureRedirect(request, '/families', 'VALIDATION_FAILED');

  const accountPath = `/families/${familyId.data}/account` as const;
  const parsed = createPaymentRequestSchema.safeParse(paymentFormCandidate(body));
  if (!parsed.success) return failureRedirect(request, accountPath, 'VALIDATION_FAILED');

  const result = await api.createPayment(familyId.data, parsed.data, { sessionToken });
  if (!result.ok) return failureRedirect(request, accountPath, result.code);

  return secureRedirect(request, `${accountPath}?success=payment-created`);
}
