import { type NextRequest, type NextResponse } from 'next/server';
import { linkWebsiteRequestRequestSchema } from '@clinic/contracts';
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

  const requestId = z.uuid().safeParse(body['requestId']);
  if (!requestId.success) return failureRedirect(request, '/website-requests', 'VALIDATION_FAILED');
  const detailPath = `/website-requests/${requestId.data}` as const;
  const parsed = linkWebsiteRequestRequestSchema.safeParse({ familyId: body['familyId'] });
  if (!parsed.success) return failureRedirect(request, detailPath, 'VALIDATION_FAILED');

  const result = await api.linkWebsiteRequest(requestId.data, parsed.data, { sessionToken });
  if (!result.ok) return failureRedirect(request, detailPath, result.code);

  return secureRedirect(request, `${detailPath}?outcome=linked`);
}
