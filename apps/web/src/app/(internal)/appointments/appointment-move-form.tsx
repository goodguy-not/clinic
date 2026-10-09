import type { AppointmentView, Room, Service, Therapist } from '@clinic/contracts';
import {
  ButtonLink,
  Field,
  FormActions,
  PageHeader,
  PageShell,
  Panel,
  SubmitButton,
} from '@/components/ui';
import { COPY } from '@/server/copy-fa';
import { TimeInput } from '@/components/time-input';
import { isoDateToJalali } from '@/server/jalali';
import { toPersianDigits } from '@/server/numerals-fa';
import { appointmentInstantInClinic } from '@/scheduling/appointment-presentation';
import { JalaliDateField } from '../tariffs/jalali-date-field';

export function AppointmentMoveForm({
  view,
  service,
  therapists,
  rooms,
  csrfToken,
  errorMessage,
  canOverrideAvailability,
}: {
  view: AppointmentView;
  service: Service;
  therapists: Therapist[];
  rooms: Room[];
  csrfToken: string;
  errorMessage: string | null;
  canOverrideAvailability: boolean;
}) {
  const current = appointmentInstantInClinic(view.appointment.startsAt);
  const date = current === null ? null : isoDateToJalali(current.date);
  const activeTherapists = therapists.filter(
    (item) => item.status === 'ACTIVE' || item.id === view.therapist.id,
  );
  const activeRooms = rooms.filter((item) => item.status === 'ACTIVE' || item.id === view.room.id);

  return (
    <PageShell>
      <PageHeader
        title={COPY.appointmentMoveTitle}
        description={COPY.appointmentMoveHelp}
        backHref={`/appointments/${view.appointment.id}`}
        backLabel={COPY.appointmentDetailTitle}
      />
      {errorMessage !== null ? <AlertMessage message={errorMessage} /> : null}
      <Panel>
        <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <strong>
            {view.participants[0] === undefined
              ? 'کودک'
              : `${view.participants[0].child.firstName} ${view.participants[0].child.lastName}`}
          </strong>
          <span className="mx-2" aria-hidden="true">
            ·
          </span>
          <span>{view.service.name}</span>
        </div>
        <form method="post" action="/api/appointments/move" className="flex flex-col gap-5">
          <input type="hidden" name="id" value={view.appointment.id} />
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <JalaliDateField
            legend="تاریخ جدید"
            help="تاریخ را در تقویم شمسی وارد کنید."
            namePrefix="date"
            value={date}
            required
          />
          <Field id="appointment-start-time" label={COPY.appointmentStartTime} required>
            {({ id, className }) => (
              <TimeInput
                id={id}
                name="startTime"
                required
                defaultValue={current?.time ?? ''}
                className={className}
              />
            )}
          </Field>
          <Field id="appointment-duration" label={COPY.appointmentDuration} required>
            {({ id, className }) => (
              <select
                id={id}
                name="durationMinutes"
                required
                defaultValue={view.appointment.durationMinutes}
                className={className}
              >
                {service.allowedDurationsMinutes.map((duration) => (
                  <option key={duration} value={duration}>
                    {toPersianDigits(String(duration))} دقیقه
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field id="appointment-therapist" label={COPY.appointmentTherapist} required>
            {({ id, className }) => (
              <select
                id={id}
                name="therapistId"
                required
                defaultValue={view.appointment.therapistId}
                className={className}
              >
                {activeTherapists.map((therapist) => (
                  <option key={therapist.id} value={therapist.id}>
                    {therapist.fullName}
                    {therapist.status === 'INACTIVE' ? ' — غیرفعال' : ''}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field id="appointment-room" label={COPY.appointmentRoom} required>
            {({ id, className }) => (
              <select
                id={id}
                name="roomId"
                required
                defaultValue={view.appointment.roomId}
                className={className}
              >
                {activeRooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                    {room.status === 'INACTIVE' ? ' — غیرفعال' : ''}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            id="appointment-note"
            label={COPY.appointmentNote}
            help="حداکثر ۲۰۰۰ نویسه؛ اطلاعات پزشکی در این یادداشت ثبت نکنید."
          >
            {({ id, className, describedBy }) => (
              <textarea
                id={id}
                name="note"
                maxLength={2000}
                rows={4}
                defaultValue={view.appointment.note ?? ''}
                className={className}
                aria-describedby={describedBy}
              />
            )}
          </Field>
          {canOverrideAvailability ? (
            <Field
              id="availability-override-reason"
              label={COPY.appointmentAvailabilityOverride}
              help={COPY.appointmentAvailabilityOverrideHelp}
            >
              {({ id, className, describedBy }) => (
                <textarea
                  id={id}
                  name="availabilityOverrideReason"
                  maxLength={500}
                  rows={3}
                  defaultValue={view.appointment.availabilityOverrideReason ?? ''}
                  className={className}
                  aria-describedby={describedBy}
                />
              )}
            </Field>
          ) : null}
          <FormActions>
            <SubmitButton>{COPY.appointmentMoveAction}</SubmitButton>
            <ButtonLink href={`/appointments/${view.appointment.id}`} tone="secondary">
              {COPY.cancel}
            </ButtonLink>
          </FormActions>
        </form>
      </Panel>
    </PageShell>
  );
}

function AlertMessage({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-900"
    >
      {message}
    </p>
  );
}
