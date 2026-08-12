import { describe, expect, it } from 'vitest';
import { WEEKDAYS_FA, windowsOverlap } from './availability-presentation';

describe('availability presentation rules', () => {
  it('keeps the accepted Saturday-first weekday convention', () => {
    expect(WEEKDAYS_FA[0]).toBe('شنبه');
    expect(WEEKDAYS_FA[6]).toBe('جمعه');
  });

  it('flags only true same-day overlap and allows touching windows', () => {
    const morning = { weekday: 0, startTime: '09:00', endTime: '12:00' };
    expect(windowsOverlap(morning, { weekday: 0, startTime: '11:30', endTime: '13:00' })).toBe(
      true,
    );
    expect(windowsOverlap(morning, { weekday: 0, startTime: '12:00', endTime: '14:00' })).toBe(
      false,
    );
    expect(windowsOverlap(morning, { weekday: 1, startTime: '10:00', endTime: '11:00' })).toBe(
      false,
    );
  });
});
