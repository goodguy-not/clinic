import { findOverlappingPair, mergeWindows, type WeeklyWindow } from './window-merge';

/**
 * The resolution arithmetic, tested without a database.
 *
 * These are the two pure decisions in the availability domain: what a day reads
 * as once its windows are combined, and whether a submitted week contradicts
 * itself. Both are string comparisons on `HH:MM` and `YYYY-MM-DD`, which is what
 * keeps them free of timezones.
 */

const window = (startTime: string, endTime: string) => ({ startTime, endTime });

describe('merging a day into one reading', () => {
  it('returns an empty day unchanged', () => {
    expect(mergeWindows([])).toEqual([]);
  });

  it('sorts windows that arrive in any order', () => {
    expect(mergeWindows([window('16:00', '19:00'), window('09:00', '13:00')])).toEqual([
      window('09:00', '13:00'),
      window('16:00', '19:00'),
    ]);
  });

  it('leaves a genuine gap alone, because a gap is a real fact about the day', () => {
    expect(mergeWindows([window('09:00', '13:00'), window('16:00', '19:00')])).toHaveLength(2);
  });

  it('merges overlapping windows', () => {
    expect(mergeWindows([window('09:00', '13:00'), window('12:00', '15:00')])).toEqual([
      window('09:00', '15:00'),
    ]);
  });

  it('merges adjacent windows, so an unbroken stretch is not reported as two', () => {
    // A recurring morning block and an extra afternoon window that starts the
    // minute it ends are one stretch of availability. Two entries would invite a
    // reader to conclude there is a gap at 13:00.
    expect(mergeWindows([window('09:00', '13:00'), window('13:00', '17:00')])).toEqual([
      window('09:00', '17:00'),
    ]);
  });

  it('does not let a contained window shorten the one containing it', () => {
    expect(mergeWindows([window('08:00', '20:00'), window('10:00', '11:00')])).toEqual([
      window('08:00', '20:00'),
    ]);
  });

  it('merges a chain of three', () => {
    expect(
      mergeWindows([window('09:00', '11:00'), window('10:30', '12:00'), window('12:00', '13:00')]),
    ).toEqual([window('09:00', '13:00')]);
  });

  it('does not mutate its input', () => {
    const input = [window('16:00', '19:00'), window('09:00', '13:00')];
    mergeWindows(input);

    expect(input[0]).toEqual(window('16:00', '19:00'));
  });
});

describe('a submitted week that contradicts itself', () => {
  const recurring = (overrides: Partial<WeeklyWindow> = {}): WeeklyWindow => ({
    weekday: 0,
    startTime: '09:00',
    endTime: '13:00',
    ...overrides,
  });

  it('accepts an empty set and a single window', () => {
    expect(findOverlappingPair([])).toBeNull();
    expect(findOverlappingPair([recurring()])).toBeNull();
  });

  it('finds two identical windows', () => {
    expect(findOverlappingPair([recurring(), recurring()])).not.toBeNull();
  });

  it('finds a partial overlap on the same weekday', () => {
    expect(
      findOverlappingPair([recurring(), recurring({ startTime: '12:00', endTime: '15:00' })]),
    ).not.toBeNull();
  });

  it('allows the same hours on a different weekday', () => {
    // Saturday and Sunday mornings are the ordinary shape of a therapist's week.
    expect(findOverlappingPair([recurring({ weekday: 0 }), recurring({ weekday: 1 })])).toBeNull();
  });

  it('allows back-to-back blocks on one day', () => {
    expect(
      findOverlappingPair([recurring(), recurring({ startTime: '13:00', endTime: '17:00' })]),
    ).toBeNull();
  });

  it('compares nothing but the weekday and the hours', () => {
    // A window has no dates to compare. Two windows over the same hours are the
    // same hours, and there is no date on which one of them stops applying —
    // that would be effective-dated availability, which does not exist here.
    expect(Object.keys(recurring()).sort()).toEqual(['endTime', 'startTime', 'weekday']);
  });
});
