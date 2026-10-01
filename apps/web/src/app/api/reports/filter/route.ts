import { NextResponse, type NextRequest } from 'next/server';
import {
  familyAccountReportQuerySchema,
  paymentReportQuerySchema,
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
import { relativeRedirect } from '@/server/security-headers';

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
    kind === 'sessions' ||
    kind === 'promises' ||
    kind === 'therapist-activity' ||
    kind === 'payments' ||
    kind === 'family-accounts'
      ? `/reports/${kind}`
      : '/reports/sessions';
  if (kind === 'family-accounts') {
    const parsed = familyAccountReportQuerySchema.safeParse({
      page: 1,
      pageSize: 25,
      ...pick(body, ['standing', 'includeInactive']),
    });
    if (!parsed.success) return relativeRedirect(base as `/${string}`);
    return redirectToReport(base, parsed.data);
  }
  const from = date(body, 'from');
  const to = date(body, 'to');
  if (from === null || to === null) return relativeRedirect(base as `/${string}`);

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
        : kind === 'payments'
          ? paymentReportQuerySchema.safeParse({
              ...common,
              page: 1,
              pageSize: 25,
              ...pick(body, ['familyId', 'method', 'recordedByUserId', 'includeVoided']),
            })
          : therapistActivityQuerySchema.safeParse({
              ...common,
              ...pick(body, ['therapistId', 'serviceId', 'includeInactive']),
            });
  if (!parsed.success) return relativeRedirect(base as `/${string}`);

  return redirectToReport(base, parsed.data);
}

function redirectToReport(base: string, query: object): NextResponse {
  const target = new URL(base, 'https://unused.invalid');
  for (const [key, value] of Object.entries(query)) target.searchParams.set(key, String(value));
  return relativeRedirect(`${target.pathname}${target.search}` as `/${string}`);
}

function pick(body: Record<string, string>, keys: string[]): Record<string, string> {
  return Object.fromEntries(
    keys.flatMap((key) => (body[key] === undefined || body[key] === '' ? [] : [[key, body[key]!]])),
  );
}
