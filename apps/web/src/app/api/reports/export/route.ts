import { NextResponse, type NextRequest } from 'next/server';
import {
  familyAccountReportQuerySchema,
  paymentReportQuerySchema,
  promiseReportQuerySchema,
  sessionReportQuerySchema,
  therapistActivityQuerySchema,
} from '@clinic/contracts';
import { api } from '@/server/api-client';
import {
  guardFailureResponse,
  guardStateChanging,
  readBody,
  sessionTokenFrom,
} from '@/server/handler-support';
import { applySecurityHeaders, secureJson } from '@/server/security-headers';

export const runtime = 'nodejs';

const KINDS = [
  'sessions',
  'promises',
  'therapist-activity',
  'payments',
  'family-accounts',
] as const;
type Kind = (typeof KINDS)[number];

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

  if (sessionToken === null) return secureJson({ error: { code: 'AUTH_SESSION_INVALID' } }, 401);
  const forwardedFor = request.headers.get('x-forwarded-for');
  const context = {
    sessionToken,
    clientIp: forwardedFor?.split(',')[0]?.trim() ?? null,
    userAgent: request.headers.get('user-agent'),
  };
  const session = await api.session(context);
  if (!session.ok) return secureJson({ error: { code: session.code } }, session.status);
  if (!session.data.user.permissions.includes('report.export')) {
    return secureJson({ error: { code: 'AUTH_FORBIDDEN' } }, 403);
  }

  if (!KINDS.includes(body['kind'] as Kind)) {
    return secureJson({ error: { code: 'VALIDATION_FAILED' } }, 400);
  }
  const kind = body['kind'] as Kind;
  let rawFilters: unknown;
  try {
    rawFilters = JSON.parse(body['filters'] ?? '{}');
  } catch {
    return secureJson({ error: { code: 'VALIDATION_FAILED' } }, 400);
  }
  if (rawFilters === null || typeof rawFilters !== 'object' || Array.isArray(rawFilters)) {
    return secureJson({ error: { code: 'VALIDATION_FAILED' } }, 400);
  }

  const filters = validateFilters(kind, rawFilters as Record<string, unknown>);
  if (filters === null) return secureJson({ error: { code: 'VALIDATION_FAILED' } }, 400);

  const result = await api.exportReportCsv(kind, filters, context);
  if (!result.ok) return secureJson({ error: { code: result.code } }, result.status);

  const response = new NextResponse(result.response.body, { status: 200 });
  response.headers.set('content-type', result.response.headers.get('content-type')!);
  const disposition = result.response.headers.get('content-disposition');
  if (disposition !== null) response.headers.set('content-disposition', disposition);
  return applySecurityHeaders(response);
}

function validateFilters(
  kind: Kind,
  filters: Record<string, unknown>,
): Record<string, unknown> | null {
  const paged = { ...filters, page: 1, pageSize: 25 };
  const parsed =
    kind === 'sessions'
      ? sessionReportQuerySchema.safeParse(paged)
      : kind === 'promises'
        ? promiseReportQuerySchema.safeParse(paged)
        : kind === 'therapist-activity'
          ? therapistActivityQuerySchema.safeParse(filters)
          : kind === 'payments'
            ? paymentReportQuerySchema.safeParse(paged)
            : familyAccountReportQuerySchema.safeParse(paged);
  if (!parsed.success) return null;

  const { page: _page, pageSize: _pageSize, ...scope } = parsed.data as Record<string, unknown>;
  return scope;
}
