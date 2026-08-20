import { NextResponse, type NextRequest } from 'next/server';
import { closeSettlementPeriodRequestSchema } from '@clinic/contracts';
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
  const parsed = closeSettlementPeriodRequestSchema.safeParse({
    therapistId: body['therapistId'],
    from: body['from'],
    to: body['to'],
  });
  const returnPath = settlementReturnPath(body['therapistId'] ?? '', body['from'], body['to']);
  if (!parsed.success || body['confirm'] !== 'yes')
    return failureRedirect(request, returnPath as `/${string}`, 'VALIDATION_FAILED');
  const result = await api.closeSettlementPeriod(parsed.data, { sessionToken: token });
  if (!result.ok) return failureRedirect(request, returnPath as `/${string}`, result.code);
  const target = new URL(returnPath, request.url);
  target.searchParams.set(
    'success',
    result.data.outcome === 'CLOSED' ? 'period-closed' : 'period-already-closed',
  );
  target.searchParams.set('periodId', result.data.period.id);
  return secureRedirect(request, `${target.pathname}${target.search}` as `/${string}`);
}
