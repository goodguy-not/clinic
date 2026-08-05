import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { parseIsoDate, toIsoDate } from './iso-date';

/**
 * The timezone regression is the whole point of this suite.
 *
 * A `DATE` has no offset, but the `Date` object Prisma returns for one does, so
 * an implementation reading local components passes every assertion in a UTC CI
 * container and returns the wrong day on a developer machine — or the reverse.
 * Testing that honestly requires actually running under another timezone.
 *
 * Jest's environment does not pick up a `process.env.TZ` change mid-run (a plain
 * Node process does), so these cases run in a child process that sets its own
 * timezone before touching a date. Each one asserts the *local* day it observed
 * as well as the formatted output: without that, a zone that failed to apply
 * would let the case pass while exercising nothing.
 *
 * The child requires the TypeScript module directly, which Node 24 strips types
 * from natively. This file deliberately contains no syntax that needs more than
 * that — no enums, no namespaces, no decorators.
 */
const MODULE_PATH = join(__dirname, 'iso-date.ts');

/** UTC-04:00 in August: midnight UTC is still the previous day locally. */
const WEST_OF_UTC = 'America/New_York';
/** UTC+03:30 year round — Iran has had no DST since 2022: a late UTC evening is already tomorrow. */
const EAST_OF_UTC = 'Asia/Tehran';

type ChildObservation = { localDay: number; formatted: string };

function observeInTimeZone(timeZone: string, instant: string): ChildObservation {
  const script = `
    process.env.TZ = ${JSON.stringify(timeZone)};
    const { toIsoDate } = require(${JSON.stringify(MODULE_PATH)});
    const value = new Date(${JSON.stringify(instant)});
    process.stdout.write(JSON.stringify({ localDay: value.getDate(), formatted: toIsoDate(value) }));
  `;

  const output = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' });

  return JSON.parse(output) as ChildObservation;
}

describe('iso-date', () => {
  describe('timezone regression', () => {
    it('formats the UTC day west of UTC, where the local day is still the day before', () => {
      const observed = observeInTimeZone(WEST_OF_UTC, '2026-08-05T00:30:00.000Z');

      // Guard: proves the child really ran west of UTC, so the assertion below
      // is not passing by accident in a UTC container.
      expect(observed.localDay).toBe(4);
      expect(observed.formatted).toBe('2026-08-05');
    }, 30000);

    it('formats the UTC day east of UTC, where the local day is already tomorrow', () => {
      const observed = observeInTimeZone(EAST_OF_UTC, '2026-08-05T23:30:00.000Z');

      expect(observed.localDay).toBe(6);
      expect(observed.formatted).toBe('2026-08-05');
    }, 30000);

    it('keeps a new year boundary on the correct side in both hemispheres', () => {
      // 1 January midnight UTC is 31 December locally in New York.
      expect(observeInTimeZone(WEST_OF_UTC, '2026-01-01T00:00:00.000Z')).toEqual({
        localDay: 31,
        formatted: '2026-01-01',
      });

      // 31 December late UTC is already 1 January in Tehran.
      expect(observeInTimeZone(EAST_OF_UTC, '2026-12-31T21:00:00.000Z')).toEqual({
        localDay: 1,
        formatted: '2026-12-31',
      });
    }, 30000);
  });

  describe('toIsoDate', () => {
    it.each([
      ['2026-08-05T00:00:00.000Z', '2026-08-05'],
      ['2026-01-01T00:00:00.000Z', '2026-01-01'],
      ['2026-12-31T00:00:00.000Z', '2026-12-31'],
      ['2028-02-29T00:00:00.000Z', '2028-02-29'],
      ['2026-03-01T00:00:00.000Z', '2026-03-01'],
    ])('formats %s as %s', (instant, expected) => {
      expect(toIsoDate(new Date(instant))).toBe(expected);
    });

    it('pads a year below four digits rather than truncating it', () => {
      const early = new Date(Date.UTC(2000, 0, 1));
      early.setUTCFullYear(76);
      expect(toIsoDate(early)).toBe('0076-01-01');
    });

    it('refuses an invalid Date instead of returning NaN-NaN-NaN', () => {
      expect(() => toIsoDate(new Date('nonsense'))).toThrow(RangeError);
    });
  });

  describe('parseIsoDate', () => {
    it('parses to midnight UTC, never to a local midnight', () => {
      expect(parseIsoDate('2026-08-05').toISOString()).toBe('2026-08-05T00:00:00.000Z');
    });

    it.each(['2026-01-01', '2026-12-31', '2028-02-29', '2026-08-05'])('round-trips %s', (value) => {
      expect(toIsoDate(parseIsoDate(value))).toBe(value);
    });

    it.each(['2026-02-30', '2027-02-29', '2026-13-01', '2026-00-10', '2026-01-32'])(
      'refuses %s rather than rolling it forward',
      (value) => {
        expect(() => parseIsoDate(value)).toThrow(RangeError);
      },
    );

    it.each(['2026-8-5', '05-08-2026', '2026-08-05T00:00:00Z', '', 'today'])(
      'refuses the non-canonical spelling %s',
      (value) => {
        expect(() => parseIsoDate(value)).toThrow(RangeError);
      },
    );
  });
});
