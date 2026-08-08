import { toPersianDigits } from '@/server/numerals-fa';

/**
 * Display-only date and time helpers for scheduling surfaces.
 *
 * Scheduling APIs will continue to exchange Gregorian ISO dates and ASCII
 * times. These helpers deliberately know nothing about appointments or their
 * eventual contracts: they only turn those stable primitives into Persian
 * labels for the interface.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK_TIME = /^(\d{2}):(\d{2})$/;

const PERSIAN_DATE_PARTS = new Intl.DateTimeFormat('fa-IR-u-ca-persian-nu-arabext', {
  calendar: 'persian',
  timeZone: 'Asia/Tehran',
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

export type ScheduleDateLabel = {
  weekday: string;
  day: string;
  month: string;
  year: string;
  full: string;
};

/**
 * Formats a plain Gregorian date as Jalali without allowing the process
 * timezone to move it to an adjacent day.
 */
export function formatScheduleDate(isoDate: string): ScheduleDateLabel | null {
  const match = ISO_DATE.exec(isoDate);
  if (match === null) return null;

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day, 12));

  // Date.UTC normalises impossible inputs, so round-trip the parts before
  // presenting them. A malformed API/query value must not become another day.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  const parts = PERSIAN_DATE_PARTS.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';

  const weekday = read('weekday');
  const jalaliDay = read('day');
  const jalaliMonth = read('month');
  const jalaliYear = read('year');

  if (weekday === '' || jalaliDay === '' || jalaliMonth === '' || jalaliYear === '') return null;

  return {
    weekday,
    day: jalaliDay,
    month: jalaliMonth,
    year: jalaliYear,
    full: `${weekday} ${jalaliDay} ${jalaliMonth} ${jalaliYear}`,
  };
}

/** Turns a valid 24-hour ASCII time into the short Persian display label. */
export function formatScheduleTime(time: string): string | null {
  const match = CLOCK_TIME.exec(time);
  if (match === null) return null;

  const [, hourText, minuteText] = match;
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (hour > 23 || minute > 59) return null;

  return toPersianDigits(`${hourText}:${minuteText}`);
}
