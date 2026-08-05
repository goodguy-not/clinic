import 'server-only';
import { toGregorian, toJalaali, isValidJalaaliDate, jalaaliMonthLength } from 'jalaali-js';

/**
 * Jalali dates for the interface, Gregorian ISO strings for everything else.
 *
 * The clinic reads and writes Jalali; PostgreSQL stores `DATE` and the shared
 * contracts carry `YYYY-MM-DD`. Conversion happens here, at the web tier's own
 * edge, so nothing downstream ever sees a Jalali value and nothing upstream
 * ever sees a Gregorian one in the interface.
 *
 * The arithmetic comes from `jalaali-js` rather than being hand-written. The
 * Jalali leap rule is a 33-year cycle with irregular placement, and a wrong day
 * here is a wrong effective date, which is a wrong price — a bad thing to get
 * subtly wrong in code nobody re-reads.
 *
 * Everything is built from explicit numeric components. No `Date` is
 * constructed from a string and no local getter is used, so the process
 * timezone cannot shift a calendar day.
 */

export type JalaliParts = { year: number; month: number; day: number };

/** The narrow window a tariff can plausibly be dated in; also bounds the year select. */
export const JALALI_MIN_YEAR = 1390;
export const JALALI_MAX_YEAR = 1460;

export const JALALI_MONTHS = [
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
] as const;

/**
 * Converts Jalali components to a Gregorian `YYYY-MM-DD` string.
 *
 * Returns `null` rather than throwing for anything that is not a real Jalali
 * date — 31 Esfand in a common year being the case that matters — so a Route
 * Handler can turn it into an ordinary validation failure.
 */
export function jalaliToIsoDate(parts: JalaliParts): string | null {
  const { year, month, day } = parts;

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < JALALI_MIN_YEAR || year > JALALI_MAX_YEAR) return null;
  if (!isValidJalaaliDate(year, month, day)) return null;

  const gregorian = toGregorian(year, month, day);

  return [
    String(gregorian.gy).padStart(4, '0'),
    String(gregorian.gm).padStart(2, '0'),
    String(gregorian.gd).padStart(2, '0'),
  ].join('-');
}

/**
 * Converts a Gregorian `YYYY-MM-DD` string to Jalali components.
 *
 * Parsed from the string's own digits, never through `new Date(value)`, which
 * would introduce an instant and with it a timezone.
 */
export function isoDateToJalali(value: string): JalaliParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return null;

  const [, year, month, day] = match as unknown as [string, string, string, string];
  const jalali = toJalaali(Number(year), Number(month), Number(day));

  return { year: jalali.jy, month: jalali.jm, day: jalali.jd };
}

/** Days in a Jalali month, so a day select can offer 30 where 31 is impossible. */
export function jalaliMonthLength(year: number, month: number): number {
  return jalaaliMonthLength(year, month);
}
