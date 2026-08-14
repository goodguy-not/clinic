import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AppHeader } from '@/components/app-header';
import { Alert, PageShell } from '@/components/ui';
import { api } from '@/server/api-client';
import {
  callerContext,
  readCsrfCookie,
  readSessionToken,
  requireSession,
} from '@/server/auth-session';
import { COPY } from '@/server/copy-fa';
import { persianMessage } from '@/server/errors-fa';
import { isKnownErrorCode } from '@/server/handler-support';
import { loadParticipantCharges } from '@/server/appointment-charges';
import { AppointmentDetail } from '../appointment-detail';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

const SUCCESSES: Record<string, string> = {
  created: 'نوبت با موفقیت ثبت شد.',
  moved: COPY.appointmentMoved,
  cancelled: COPY.appointmentCancelledSuccess,
  completed: COPY.appointmentCompletedSuccess,
  attendance: COPY.appointmentAttendanceSuccess,
  reopened: COPY.appointmentReopenedSuccess,
  'charge-posted': 'هزینهٔ جلسه با موفقیت ثبت شد.',
  'charge-already-posted': 'هزینهٔ معتبر این جلسه پیش‌تر ثبت شده بود.',
};

export default async function AppointmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSession({ requirePermission: 'appointment.read' });
  const { id } = await params;
  const token = await readSessionToken();
  const context = await callerContext(token ?? undefined);
  const result = await api.appointmentView(id, context);
  if (!result.ok && result.code === 'APPOINTMENT_NOT_FOUND') notFound();

  if (!result.ok) {
    return (
      <>
        <AppHeader />
        <PageShell>
          <Alert>{persianMessage(result.code)}</Alert>
        </PageShell>
      </>
    );
  }

  const query = await searchParams;
  const rawError = typeof query['error'] === 'string' ? query['error'] : null;
  const rawSuccess = typeof query['success'] === 'string' ? query['success'] : '';
  const canReadCharges = user.permissions.includes('charge.read');
  const charges = canReadCharges
    ? await loadParticipantCharges(
        result.data.participants.map(({ participant }) => participant.id),
        context,
      )
    : {};

  return (
    <>
      <AppHeader />
      <AppointmentDetail
        view={result.data}
        csrfToken={(await readCsrfCookie()) ?? ''}
        errorMessage={isKnownErrorCode(rawError) ? persianMessage(rawError) : null}
        successMessage={SUCCESSES[rawSuccess] ?? null}
        canUpdate={user.permissions.includes('appointment.update')}
        canCancel={user.permissions.includes('appointment.cancel')}
        canComplete={user.permissions.includes('appointment.complete')}
        canReopen={user.permissions.includes('appointment.reopen')}
        charges={charges}
        canReadCharges={canReadCharges}
        canPostCharge={user.permissions.includes('charge.post')}
      />
    </>
  );
}
