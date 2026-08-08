import { describe, expect, it } from 'vitest';
import { formatScheduleDate, formatScheduleTime } from './presentation';

describe('schedule presentation formatting', () => {
  it('presents an ISO clinic date as a complete Persian Jalali label', () => {
    expect(formatScheduleDate('2026-08-09')).toEqual({
      weekday: 'یکشنبه',
      day: '۱۸',
      month: 'مرداد',
      year: '۱۴۰۵',
      full: 'یکشنبه ۱۸ مرداد ۱۴۰۵',
    });
  });

  it.each(['2026-02-30', '2026-13-01', 'not-a-date'])('rejects invalid date %s', (value) => {
    expect(formatScheduleDate(value)).toBeNull();
  });

  it('keeps the clock shape stable while localising its digits', () => {
    expect(formatScheduleTime('09:05')).toBe('۰۹:۰۵');
    expect(formatScheduleTime('23:59')).toBe('۲۳:۵۹');
  });

  it.each(['9:05', '24:00', '12:60', 'noon'])('rejects invalid clock time %s', (value) => {
    expect(formatScheduleTime(value)).toBeNull();
  });
});
