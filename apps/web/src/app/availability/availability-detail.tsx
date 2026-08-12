import type {
  ResolvedAvailability,
  Therapist,
  TherapistAvailability,
  TherapistAvailabilityException,
} from '@clinic/contracts';
import {
  Badge,
  Alert,
  EmptyState,
  PageHeader,
  PageShell,
  Panel,
  SubmitButton,
} from '@/components/ui';
import { CONTROL_CLASS } from '@/components/styles';
import { COPY } from '@/server/copy-fa';
import { isoDateToJalali, JALALI_MONTHS, type JalaliParts } from '@/server/jalali';
import { toPersianDigits } from '@/server/numerals-fa';
import { WEEKDAYS_FA } from '@/scheduling/availability-presentation';
import { JalaliDateField } from '../tariffs/jalali-date-field';
import { WeeklyAvailabilityEditor } from './weekly-availability-editor';

export type AvailabilitySuccess = 'windows' | 'exception-added' | 'exception-removed';

export function AvailabilityDetail({
  therapist,
  windows,
  exceptions,
  resolved,
  selectedDate,
  today,
  canManage,
  csrfToken,
  errorMessage,
  success,
}: {
  therapist: Therapist;
  windows: TherapistAvailability[];
  exceptions: TherapistAvailabilityException[];
  resolved: ResolvedAvailability | null;
  selectedDate: string;
  today: string;
  canManage: boolean;
  csrfToken: string;
  errorMessage: string | null;
  success: AvailabilitySuccess | null;
}) {
  const editable = canManage && therapist.status === 'ACTIVE';
  const defaultDate = isoDateToJalali(today) ?? undefined;
  const selectedParts = isoDateToJalali(selectedDate) ?? defaultDate;
  const successMessage =
    success === 'windows'
      ? COPY.availabilityWeekSaved
      : success === 'exception-added'
        ? COPY.availabilityExceptionAdded
        : success === 'exception-removed'
          ? COPY.availabilityExceptionRemoved
          : null;

  return (
    <PageShell>
      <PageHeader
        title={`${COPY.availabilityTitle} — ${therapist.fullName}`}
        description={therapist.specialty}
        backHref="/availability"
        backLabel={COPY.back}
      />

      {errorMessage !== null ? <Alert>{errorMessage}</Alert> : null}
      {successMessage !== null ? <Alert tone="info">{successMessage}</Alert> : null}
      {!canManage ? <Alert tone="info">{COPY.availabilityReadOnlyNotice}</Alert> : null}
      {therapist.status !== 'ACTIVE' ? (
        <Alert tone="info">{COPY.availabilityInactiveNotice}</Alert>
      ) : null}

      <Panel title={COPY.availabilityWeekTitle}>
        <p className="text-sm text-slate-600">{COPY.availabilityWeekDescription}</p>
        {editable ? (
          <WeeklyAvailabilityEditor
            therapistId={therapist.id}
            windows={windows.map(({ weekday, startTime, endTime }) => ({
              weekday,
              startTime,
              endTime,
            }))}
            csrfToken={csrfToken}
            labels={{
              overlap: COPY.availabilityOverlapClient,
              addWindow: COPY.availabilityAddWindow,
              dayOff: COPY.availabilityDayOff,
              startTime: COPY.availabilityStartTime,
              endTime: COPY.availabilityEndTime,
              removeWindow: COPY.availabilityRemoveWindow,
              limit: COPY.availabilityWindowLimit,
              save: COPY.availabilitySaveWeek,
            }}
          />
        ) : (
          <ReadOnlyWeek windows={windows} />
        )}
      </Panel>

      <Panel title={COPY.availabilityResolvedTitle}>
        <p className="text-sm text-slate-600">{COPY.availabilityResolvedDescription}</p>
        <form
          method="get"
          action={`/therapists/${therapist.id}/availability`}
          className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4"
        >
          <JalaliDateField
            legend={COPY.availabilityDateLabel}
            help={COPY.availabilityDateHelp}
            namePrefix="date"
            value={selectedParts}
            required
          />
          <div>
            <SubmitButton tone="secondary">{COPY.availabilityResolveAction}</SubmitButton>
          </div>
        </form>
        {resolved !== null ? <ResolvedDay availability={resolved} /> : null}
      </Panel>

      <Panel title={COPY.availabilityExceptionsTitle}>
        <p className="text-sm text-slate-600">{COPY.availabilityExceptionsDescription}</p>

        {editable ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ExceptionForm
              kind="closed"
              therapistId={therapist.id}
              csrfToken={csrfToken}
              defaultDate={defaultDate}
            />
            <ExceptionForm
              kind="extra"
              therapistId={therapist.id}
              csrfToken={csrfToken}
              defaultDate={defaultDate}
            />
          </div>
        ) : null}

        {exceptions.length === 0 ? (
          <EmptyState message={COPY.availabilityExceptionEmpty} />
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {exceptions.map((exception) => (
              <li
                key={exception.id}
                className={`flex flex-col gap-3 rounded-xl border border-s-4 bg-white p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between ${
                  exception.isAvailable
                    ? 'border-s-emerald-600 border-slate-200'
                    : 'border-s-red-600 border-slate-200'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-slate-950">
                      {formatJalali(exception.exceptionDate)}
                    </span>
                    <Badge tone={exception.isAvailable ? 'success' : 'danger'}>
                      {exception.isAvailable
                        ? COPY.availabilityExtraBadge
                        : COPY.availabilityClosedBadge}
                    </Badge>
                  </div>
                  {exception.isAvailable &&
                  exception.startTime !== null &&
                  exception.endTime !== null ? (
                    <p className="mt-1 text-sm font-semibold tabular-nums text-slate-800" dir="ltr">
                      {exception.startTime} – {exception.endTime}
                    </p>
                  ) : null}
                  <p className="mt-1 text-sm text-slate-600">
                    {exception.reason ?? COPY.availabilityNoReason}
                  </p>
                </div>
                {editable ? (
                  <form
                    method="post"
                    action={`/api/availability/${therapist.id}/exceptions/remove`}
                  >
                    <input type="hidden" name="csrfToken" value={csrfToken} />
                    <input type="hidden" name="exceptionId" value={exception.id} />
                    <SubmitButton tone="danger">{COPY.availabilityRemoveException}</SubmitButton>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </PageShell>
  );
}

function ReadOnlyWeek({ windows }: { windows: TherapistAvailability[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {WEEKDAYS_FA.map((day, weekday) => {
        const dayWindows = windows.filter((window) => window.weekday === weekday);
        return (
          <section key={day} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <h3 className="font-bold text-slate-950">{day}</h3>
            {dayWindows.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">{COPY.availabilityDayOff}</p>
            ) : (
              <ul className="mt-2 flex list-none flex-wrap gap-2 p-0">
                {dayWindows.map((window) => (
                  <li
                    key={window.id}
                    dir="ltr"
                    className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm font-bold tabular-nums text-brand-950"
                  >
                    {window.startTime} – {window.endTime}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function ResolvedDay({ availability }: { availability: ResolvedAvailability }) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        availability.isClosed ? 'border-red-200 bg-red-50/70' : 'border-brand-200 bg-brand-50/70'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-bold text-slate-950">{formatJalali(availability.date)}</h3>
        <Badge tone={availability.isClosed ? 'danger' : 'info'}>
          {availability.isClosed ? COPY.availabilityResolvedClosed : COPY.availabilityResolvedOpen}
        </Badge>
      </div>
      {availability.closedReason !== null ? (
        <p className="mt-1 text-sm text-red-900">{availability.closedReason}</p>
      ) : null}
      {availability.windows.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">{COPY.availabilityResolvedEmpty}</p>
      ) : (
        <ul className="mt-3 flex list-none flex-wrap gap-2 p-0">
          {availability.windows.map((window) => (
            <li
              key={`${window.startTime}-${window.endTime}`}
              dir="ltr"
              className="rounded-lg bg-white px-3 py-1.5 text-sm font-bold tabular-nums text-slate-900 shadow-xs"
            >
              {window.startTime} – {window.endTime}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ExceptionForm({
  kind,
  therapistId,
  csrfToken,
  defaultDate,
}: {
  kind: 'closed' | 'extra';
  therapistId: string;
  csrfToken: string;
  defaultDate?: JalaliParts;
}) {
  const isExtra = kind === 'extra';
  return (
    <form
      method="post"
      action={`/api/availability/${therapistId}/exceptions`}
      className={`flex flex-col gap-4 rounded-xl border p-4 ${
        isExtra ? 'border-emerald-200 bg-emerald-50/50' : 'border-red-200 bg-red-50/50'
      }`}
    >
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <input type="hidden" name="kind" value={kind} />
      <div>
        <h3 className="font-bold text-slate-950">
          {isExtra ? COPY.availabilityExtraTitle : COPY.availabilityClosedTitle}
        </h3>
        <p className="text-xs text-slate-600">
          {isExtra ? COPY.availabilityExtraHelp : COPY.availabilityClosedHelp}
        </p>
      </div>
      <JalaliDateField
        legend={COPY.availabilityDateLabel}
        help={COPY.availabilityDateHelp}
        namePrefix={kind}
        value={defaultDate}
        required
      />
      {isExtra ? (
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm font-semibold text-slate-900">
            {COPY.availabilityStartTime}
            <input name="startTime" type="time" step="60" required className={CONTROL_CLASS} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-slate-900">
            {COPY.availabilityEndTime}
            <input name="endTime" type="time" step="60" required className={CONTROL_CLASS} />
          </label>
        </div>
      ) : null}
      <label className="flex flex-col gap-1 text-sm font-semibold text-slate-900">
        {COPY.availabilityReasonLabel}
        <input
          name="reason"
          type="text"
          maxLength={500}
          aria-describedby={`${kind}-reason-help`}
          className={CONTROL_CLASS}
        />
        <span id={`${kind}-reason-help`} className="text-xs font-normal text-slate-600">
          {COPY.availabilityReasonHelp}
        </span>
      </label>
      <div>
        <SubmitButton>
          {isExtra ? COPY.availabilityAddExtra : COPY.availabilityAddClosed}
        </SubmitButton>
      </div>
    </form>
  );
}

function formatJalali(isoDate: string): string {
  const parts = isoDateToJalali(isoDate);
  if (parts === null) return isoDate;
  const month = JALALI_MONTHS[parts.month - 1] ?? String(parts.month);
  return `${toPersianDigits(String(parts.day))} ${month} ${toPersianDigits(String(parts.year))}`;
}
