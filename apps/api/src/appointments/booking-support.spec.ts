import { isWholeMinute, isWithinAvailability, type ClinicSpan } from './booking-support';

/**
 * The two booking decisions that are pure functions.
 *
 * Everything else in the module is a rule PostgreSQL decides — the two overlap
 * constraints, the composite foreign key, the advisory-locked recomputation —
 * and is proved against a real database in `appointments-booking.int-spec.ts`.
 * A mock would only prove that a mock was called.
 */

const span = (overrides: Partial<ClinicSpan> = {}): ClinicSpan => ({
  startDate: '2026-09-05',
  startTime: '10:00',
  endDate: '2026-09-05',
  endTime: '10:45',
  ...overrides,
});

const MORNING = { startTime: '09:00', endTime: '13:00' };
const EVENING = { startTime: '16:00', endTime: '19:00' };

describe('availability containment', () => {
  it('accepts a session wholly inside a window', () => {
    expect(isWithinAvailability(span(), [MORNING])).toBe(true);
  });

  it('accepts a session that exactly fills a window', () => {
    expect(isWithinAvailability(span({ startTime: '09:00', endTime: '13:00' }), [MORNING])).toBe(
      true,
    );
  });

  it('refuses a session that starts inside a window and runs past its end', () => {
    // The rule is "happens while working", not "starts while working". The
    // therapist is not there for the part that overhangs.
    expect(isWithinAvailability(span({ startTime: '12:30', endTime: '13:15' }), [MORNING])).toBe(
      false,
    );
  });

  it('refuses a session that starts before a window opens', () => {
    expect(isWithinAvailability(span({ startTime: '08:30', endTime: '09:15' }), [MORNING])).toBe(
      false,
    );
  });

  it('refuses a session that spans the gap between two windows', () => {
    // Resolved windows arrive merged, so two that remain separate are genuinely
    // separate: the therapist goes home in between.
    expect(
      isWithinAvailability(span({ startTime: '12:30', endTime: '16:30' }), [MORNING, EVENING]),
    ).toBe(false);
  });

  it('accepts a session inside the second of two windows', () => {
    expect(
      isWithinAvailability(span({ startTime: '17:00', endTime: '17:45' }), [MORNING, EVENING]),
    ).toBe(true);
  });

  it('refuses everything on a day with no windows', () => {
    // A therapist who does not work that weekday, and a closed day with no dated
    // window, are the same answer: there is no hour to be inside.
    expect(isWithinAvailability(span(), [])).toBe(false);
  });

  it('refuses a session that crosses midnight, including one ending at 00:00', () => {
    // A working window is a weekday and two wall-clock times; the latest end it
    // can state is 23:59, so no window exists for such a session to be inside.
    // The service refuses such a span as an invalid time before reaching here,
    // which is what keeps it out of the override's reach; this is the second
    // statement of the same fact.
    expect(
      isWithinAvailability(span({ startTime: '23:00', endDate: '2026-09-06', endTime: '00:00' }), [
        { startTime: '00:00', endTime: '23:59' },
      ]),
    ).toBe(false);
  });
});

describe('whole-minute instants', () => {
  it.each(['2026-09-05T06:30:00.000Z', '2026-09-05T06:30:00Z', '2026-09-05T10:00:00+03:30'])(
    'accepts %s',
    (instant: string) => {
      expect(isWholeMinute(instant)).toBe(true);
    },
  );

  it.each(['2026-09-05T06:30:30.000Z', '2026-09-05T06:30:00.500Z'])(
    'refuses %s',
    (instant: string) => {
      expect(isWholeMinute(instant)).toBe(false);
    },
  );

  it('refuses a value that is not an instant at all', () => {
    expect(isWholeMinute('not a time')).toBe(false);
  });
});
