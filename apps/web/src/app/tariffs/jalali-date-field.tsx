import { JALALI_MAX_YEAR, JALALI_MIN_YEAR, JALALI_MONTHS, type JalaliParts } from '@/server/jalali';
import { toPersianDigits } from '@/server/numerals-fa';

/**
 * A Jalali date as three selects.
 *
 * Not `<input type="date">`: that control is Gregorian in every browser, and
 * labelling it as Jalali would show the clinic one calendar while submitting
 * another. Three selects show real Jalali values, need no client JavaScript,
 * and are reachable with a keyboard alone.
 *
 * The day list is a fixed 1–31. Trimming it to the selected month would need
 * JavaScript to react to the month select, and an unreachable option is a worse
 * failure than an impossible combination the server rejects with a clear
 * message — the conversion refuses 31 Esfand rather than rolling it forward.
 *
 * Rendered as a `fieldset` so a screen reader announces "start of validity"
 * with each part rather than three unexplained dropdowns.
 */
export function JalaliDateField({
  legend,
  help,
  namePrefix,
  value,
  required = false,
}: {
  legend: string;
  help?: string;
  namePrefix: 'start' | 'end';
  value?: JalaliParts | null;
  required?: boolean;
}) {
  const helpId = `${namePrefix}-date-help`;
  const years = Array.from(
    { length: JALALI_MAX_YEAR - JALALI_MIN_YEAR + 1 },
    (_unused, index) => JALALI_MIN_YEAR + index,
  );

  const select =
    'rounded-md border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white';

  return (
    <fieldset className="flex flex-col gap-2 border-0 p-0">
      <legend className="mb-1 text-sm font-medium text-slate-900">
        {legend}
        {required ? <span className="ms-1 text-red-700">*</span> : null}
      </legend>
      {help !== undefined ? (
        <p id={helpId} className="mb-1 text-xs text-slate-600">
          {help}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          سال
          <select
            name={`${namePrefix}-year`}
            defaultValue={value?.year ?? ''}
            aria-describedby={help === undefined ? undefined : helpId}
            className={select}
          >
            <option value="">—</option>
            {years.map((year) => (
              <option key={year} value={year}>
                {toPersianDigits(String(year))}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-slate-600">
          ماه
          <select name={`${namePrefix}-month`} defaultValue={value?.month ?? ''} className={select}>
            <option value="">—</option>
            {JALALI_MONTHS.map((month, index) => (
              <option key={month} value={index + 1}>
                {month}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-slate-600">
          روز
          <select name={`${namePrefix}-day`} defaultValue={value?.day ?? ''} className={select}>
            <option value="">—</option>
            {Array.from({ length: 31 }, (_unused, index) => index + 1).map((day) => (
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
