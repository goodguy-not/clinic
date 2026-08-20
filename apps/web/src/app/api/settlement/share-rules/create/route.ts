import { NextResponse, type NextRequest } from 'next/server';
import { createShareRuleRequestSchema } from '@clinic/contracts';
import { api } from '@/server/api-client';
import {
  failureRedirect,
  guardFailureResponse,
  guardStateChanging,
  readBody,
  sessionTokenFrom,
} from '@/server/handler-support';
import { jalaliToIsoDate } from '@/server/jalali';
import { secureRedirect } from '@/server/security-headers';
import { percentageToBasisPoints, settlementReturnPath } from '@/server/settlement-forms';

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
  const therapistId = body['therapistId'] ?? '';
  const returnPath = settlementReturnPath(therapistId, body['returnFrom'], body['returnTo']);
  const date = (prefix: string) =>
    jalaliToIsoDate({
      year: Number(body[`${prefix}-year`]),
      month: Number(body[`${prefix}-month`]),
      day: Number(body[`${prefix}-day`]),
    });
  const basisPoints = percentageToBasisPoints(body['sharePercent'] ?? '');
  const correction = body['supersedesShareRuleId'];
  const effectiveStart = correction ? body['fixedStart'] : date('start');
  const effectiveEnd = correction
    ? body['fixedEnd'] === ''
      ? null
      : body['fixedEnd']
    : body['openEnded'] === 'true'
      ? null
      : date('end');
  if (!correction && body['openEnded'] !== 'true' && effectiveEnd === null) {
    return failureRedirect(request, returnPath, 'VALIDATION_FAILED');
  }
  const parsed = createShareRuleRequestSchema.safeParse({
    therapistId,
    shareBasisPoints: basisPoints,
    effectiveStart,
    effectiveEnd,
    ...(correction ? { supersedesShareRuleId: correction, reason: body['reason'] ?? '' } : {}),
  });
  if (!parsed.success)
    return failureRedirect(request, returnPath as `/${string}`, 'VALIDATION_FAILED');
  const result = await api.createShareRule(parsed.data, { sessionToken: token });
  if (!result.ok) return failureRedirect(request, returnPath as `/${string}`, result.code);
  return secureRedirect(
    request,
    `${returnPath}${returnPath.includes('?') ? '&' : '?'}success=share-rule-created` as `/${string}`,
  );
}
