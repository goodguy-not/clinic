import {
  RECURRENCE_HORIZON_MONTHS,
  RECURRENCE_OCCURRENCES_MAX,
  type RecurrenceRule,
} from '@clinic/contracts';

/**
 * The calendar arithmetic of a weekly rule, as a pure function.
 *
 * Kept out of the service for the reason `booking-support.ts` is: which days a
 * pattern lands on is decided by counting weeks, needs no database and is worth
 * testing exhaustively without one.
 *
 * IT WORKS IN CALENDAR DAYS, NEVER IN INSTANTS. A clinic date is a `YYYY-MM-DD`
 * with no zone, adding seven of them is unambiguous, and the weekday is
 * therefore preserved by construction — no leap second, no month length and no
 * timezone rule can move the seventh day after a Saturday off a Saturday. The
 * conversion back to the instant each session starts at is PostgreSQL's
 * `clinic_moment`, where `Asia/Tehran` is written once.
 */

/**
 * The clinic dates a rule generates, starting with the first session's own day.
 *
 * THE FIRST OCCURRENCE IS ALWAYS ONE OF THEM. A count of twelve means twelve
 * sessions including the one the receptionist just placed, not twelve more
 * after it, and an end date is inclusive of a session falling exactly on it.
 *
 * An `END_DATE` earlier than the first session yields an EMPTY list rather than
 * an error: this function answers what the rule generates, and "nothing" is a
 * true answer to that. The service turns it into `RECURRENCE_RULE_INVALID`,
 * because a series with no sessions is not a thing the clinic may create.
 *
 * Generation stops one past `RECURRENCE_OCCURRENCES_MAX` so an end date a
 * century out is bounded work and the service can still see that the limit was
 * exceeded rather than silently receiving a truncated series.
 */
export function occurrenceDates(firstDate: string, rule: RecurrenceRule): string[] {
  const stepDays = rule.intervalWeeks * 7;
  const limit =
    rule.endMode === 'OCCURRENCE_COUNT'
      ? Math.min(rule.occurrenceCount, RECURRENCE_OCCURRENCES_MAX + 1)
      : RECURRENCE_OCCURRENCES_MAX + 1;

  const dates: string[] = [];

  for (let index = 0; index < limit; index += 1) {
    const date = addDays(firstDate, index * stepDays);

    if (rule.endMode === 'END_DATE' && date > rule.endsOn) break;

    dates.push(date);
  }

  return dates;
}

/**
 * Does this rule break either approved bound?
 *
 * TWO BOUNDS, CHECKED TOGETHER BECAUSE A SERIES MUST SATISFY BOTH and neither
 * implies the other: fifty-two fortnightly sessions are inside the count and two
 * years past the horizon, and a session every twelfth week for three years is
 * only thirteen sessions. Checking one would let the other through.
 *
 * ONE PREDICATE RATHER THAN TWO, because the caller has one answer to give. The
 * approved vocabulary has a single code for a rule the clinic will not accept,
 * and "fifty-three is too many" and "March 2028 is too far" are the same refusal
 * to the receptionist: change the bound.
 *
 * MEASURED FROM THE FIRST OCCURRENCE, not from today. A term booked to start
 * next month runs a year from its own first session, and measuring from the
 * moment the form was submitted would quietly shorten it.
 *
 * The dates are compared as strings, which is comparing them as dates: the
 * format is fixed-width and lexicographic order is chronological order.
 */
export function exceedsRecurrenceBounds(firstDate: string, dates: readonly string[]): boolean {
  if (dates.length > RECURRENCE_OCCURRENCES_MAX) return true;

  const last = dates.at(-1);

  return last !== undefined && last > addMonths(firstDate, RECURRENCE_HORIZON_MONTHS);
}

/**
 * `YYYY-MM-DD` plus a whole number of months, clamped to the month's length.
 *
 * Twelve months after the 29th of February is the 28th of the following
 * February, not the 1st of March: `Date.UTC` normalises the overflow forward and
 * would push the horizon a day out, which is the one day of the year the bound
 * would be wrong on. Clamping is done by asking for the target month's own last
 * day and taking the smaller of the two.
 */
function addMonths(date: string, months: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7)) - 1;
  const day = Number(date.slice(8, 10));

  // Day 0 of the month after the target is the target month's last day.
  const lastDayOfTargetMonth = new Date(Date.UTC(year, month + months + 1, 0)).getUTCDate();

  return new Date(Date.UTC(year, month + months, Math.min(day, lastDayOfTargetMonth)))
    .toISOString()
    .slice(0, 10);
}

/**
 * `YYYY-MM-DD` plus a whole number of days.
 *
 * Built on `Date.UTC` so the result never depends on the machine's timezone,
 * and re-formatted from the UTC components for the same reason. Comparing two
 * of these as strings is comparing them as dates: the format is fixed-width and
 * lexicographic order is chronological order, which is what the `END_DATE`
 * bound above relies on.
 */
function addDays(date: string, days: number): string {
  const moved = new Date(
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))),
  );

  moved.setUTCDate(moved.getUTCDate() + days);

  return moved.toISOString().slice(0, 10);
}
