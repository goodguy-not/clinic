import { NextResponse, type NextRequest } from 'next/server';
import {
  FAMILY_ACCOUNT_REPORT_EXPORT_PERMISSIONS,
  PAYMENT_REPORT_EXPORT_PERMISSIONS,
  PROMISE_REPORT_EXPORT_PERMISSIONS,
  SESSION_REPORT_EXPORT_PERMISSIONS,
  THERAPIST_ACTIVITY_EXPORT_PERMISSIONS,
  familyAccountReportExportQuerySchema,
  paymentReportExportQuerySchema,
  promiseReportExportQuerySchema,
  sessionReportExportQuerySchema,
  therapistActivityExportQuerySchema,
  type Permission,
} from '@clinic/contracts';
import { api, type ReportExportQuery } from '@/server/api-client';
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
  const kind = kindFrom(body);
  if (kind === null) {
    return secureJson({ error: { code: 'VALIDATION_FAILED' } }, 400);
  }
  if (
    !permissionsFor(kind).every((permission) => session.data.user.permissions.includes(permission))
  ) {
    return secureJson({ error: { code: 'AUTH_FORBIDDEN' } }, 403);
  }
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

function validateFilters(kind: Kind, filters: Record<string, unknown>): ReportExportQuery | null {
  const parsed =
    kind === 'sessions'
      ? sessionReportExportQuerySchema.safeParse(filters)
      : kind === 'promises'
        ? promiseReportExportQuerySchema.safeParse(filters)
        : kind === 'therapist-activity'
          ? therapistActivityExportQuerySchema.safeParse(filters)
          : kind === 'payments'
            ? paymentReportExportQuerySchema.safeParse(filters)
            : familyAccountReportExportQuerySchema.safeParse(filters);
  if (!parsed.success) return null;

  return parsed.data;
}

function kindFrom(body: Record<string, string>): Kind | null {
  return KINDS.includes(body['kind'] as Kind) ? (body['kind'] as Kind) : null;
}

function permissionsFor(kind: Kind): readonly Permission[] {
  if (kind === 'sessions') return SESSION_REPORT_EXPORT_PERMISSIONS;
  if (kind === 'promises') return PROMISE_REPORT_EXPORT_PERMISSIONS;
  if (kind === 'therapist-activity') return THERAPIST_ACTIVITY_EXPORT_PERMISSIONS;
  if (kind === 'payments') return PAYMENT_REPORT_EXPORT_PERMISSIONS;
  return FAMILY_ACCOUNT_REPORT_EXPORT_PERMISSIONS;
}
