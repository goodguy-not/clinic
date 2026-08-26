import 'server-only';
import { z } from 'zod';
import { addDaysToIsoDate } from '@/scheduling/appointment-presentation';
import { clinicToday } from '@/server/clinic-time';
import { isoDateToJalali } from '@/server/jalali';
import { formatScheduleDate } from '@/scheduling/presentation';

export type SearchParams = Record<string, string | string[] | undefined>;

export function one(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
}

export function defaultRange(params: SearchParams) {
  const today = clinicToday();
  const fallbackFrom = addDaysToIsoDate(today, -29) ?? today;
  const candidateFrom = z.iso.date().safeParse(one(params, 'from'));
  const candidateTo = z.iso.date().safeParse(one(params, 'to'));
  const validRange =
    candidateFrom.success && candidateTo.success && candidateFrom.data <= candidateTo.data;
  const from = validRange ? candidateFrom.data : fallbackFrom;
  const to = validRange ? candidateTo.data : today;
  return { from, to, fromJalali: isoDateToJalali(from)!, toJalali: isoDateToJalali(to)! };
}

export function uuidParam(params: SearchParams, key: string): string | undefined {
  const parsed = z.uuid().safeParse(one(params, key));
  return parsed.success ? parsed.data : undefined;
}

export function intParam(params: SearchParams, key: string, fallback: number): number {
  const value = Number(one(params, key));
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function dateLabel(value: string): string {
  return formatScheduleDate(value)?.full ?? value;
}

export function instantLabel(value: string): string {
  return new Intl.DateTimeFormat('fa-IR-u-ca-persian-nu-persian', {
    timeZone: 'Asia/Tehran',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

/** Export is for the whole validated scope, never only the visible page. */
export function exportFilters(
  query: object,
): Record<string, string | number | boolean | undefined> {
  return Object.fromEntries(
    Object.entries(query)
      .filter(([key]) => key !== 'page' && key !== 'pageSize')
      .map(([key, value]) => [key, typeof value === 'boolean' ? String(value) : value]),
  ) as Record<string, string | number | boolean | undefined>;
}
