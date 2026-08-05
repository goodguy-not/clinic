/**
 * Conversion between a PostgreSQL `DATE` and the `YYYY-MM-DD` string that
 * crosses the API boundary.
 *
 * A `DATE` column has no time and no timezone. The Prisma client has no
 * date-only type, so it hands one back as a JavaScript `Date` pinned to
 * midnight UTC — a value that *looks* like an instant and will happily answer
 * timezone-dependent questions it has no business answering.
 *
 * Everything here therefore reads and writes UTC components only. Using
 * `getFullYear`/`getMonth`/`getDate` instead would return the previous day for
 * any process running west of UTC and the next day for a late-evening instant
 * east of it, which for an effective-dated price means quietly applying the
 * wrong tariff near a boundary. `iso-date.spec.ts` pins both directions by
 * running the same assertions under a negative-offset and a positive-offset
 * timezone.
 *
 * Effective dates must never reach a caller as a timestamp: `@clinic/contracts`
 * types them as `isoDateSchema` strings, so a `Date` that escaped this module
 * fails schema parsing in tests rather than reaching a browser.
 */

/** Formats a `DATE` value read from PostgreSQL as `YYYY-MM-DD`. */
export function toIsoDate(value: Date): string {
  if (Number.isNaN(value.getTime())) {
    throw new RangeError('Cannot format an invalid Date as a calendar date');
  }

  const year = String(value.getUTCFullYear()).padStart(4, '0');
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Parses `YYYY-MM-DD` into the `Date` Prisma writes to a `DATE` column.
 *
 * Built with `Date.UTC` rather than `new Date(string)` so the result never
 * depends on the process timezone, and validated by re-formatting: `Date.UTC`
 * silently rolls an overflowing day forward, so `2026-02-30` would otherwise
 * become the second of March instead of being refused.
 */
export function parseIsoDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (match === null) {
    throw new RangeError(`Not a calendar date formatted YYYY-MM-DD: ${value}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (toIsoDate(parsed) !== value) {
    throw new RangeError(`Not a real calendar date: ${value}`);
  }

  return parsed;
}
