import { SHARE_BASIS_POINTS_MAX } from '@clinic/contracts';

/**
 * HOW A SESSION'S PRE-DISCOUNT VALUE IS SPLIT BETWEEN A THERAPIST AND THE
 * CLINIC. The frozen rule (`@clinic/contracts` — `SHARE_ROUNDING`), as the one
 * executable statement of it in this application.
 *
 *   therapistGross = round_half_up(base * shareBasisPoints / 10000)
 *   clinicGross    = base - therapistGross          // the exact residual
 *
 * HALF-UP RATHER THAN HALF-EVEN, because it is the rule a person checking the
 * figure by hand applies, and a settlement number that disagrees with a
 * therapist's own arithmetic by one toman costs more to explain than banker's
 * rounding saves in aggregate.
 *
 * EXACTLY ONE SIDE IS ROUNDED. Rounding both independently makes them sum to
 * one toman more or less than the session was worth, and the missing toman
 * surfaces in a report that has to balance. The therapist's is the rounded side
 * — it is the side somebody is owed a whole number of — and the clinic absorbs
 * the remainder by construction, so `therapist + clinic === base` holds for
 * every session with no tolerance and no reconciliation step.
 *
 * `bigint` END TO END, NEVER `number`. A charge amount is `BIGINT` in
 * PostgreSQL and is not representable as a JavaScript number above 2^53;
 * `Math.round((base * bp) / 10000)` gives a different answer there, and a
 * different answer on a .5 that floating point represents as slightly under.
 * Both differences are silent. `(base * bp + 5000n) / 10000n` is exact, and
 * `bigint` division truncates toward zero — which is floor, because a base
 * amount is never negative and therefore no negative-half-up case exists.
 *
 * IT IS NOT THE ONLY PLACE THIS RULE IS ENFORCED, deliberately.
 * `session_settlement_split_chk` re-derives the same expression in SQL and
 * refuses the row if the two disagree, which is what stops a rounding change, a
 * refactor or a repair script restating what was applied to a session somebody
 * has already been paid for. The same division of labour as
 * `enforce_charge_adjustment_bounds`: this produces the values, the database
 * makes the rule true of every writer.
 */
export type ShareSplit = {
  readonly therapistGrossToman: bigint;
  readonly clinicGrossToman: bigint;
};

export function splitSessionValue(baseAmountToman: bigint, shareBasisPoints: number): ShareSplit {
  const max = BigInt(SHARE_BASIS_POINTS_MAX);
  const therapistGrossToman = (baseAmountToman * BigInt(shareBasisPoints) + max / 2n) / max;

  return { therapistGrossToman, clinicGrossToman: baseAmountToman - therapistGrossToman };
}
