import type { Metadata } from 'next';
import { AppHeader } from '@/components/app-header';
import { Alert, ButtonLink, PageShell } from '@/components/ui';
import { api } from '@/server/api-client';
import { jalaliDateFromBody } from '@/server/availability-forms';
import {
  callerContext,
  readCsrfCookie,
  readSessionToken,
  requireSession,
} from '@/server/auth-session';
import { clinicToday } from '@/server/clinic-time';
import { COPY } from '@/server/copy-fa';
import { persianMessage } from '@/server/errors-fa';
import { isKnownErrorCode } from '@/server/handler-support';
import {
  AvailabilityDetail,
  type AvailabilitySuccess,
} from '../../../availability/availability-detail';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function TherapistAvailabilityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSession({ requirePermission: 'availability.read' });
  const { id } = await params;
  const query = await searchParams;
  const today = clinicToday();
  const hasDateQuery = ['date-year', 'date-month', 'date-day'].some(
    (key) => typeof query[key] === 'string',
  );
  const queryBody = Object.fromEntries(
    Object.entries(query).flatMap(([key, value]) =>
      typeof value === 'string' ? [[key, value]] : [],
    ),
  );
  const requestedDate = hasDateQuery ? jalaliDateFromBody(queryBody, 'date') : today;
  const selectedDate = requestedDate ?? today;
  const token = await readSessionToken();
  const context = await callerContext(token ?? undefined);

  const [therapistResult, windowsResult, exceptionsResult, resolvedResult] = await Promise.all([
    api.getTherapist(id, context),
    api.listAvailabilityWindows(id, context),
    api.listAvailabilityExceptions(id, {}, context),
    api.resolveAvailability({ therapistId: id, date: selectedDate }, context),
  ]);

  if (!therapistResult.ok) {
    return (
      <>
        <AppHeader />
        <PageShell>
          <Alert>{persianMessage(therapistResult.code)}</Alert>
          <div>
            <ButtonLink href="/availability" tone="secondary">
              {COPY.back}
            </ButtonLink>
          </div>
        </PageShell>
      </>
    );
  }

  const rawError = query['error'];
  const routeCode = typeof rawError === 'string' && isKnownErrorCode(rawError) ? rawError : null;
  const failedRead = [windowsResult, exceptionsResult, resolvedResult].find((result) => !result.ok);
  const errorMessage =
    requestedDate === null
      ? persianMessage('AVAILABILITY_DATE_INVALID')
      : routeCode !== null
        ? persianMessage(routeCode)
        : failedRead !== undefined && !failedRead.ok
          ? persianMessage(failedRead.code)
          : null;
  const rawSuccess = query['success'];
  const success: AvailabilitySuccess | null =
    rawSuccess === 'windows' ||
    rawSuccess === 'exception-added' ||
    rawSuccess === 'exception-removed'
      ? rawSuccess
      : null;

  return (
    <>
      <AppHeader />
      <AvailabilityDetail
        therapist={therapistResult.data.therapist}
        windows={windowsResult.ok ? windowsResult.data.windows : []}
        exceptions={exceptionsResult.ok ? exceptionsResult.data.exceptions : []}
        resolved={resolvedResult.ok ? resolvedResult.data.availability : null}
        selectedDate={selectedDate}
        today={today}
        canManage={user.permissions.includes('availability.manage')}
        csrfToken={(await readCsrfCookie()) ?? ''}
        errorMessage={errorMessage}
        success={success}
      />
    </>
  );
}
