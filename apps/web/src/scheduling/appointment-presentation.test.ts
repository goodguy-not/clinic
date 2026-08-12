import { describe, expect, it } from 'vitest';
import {
  addDaysToIsoDate,
  appointmentInstantInClinic,
  clinicWallTimeToIso,
  clinicWeek,
} from './appointment-presentation';

describe('appointment clinic time conversion', () => {
  it('round-trips the Tehran wall time through the UTC F3 instant', () => {
    const instant = clinicWallTimeToIso('2026-08-13', '09:05');
    expect(instant).toBe('2026-08-13T05:35:00.000Z');
    expect(appointmentInstantInClinic(instant!)).toEqual({ date: '2026-08-13', time: '09:05' });
  });

  it('rejects impossible dates and malformed times instead of normalising them', () => {
    expect(clinicWallTimeToIso('2026-02-30', '09:00')).toBeNull();
    expect(clinicWallTimeToIso('2026-08-13', '9:00')).toBeNull();
  });
});

describe('Saturday-first appointment week', () => {
  it('places any selected day inside a Saturday-to-Friday rail', () => {
    expect(clinicWeek('2026-08-13')).toEqual([
      '2026-08-08',
      '2026-08-09',
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
      '2026-08-13',
      '2026-08-14',
    ]);
    expect(addDaysToIsoDate('2026-08-13', 7)).toBe('2026-08-20');
  });
});
