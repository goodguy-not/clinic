import { z } from 'zod';

/**
 * A calendar date with no time and no timezone, as `YYYY-MM-DD`.
 *
 * Effective-dated rules resolve against a service date, not an instant. A
 * timestamp would carry an offset, and an offset turns "this price applies on
 * the fourteenth" into a question about whose midnight — which is exactly the
 * class of bug that silently misprices a session near a month boundary.
 *
 * So dates cross this boundary as strings and stay `DATE` in PostgreSQL. There
 * is deliberately no `z.date()` anywhere in the catalog contracts, and nothing
 * in NestJS may hand a `Date` back to a caller for one of these fields.
 *
 * The regular expression is not sufficient on its own: `2026-02-30` matches it
 * and is not a day. The refinement re-formats the parsed value and compares, so
 * an overflowing day is rejected rather than silently rolled forward into
 * March.
 */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a calendar date formatted YYYY-MM-DD')
  .refine(isRealCalendarDate, 'must be a real calendar date');

export type IsoDate = z.infer<typeof isoDateSchema>;

/**
 * Built on `Date.UTC` rather than `new Date(string)` so the check never depends
 * on the machine's timezone. Verified against the components that were typed,
 * because `Date.UTC` normalises overflow instead of failing.
 */
function isRealCalendarDate(value: string): boolean {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));

  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}
