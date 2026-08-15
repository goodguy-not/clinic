import type { FamilyAccountResponse } from '@clinic/contracts';

/**
 * TRANSITIONAL. DELETE WHEN THE FAMILY POSITION IS DERIVED.
 *
 * The frozen Milestone 6 contract requires `position` on the account response,
 * and the read that derives it is written in a later checkpoint of this
 * milestone. Until then this service still answers with the Milestone 5 body,
 * and this type is the only thing that says so.
 *
 * WHY A NAMED TYPE RATHER THAN A LOOSER CONTRACT. The alternative was to freeze
 * `position` as optional and narrow it once the derivation landed — a
 * post-freeze change to the shape both workstreams build against, which is
 * exactly what F1 exists to prevent. The contract therefore states the final
 * truth, and the interim is a local, obviously temporary annotation with one
 * consumer.
 *
 * WHAT IT DOES NOT DO. It does not fabricate a position: there is no zeroed
 * block, no null placeholder and no default. An account without a position says
 * nothing about what the family owes, which is honest, and the interface shows
 * no balance today for the same reason it showed none in Milestone 5.
 *
 * REMOVAL IS ONE EDIT PER SIDE: when `FamilyAccountService.account` returns a
 * position, this file is deleted, the controller and service annotate
 * `FamilyAccountResponse`, and `legacyFamilyAccountResponseSchema` in `apps/web`
 * goes with it. A test in the web tier pins that the frozen schema still refuses
 * a body with no position, so neither half can be forgotten quietly.
 */
export type LegacyFamilyAccountResponse = Omit<FamilyAccountResponse, 'position'>;
