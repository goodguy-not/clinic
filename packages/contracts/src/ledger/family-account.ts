import { z } from 'zod';
import { isoDateSchema } from '../dates';
import { tomanAmountSchema } from '../money';
import { paymentSummarySchema } from '../payments/common';
import { sessionChargeDetailSchema } from './charges';
import { chargeChildSummarySchema, ledgerPageQuerySchema, pageInfoSchema } from './common';

/**
 * The family account: child-level session detail, filter-scoped charge totals,
 * and — from Milestone 6 — the family's whole financial position
 * (PROJECT_SPEC.md 7).
 *
 * WHAT MILESTONE 5 COULD NOT ANSWER AND MILESTONE 6 NOW DOES. Milestone 5 had
 * the charges, the adjustments and the voids, and nothing that could produce a
 * balance, so it deliberately carried no balance field at all — a zero that
 * meant "no payments exist" is the one number a reader would most trust and
 * most misread. Milestone 6 adds payments, so `position` states what the family
 * has paid, what remains due and what stands to their credit, all derived by the
 * server from valid charges and confirmed payments.
 *
 * `totals` IS UNCHANGED AND STAYS FILTER-SCOPED. It describes the charge view
 * the query asked for — this child, these dates — and nothing about it moved.
 * The addition is purely additive: an existing consumer that ignores `position`
 * reads exactly what it read before.
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
 * WHERE THE FAMILY STANDS: the whole family, always, and never the filter.
 *
 * THIS IS THE SEMANTIC DISTINCTION MILESTONE 6 FREEZES. `totals` above answers
 * "what does this view of the charges add up to?" and moves when the reader
 * narrows to one child or one month. `position` answers "what does this family
 * owe?" and does not move at all: it is computed over EVERY valid charge and
 * EVERY confirmed payment of the family, whatever `childId`, `from`, `to` or
 * `includeVoided` say. Two numbers that look alike and mean different things are
 * how a screen ends up quoting a filtered balance to a family, so the two live
 * in separate blocks with separate names and this comment between them.
 *
 * EVERY VALUE IS SERVER-DERIVED, AND NONE OF IT IS STORED (DECISION_LOG,
 * 2026-08-15 — Credit is derived). There is no cached balance column to drift
 * from the rows beneath it, and CLAUDE.md forbids the web tier from computing
 * any of this: the browser parses these numbers, it never adds them up.
 *
 * THERE IS NO SIGNED `balance`, DELIBERATELY. A single number that is positive
 * when owed and negative when in credit puts the meaning in a minus sign that
 * every consumer must interpret and that reads wrongly the moment somebody
 * formats it without one. `amountDueToman` and `creditToman` are both unsigned,
 * both always present, and at most one of them is non-zero — a family either
 * owes money or has money standing to them, and the refinement below refuses a
 * response claiming both.
 *
 * PROMISES ARE COUNTED, NEVER SUMMED. A promise moves no money in any state
 * (CLAUDE.md), so a promised TOTAL next to an amount due would be an invitation
 * to subtract one from the other. `openPromiseCount` is the promises still on
 * time and `missedPromiseCount` the open ones whose due date has passed —
 * derived against the clinic's calendar day, never stored.
 *
 * WHAT THIS POSITION KNOWS IS ONLY WHAT THIS SYSTEM HOLDS (DECISION_LOG,
 * 2026-08-15 — Milestone 6 knows only its own records). Paper debt from before
 * the ledger existed is not in these numbers, and the interface says so plainly
 * wherever it shows them.
 */
export const familyFinancialPositionSchema = z
  .strictObject({
    /**
     * Every valid charge of the family, less the concessions still active
     * against them. The same arithmetic as `netChargedTotalToman` above, over
     * the whole family rather than the filtered view.
     */
    netChargedTotalToman: tomanAmountSchema,
    /** Every confirmed payment of the family. Voided payments count for nothing. */
    confirmedPaymentTotalToman: tomanAmountSchema,
    /** Paid beyond what was charged — a prepayment and an overpayment alike. */
    creditToman: tomanAmountSchema,
    /** Charged beyond what was paid. */
    amountDueToman: tomanAmountSchema,
    paymentCount: z.number().int().nonnegative(),
    /**
     * Stated for the reason `voidedChargeCount` is: a manager has to be able to
     * see that a reversal happened without switching a list filter to look for
     * it.
     */
    voidedPaymentCount: z.number().int().nonnegative(),
    /**
     * The most recent CONFIRMED payment, by received date, or null if the family
     * has never paid. PROJECT_SPEC.md 7 asks the account to show it, and it is
     * the fact a receptionist answers "when did they last pay?" from without
     * opening the history.
     */
    lastPayment: paymentSummarySchema.nullable(),
    openPromiseCount: z.number().int().nonnegative(),
    missedPromiseCount: z.number().int().nonnegative(),
  })
  .refine(
    (value) => value.creditToman === '0' || value.amountDueToman === '0',
    'a family is owed money or owes money, never both',
  );

export type FamilyFinancialPosition = z.infer<typeof familyFinancialPositionSchema>;

/**
 * A family's ledger, newest session first.
 *
 * `familyId` is echoed so a cached or shared response can never be read against
 * the wrong family.
 *
 * `position` IS ADDITIVE. Milestone 6 adds one key and changes nothing else in
 * this response; `totals`, `charges` and `page` mean exactly what they meant
 * before.
 *
 * `position` IS REQUIRED, AND NOTHING HERE IS OPTIONAL. This is the final
 * Milestone 6 shape of the route: a response without a position is not a thinner
 * account, it is an account that cannot say what the family owes. Freezing it as
 * optional and narrowing it later would be a post-freeze contract change, which
 * is the thing a freeze exists to prevent.
 *
 * THE DERIVATION IS LIVE. `FamilyAccountService` computes the position on every
 * read of `GET /families/:id/account`, and both tiers parse this schema
 * directly; the transitional parsers that bridged the gap during Milestone 6
 * were deleted when it closed. A caller of the frozen schema gets the final
 * shape or a parse error, never a half-filled account.
 */
export const familyAccountResponseSchema = z.strictObject({
  familyId: z.uuid(),
  totals: familyAccountTotalsSchema,
  position: familyFinancialPositionSchema,
  charges: z.array(sessionChargeViewSchema),
  page: pageInfoSchema,
});

export type FamilyAccountResponse = z.infer<typeof familyAccountResponseSchema>;
