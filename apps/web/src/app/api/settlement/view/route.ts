import { NextResponse, type NextRequest } from 'next/server';
import { settlementStatementQuerySchema } from '@clinic/contracts';
import {
  guardFailureResponse,
  guardStateChanging,
  readBody,
  sessionTokenFrom,
} from '@/server/handler-support';
import { jalaliToIsoDate } from '@/server/jalali';
import { applySecurityHeaders } from '@/server/security-headers';
import { settlementReturnPath } from '@/server/settlement-forms';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await readBody(request);
  const token = sessionTokenFrom(request);
  try {
    guardStateChanging(request, body, token === null ? 'unauthenticated' : { sessionToken: token });
  } catch (error) {
    const refusal = guardFailureResponse(error);
    if (refusal !== null) return refusal;
    throw error;
  }
  const date = (prefix: string) =>
    jalaliToIsoDate({
      year: Number(body[`${prefix}-year`]),
      month: Number(body[`${prefix}-month`]),
      day: Number(body[`${prefix}-day`]),
    });
  const parsed = settlementStatementQuerySchema.safeParse({
    therapistId: body['therapistId'],
    from: date('from'),
    to: date('to'),
  });
  const target = parsed.success
    ? settlementReturnPath(parsed.data.therapistId, parsed.data.from, parsed.data.to)
    : '/settlements?error=VALIDATION_FAILED';
  return applySecurityHeaders(NextResponse.redirect(new URL(target, request.url), 303));
}
