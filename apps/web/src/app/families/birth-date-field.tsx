import { JALALI_MAX_YEAR, JALALI_MIN_YEAR, JALALI_MONTHS, type JalaliParts } from '@/server/jalali';
import { toPersianDigits } from '@/server/numerals-fa';
import { COPY } from '@/server/copy-fa';

/**
 * A Jalali birth date as three selects, named `birth-year`/`birth-month`/`birth-day`.
 *
 * Mirrors `tariffs/jalali-date-field.tsx` exactly, kept as its own small
 * component rather than a shared import: the tariff field's prefix is
 * type-locked to `start`/`end`, and widening it there to accommodate a third,
 * unrelated screen was judged riskier than the few duplicated lines here.
 */
export function BirthDateField({ value }: { value?: JalaliParts | null }) {
  const years = Array.from(
    { length: JALALI_MAX_YEAR - JALALI_MIN_YEAR + 1 },
    (_unused, index) => JALALI_MIN_YEAR + index,
  );

  const select =
    'rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white';

  return (
    <fieldset className="flex flex-col gap-2 border-0 p-0">
      <legend className="mb-1 text-sm font-medium text-slate-900">
        {COPY.childBirthDateLabel}
        <span className="ms-1 text-red-700">*</span>
      </legend>

      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          سال
          <select name="birth-year" defaultValue={value?.year ?? ''} className={select}>
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
          <select name="birth-month" defaultValue={value?.month ?? ''} className={select}>
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
          <select name="birth-day" defaultValue={value?.day ?? ''} className={select}>
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
