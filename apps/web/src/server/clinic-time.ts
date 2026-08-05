/**
 * The clinic's own calendar date.
 *
 * The clinic is in Iran, so "today" means today in Tehran — not in UTC and not
 * in whatever timezone the server process happens to run under. Those three
 * answers differ for three and a half hours of every day: between 20:30 and
 * midnight local, UTC is still on the previous date. A tariff starting tomorrow
 * would be labelled as already in force, or one that expired today would still
 * read as current.
 *
 * The zone is a constant rather than an environment variable. This is a
 * single-clinic product; a required variable would be one more thing to get
 * wrong in a deployment, and its correct value is already known. Multi-clinic
 * or multi-timezone operation would change that, and is the revisit trigger.
 *
 * WHAT THIS IS NOT FOR: resolving a tariff. That uses the service date the
 * caller supplies, because the price of a session is decided by the day the
 * session happened, not by the day somebody is looking at the screen. This
 * helper exists only to classify a tariff for display as current, future or
 * expired.
 */

/** The approved clinic business timezone. Iran has had no DST since 2022. */
export const CLINIC_TIME_ZONE = 'Asia/Tehran';

/**
 * Built once: constructing a formatter is comparatively expensive, and this is
 * called for every row on the tariff list.
 *
 * `Intl` with an explicit `timeZone` is what makes the result independent of
 * the process timezone. Local getters would answer for wherever the server is,
 * and `getUTC*` would answer for UTC — neither is the clinic.
 */
const CLINIC_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: CLINIC_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Today in the clinic's timezone, as a Gregorian `YYYY-MM-DD` string.
 *
 * Assembled from `formatToParts` rather than from a formatted string, so the
 * result never depends on a locale's ordering or separators.
 */
export function clinicToday(now: Date = new Date()): string {
  const parts = CLINIC_DATE_FORMAT.formatToParts(now);

  const find = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';

  const year = find('year').padStart(4, '0');
  const month = find('month').padStart(2, '0');
  const day = find('day').padStart(2, '0');

  return `${year}-${month}-${day}`;
}
