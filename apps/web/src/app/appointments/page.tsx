import type { Metadata } from 'next';
import { z } from 'zod';
import { AppHeader } from '@/components/app-header';
import { api } from '@/server/api-client';
import { callerContext, readSessionToken, requireSession } from '@/server/auth-session';
import { clinicToday } from '@/server/clinic-time';
import { persianMessage } from '@/server/errors-fa';
import { formatScheduleDate } from '@/scheduling/presentation';
import { addDaysToIsoDate, clinicWeek } from '@/scheduling/appointment-presentation';
import { AppointmentDay } from './appointment-day';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

function one(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function dateHref(date: string, therapistId?: string, roomId?: string): string {
  const search = new URLSearchParams({ date });
  if (therapistId !== undefined) search.set('therapistId', therapistId);
  if (roomId !== undefined) search.set('roomId', roomId);
  return `/appointments?${search.toString()}`;
}

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession({ requirePermission: 'appointment.read' });
  const params = await searchParams;
  const today = clinicToday();
  const candidateDate = one(params['date']) ?? today;
  const date =
    /^\d{4}-\d{2}-\d{2}$/.test(candidateDate) && clinicWeek(candidateDate).length === 7
      ? candidateDate
      : today;
  const therapistId = z.uuid().safeParse(one(params['therapistId']));
  const roomId = z.uuid().safeParse(one(params['roomId']));
  const filters = {
    ...(therapistId.success ? { therapistId: therapistId.data } : {}),
    ...(roomId.success ? { roomId: roomId.data } : {}),
  };

  const token = await readSessionToken();
  const context = await callerContext(token ?? undefined);
  const [day, therapists, rooms] = await Promise.all([
    api.appointmentDay({ date, ...filters }, context),
    api.listTherapists(context),
    api.listRooms(context),
  ]);

  const week = clinicWeek(date);
  const labels = week.map((value) => formatScheduleDate(value));
  const first = labels[0];
  const last = labels.at(-1);
  const selectedLabel = formatScheduleDate(date)?.full ?? date;
  const filterTherapist = filters.therapistId;
  const filterRoom = filters.roomId;

  return (
    <>
      <AppHeader />
      <AppointmentDay
        day={day.ok ? day.data : null}
        selectedDateLabel={selectedLabel}
        periodLabel={
          first !== null && first !== undefined && last !== null && last !== undefined
            ? `${first.day} ${first.month} تا ${last.day} ${last.month} ${last.year}`
            : selectedLabel
        }
        dayOptions={week.map((isoDate, index) => {
          const label = labels[index];
          const isToday = isoDate === today;
          const selected = isoDate === date;
          return {
            isoDate,
            href: dateHref(isoDate, filterTherapist, filterRoom),
            weekday: label?.weekday ?? isoDate,
            day: label?.day ?? isoDate.slice(-2),
            month: label?.month,
            today: isToday,
            selected,
            accessibleLabel: `${label?.full ?? isoDate}${isToday ? '، امروز' : ''}${selected ? '، انتخاب‌شده' : ''}`,
          };
        })}
        previousHref={dateHref(addDaysToIsoDate(date, -7) ?? date, filterTherapist, filterRoom)}
        nextHref={dateHref(addDaysToIsoDate(date, 7) ?? date, filterTherapist, filterRoom)}
        todayHref={dateHref(today, filterTherapist, filterRoom)}
        therapists={therapists.ok ? therapists.data.therapists : []}
        rooms={rooms.ok ? rooms.data.rooms : []}
        therapistId={filterTherapist}
        roomId={filterRoom}
        clearHref={dateHref(date)}
        errorMessage={day.ok ? null : persianMessage(day.code)}
      />
    </>
  );
}
