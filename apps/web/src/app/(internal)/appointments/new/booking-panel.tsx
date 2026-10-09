import type { Room, Service, Therapist } from '@clinic/contracts';
import {
  Alert,
  Badge,
  ChoiceGroup,
  ChoiceOption,
  Field,
  FormActions,
  Panel,
} from '@/components/ui';
import { CONTROL_CLASS } from '@/components/styles';
import { TimeInput } from '@/components/time-input';
import { persianMessage } from '@/server/errors-fa';
import { toPersianDigits } from '@/server/numerals-fa';
import { appointmentTimeLabel } from '@/scheduling/appointment-presentation';
import { formatScheduleDate } from '@/scheduling/presentation';
import type { BookingState } from './booking-state';

const MONTHS = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
];

function DateFields({
  prefix,
  label,
  intent,
  required = true,
}: {
  prefix: string;
  label: string;
  intent: Record<string, string>;
  required?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2 border-0 p-0">
      <legend className="text-sm font-semibold text-slate-900">
        {label}
        {required ? <span className="ms-1 text-red-700">*</span> : null}
      </legend>
      <div className="grid grid-cols-3 gap-2">
        <label className="text-xs text-slate-600">
          سال
          <select
            name={`${prefix}-year`}
            required={required}
            defaultValue={intent[`${prefix}-year`] ?? ''}
            className={CONTROL_CLASS}
          >
            <option value="">—</option>
            {Array.from({ length: 21 }, (_, index) => 1400 + index).map((year) => (
              <option key={year} value={year}>
                {toPersianDigits(String(year))}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-600">
          ماه
          <select
            name={`${prefix}-month`}
            required={required}
            defaultValue={intent[`${prefix}-month`] ?? ''}
            className={CONTROL_CLASS}
          >
            <option value="">—</option>
            {MONTHS.map((month, index) => (
              <option key={month} value={index + 1}>
                {month}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-600">
          روز
          <select
            name={`${prefix}-day`}
            required={required}
            defaultValue={intent[`${prefix}-day`] ?? ''}
            className={CONTROL_CLASS}
          >
            <option value="">—</option>
            {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
              <option key={day} value={day}>
                {toPersianDigits(String(day))}
              </option>
            ))}
          </select>
        </label>
      </div>
    </fieldset>
  );
}

function ChildPicker({ state, pending }: { state: BookingState; pending: boolean }) {
  const selected = state.intent['childId'];
  return (
    <Panel title="۱. کودک و خانواده">
      <Field
        id="family-search"
        label="جست‌وجوی خصوصی خانواده یا کودک"
        help="نام، شماره پرونده یا تلفن فقط در بدنهٔ امن درخواست ارسال می‌شود و در نشانی صفحه ذخیره نمی‌شود."
      >
        {({ id, className, describedBy }) => (
          <input
            id={id}
            name="familySearch"
            type="search"
            minLength={2}
            maxLength={60}
            defaultValue={state.intent['familySearch'] ?? ''}
            aria-describedby={describedBy}
            className={className}
          />
        )}
      </Field>
      <div>
        <button
          type="submit"
          name="action"
          value="search"
          formNoValidate
          disabled={pending}
          className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
        >
          جست‌وجوی کودک
        </button>
      </div>
      {state.families.length === 0 ? (
        <p className="text-sm text-slate-600">
          برای انتخاب کودک، نام یا شماره پرونده را جست‌وجو کنید.
        </p>
      ) : (
        <div className="flex flex-col gap-3" role="radiogroup" aria-label="انتخاب کودک">
          {state.families.map((family) => (
            <section key={family.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h3 className="font-bold text-slate-950">{family.familyName}</h3>
                {family.primaryGuardian ? (
                  <span className="text-xs text-slate-600">
                    سرپرست: {family.primaryGuardian.fullName}
                  </span>
                ) : null}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {family.children
                  .filter((child) => child.status === 'ACTIVE')
                  .map((child) => (
                    <ChoiceOption
                      key={child.id}
                      id={`child-${child.id}`}
                      name="childId"
                      value={child.id}
                      label={`${child.firstName} ${child.lastName}`}
                      description={`پرونده ${toPersianDigits(child.fileNumber)}`}
                      defaultChecked={selected === child.id}
                    />
                  ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {state.searchTruncated ? (
        <p className="text-sm font-medium text-amber-800">
          نتیجه‌ها کامل نیست؛ عبارت دقیق‌تری وارد کنید.
        </p>
      ) : null}
    </Panel>
  );
}

function Preview({ state }: { state: BookingState }) {
  const preview = state.preview;
  if (preview === null) return null;
  return (
    <Panel title="۳. پیش‌نمایش تکرار هفتگی">
      <div
        className={`rounded-lg border px-4 py-3 text-sm ${preview.bookable ? 'border-emerald-300 bg-emerald-50 text-emerald-950' : 'border-red-300 bg-red-50 text-red-950'}`}
      >
        {preview.bookable
          ? `هر ${toPersianDigits(String(preview.pattern.intervalWeeks))} هفته، ${toPersianDigits(String(preview.occurrences.length))} جلسه آمادهٔ ثبت است.`
          : `${toPersianDigits(String(preview.blockedCount))} جلسه مانع قطعی یا نیاز به مجوز حضور دارد.`}
      </div>
      <p className="text-sm text-slate-600">
        پیش‌نمایش زمانی را رزرو نمی‌کند. ثبت نهایی همهٔ جلسات را دوباره بررسی می‌کند و مجموعه فقط
        به‌صورت کامل ساخته می‌شود.
      </p>
      <ol className="grid list-none gap-2 p-0 sm:grid-cols-2">
        {preview.occurrences.map((occurrence) => {
          const date = formatScheduleDate(occurrence.date);
          const tone = occurrence.blockedBy
            ? 'danger'
            : occurrence.outsideAvailability
              ? 'warning'
              : 'success';
          const label = occurrence.blockedBy
            ? persianMessage(occurrence.blockedBy)
            : occurrence.outsideAvailability
              ? 'خارج از برنامهٔ حضور؛ با دلیل مجاز'
              : 'آمادهٔ ثبت';
          return (
            <li key={occurrence.index} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <strong>{date?.full ?? occurrence.date}</strong>
                  <p dir="ltr" className="mt-1 text-sm tabular-nums text-slate-600">
                    {appointmentTimeLabel(occurrence.startsAt)} –{' '}
                    {appointmentTimeLabel(occurrence.endsAt)}
                  </p>
                </div>
                <Badge tone={tone}>{label}</Badge>
              </div>
            </li>
          );
        })}
      </ol>
      {preview.bookable ? (
        <FormActions>
          <button
            type="submit"
            name="action"
            value="create-series"
            className="min-h-11 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          >
            ثبت نهایی همهٔ جلسات
          </button>
        </FormActions>
      ) : (
        <p className="text-sm font-semibold text-red-800">
          هیچ جلسه‌ای حذف نمی‌شود. مانع‌ها را برطرف کنید و دوباره پیش‌نمایش بگیرید.
        </p>
      )}
    </Panel>
  );
}

export function BookingPanel({
  state,
  services,
  therapists,
  rooms,
  canOverrideAvailability,
  pending,
}: {
  state: BookingState;
  services: Service[];
  therapists: Therapist[];
  rooms: Room[];
  canOverrideAvailability: boolean;
  pending: boolean;
}) {
  const activeServices = services.filter((item) => item.status === 'ACTIVE');
  const activeTherapists = therapists.filter((item) => item.status === 'ACTIVE');
  const activeRooms = rooms.filter((item) => item.status === 'ACTIVE');
  return (
    <>
      {state.errorMessage ? (
        <Alert>
          {state.finalCreateConflict
            ? `در فاصلهٔ پیش‌نمایش تا ثبت، برنامه تغییر کرده است: ${state.errorMessage} اطلاعات شما حفظ شده؛ دوباره پیش‌نمایش بگیرید.`
            : state.errorMessage}
        </Alert>
      ) : null}
      <ChildPicker state={state} pending={pending} />
      <Panel title="۲. زمان و منابع">
        <ChoiceGroup legend="نوع نوبت" help="برای مراجعهٔ دوبار در هفته، دو مجموعهٔ مستقل بسازید.">
          <ChoiceOption
            id="booking-once"
            name="bookingMode"
            value="once"
            label="نوبت یک‌باره"
            defaultChecked={state.intent['bookingMode'] !== 'recurring'}
          />
          <ChoiceOption
            id="booking-recurring"
            name="bookingMode"
            value="recurring"
            label="تکرار هفتگی"
            description="یک روز هفته، حداکثر ۵۲ جلسه و تا ۱۲ ماه"
            defaultChecked={state.intent['bookingMode'] === 'recurring'}
          />
        </ChoiceGroup>
        <Field id="service-duration" label="خدمت و مدت مجاز" required>
          {({ id, className }) => (
            <select
              id={id}
              name="serviceDuration"
              required
              defaultValue={state.intent['serviceDuration'] ?? ''}
              className={className}
            >
              <option value="">انتخاب کنید</option>
              {activeServices.flatMap((service) =>
                service.allowedDurationsMinutes.map((duration) => (
                  <option key={`${service.id}:${duration}`} value={`${service.id}:${duration}`}>
                    {service.name} — {toPersianDigits(String(duration))} دقیقه
                  </option>
                )),
              )}
            </select>
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="therapist" label="درمانگر" required>
            {({ id, className }) => (
              <select
                id={id}
                name="therapistId"
                required
                defaultValue={state.intent['therapistId'] ?? ''}
                className={className}
              >
                <option value="">انتخاب کنید</option>
                {activeTherapists.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.fullName}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field id="room" label="اتاق" required>
            {({ id, className }) => (
              <select
                id={id}
                name="roomId"
                required
                defaultValue={state.intent['roomId'] ?? ''}
                className={className}
              >
                <option value="">انتخاب کنید</option>
                {activeRooms.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <DateFields prefix="date" label="تاریخ اولین جلسه" intent={state.intent} />
          <Field id="start-time" label="ساعت شروع" required>
            {({ id, className }) => (
              <TimeInput
                id={id}
                name="startTime"
                required
                defaultValue={state.intent['startTime'] ?? ''}
                className={className}
              />
            )}
          </Field>
        </div>
        <Field
          id="note"
          label="یادداشت غیرپزشکی"
          help="از ثبت اطلاعات بالینی یا مالی خودداری کنید."
        >
          {({ id, className, describedBy }) => (
            <textarea
              id={id}
              name="note"
              maxLength={2000}
              rows={3}
              defaultValue={state.intent['note'] ?? ''}
              aria-describedby={describedBy}
              className={className}
            />
          )}
        </Field>
        {canOverrideAvailability ? (
          <Field
            id="override-reason"
            label="دلیل ثبت خارج از برنامهٔ حضور"
            help="این مجوز فقط نبودن درمانگر در برنامهٔ حضور را پوشش می‌دهد؛ تداخل کودک، درمانگر یا اتاق هرگز قابل عبور نیست."
          >
            {({ id, className, describedBy }) => (
              <textarea
                id={id}
                name="availabilityOverrideReason"
                maxLength={500}
                rows={2}
                defaultValue={state.intent['availabilityOverrideReason'] ?? ''}
                aria-describedby={describedBy}
                className={className}
              />
            )}
          </Field>
        ) : (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            ثبت خارج از برنامهٔ حضور نیازمند مجوز و دلیل است. تداخل‌های زمانی قابل چشم‌پوشی نیستند.
          </p>
        )}
        <details
          open={state.intent['bookingMode'] === 'recurring'}
          className="rounded-xl border border-brand-200 bg-brand-50/50 p-4"
        >
          <summary className="cursor-pointer font-bold text-brand-950">
            تنظیم پایان تکرار هفتگی
          </summary>
          <div className="mt-4 flex flex-col gap-4">
            <Field id="interval-weeks" label="فاصلهٔ تکرار (هفته)">
              {({ id, className }) => (
                <input
                  id={id}
                  name="intervalWeeks"
                  type="number"
                  min={1}
                  max={12}
                  defaultValue={state.intent['intervalWeeks'] ?? '1'}
                  className={className}
                />
              )}
            </Field>
            <ChoiceGroup legend="پایان مجموعه">
              <ChoiceOption
                id="end-count"
                name="endMode"
                value="OCCURRENCE_COUNT"
                label="با تعداد جلسه"
                defaultChecked={state.intent['endMode'] !== 'END_DATE'}
              />
              <ChoiceOption
                id="end-date"
                name="endMode"
                value="END_DATE"
                label="در تاریخ پایان"
                defaultChecked={state.intent['endMode'] === 'END_DATE'}
              />
            </ChoiceGroup>
            <Field id="occurrence-count" label="تعداد جلسه (حداکثر ۵۲)">
              {({ id, className }) => (
                <input
                  id={id}
                  name="occurrenceCount"
                  type="number"
                  min={1}
                  max={52}
                  defaultValue={state.intent['occurrenceCount'] ?? '8'}
                  className={className}
                />
              )}
            </Field>
            <DateFields
              prefix="endsOn"
              label="تاریخ پایان (فقط در حالت تاریخ پایان)"
              intent={state.intent}
              required={false}
            />
          </div>
        </details>
        <FormActions>
          <button
            type="submit"
            name="action"
            value="submit-booking"
            disabled={pending}
            className="min-h-11 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          >
            {pending ? 'در حال بررسی…' : 'ثبت نوبت یک‌باره / پیش‌نمایش مجموعه'}
          </button>
        </FormActions>
      </Panel>
      <Preview state={state} />
    </>
  );
}
