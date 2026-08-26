import Link from 'next/link';
import type {
  AppointmentSeriesDetail,
  ChildDetailResponse,
  Room,
  Service,
  Therapist,
} from '@clinic/contracts';
import {
  Alert,
  Badge,
  ChoiceGroup,
  ChoiceOption,
  Field,
  FormActions,
  PageHeader,
  PageShell,
  Panel,
  SubmitButton,
} from '@/components/ui';
import {
  appointmentInstantInClinic,
  appointmentTimeLabel,
  APPOINTMENT_STATUS_PRESENTATION,
} from '@/scheduling/appointment-presentation';
import { formatScheduleDate } from '@/scheduling/presentation';
import { toPersianDigits } from '@/server/numerals-fa';

export function SeriesDetail({
  detail,
  children,
  services,
  therapists,
  rooms,
  csrfToken,
  canUpdate,
  canCancel,
  canOverride,
  errorMessage,
  successMessage,
}: {
  detail: AppointmentSeriesDetail;
  children: Map<string, ChildDetailResponse>;
  services: Service[];
  therapists: Therapist[];
  rooms: Room[];
  csrfToken: string;
  canUpdate: boolean;
  canCancel: boolean;
  canOverride: boolean;
  errorMessage: string | null;
  successMessage: string | null;
}) {
  const future = detail.occurrences.filter(({ appointment }) => appointment.status === 'SCHEDULED');
  const first = future[0] ?? detail.occurrences[0];
  const service = services.find((item) => item.id === first?.appointment.serviceId);
  return (
    <PageShell wide>
      <PageHeader
        title="مجموعهٔ نوبت هفتگی"
        description={`${toPersianDigits(String(detail.occurrences.length))} جلسه؛ ${detail.series.intervalWeeks === 1 ? 'هر هفته' : `هر ${toPersianDigits(String(detail.series.intervalWeeks))} هفته`}`}
        backHref="/appointments"
        backLabel="برنامهٔ نوبت‌ها"
      />
      {errorMessage ? <Alert>{errorMessage}</Alert> : null}
      {successMessage ? <Alert tone="info">{successMessage}</Alert> : null}
      <Panel title="جلسه‌های مجموعه">
        <p className="text-sm text-slate-600">
          جلسه‌های انجام‌شده و لغوشده برای حفظ تاریخچه تغییر نمی‌کنند. برای جابه‌جایی یا لغو فقط یک
          جلسه، همان جلسه را باز کنید.
        </p>
        <ol className="grid list-none gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {detail.occurrences.map(({ appointment, participants }) => {
            const local = appointmentInstantInClinic(appointment.startsAt);
            const status = APPOINTMENT_STATUS_PRESENTATION[appointment.status];
            const child = children.get(participants[0]?.childId ?? '')?.child;
            return (
              <li key={appointment.id}>
                <Link
                  href={`/appointments/${appointment.id}`}
                  className="block min-h-24 rounded-xl border border-slate-200 bg-white p-3 shadow-xs transition-colors hover:border-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                >
                  <div className="flex items-start justify-between gap-2">
                    <strong>
                      {local ? formatScheduleDate(local.date)?.full : appointment.startsAt}
                    </strong>
                    <Badge tone={status.badgeTone}>{status.label}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-700">
                    {appointmentTimeLabel(appointment.startsAt)} ·{' '}
                    {child ? `${child.firstName} ${child.lastName}` : 'کودک'}
                  </p>
                </Link>
              </li>
            );
          })}
        </ol>
      </Panel>
      {future.length > 0 && canUpdate && first ? (
        <Panel title="به‌روزرسانی این جلسه و جلسه‌های آینده">
          <p className="text-sm text-slate-600">
            تاریخ‌ها و ریتم هفتگی ثابت می‌ماند؛ ساعت، درمانگر، اتاق، مدت و یادداشت همهٔ جلسه‌های
            واجد شرایط یکجا تغییر می‌کند یا هیچ‌کدام.
          </p>
          <form
            method="post"
            action="/api/appointment-series/update-from"
            className="flex flex-col gap-4"
          >
            <input type="hidden" name="csrfToken" value={csrfToken} />
            <input type="hidden" name="seriesId" value={detail.series.id} />
            <Field id="update-pivot" label="شروع تغییر از جلسه" required>
              {({ id, className }) => (
                <select id={id} name="fromAppointmentId" className={className}>
                  {future.map(({ appointment }) => (
                    <option key={appointment.id} value={appointment.id}>
                      {appointmentInstantInClinic(appointment.startsAt)
                        ? formatScheduleDate(appointmentInstantInClinic(appointment.startsAt)!.date)
                            ?.full
                        : appointment.startsAt}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="series-time" label="ساعت جدید" required>
                {({ id, className }) => (
                  <input
                    id={id}
                    name="startTime"
                    type="time"
                    step="60"
                    required
                    defaultValue={appointmentInstantInClinic(first.appointment.startsAt)?.time}
                    className={className}
                  />
                )}
              </Field>
              <Field id="series-duration" label="مدت مجاز" required>
                {({ id, className }) => (
                  <select
                    id={id}
                    name="durationMinutes"
                    defaultValue={first.appointment.durationMinutes}
                    className={className}
                  >
                    {(service?.allowedDurationsMinutes ?? [first.appointment.durationMinutes]).map(
                      (duration) => (
                        <option key={duration} value={duration}>
                          {toPersianDigits(String(duration))} دقیقه
                        </option>
                      ),
                    )}
                  </select>
                )}
              </Field>
              <Field id="series-therapist" label="درمانگر" required>
                {({ id, className }) => (
                  <select
                    id={id}
                    name="therapistId"
                    defaultValue={first.appointment.therapistId}
                    className={className}
                  >
                    {therapists
                      .filter(
                        (item) =>
                          item.status === 'ACTIVE' || item.id === first.appointment.therapistId,
                      )
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.fullName}
                        </option>
                      ))}
                  </select>
                )}
              </Field>
              <Field id="series-room" label="اتاق" required>
                {({ id, className }) => (
                  <select
                    id={id}
                    name="roomId"
                    defaultValue={first.appointment.roomId}
                    className={className}
                  >
                    {rooms
                      .filter(
                        (item) => item.status === 'ACTIVE' || item.id === first.appointment.roomId,
                      )
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                  </select>
                )}
              </Field>
            </div>
            <Field id="series-note" label="یادداشت غیرپزشکی">
              {({ id, className }) => (
                <textarea
                  id={id}
                  name="note"
                  rows={3}
                  maxLength={2000}
                  defaultValue={first.appointment.note ?? ''}
                  className={className}
                />
              )}
            </Field>
            {canOverride ? (
              <Field
                id="series-override"
                label="دلیل ثبت خارج از برنامهٔ حضور"
                help="فقط نبودن درمانگر در برنامهٔ حضور قابل مجوز است؛ تداخل‌ها هرگز قابل عبور نیستند."
              >
                {({ id, className, describedBy }) => (
                  <textarea
                    id={id}
                    name="availabilityOverrideReason"
                    rows={2}
                    maxLength={500}
                    defaultValue={first.appointment.availabilityOverrideReason ?? ''}
                    aria-describedby={describedBy}
                    className={className}
                  />
                )}
              </Field>
            ) : null}
            <FormActions>
              <SubmitButton>به‌روزرسانی این و آینده</SubmitButton>
            </FormActions>
          </form>
        </Panel>
      ) : null}
      {future.length > 0 && canCancel ? (
        <Panel title="لغو این جلسه و جلسه‌های آینده">
          <p className="text-sm text-slate-600">
            جلسه‌های انجام‌شده یا از قبل لغوشده دست‌نخورده می‌مانند.
          </p>
          <form
            method="post"
            action="/api/appointment-series/cancel-from"
            className="flex flex-col gap-4"
          >
            <input type="hidden" name="csrfToken" value={csrfToken} />
            <input type="hidden" name="seriesId" value={detail.series.id} />
            <Field id="cancel-pivot" label="شروع لغو از جلسه" required>
              {({ id, className }) => (
                <select id={id} name="fromAppointmentId" className={className}>
                  {future.map(({ appointment }) => (
                    <option key={appointment.id} value={appointment.id}>
                      {appointmentInstantInClinic(appointment.startsAt)
                        ? formatScheduleDate(appointmentInstantInClinic(appointment.startsAt)!.date)
                            ?.full
                        : appointment.startsAt}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <ChoiceGroup legend="لغوکننده">
              <ChoiceOption
                id="series-family"
                name="cancelledBy"
                value="FAMILY"
                label="خانواده"
                defaultChecked
              />
              <ChoiceOption id="series-clinic" name="cancelledBy" value="CLINIC" label="کلینیک" />
            </ChoiceGroup>
            <Field id="series-reason" label="دلیل لغو" required>
              {({ id, className }) => (
                <textarea
                  id={id}
                  name="reason"
                  required
                  rows={3}
                  maxLength={500}
                  className={className}
                />
              )}
            </Field>
            <FormActions>
              <SubmitButton tone="danger">لغو این و آینده</SubmitButton>
            </FormActions>
          </form>
        </Panel>
      ) : null}
    </PageShell>
  );
}
