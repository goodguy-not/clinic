import { describe, expect, it } from 'vitest';
import {
  availabilityExceptionFromBody,
  availabilityWindowsFromLists,
  jalaliDateFromBody,
} from './availability-forms';

describe('availability form shaping', () => {
  it('keeps aligned recurring windows in submitted order', () => {
    expect(
      availabilityWindowsFromLists({
        weekday: ['0', '2'],
        startTime: ['09:00', '14:00'],
        endTime: ['12:00', '18:00'],
      }),
    ).toEqual({
      windows: [
        { weekday: 0, startTime: '09:00', endTime: '12:00' },
        { weekday: 2, startTime: '14:00', endTime: '18:00' },
      ],
    });
  });

  it('allows the manager to clear the whole recurring set', () => {
    expect(availabilityWindowsFromLists({})).toEqual({ windows: [] });
  });

  it('refuses misaligned repeated fields instead of pairing the wrong times', () => {
    expect(
      availabilityWindowsFromLists({
        weekday: ['0', '1'],
        startTime: ['09:00'],
        endTime: ['12:00', '13:00'],
      }),
    ).toBeNull();
  });

  it('accepts Persian digits in a Jalali date and converts only at the web edge', () => {
    expect(
      jalaliDateFromBody(
        { 'closed-year': '۱۴۰۵', 'closed-month': '۵', 'closed-day': '۲۲' },
        'closed',
      ),
    ).toBe('2026-08-13');
  });

  it('builds the two accepted exception branches without carrying irrelevant times', () => {
    expect(
      availabilityExceptionFromBody({
        kind: 'closed',
        closureScope: 'whole',
        'closed-year': '1405',
        'closed-month': '5',
        'closed-day': '22',
        reason: ' مرخصی ',
        startTime: '09:00',
        endTime: '10:00',
      }),
    ).toEqual({ isAvailable: false, exceptionDate: '2026-08-13', reason: 'مرخصی' });

    expect(
      availabilityExceptionFromBody({
        kind: 'extra',
        'extra-year': '1405',
        'extra-month': '5',
        'extra-day': '22',
        reason: '',
        startTime: '15:00',
        endTime: '18:00',
      }),
    ).toEqual({
      isAvailable: true,
      exceptionDate: '2026-08-13',
      startTime: '15:00',
      endTime: '18:00',
      reason: null,
    });
  });

  it('sends paired Persian-digit times only for a partial closure', () => {
    expect(
      availabilityExceptionFromBody({
        kind: 'closed',
        closureScope: 'partial',
        'closed-year': '1405',
        'closed-month': '5',
        'closed-day': '22',
        startTime: '۰۹:۰۰',
        endTime: '۱۱:۳۰',
        reason: '',
      }),
    ).toEqual({
      isAvailable: false,
      exceptionDate: '2026-08-13',
      startTime: '09:00',
      endTime: '11:30',
      reason: null,
    });
  });

  it('refuses an impossible Jalali date', () => {
    expect(
      availabilityExceptionFromBody({
        kind: 'closed',
        'closed-year': '1404',
        'closed-month': '12',
        'closed-day': '30',
      }),
    ).toBeNull();
  });
});
