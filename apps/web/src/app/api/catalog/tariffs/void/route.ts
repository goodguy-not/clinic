import { NextResponse, type NextRequest } from 'next/server';
import { voidTariffRequestSchema } from '@clinic/contracts';
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

/**
 * Void a tariff.
 *
 * A withdrawal, not a deletion: the row stays, its reason is recorded, and it
 * never prices anything again. Nothing here can rewrite the price — the
 * database permits exactly one transition, from active to voided.
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

  const parsed = voidTariffRequestSchema.safeParse({ reason: body['reason'] ?? '' });

  if (!parsed.success) return failureRedirect(request, '/tariffs', 'VALIDATION_FAILED');

  const result = await api.voidTariff(body['id'] ?? '', parsed.data.reason, { sessionToken });

  if (!result.ok) return failureRedirect(request, '/tariffs', result.code);

  return secureRedirect(request, '/tariffs');
}
