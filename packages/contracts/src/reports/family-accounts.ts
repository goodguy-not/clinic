import { z } from 'zod';
import { familyFinancialPositionSchema } from '../ledger/family-account';
import { ledgerPageQuerySchema, pageInfoSchema } from '../ledger/common';
import { tomanAmountSchema } from '../money';
import { reportFamilySummarySchema } from './common';

/**
 * Family accounts: what every family owes or stands in credit for, in one page
 * (PROJECT_SPEC.md 10 — "family accounts with charges, payments, balance, last
 * payment, count, promise").
 *
 * ROUTE FROZEN HERE (Milestone 7, checkpoint C1). No controller implements it
 * yet.
 *
 *   GET /reports/family-accounts   `familyAccountReportQuerySchema` -> `familyAccountReportResponseSchema`
 *
 * MANAGER-ONLY, UNDER `report.read_financial`. Every family's money on one
 * screen is the clinic-wide financial reporting the accepted decision keeps with
 * the manager. A receptionist reads one family's account at a time, through the
 * route that names that family, which is the authority they already hold.
 *
 * IT HAS NO DATE RANGE, AND THAT IS THE SEMANTIC POINT. A financial position is
 * not a period: it is every valid charge and every confirmed payment a family
 * has ever had, and it does not move when a reader narrows a filter (the
 * `totals` versus `position` distinction Milestone 6 froze on the family
 * account). A "position as at last month" would be a different concept nobody
 * has approved, and it is not what this report is.
 *
 * NOTHING HERE IS STORED. Every position is derived on the request that asks for
 * it, from the same rows the family account derives it from. There is no
 * reporting aggregate, no nightly rollup and no cached balance column — a second
 * source of financial truth is exactly what this milestone must not create.
 *
 * WHAT THESE NUMBERS KNOW IS ONLY WHAT THIS SYSTEM HOLDS (DECISION_LOG,
 * 2026-08-15). Paper debt from before the ledger existed is not in them, and no
 * opening balance exists to carry it; the interface says so wherever it shows
 * them.
 *
 * THE PRINTABLE ACCOUNT OF ONE FAMILY IS NOT HERE AND IS NOT NEW. It is the
 * existing `GET /families/:id/account` response, printed — the system's own
 * facts, laid out to be readable. Milestone 7 invents no receipt and no
 * statement document (the accepted owner decision), so no contract in this
 * package describes one.
 */

/**
 * WHERE A FAMILY STANDS, AS A CLOSED WORD RATHER THAN A THRESHOLD.
 *
 * `OWING` is `amountDueToman` above zero, `IN_CREDIT` is `creditToman` above
 * zero, and `SETTLED` is both at zero — which the family position guarantees is
 * a partition, because it refuses a response claiming a family both owes and is
 * owed.
 *
 * A closed enum rather than a `minAmountDueToman` filter: an amount threshold in
 * a query string is a number somebody invents on the spot, it makes two managers
 * quote two different "families in arrears" counts, and the arithmetic behind it
 * belongs to the server (CLAUDE.md, Architecture boundary).
 */
export const FAMILY_ACCOUNT_STANDINGS = ['OWING', 'IN_CREDIT', 'SETTLED'] as const;

export type FamilyAccountStanding = (typeof FAMILY_ACCOUNT_STANDINGS)[number];

export const familyAccountStandingSchema = z.enum(FAMILY_ACCOUNT_STANDINGS);

/**
 * Which families to report on.
 *
 * `includeInactive` DEFAULTS TO FALSE and is about the FAMILY RECORD, never
 * about its money. A deactivated family that still owes money is a real
 * situation and the flag is how a manager finds it; what the flag never does is
 * hide a charge, a payment or a void from a position it is included in.
 *
 * NO FREE TEXT, AS EVERYWHERE IN THIS DIRECTORY: a family is found by search,
 * which is a POST for exactly the reason a name may not travel in a query
 * string.
 *
 * Not `z.coerce.boolean()`, for the reason stated on every other flag in this
 * package: `Boolean('false')` is `true`.
 */
export const familyAccountReportQuerySchema = ledgerPageQuerySchema.extend({
  standing: familyAccountStandingSchema.optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type FamilyAccountReportQuery = z.infer<typeof familyAccountReportQuerySchema>;

/**
 * One family's whole standing.
 *
 * `position` IS THE FROZEN MILESTONE 6 SHAPE, REUSED WHOLE AND NOT RESTATED. It
 * already carries the net charged, the confirmed payments, the credit, the
 * amount due, the payment counts, the last payment and the open and missed
 * promise counts — which is, item for item, what PROJECT_SPEC.md 10 asks this
 * report to show. A second, flatter shape saying the same things would be a
 * second definition of "what a family owes", and the two would drift the first
 * time one of them was corrected.
 *
 * IT IS WHOLE-FAMILY, ALWAYS, AND THE REPORT'S FILTER NEVER NARROWS IT. That is
 * the invariant `familyFinancialPositionSchema` was frozen with, and it holds
 * here for the same reason: a filtered balance quoted to a family is the bug the
 * separation exists to prevent.
 */
export const familyAccountReportRowSchema = z.strictObject({
  family: reportFamilySummarySchema,
  position: familyFinancialPositionSchema,
});

export type FamilyAccountReportRow = z.infer<typeof familyAccountReportRowSchema>;

/**
 * What the filtered set of families adds up to.
 *
 * OVER EVERY FAMILY THE FILTER MATCHES, NOT THE PAGE.
 *
 * THE TWO SUMS ARE NOT NETTED AGAINST EACH OTHER, AND THERE IS NO CLINIC
 * BALANCE. One family's credit does not reduce another family's debt, and a
 * single signed number that pretended otherwise would be the clinic-wide balance
 * this product does not recognise. Both are unsigned, both are always present,
 * and a reader who wants a net figure has to decide for themselves what they
 * mean by it.
 */
export const familyAccountReportTotalsSchema = z.strictObject({
  familyCount: z.number().int().nonnegative(),
  owingFamilyCount: z.number().int().nonnegative(),
  inCreditFamilyCount: z.number().int().nonnegative(),
  totalAmountDueToman: tomanAmountSchema,
  totalCreditToman: tomanAmountSchema,
});

export type FamilyAccountReportTotals = z.infer<typeof familyAccountReportTotalsSchema>;

/**
 * The families this filter matched, largest amount due first.
 *
 * THE ORDER IS THE WORKLIST ORDER, stated by the server rather than chosen by
 * the caller: the report exists to answer "who should we call first?", and a
 * sort parameter would be a second way to ask one question. Families in credit
 * and settled families follow, by name.
 *
 * An empty result is a successful read — a clinic where nobody owes anything is
 * the outcome the report is looking for.
 */
export const familyAccountReportResponseSchema = z.strictObject({
  totals: familyAccountReportTotalsSchema,
  families: z.array(familyAccountReportRowSchema),
  page: pageInfoSchema,
});

export type FamilyAccountReportResponse = z.infer<typeof familyAccountReportResponseSchema>;
