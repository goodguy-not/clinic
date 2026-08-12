import 'server-only';
import type {
  AvailabilityWindowInput,
  CreateAvailabilityExceptionRequest,
} from '@clinic/contracts';
import type { SubmittedBody } from './handler-support';
import { jalaliToIsoDate } from './jalali';
import { toWesternDigits } from './numerals-fa';

type SubmittedLists = Record<string, string[]>;

export function availabilityWindowsFromLists(lists: SubmittedLists): unknown {
  const weekdays = lists['weekday'] ?? [];
  const starts = lists['startTime'] ?? [];
  const ends = lists['endTime'] ?? [];

  if (weekdays.length !== starts.length || starts.length !== ends.length) return null;

  const windows: AvailabilityWindowInput[] = weekdays.map((weekday, index) => ({
    weekday: Number(toWesternDigits(weekday)),
    startTime: starts[index] ?? '',
    endTime: ends[index] ?? '',
  })) as AvailabilityWindowInput[];

  return { windows };
}

export function jalaliDateFromBody(body: SubmittedBody, prefix: string): string | null {
  const year = Number(toWesternDigits(body[`${prefix}-year`] ?? ''));
  const month = Number(toWesternDigits(body[`${prefix}-month`] ?? ''));
  const day = Number(toWesternDigits(body[`${prefix}-day`] ?? ''));

  return jalaliToIsoDate({ year, month, day });
}

export function availabilityExceptionFromBody(
  body: SubmittedBody,
): CreateAvailabilityExceptionRequest | null {
  const kind = body['kind'];
  if (kind !== 'closed' && kind !== 'extra') return null;

  const exceptionDate = jalaliDateFromBody(body, kind);
  if (exceptionDate === null) return null;

  const reason = body['reason']?.trim() || null;

  if (kind === 'closed') return { isAvailable: false, exceptionDate, reason };

  return {
    isAvailable: true,
    exceptionDate,
    startTime: body['startTime'] ?? '',
    endTime: body['endTime'] ?? '',
    reason,
  };
}
