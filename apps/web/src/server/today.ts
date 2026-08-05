import 'server-only';

/**
 * Today, as a `YYYY-MM-DD` string, decided by the server.
 *
 * Used to describe a tariff as current, future or expired. Doing that in the
 * browser would make the answer depend on the visitor's device clock, so a
 * laptop a day out would show a price as in force when it is not.
 *
 * Formatted from UTC components for the same reason `iso-date.ts` does: local
 * getters would return a different day either side of midnight depending on
 * where the server runs.
 *
 * The clinic is in Iran (UTC+03:30, no DST), so UTC and local dates differ only
 * between 20:30 and 24:00 local time. That is a real window, and closing it is
 * a matter of pinning the deployment timezone rather than of reading a clock
 * differently here — worth stating explicitly rather than leaving as an
 * accident.
 */
export function serverToday(now: Date = new Date()): string {
  const year = String(now.getUTCFullYear()).padStart(4, '0');
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}
