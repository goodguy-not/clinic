import { familyAccountResponseSchema, type FamilyAccountResponse } from '@clinic/contracts';
import { z } from 'zod';

/**
 * TRANSITIONAL. DELETE WHEN THE FAMILY POSITION IS DERIVED.
 *
 * The frozen Milestone 6 contract requires `position` on the account response,
 * and the read that derives it lands later in this milestone. The running API
 * still answers with the Milestone 5 body, and `familyAccountResponseSchema` is
 * strict, so parsing today's response against the final contract would fail on
 * a page that works.
 *
 * THIS PARSER IS THE WHOLE OF THE COMPATIBILITY, and it is one line of schema:
 * the final shape with `position` allowed to be absent. It is deliberately NOT
 * the frozen contract, is not re-exported from `@clinic/contracts`, and is named
 * legacy so it cannot be picked up by mistake in a new screen.
 *
 * IT DOES NOT INVENT A POSITION. There is no zero block, no null placeholder and
 * no default: `position` is either the server's own answer or absent, and absent
 * means "this API does not state the family's position yet". No interface may
 * render a balance, a credit or an amount due from an absent position — a zero
 * shown where a number is unknown is the one mistake this milestone can least
 * afford, and the account screen shows no such figure today for exactly the
 * reason it showed none in Milestone 5.
 *
 * REMOVAL: when the account read produces a position, this file and
 * `family-account-legacy.ts` in `apps/api` are deleted together and every
 * consumer moves back to `FamilyAccountResponse`. `family-account-legacy.test.ts`
 * pins that the frozen contract still refuses a body without a position, so the
 * final shape cannot quietly drift into permanent optionality.
 */
export const legacyFamilyAccountResponseSchema = familyAccountResponseSchema.extend({
  position: familyAccountResponseSchema.shape.position.optional(),
});

export type LegacyFamilyAccountResponse = z.infer<typeof legacyFamilyAccountResponseSchema>;

/**
 * The one thing a screen may safely ask while the transition lasts: does the
 * server state this family's position?
 *
 * Written as a type guard so a consumer that answers "yes" holds the FINAL
 * contract's position type from then on, with nothing optional about it.
 */
export function hasFinalPosition(
  account: LegacyFamilyAccountResponse,
): account is FamilyAccountResponse {
  return account.position !== undefined;
}
