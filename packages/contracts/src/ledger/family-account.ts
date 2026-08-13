import { z } from 'zod';
import { isoDateSchema } from '../dates';
import { tomanAmountSchema } from '../money';
import { sessionChargeDetailSchema } from './charges';
import { chargeChildSummarySchema, ledgerPageQuerySchema, pageInfoSchema } from './common';

/**
 * The family account: child-level session detail and family-level totals
 * (PROJECT_SPEC.md 7).
 *
 * WHAT PROJECT_SPEC.md 7 ASKS FOR AND THIS MILESTONE DOES NOT ANSWER. That
 * section describes an account carrying valid charges, payments, credits,
 * balance, last payment, promises, adjustments and voids. Milestone 5 has the
 * charges, the adjustments and the voids, and nothing that could produce the
 * rest. There is therefore NO `balanceToman`, no `creditToman`, no
 * `lastPaymentAt` and no `outstandingToman` in this response — not as null, not
 * as zero. A balance field reading zero while payments do not exist would be a
 * claim the ledger cannot support, and it is the one number a person reading
 * this screen would trust most.
 *
 * A READ MODEL, exactly as the appointment day view is: denormalised on purpose
 * so a screen listing a family's sessions can print the child, the service and
 * the therapist without an N+1 across an HTTP boundary.
 */

/** The names an interface prints instead of a uuid. */
const namedSchema = z.strictObject({ id: z.uuid(), name: z.string() });

/**
 * One charge as the account shows it: the financial record, plus the three
 * things a reader identifies the session by.
 *
 * The names are resolved from the CURRENT catalog rows against the ids the
 * charge snapshotted. A therapist who has since been renamed prints under the
 * new name; the charge still points at the same person, and the amount, the
 * length and the date it recorded are untouched. Snapshotting names as strings
 * would be a second copy of a fact that can disagree, and the ids are the fact.
 */
export const sessionChargeViewSchema = z.strictObject({
  charge: sessionChargeDetailSchema,
  child: chargeChildSummarySchema,
  service: namedSchema,
  therapist: z.strictObject({ id: z.uuid(), fullName: z.string() }),
});

export type SessionChargeView = z.infer<typeof sessionChargeViewSchema>;

/**
 * Which slice of a family's history to read.
 *
 * `childId` narrows a family account to one child, which is how a guardian with
 * three children in therapy reads it. The date bounds are clinic calendar days
 * compared against `serviceDate` — the day the session happened, never the day
 * the charge was entered, because a charge posted late belongs to the session it
 * priced.
 *
 * `includeVoided` DEFAULTS TO TRUE: FINANCIAL HISTORY IS VISIBLE UNLESS SOMEBODY
 * ASKS TO HIDE IT. A voided charge is not owed, but it did happen, and a default
 * that dropped it would let an account silently disagree with the audit trail —
 * a family asking "you charged us for that session, what happened to it?" would
 * be told nothing was ever charged. PROJECT_SPEC.md 7 lists voids among what the
 * account shows, and final records are voided rather than deleted precisely so
 * they stay readable (CLAUDE.md). Hiding them is a convenience an operator
 * chooses on a busy screen, not the shape of the record.
 *
 * A voided row is marked as voided wherever it appears: `voidedAt`,
 * `voidedByUserId` and `voidReason` are populated on the charge and on every
 * withdrawn concession, which is what an interface renders the marker from.
 *
 * IT IS A FILTER ON THE LIST ONLY. A voided charge is excluded from every total
 * whether or not it is shown, and a voided adjustment reduces nothing — that is
 * what withdrawing them means. Turning this off changes what a reader sees, never
 * what the account says is owed.
 *
 * NOT `z.coerce.boolean()`, which is how the catalog filters are written and
 * would be wrong here: `Boolean('false')` is `true`, so a default-false filter
 * can only ever be turned on, and a default-TRUE one could never be turned off.
 * The two spellings are stated explicitly and one of them is the default.
 */
export const familyAccountQuerySchema = ledgerPageQuerySchema.extend({
  childId: z.uuid().optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  includeVoided: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});

export type FamilyAccountQuery = z.infer<typeof familyAccountQuerySchema>;

/**
 * What the family was charged for the sessions this filter matches.
 *
 * OVER THE WHOLE FILTERED ACCOUNT, NOT THE PAGE. A total that changed when the
 * reader turned the page would be read as a different family's money.
 *
 * VOIDED CHARGES ARE COUNTED IN NEITHER SUM, and voided adjustments do not
 * reduce anything — that is what withdrawing them means. `chargedTotalToman` is
 * the sum of the valid charges as raised, `adjustmentTotalToman` the sum of the
 * concessions still active against them, and `netChargedTotalToman` the
 * difference, which is what the family was actually asked for.
 *
 * `netChargedTotalToman` IS NOT A BALANCE AND IS NOT NAMED LIKE ONE. It says
 * what was charged, not what is owed; nothing here has been paid, because
 * nothing in this milestone can be.
 *
 * `voidedChargeCount` is stated because a manager reading an account has to be
 * able to see that a correction happened without switching the list filter to
 * look for it.
 */
export const familyAccountTotalsSchema = z.strictObject({
  chargedTotalToman: tomanAmountSchema,
  adjustmentTotalToman: tomanAmountSchema,
  netChargedTotalToman: tomanAmountSchema,
  chargeCount: z.number().int().nonnegative(),
  voidedChargeCount: z.number().int().nonnegative(),
});

export type FamilyAccountTotals = z.infer<typeof familyAccountTotalsSchema>;

/**
 * A family's ledger, newest session first.
 *
 * `familyId` is echoed so a cached or shared response can never be read against
 * the wrong family.
 */
export const familyAccountResponseSchema = z.strictObject({
  familyId: z.uuid(),
  totals: familyAccountTotalsSchema,
  charges: z.array(sessionChargeViewSchema),
  page: pageInfoSchema,
});

export type FamilyAccountResponse = z.infer<typeof familyAccountResponseSchema>;
