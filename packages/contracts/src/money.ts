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
 * The practical ceiling for a single amount of money anywhere in this product.
 *
 * ONE NUMBER, THREE CONSTRAINTS. It is mirrored by `tariff_price_bounds_chk`,
 * and Milestone 5 reuses the same ceiling in `session_charge_amount_bounds_chk`
 * and `charge_adjustment_amount_bounds_chk` rather than picking a second value
 * that could drift from it. The name says "tariff" because that is where the
 * bound was first agreed; what it means is the largest amount the ledger will
 * accept.
 *
 * A fat-finger guard, not a modelled price: it exists so a mistyped run of
 * digits is refused at entry rather than discovered in a report. It is
 * deliberately far above any plausible session price, and changing it is a
 * one-line change in every place with no data migration.
 */
export const TARIFF_MAX_PRICE_TOMAN = '1000000000';

/**
 * A money amount in whole toman that may legitimately be NEGATIVE.
 *
 * MILESTONE 8 IS THE FIRST THING THAT CAN PRODUCE ONE, and that is why this
 * type did not exist before it (`ledger/charges.ts` says so explicitly). A
 * charge is positive or zero, an adjustment is positive and may not take the
 * family's effective amount below zero, and a payment is money that arrived —
 * nothing family-facing goes below zero and nothing ever will. What CAN is the
 * CLINIC NET SHARE of a session: CLAUDE.md requires a clinic net to be negative
 * whenever the clinic explicitly bears a discount larger than its own gross
 * share, and requires that subsidy to be VISIBLE in reports rather than clamped
 * to zero or shown as its absolute value with a word beside it.
 *
 * IT IS NOT A REPLACEMENT FOR `tomanAmountSchema`, AND MOST SETTLEMENT FIGURES
 * KEEP USING THE UNSIGNED ONE. A therapist gross share, a therapist discount
 * and a therapist net are non-negative by domain rule (CLAUDE.md — therapist
 * net share must never be negative), so they are typed unsigned and a negative
 * one is a response that could not have come from the settlement service. Only
 * the figures that may genuinely cross zero are signed. Widening every amount
 * "just in case" would delete a rule from the type system.
 *
 * THE SAME CANONICAL-STRING DISCIPLINE, PLUS ONE MORE RULE. Digits on the wire
 * for the reason `tomanAmountSchema` gives — JSON has no integer type and
 * `BigInt` has no JSON representation — and exactly ONE spelling per amount, so
 * two equal amounts are equal strings. That means CANONICAL ZERO IS `'0'` AND
 * NEVER `'-0'`: a negative zero is the same amount written a second way, it
 * compares unequal as a string, and it is what a naive `-(0)` in a formatter or
 * a `String(-0)` in a serialiser produces. The regular expression makes it
 * unrepresentable rather than leaving it to be normalised by whoever notices.
 *
 * NO JS NUMBER ANYWHERE. `-0`, `NaN`, `-Infinity` and silent precision loss
 * above 2^53 are all reachable from a `number` and none of them is reachable
 * from this.
 *
 * The magnitude bound is symmetric with the unsigned one: a value whose digits
 * exceed `BIGINT_MAX` is a write PostgreSQL would refuse, so it is refused here
 * as a validation error instead of arriving as a 500.
 */
export const signedTomanAmountSchema = z
  .string()
  .regex(
    /^(?:0|-?[1-9]\d*)$/,
    'must be a whole number of toman in canonical decimal form, with no negative zero',
  )
  .refine((value) => {
    const digits = value.startsWith('-') ? value.slice(1) : value;

    return (
      digits.length < BIGINT_MAX.length ||
      (digits.length === BIGINT_MAX.length && digits <= BIGINT_MAX)
    );
  }, 'exceeds the maximum storable amount');

export type SignedTomanAmount = z.infer<typeof signedTomanAmountSchema>;
