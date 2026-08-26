import Link from 'next/link';
import type { AppointmentDayResponse, AppointmentView, Room, Therapist } from '@clinic/contracts';
import {
  ScheduleAgenda,
  ScheduleAgendaGroup,
  ScheduleCard,
  ScheduleDateNavigation,
  type ScheduleDayOption,
} from '@/components/scheduling';
import {
  Alert,
  Badge,
  ButtonLink,
  EmptyState,
  FOCUS_RING,
  PageHeader,
  PageShell,
} from '@/components/ui';
import { COPY } from '@/server/copy-fa';
import { toPersianDigits } from '@/server/numerals-fa';
import { appointmentChargeState, type ParticipantChargeLookup } from '@/ledger/appointment-charge';
import {
  APPOINTMENT_STATUS_PRESENTATION,
  ATTENDANCE_PRESENTATION,
  appointmentCardTone,
  appointmentInstantInClinic,
  appointmentTimeLabel,
} from '@/scheduling/appointment-presentation';

function ChargeSignal({
  view,
  charges,
}: {
  view: AppointmentView;
  charges: ParticipantChargeLookup;
}) {
  const states = view.participants.map(({ participant }) =>
    appointmentChargeState(view, participant.id, charges[participant.id]),
  );

  return (
    <>
      {states.some((state) => state.kind === 'CHARGED') ? (
        <Badge tone="success">✓ {COPY.appointmentDayCharged}</Badge>
      ) : null}
      {states.some((state) => state.kind === 'UNPRICED') ? (
        <Badge tone="warning">! {COPY.appointmentDayUnpriced}</Badge>
      ) : null}
    </>
  );
}

function AppointmentCard({
  view,
  charges,
}: {
  view: AppointmentView;
  charges: ParticipantChargeLookup;
}) {
  const child = view.participants[0]?.child;
  const participant = view.participants[0]?.participant;
  const status = APPOINTMENT_STATUS_PRESENTATION[view.appointment.status];

  return (
    <ScheduleCard
      title={child === undefined ? 'کودک ثبت‌نشده' : `${child.firstName} ${child.lastName}`}
      href={`/appointments/${view.appointment.id}`}
      accessibleLabel={`مشاهدهٔ جزئیات نوبت ${child?.firstName ?? ''} ${child?.lastName ?? ''}`.trim()}
      tone={appointmentCardTone(view)}
      badge={
        <span className="flex flex-wrap gap-1.5">
          <Badge tone={status.badgeTone}>{status.label}</Badge>
          {participant !== undefined && participant.attendance !== 'PENDING' ? (
            <Badge tone={ATTENDANCE_PRESENTATION[participant.attendance].tone}>
              {ATTENDANCE_PRESENTATION[participant.attendance].label}
            </Badge>
          ) : null}
          {view.outcomeUnresolved ? (
            <Badge tone="warning">{COPY.appointmentUnresolved}</Badge>
          ) : null}
        </span>
      }
      description={
        <span className="flex flex-wrap gap-x-2 gap-y-0.5">
          <strong>{view.service.name}</strong>
          <span aria-hidden="true">·</span>
          <span>{view.therapist.fullName}</span>
          <span aria-hidden="true">·</span>
          <span>{view.room.name}</span>
        </span>
      }
      metadata={
        <>
          <span>{toPersianDigits(String(view.appointment.durationMinutes))} دقیقه</span>
          {child !== undefined ? (
            <span>
              {COPY.appointmentFileNumber}: {toPersianDigits(child.fileNumber)}
            </span>
          ) : null}
          <ChargeSignal view={view} charges={charges} />
        </>
      }
    />
  );
}

function DaySummary({ summary }: { summary: AppointmentDayResponse['summary'] }) {
  const items = [
    [COPY.appointmentTotal, summary.total, 'text-slate-950'],
    [COPY.appointmentScheduled, summary.scheduled, 'text-brand-800'],
    [COPY.appointmentCompleted, summary.completed, 'text-emerald-800'],
    [COPY.appointmentCancelled, summary.cancelled, 'text-slate-600'],
    [COPY.appointmentUnresolved, summary.unresolvedOutcomes, 'text-amber-800'],
    [COPY.appointmentNoShow, summary.noShows, 'text-red-800'],
  ] as const;

  return (
    <dl aria-label="خلاصهٔ روز" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {items.map(([label, value, tone]) => (
        <div
          key={label}
          className="rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-xs"
        >
          <dt className="text-xs font-medium text-slate-600">{label}</dt>
          <dd className={`mt-1 text-2xl font-black tabular-nums ${tone}`}>
            {toPersianDigits(String(value))}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function AppointmentDay({
  day,
  selectedDateLabel,
  dayOptions,
  periodLabel,
  previousHref,
  nextHref,
  todayHref,
  therapists,
  rooms,
  therapistId,
  roomId,
  clearHref,
  errorMessage,
  charges,
}: {
  day: AppointmentDayResponse | null;
  selectedDateLabel: string;
  dayOptions: ScheduleDayOption[];
  periodLabel: string;
  previousHref: string;
  nextHref: string;
  todayHref: string;
  therapists: Therapist[];
  rooms: Room[];
  therapistId?: string;
  roomId?: string;
  clearHref: string;
  errorMessage: string | null;
  charges: ParticipantChargeLookup;
}) {
  const grouped = new Map<string, AppointmentView[]>();
  for (const view of day?.appointments ?? []) {
    const key =
      appointmentInstantInClinic(view.appointment.startsAt)?.time ?? view.appointment.startsAt;
    const existing = grouped.get(key) ?? [];
    existing.push(view);
    grouped.set(key, existing);
  }

  return (
    <PageShell wide>
      <PageHeader
        title={COPY.appointmentsTitle}
        action={<ButtonLink href="/appointments/new">ثبت نوبت</ButtonLink>}
        description={`${selectedDateLabel} — ${COPY.appointmentsDescription}`}
      />

      {errorMessage !== null ? <Alert>{errorMessage}</Alert> : null}

      <ScheduleDateNavigation
        label={COPY.appointmentDateNavLabel}
        periodLabel={periodLabel}
        previous={{ href: previousHref, label: COPY.appointmentPreviousWeek }}
        next={{ href: nextHref, label: COPY.appointmentNextWeek }}
        today={{ href: todayHref, label: COPY.appointmentToday }}
        todayMarker={COPY.appointmentToday}
        days={dayOptions}
      />

      <section
        aria-labelledby="appointment-filters"
        className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <h2 id="appointment-filters" className="mb-3 text-sm font-bold text-slate-900">
          {COPY.appointmentFiltersTitle}
        </h2>
        <form
          method="get"
          action="/appointments"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] lg:items-end"
        >
          <input
            type="hidden"
            name="date"
            value={day?.date ?? dayOptions.find((option) => option.selected)?.isoDate ?? ''}
          />
          <label className="flex flex-col gap-1 text-sm font-semibold text-slate-800">
            {COPY.appointmentTherapist}
            <select
              name="therapistId"
              defaultValue={therapistId ?? ''}
              className={`rounded-lg border border-slate-300 bg-white px-3 py-2 text-base ${FOCUS_RING}`}
            >
              <option value="">{COPY.appointmentAllTherapists}</option>
              {therapists.map((therapist) => (
                <option key={therapist.id} value={therapist.id}>
                  {therapist.fullName}
                  {therapist.status === 'INACTIVE' ? ' — غیرفعال' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-slate-800">
            {COPY.appointmentRoom}
            <select
              name="roomId"
              defaultValue={roomId ?? ''}
              className={`rounded-lg border border-slate-300 bg-white px-3 py-2 text-base ${FOCUS_RING}`}
            >
              <option value="">{COPY.appointmentAllRooms}</option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                  {room.status === 'INACTIVE' ? ' — غیرفعال' : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-1">
            <button
              type="submit"
              className={`min-h-11 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 ${FOCUS_RING}`}
            >
              {COPY.appointmentApplyFilters}
            </button>
            {therapistId !== undefined || roomId !== undefined ? (
              <Link
                href={clearHref}
                className={`inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 ${FOCUS_RING}`}
              >
                {COPY.appointmentClearFilters}
              </Link>
            ) : null}
          </div>
        </form>
      </section>

      {day !== null ? <DaySummary summary={day.summary} /> : null}

      {day !== null && day.appointments.length > 0 ? (
        <ScheduleAgenda
          id="clinic-day-agenda"
          title={COPY.appointmentDayAgendaTitle}
          description={`${toPersianDigits(String(day.summary.total))} نوبت بر اساس ساعت شروع`}
        >
          {[...grouped.entries()].map(([time, appointments]) => (
            <ScheduleAgendaGroup
              key={time}
              time={time}
              timeLabel={appointmentTimeLabel(appointments[0]!.appointment.startsAt)}
            >
              {appointments.map((view) => (
                <AppointmentCard key={view.appointment.id} view={view} charges={charges} />
              ))}
            </ScheduleAgendaGroup>
          ))}
        </ScheduleAgenda>
      ) : (
        <EmptyState
          message={day === null ? COPY.appointmentDayFailure : COPY.appointmentDayEmpty}
          action={
            day === null ? (
              <ButtonLink href={clearHref} tone="secondary">
                تلاش دوباره
              </ButtonLink>
            ) : undefined
          }
        />
      )}
    </PageShell>
  );
}
