import type { AppointmentStatus, AppointmentView, AttendanceOutcome } from '@clinic/contracts';
import { CLINIC_TIME_ZONE } from '@/server/clinic-time';
import { formatScheduleDate, formatScheduleTime } from './presentation';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const CLINIC_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: CLINIC_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export const APPOINTMENT_STATUS_PRESENTATION: Record<
  AppointmentStatus,
  {
    label: string;
    tone: 'brand' | 'success' | 'neutral';
    badgeTone: 'info' | 'success' | 'neutral';
  }
> = {
  SCHEDULED: { label: 'برنامه‌ریزی‌شده', tone: 'brand', badgeTone: 'info' },
  COMPLETED: { label: 'انجام‌شده', tone: 'success', badgeTone: 'success' },
  CANCELLED_BY_FAMILY: { label: 'لغو از طرف خانواده', tone: 'neutral', badgeTone: 'neutral' },
  CANCELLED_BY_CLINIC: { label: 'لغو از طرف کلینیک', tone: 'neutral', badgeTone: 'neutral' },
};

export const ATTENDANCE_PRESENTATION: Record<
  AttendanceOutcome,
  { label: string; tone: 'warning' | 'success' | 'danger' }
> = {
  PENDING: { label: 'نتیجه ثبت نشده', tone: 'warning' },
  ATTENDED: { label: 'حاضر', tone: 'success' },
  NO_SHOW: { label: 'عدم حضور', tone: 'danger' },
};

function partsOf(date: Date): Record<string, string> {
  return Object.fromEntries(
    CLINIC_PARTS.formatToParts(date).map((part) => [part.type, part.value]),
  );
}

/** Reads an instant as the clinic's own date and wall-clock time. */
export function appointmentInstantInClinic(value: string): { date: string; time: string } | null {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;

  const parts = partsOf(instant);
  const date = `${parts['year'] ?? ''}-${parts['month'] ?? ''}-${parts['day'] ?? ''}`;
  const time = `${parts['hour'] ?? ''}:${parts['minute'] ?? ''}`;

  return ISO_DATE.test(date) && CLOCK_TIME.test(time) ? { date, time } : null;
}

/**
 * Converts a clinic-local calendar value into the UTC instant required by F3.
 * The offset is derived from Intl for that exact date and verified by a round
 * trip, so this remains correct if the timezone database changes.
 */
export function clinicWallTimeToIso(date: string, time: string): string | null {
  const dateMatch = ISO_DATE.exec(date);
  if (dateMatch === null || !CLOCK_TIME.test(time)) return null;

  const [hourText, minuteText] = time.split(':') as [string, string];
  const desired = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(hourText),
    minute: Number(minuteText),
  };
  const wallAsUtc = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
  );
  const normalised = new Date(wallAsUtc);
  if (
    normalised.getUTCFullYear() !== desired.year ||
    normalised.getUTCMonth() !== desired.month - 1 ||
    normalised.getUTCDate() !== desired.day
  ) {
    return null;
  }

  const firstParts = partsOf(normalised);
  const representedAsUtc = Date.UTC(
    Number(firstParts['year']),
    Number(firstParts['month']) - 1,
    Number(firstParts['day']),
    Number(firstParts['hour']),
    Number(firstParts['minute']),
  );
  const candidate = new Date(wallAsUtc - (representedAsUtc - wallAsUtc));
  const roundTrip = appointmentInstantInClinic(candidate.toISOString());

  return roundTrip?.date === date && roundTrip.time === time ? candidate.toISOString() : null;
}

export function addDaysToIsoDate(date: string, days: number): string | null {
  const match = ISO_DATE.exec(date);
  if (match === null) return null;
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  if (Number.isNaN(value.getTime())) return null;
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Saturday-first seven-day rail containing the selected clinic day. */
export function clinicWeek(date: string): string[] {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return [];
  const daysFromSaturday = (parsed.getUTCDay() + 1) % 7;
  const saturday = addDaysToIsoDate(date, -daysFromSaturday);
  if (saturday === null) return [];

  return Array.from({ length: 7 }, (_unused, index) => addDaysToIsoDate(saturday, index)).filter(
    (value): value is string => value !== null,
  );
}

export function appointmentTimeLabel(value: string): string {
  const clinic = appointmentInstantInClinic(value);
  return clinic === null ? '—' : (formatScheduleTime(clinic.time) ?? clinic.time);
}

export function appointmentDateTimeLabel(value: string): string {
  const clinic = appointmentInstantInClinic(value);
  if (clinic === null) return '—';
  const date = formatScheduleDate(clinic.date);
  const time = formatScheduleTime(clinic.time) ?? clinic.time;
  return date === null ? `${clinic.date}، ساعت ${time}` : `${date.full}، ساعت ${time}`;
}

export function appointmentCardTone(
  view: AppointmentView,
): 'brand' | 'success' | 'neutral' | 'warning' | 'danger' {
  if (view.participants.some(({ participant }) => participant.attendance === 'NO_SHOW')) {
    return 'danger';
  }
  if (view.outcomeUnresolved) return 'warning';
  return APPOINTMENT_STATUS_PRESENTATION[view.appointment.status].tone;
}
