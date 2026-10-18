import 'server-only';
import {
  appointmentConflictDetailsSchema,
  availabilityRefusalDetailsSchema,
} from '@clinic/contracts';
import { appointmentTimeLabel } from './appointment-presentation';
import { formatScheduleTime } from './presentation';
import { persianMessage } from '@/server/errors-fa';

export function schedulingRefusalMessage(
  code: string,
  details: unknown,
  names: {
    children?: Record<string, string>;
    therapists?: Record<string, string>;
    rooms?: Record<string, string>;
  } = {},
): string {
  if (
    [
      'APPOINTMENT_CHILD_CONFLICT',
      'APPOINTMENT_THERAPIST_CONFLICT',
      'APPOINTMENT_ROOM_CONFLICT',
    ].includes(code)
  ) {
    const parsed = appointmentConflictDetailsSchema.safeParse(details);
    if (parsed.success)
      return parsed.data.conflicts
        .map((item) => {
          const label =
            item.resource === 'CHILD'
              ? (names.children?.[item.resourceId] ?? 'کودک')
              : item.resource === 'THERAPIST'
                ? (names.therapists?.[item.resourceId] ?? 'درمانگر')
                : (names.rooms?.[item.resourceId] ?? 'اتاق');
          return `${label} از ${appointmentTimeLabel(item.startsAt)} تا ${appointmentTimeLabel(item.endsAt)} جلسهٔ دیگری دارد.`;
        })
        .join(' ');
  }
  if (code === 'APPOINTMENT_OUTSIDE_AVAILABILITY') {
    const parsed = availabilityRefusalDetailsSchema.safeParse(details);
    if (parsed.success) {
      const data = parsed.data;
      const hours = data.availableWindows.length
        ? `ساعت حضور درمانگر در این روز: ${data.availableWindows.map((item) => `${formatScheduleTime(item.startTime)} تا ${formatScheduleTime(item.endTime)}`).join('، ')}.`
        : 'برای درمانگر در این روز ساعت حضوری ثبت نشده است.';
      const reason =
        data.reason === 'CLOSED_DAY'
          ? 'این روز برای درمانگر بسته است.'
          : data.reason === 'PARTIAL_CLOSURE'
            ? `بخشی از روز بسته است: ${data.closedRanges.map((item) => `${formatScheduleTime(item.startTime)} تا ${formatScheduleTime(item.endTime)}`).join('، ')}.`
            : 'زمان جلسه بیرون از ساعت حضور هفتگی درمانگر است.';
      const next = data.overridable
        ? 'اگر درمانگر پذیرفته است، دلیل را در بخش «دلیل ثبت خارج از برنامهٔ حضور» بنویسید و دوباره ثبت کنید.'
        : 'برای ثبت استثنا، همکاری با مجوز ثبت خارج از برنامهٔ حضور باید اقدام کند.';
      return `${reason} ${hours} ${next}`;
    }
  }
  return persianMessage(code as Parameters<typeof persianMessage>[0]);
}

export function readRefusalDetails(raw: string | string[] | undefined): unknown {
  if (typeof raw !== 'string' || raw.length > 6000) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
