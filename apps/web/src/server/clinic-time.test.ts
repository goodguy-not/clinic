import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLINIC_TIME_ZONE, clinicToday } from './clinic-time';

/**
 * The clinic business date.
 *
 * Tehran is UTC+03:30 with no DST, so its calendar date rolls over at 20:30
 * UTC. Every case below is anchored on that boundary: an implementation reading
 * UTC or process-local components gives a different answer for three and a half
 * hours of every day, and those are exactly the hours a receptionist finishing
 * an evening shift would be looking at the screen.
 */

const MODULE_PATH = join(__dirname, 'clinic-time.ts');

/**
 * Runs the real module in a child process under an explicit timezone.
 *
 * The only honest way to prove the result does not depend on the process
 * timezone is to change it. Vitest does not pick up a `process.env.TZ` change
 * mid-run, so the child sets its own before touching a date. Node 24 strips the
 * types natively; this module deliberately contains nothing that needs more.
 */
function clinicTodayUnderTimeZone(processTimeZone: string, instant: string): string {
  const script = `
    process.env.TZ = ${JSON.stringify(processTimeZone)};
    const { clinicToday } = require(${JSON.stringify(MODULE_PATH)});
    process.stdout.write(clinicToday(new Date(${JSON.stringify(instant)})));
  `;

  return execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' });
}

describe('clinicToday', () => {
  it('names the approved clinic timezone', () => {
    expect(CLINIC_TIME_ZONE).toBe('Asia/Tehran');
  });

  it('differs from UTC when Tehran has already turned the page', () => {
    // 21:00 UTC is 00:30 the next day in Tehran.
    const instant = new Date('2026-08-05T21:00:00.000Z');

    expect(clinicToday(instant)).toBe('2026-08-06');
    // The old UTC-based answer, kept explicit so the difference is the point of
    // the test rather than an incidental detail.
    expect(instant.toISOString().slice(0, 10)).toBe('2026-08-05');
  });

  it.each([
    ['one minute before Tehran midnight', '2026-08-05T20:29:00.000Z', '2026-08-05'],
    ['exactly at Tehran midnight', '2026-08-05T20:30:00.000Z', '2026-08-06'],
    ['one minute after Tehran midnight', '2026-08-05T20:31:00.000Z', '2026-08-06'],
  ])('resolves %s', (_label, instant, expected) => {
    expect(clinicToday(new Date(instant))).toBe(expected);
  });

  it.each([
    ['a year boundary', '2026-12-31T20:30:00.000Z', '2027-01-01'],
    ['a Gregorian leap day', '2028-02-28T20:30:00.000Z', '2028-02-29'],
    ['midday, where every timezone agrees', '2026-08-05T09:00:00.000Z', '2026-08-05'],
  ])('handles %s', (_label, instant, expected) => {
    expect(clinicToday(new Date(instant))).toBe(expected);
  });

  it('gives the same clinic date whatever timezone the process runs in', () => {
    // 21:00 UTC: already the 6th in Tehran, still the 5th in UTC, and still the
    // 5th in New York. Only the clinic's answer is correct here.
    const instant = '2026-08-05T21:00:00.000Z';

    for (const processTimeZone of ['UTC', 'America/New_York', 'Asia/Tokyo', 'Asia/Tehran']) {
      expect(clinicTodayUnderTimeZone(processTimeZone, instant)).toBe('2026-08-06');
    }
  }, 30000);

  it('returns a value the date-only comparison can use directly', () => {
    expect(clinicToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
