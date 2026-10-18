import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { AppHeader } from '@/components/app-header';
import { Alert, PageShell } from '@/components/ui';
import { api } from '@/server/api-client';
import {
  callerContext,
  readCsrfCookie,
  readSessionToken,
  requireSession,
} from '@/server/auth-session';
import { persianMessage } from '@/server/errors-fa';
import { isKnownErrorCode } from '@/server/handler-support';
import { AppointmentMoveForm } from '../../appointment-move-form';
import { readRefusalDetails, schedulingRefusalMessage } from '@/scheduling/refusal-message';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AppointmentEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSession({ requirePermission: 'appointment.update' });
  const { id } = await params;
  const token = await readSessionToken();
  const context = await callerContext(token ?? undefined);
  const [view, services, therapists, rooms] = await Promise.all([
    api.appointmentView(id, context),
    api.listServices(context),
    api.listTherapists(context),
    api.listRooms(context),
  ]);
  if (!view.ok && view.code === 'APPOINTMENT_NOT_FOUND') notFound();
  if (!view.ok)
    return (
      <>
        <AppHeader />
        <PageShell>
          <Alert>{persianMessage(view.code)}</Alert>
        </PageShell>
      </>
    );
  if (view.data.appointment.status !== 'SCHEDULED') redirect(`/appointments/${id}`);

  const service = services.ok
    ? services.data.services.find((item) => item.id === view.data.service.id)
    : undefined;
  if (service === undefined || !therapists.ok || !rooms.ok) {
    return (
      <>
        <AppHeader />
        <PageShell>
          <Alert>
            {persianMessage(
              !services.ok
                ? services.code
                : !therapists.ok
                  ? therapists.code
                  : !rooms.ok
                    ? rooms.code
                    : 'SERVICE_NOT_FOUND',
            )}
          </Alert>
        </PageShell>
      </>
    );
  }
  const query = await searchParams;
  const rawError = typeof query['error'] === 'string' ? query['error'] : null;
  const names = {
    children: Object.fromEntries(
      view.data.participants.map(({ child }) => [child.id, `${child.firstName} ${child.lastName}`]),
    ),
    therapists: Object.fromEntries(
      therapists.data.therapists.map((item) => [item.id, item.fullName]),
    ),
    rooms: Object.fromEntries(rooms.data.rooms.map((item) => [item.id, item.name])),
  };

  return (
    <>
      <AppHeader />
      <AppointmentMoveForm
        view={view.data}
        service={service}
        therapists={therapists.data.therapists}
        rooms={rooms.data.rooms}
        csrfToken={(await readCsrfCookie()) ?? ''}
        errorMessage={
          isKnownErrorCode(rawError)
            ? schedulingRefusalMessage(rawError, readRefusalDetails(query['detail']), names)
            : null
        }
        canOverrideAvailability={user.permissions.includes('appointment.override_availability')}
      />
    </>
  );
}
