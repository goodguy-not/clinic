import { RECURRENCE_HORIZON_MONTHS, RECURRENCE_OCCURRENCES_MAX } from '@clinic/contracts';
import { exceedsRecurrenceBounds, occurrenceDates } from './recurrence-support';

/**
 * The calendar arithmetic of a weekly rule, tested without a database.
 *
 * 2026-09-05 is a Saturday, which is weekday 0 in the clinic's Saturday-first
 * numbering — the same reference date the booking suites use. Every date here is
 * an ordinary Gregorian day chosen for its weekday and nothing else.
 */
describe('occurrenceDates', () => {
  describe('a count', () => {
    it('includes the first session in the count', () => {
      const dates = occurrenceDates('2026-09-05', {
        endMode: 'OCCURRENCE_COUNT',
        intervalWeeks: 1,
        occurrenceCount: 3,
      });

      expect(dates).toEqual(['2026-09-05', '2026-09-12', '2026-09-19']);
    });

    it('generates a single session for a count of one', () => {
      const dates = occurrenceDates('2026-09-05', {
        endMode: 'OCCURRENCE_COUNT',
        intervalWeeks: 1,
        occurrenceCount: 1,
      });

      expect(dates).toEqual(['2026-09-05']);
    });

    it('steps by the interval, so every second week skips one', () => {
      const dates = occurrenceDates('2026-09-05', {
        endMode: 'OCCURRENCE_COUNT',
        intervalWeeks: 2,
        occurrenceCount: 3,
      });

      expect(dates).toEqual(['2026-09-05', '2026-09-19', '2026-10-03']);
    });
  });

  describe('an end date', () => {
    it('is inclusive of a session falling exactly on it', () => {
      const dates = occurrenceDates('2026-09-05', {
        endMode: 'END_DATE',
        intervalWeeks: 1,
        endsOn: '2026-09-19',
      });

      expect(dates).toEqual(['2026-09-05', '2026-09-12', '2026-09-19']);
    });

    it('stops before a session that would fall past it', () => {
      const dates = occurrenceDates('2026-09-05', {
        endMode: 'END_DATE',
        intervalWeeks: 1,
        endsOn: '2026-09-18',
      });

      expect(dates).toEqual(['2026-09-05', '2026-09-12']);
    });

    it('generates the first session when the bound is the first day itself', () => {
      const dates = occurrenceDates('2026-09-05', {
        endMode: 'END_DATE',
        intervalWeeks: 1,
        endsOn: '2026-09-05',
      });

      expect(dates).toEqual(['2026-09-05']);
    });

    // A rule with no sessions is not an error here: this function answers what
    // the rule generates, and the service refuses the empty answer.
    it('generates nothing when the bound is before the first session', () => {
      const dates = occurrenceDates('2026-09-05', {
        endMode: 'END_DATE',
        intervalWeeks: 1,
        endsOn: '2026-09-04',
      });

      expect(dates).toEqual([]);
    });
  });

  describe('the ceiling', () => {
    it('stops one past the maximum, so the service can see the limit was exceeded', () => {
      const dates = occurrenceDates('2026-09-05', {
        endMode: 'END_DATE',
        intervalWeeks: 1,
        endsOn: '2099-01-01',
      });

      expect(dates).toHaveLength(RECURRENCE_OCCURRENCES_MAX + 1);
    });

    it('generates exactly the maximum when a rule asks for it', () => {
      const dates = occurrenceDates('2026-09-05', {
        endMode: 'OCCURRENCE_COUNT',
        intervalWeeks: 1,
        occurrenceCount: RECURRENCE_OCCURRENCES_MAX,
      });

      expect(dates).toHaveLength(RECURRENCE_OCCURRENCES_MAX);
    });
  });

  describe('the weekday is preserved by construction', () => {
    // Counted in calendar days, so no month length, leap year or timezone rule
    // can move the seventh day after a Saturday off a Saturday.
    it('lands on the same weekday across a month, a year and a leap day', () => {
      const dates = occurrenceDates('2027-12-25', {
        endMode: 'OCCURRENCE_COUNT',
        intervalWeeks: 1,
        occurrenceCount: RECURRENCE_OCCURRENCES_MAX,
      });

      const weekdays = new Set(dates.map((date) => new Date(`${date}T00:00:00Z`).getUTCDay()));

      expect(weekdays.size).toBe(1);
      expect(dates).toContain('2028-02-26');
      expect(dates.at(-1)).toBe('2028-12-16');
    });
  });
});

/**
 * The two approved bounds: at most 52 sessions, and none more than 12 months
 * past the first.
 *
 * Both are pinned as values here, because F4 consumers rely on them and a
 * change to either is a change to what the clinic may book rather than an
 * implementation detail.
 */
describe('exceedsRecurrenceBounds', () => {
  it('states the approved bounds as values', () => {
    expect(RECURRENCE_OCCURRENCES_MAX).toBe(52);
    expect(RECURRENCE_HORIZON_MONTHS).toBe(12);
  });

  const weekly = (count: number) =>
    occurrenceDates('2026-09-05', {
      endMode: 'OCCURRENCE_COUNT',
      intervalWeeks: 1,
      occurrenceCount: count,
    });

  it('accepts a full year of weekly sessions', () => {
    const dates = weekly(RECURRENCE_OCCURRENCES_MAX);

    expect(dates).toHaveLength(52);
    // 51 weeks after 2026-09-05, which is inside a year of it.
    expect(dates.at(-1)).toBe('2027-08-28');
    expect(exceedsRecurrenceBounds('2026-09-05', dates)).toBe(false);
  });

  it('refuses one session past the count', () => {
    expect(exceedsRecurrenceBounds('2026-09-05', weekly(RECURRENCE_OCCURRENCES_MAX + 1))).toBe(
      true,
    );
  });

  /**
   * NEITHER BOUND IMPLIES THE OTHER, which is why both are checked.
   * Twenty-eight fortnightly sessions are well inside the count and run past a
   * year, so a count-only check would let them through.
   */
  it('refuses a rule inside the count that runs past the horizon', () => {
    const fortnightly = occurrenceDates('2026-09-05', {
      endMode: 'OCCURRENCE_COUNT',
      intervalWeeks: 2,
      occurrenceCount: 28,
    });

    expect(fortnightly).toHaveLength(28);
    expect(fortnightly.at(-1)).toBe('2027-09-18');
    expect(exceedsRecurrenceBounds('2026-09-05', fortnightly)).toBe(true);

    // One fortnight earlier lands on 2027-09-04, a day inside the horizon, and
    // is accepted — the bound is a real edge rather than a rounded-off month.
    expect(
      exceedsRecurrenceBounds(
        '2026-09-05',
        occurrenceDates('2026-09-05', {
          endMode: 'OCCURRENCE_COUNT',
          intervalWeeks: 2,
          occurrenceCount: 27,
        }),
      ),
    ).toBe(false);
  });

  it('applies both bounds to an end date as well as to a count', () => {
    const withinBoth = occurrenceDates('2026-09-05', {
      endMode: 'END_DATE',
      intervalWeeks: 4,
      endsOn: '2027-09-05',
    });

    expect(exceedsRecurrenceBounds('2026-09-05', withinBoth)).toBe(false);

    // A session every twelfth week for three years: only fourteen sessions, and
    // two years past the horizon.
    const pastHorizon = occurrenceDates('2026-09-05', {
      endMode: 'END_DATE',
      intervalWeeks: 12,
      endsOn: '2029-09-05',
    });

    expect(pastHorizon.length).toBeLessThan(RECURRENCE_OCCURRENCES_MAX);
    expect(exceedsRecurrenceBounds('2026-09-05', pastHorizon)).toBe(true);

    // A weekly year and a half: inside the horizon test only because the count
    // catches it first.
    const pastCount = occurrenceDates('2026-09-05', {
      endMode: 'END_DATE',
      intervalWeeks: 1,
      endsOn: '2028-03-05',
    });

    expect(exceedsRecurrenceBounds('2026-09-05', pastCount)).toBe(true);
  });

  it('measures the horizon from the first occurrence, not from today', () => {
    // A term that starts next year still gets its own full year.
    const dates = occurrenceDates('2029-01-06', {
      endMode: 'END_DATE',
      intervalWeeks: 1,
      endsOn: '2029-12-29',
    });

    expect(exceedsRecurrenceBounds('2029-01-06', dates)).toBe(false);
  });

  it('lands the horizon on the last day of a shorter month rather than overflowing it', () => {
    // Twelve months after 29 February is 28 February, not 1 March. Without the
    // clamp the bound would be a day too generous on exactly one date a year.
    expect(exceedsRecurrenceBounds('2028-02-29', ['2028-02-29', '2029-02-28'])).toBe(false);
    expect(exceedsRecurrenceBounds('2028-02-29', ['2028-02-29', '2029-03-01'])).toBe(true);
  });

  it('accepts a series of one, and a rule that generated nothing', () => {
    expect(exceedsRecurrenceBounds('2026-09-05', ['2026-09-05'])).toBe(false);
    // An empty rule is refused by the service as an empty series, not here.
    expect(exceedsRecurrenceBounds('2026-09-05', [])).toBe(false);
  });
});
