import { NextResponse, type NextRequest } from 'next/server';
import {
  promiseReportQuerySchema,
  sessionReportQuerySchema,
  therapistActivityQuerySchema,
} from '@clinic/contracts';
import {
  guardFailureResponse,
  guardStateChanging,
  readBody,
  sessionTokenFrom,
} from '@/server/handler-support';
import { jalaliToIsoDate } from '@/server/jalali';
import { applySecurityHeaders } from '@/server/security-headers';

export const runtime = 'nodejs';

function date(body: Record<string, string>, prefix: string): string | null {
  return jalaliToIsoDate({
    year: Number(body[`${prefix}-year`]),
    month: Number(body[`${prefix}-month`]),
    day: Number(body[`${prefix}-day`]),
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await readBody(request);
  const sessionToken = sessionTokenFrom(request);
  try {
    guardStateChanging(request, body, sessionToken === null ? 'unauthenticated' : { sessionToken });
  } catch (error) {
    const refusal = guardFailureResponse(error);
    if (refusal !== null) return refusal;
    throw error;
  }

  const kind = body['kind'];
  const base =
    kind === 'sessions' || kind === 'promises' || kind === 'therapist-activity'
      ? `/reports/${kind}`
      : '/reports/sessions';
  const from = date(body, 'from');
  const to = date(body, 'to');
  if (from === null || to === null)
    return applySecurityHeaders(NextResponse.redirect(new URL(base, request.url), 303));

  const common = { from, to };
  const parsed =
    kind === 'sessions'
      ? sessionReportQuerySchema.safeParse({
          ...common,
          page: 1,
          pageSize: 25,
          ...pick(body, [
            'familyId',
            'childId',
            'therapistId',
            'serviceId',
            'roomId',
            'status',
            'attendance',
          ]),
        })
      : kind === 'promises'
        ? promiseReportQuerySchema.safeParse({
            ...common,
            page: 1,
            pageSize: 25,
            ...pick(body, ['familyId', 'status']),
          })
        : therapistActivityQuerySchema.safeParse({
            ...common,
            ...pick(body, ['therapistId', 'serviceId', 'includeInactive']),
          });
  if (!parsed.success)
    return applySecurityHeaders(NextResponse.redirect(new URL(base, request.url), 303));

  const target = new URL(base, request.url);
  for (const [key, value] of Object.entries(parsed.data))
    target.searchParams.set(key, String(value));
  return applySecurityHeaders(NextResponse.redirect(target, 303));
}

function pick(body: Record<string, string>, keys: string[]): Record<string, string> {
  return Object.fromEntries(
    keys.flatMap((key) => (body[key] === undefined || body[key] === '' ? [] : [[key, body[key]!]])),
  );
}
