import { describe, expect, it } from 'vitest';
import { isoDateToJalali, jalaliMonthLength, jalaliToIsoDate } from './jalali';
import { formatToman, toPersianDigits } from './numerals-fa';

/**
 * Jalali conversion and money formatting.
 *
 * The conversion cases below are fixed, independently checkable anchor dates
 * rather than values produced by the code under test: Nowruz, the last day of a
 * common year, the extra day of a leap year, and the boundaries either side.
 */

describe('jalaliToIsoDate', () => {
  it.each([
    // 1 Farvardin 1405 — Nowruz.
    [{ year: 1405, month: 1, day: 1 }, '2026-03-21'],
    // 29 Esfand 1404, the last day of a common year.
    [{ year: 1404, month: 12, day: 29 }, '2026-03-20'],
    // 30 Esfand 1403, which exists only because 1403 is a leap year.
    [{ year: 1403, month: 12, day: 30 }, '2025-03-20'],
    // A Gregorian leap day, reached from its Jalali side.
    [{ year: 1406, month: 12, day: 10 }, '2028-02-29'],
  ])('converts %o', (parts, expected) => {
    expect(jalaliToIsoDate(parts)).toBe(expected);
  });

  it('refuses 30 Esfand in a common year', () => {
    // 1404 is not a leap year, so this day does not exist. Rolling it forward
    // to 1 Farvardin would silently price a session on the wrong date.
    expect(jalaliToIsoDate({ year: 1404, month: 12, day: 30 })).toBeNull();
    expect(jalaliToIsoDate({ year: 1403, month: 12, day: 30 })).not.toBeNull();
  });

  it.each([
    [{ year: 1405, month: 13, day: 1 }],
    [{ year: 1405, month: 0, day: 1 }],
    [{ year: 1405, month: 1, day: 0 }],
    [{ year: 1405, month: 1, day: 32 }],
    [{ year: 1405, month: 7, day: 31 }],
    [{ year: 1200, month: 1, day: 1 }],
    [{ year: 1405, month: 1.5, day: 1 }],
  ])('refuses the impossible date %o', (parts) => {
    expect(jalaliToIsoDate(parts)).toBeNull();
  });
});

describe('isoDateToJalali', () => {
  it.each([
    ['2026-03-21', { year: 1405, month: 1, day: 1 }],
    ['2026-03-20', { year: 1404, month: 12, day: 29 }],
    ['2025-03-20', { year: 1403, month: 12, day: 30 }],
  ])('converts %s', (value, expected) => {
    expect(isoDateToJalali(value)).toEqual(expected);
  });

  it.each(['2026-3-1', '', 'today', '2026-03-21T00:00:00Z'])('refuses %j', (value) => {
    expect(isoDateToJalali(value)).toBeNull();
  });

  it.each(['2026-03-21', '2028-02-29', '2026-01-01', '2026-12-31'])('round-trips %s', (value) => {
    const jalali = isoDateToJalali(value);
    expect(jalali).not.toBeNull();
    expect(jalaliToIsoDate(jalali!)).toBe(value);
  });
});

describe('jalaliMonthLength', () => {
  it('gives 31 days to the first six months and 30 to the next five', () => {
    for (const month of [1, 2, 3, 4, 5, 6]) expect(jalaliMonthLength(1405, month)).toBe(31);
    for (const month of [7, 8, 9, 10, 11]) expect(jalaliMonthLength(1405, month)).toBe(30);
  });

  it('gives Esfand 30 days only in a leap year', () => {
    expect(jalaliMonthLength(1403, 12)).toBe(30);
    expect(jalaliMonthLength(1404, 12)).toBe(29);
  });
});

describe('money formatting', () => {
  it('renders Persian digits', () => {
    expect(toPersianDigits('1405')).toBe('۱۴۰۵');
  });

  it.each([
    ['0', '۰ تومان'],
    ['120000', '۱۲۰٬۰۰۰ تومان'],
    ['1000', '۱٬۰۰۰ تومان'],
    ['999', '۹۹۹ تومان'],
    ['1000000000', '۱٬۰۰۰٬۰۰۰٬۰۰۰ تومان'],
  ])('formats %s as %s', (amount, expected) => {
    expect(formatToman(amount)).toBe(expected);
  });

  it('formats an amount beyond Number.MAX_SAFE_INTEGER without losing a digit', () => {
    // The reason the API carries money as a string: 9007199254740993 becomes
    // ...992 if it ever passes through a JavaScript number. Formatting reads
    // the digits directly, so the final 3 survives.
    expect(formatToman('9007199254740993')).toBe('۹٬۰۰۷٬۱۹۹٬۲۵۴٬۷۴۰٬۹۹۳ تومان');
  });

  it('returns a non-numeric value unchanged rather than mangling it', () => {
    expect(formatToman('not-a-number')).toBe('not-a-number');
  });
});
