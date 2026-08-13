import type { Metadata } from 'next';
import { AppHeader } from '@/components/app-header';
import { PageHeader, PageShell } from '@/components/ui';
import { api } from '@/server/api-client';
import { callerContext, readSessionToken, requireSession } from '@/server/auth-session';
import { clinicToday } from '@/server/clinic-time';
import { isoDateToJalali } from '@/server/jalali';
import { BookingWorkflow } from './booking-workflow';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function NewAppointmentPage() {
  const user = await requireSession({ requirePermission: 'appointment.create' });
  const token = await readSessionToken();
  const context = await callerContext(token ?? undefined);
  const [services, therapists, rooms] = await Promise.all([
    api.listServices(context),
    api.listTherapists(context),
    api.listRooms(context),
  ]);
  const today = isoDateToJalali(clinicToday());
  const intent: Record<string, string> =
    today === null
      ? {}
      : {
          'date-year': String(today.year),
          'date-month': String(today.month),
          'date-day': String(today.day),
          bookingMode: 'once',
        };

  return (
    <>
      <AppHeader />
      <PageShell wide>
        <PageHeader
          title="ثبت نوبت"
          description="نوبت یک‌باره یا مجموعهٔ هفتگی را با بررسی قطعی برنامه ثبت کنید."
          backHref="/appointments"
          backLabel="برنامهٔ نوبت‌ها"
        />
        <BookingWorkflow
          initialState={{
            intent,
            families: [],
            searchTruncated: false,
            searchPerformed: false,
            preview: null,
            errorMessage: null,
            finalCreateConflict: false,
          }}
          services={services.ok ? services.data.services : []}
          therapists={therapists.ok ? therapists.data.therapists : []}
          rooms={rooms.ok ? rooms.data.rooms : []}
          canOverrideAvailability={user.permissions.includes('appointment.override_availability')}
        />
      </PageShell>
    </>
  );
}
