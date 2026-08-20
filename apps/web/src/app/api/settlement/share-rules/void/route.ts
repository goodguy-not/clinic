import { NextResponse, type NextRequest } from 'next/server';
import { voidShareRuleRequestSchema } from '@clinic/contracts';
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
import { settlementReturnPath } from '@/server/settlement-forms';

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
  const ids = z.strictObject({ therapistId: z.uuid(), shareRuleId: z.uuid() }).safeParse(body);
  const returnPath = settlementReturnPath(
    body['therapistId'] ?? '',
    body['returnFrom'],
    body['returnTo'],
  );
  const parsed = voidShareRuleRequestSchema.safeParse({ reason: body['reason'] ?? '' });
  if (!ids.success || !parsed.success)
    return failureRedirect(request, returnPath as `/${string}`, 'VALIDATION_FAILED');
  const result = await api.voidShareRule(ids.data.shareRuleId, parsed.data, {
    sessionToken: token,
  });
  if (!result.ok) return failureRedirect(request, returnPath as `/${string}`, result.code);
  return secureRedirect(
    request,
    `${returnPath}${returnPath.includes('?') ? '&' : '?'}success=share-rule-voided` as `/${string}`,
  );
}
