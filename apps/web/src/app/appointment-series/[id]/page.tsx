import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { AppHeader } from '@/components/app-header';
import { api } from '@/server/api-client';
import {
  callerContext,
  readCsrfCookie,
  readSessionToken,
  requireSession,
} from '@/server/auth-session';
import { persianMessage } from '@/server/errors-fa';
import { isKnownErrorCode } from '@/server/handler-support';
import { SeriesDetail } from '../series-detail';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };
const one = (value: string | string[] | undefined) =>
  typeof value === 'string' ? value : undefined;

export default async function SeriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSession({ requirePermission: 'appointment.read' });
  const parsed = z.uuid().safeParse((await params).id);
  if (!parsed.success) notFound();
  const token = await readSessionToken();
  const context = await callerContext(token ?? undefined);
  const [detail, services, therapists, rooms] = await Promise.all([
    api.appointmentSeries(parsed.data, context),
    api.listServices(context),
    api.listTherapists(context),
    api.listRooms(context),
  ]);
  if (!detail.ok) {
    if (detail.code === 'APPOINTMENT_SERIES_NOT_FOUND') notFound();
    throw new Error(detail.code);
  }
  const childIds = [
    ...new Set(
      detail.data.occurrences.flatMap((item) =>
        item.participants.map((participant) => participant.childId),
      ),
    ),
  ];
  const childResults = await Promise.all(
    childIds.map(async (id) => [id, await api.getChild(id, context)] as const),
  );
  const children = new Map(
    childResults.flatMap(([id, result]) => (result.ok ? [[id, result.data] as const] : [])),
  );
  const query = await searchParams;
  const error = one(query['error']) ?? null;
  const errorMessage = isKnownErrorCode(error) ? persianMessage(error) : null;
  const success = one(query['success']);
  const changed = Number(one(query['changed']) ?? '0');
  const successMessage =
    success === 'created'
      ? 'مجموعه و همهٔ جلسه‌ها با موفقیت ثبت شد.'
      : success === 'updated'
        ? `${toFa(changed)} جلسهٔ واجد شرایط به‌روزرسانی شد.`
        : success === 'cancelled'
          ? `${toFa(changed)} جلسهٔ واجد شرایط لغو شد.`
          : null;
  return (
    <>
      <AppHeader />
      <SeriesDetail
        detail={detail.data}
        children={children}
        services={services.ok ? services.data.services : []}
        therapists={therapists.ok ? therapists.data.therapists : []}
        rooms={rooms.ok ? rooms.data.rooms : []}
        csrfToken={(await readCsrfCookie()) ?? ''}
        canUpdate={user.permissions.includes('appointment.update')}
        canCancel={user.permissions.includes('appointment.cancel')}
        canOverride={user.permissions.includes('appointment.override_availability')}
        errorMessage={errorMessage}
        successMessage={successMessage}
      />
    </>
  );
}
function toFa(value: number) {
  return new Intl.NumberFormat('fa-IR').format(value);
}
