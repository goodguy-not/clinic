import 'server-only';
import { clinicWallTimeToIso } from '@/scheduling/appointment-presentation';
import { jalaliToIsoDate } from './jalali';
import { toWesternDigits } from './numerals-fa';
import type { SubmittedBody } from './handler-support';

function nullableTrimmed(value: string | undefined): string | null {
  const canonical = (value ?? '').trim();
  return canonical === '' ? null : canonical;
}

export function appointmentMoveFormToRequest(body: SubmittedBody): Record<string, unknown> {
  const date = jalaliToIsoDate({
    year: Number(toWesternDigits(body['date-year'] ?? '')),
    month: Number(toWesternDigits(body['date-month'] ?? '')),
    day: Number(toWesternDigits(body['date-day'] ?? '')),
  });
  const time = toWesternDigits(body['startTime'] ?? '');

  return {
    durationMinutes: Number(toWesternDigits(body['durationMinutes'] ?? '')),
    therapistId: body['therapistId'] ?? '',
    roomId: body['roomId'] ?? '',
    startsAt: date === null ? null : clinicWallTimeToIso(date, time),
    note: nullableTrimmed(body['note']),
    availabilityOverrideReason: nullableTrimmed(body['availabilityOverrideReason']),
  };
}
