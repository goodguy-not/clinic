import { z } from 'zod';

/**
 * The largest value a PostgreSQL signed `BIGINT` column can hold.
 *
 * Money is stored as integer toman in `BIGINT` (DECISION_LOG, 2026-08-02 —
 * Money unit), so a value above this is not a large price, it is a write that
 * would fail at the database. Rejecting it in the contract turns a 500 into a
 * validation error.
 */
export const BIGINT_MAX = '9223372036854775807';

/**
 * A money amount in whole toman, carried as a decimal string.
 *
 * A string rather than a number because JSON has no integer type: anything
 * above 2^53 loses precision silently on the way through `JSON.parse`, and
 * "silently" is the part that matters for money. `BigInt` cannot be serialised
 * to JSON at all, so the wire format is the digits themselves.
 *
 * No sign, no separator, no decimal point, no leading zero — one canonical
 * spelling per amount, so two equal amounts are also equal strings and a
 * response can be compared or snapshotted without normalising first.
 */
export const tomanAmountSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)$/, 'must be a whole number of toman in canonical decimal form')
  .refine((value) => value.length <= BIGINT_MAX.length, 'exceeds the maximum storable amount')
  .refine(
    (value) => value.length < BIGINT_MAX.length || value <= BIGINT_MAX,
    'exceeds the maximum storable amount',
  );

export type TomanAmount = z.infer<typeof tomanAmountSchema>;

/**
 * The practical ceiling for a single tariff price, mirrored by the
 * `tariff_price_bounds_chk` database constraint.
 *
 * A fat-finger guard, not a modelled price: it exists so a mistyped run of
 * digits is refused at entry rather than discovered in a report. It is
 * deliberately far above any plausible session price, and changing it is a
 * one-line change in both places with no data migration.
 */
export const TARIFF_MAX_PRICE_TOMAN = '1000000000';
