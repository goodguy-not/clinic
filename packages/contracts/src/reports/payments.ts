import { z } from 'zod';
import { isoDateSchema } from '../dates';
import { ledgerPageQuerySchema, pageInfoSchema } from '../ledger/common';
import { tomanAmountSchema } from '../money';
import { paymentMethodSchema, paymentStatusSchema } from '../payments/common';
import { reportFamilySummarySchema, reportRangeSchema, reportUserSummarySchema } from './common';

/**
 * Payments by date, method and user (PROJECT_SPEC.md 10).
 *
 * ROUTE FROZEN HERE (Milestone 7, checkpoint C1). No controller implements it
 * yet.
 *
 *   GET /reports/payments   `paymentReportQuerySchema` -> `paymentReportResponseSchema`
 *
 * MANAGER-ONLY, UNDER `report.read_financial`. This is clinic-wide financial
 * reporting AND per-user financial attribution, which are the two things the
 * accepted Milestone 7 decision keeps with the manager. A receptionist holds
 * `payment.read` — they record money and read a family's own history with it —
 * and that authority deliberately does not extend to every family's money in one
 * page, nor to what a colleague took in. The dashboard gives them the one
 * clinic-wide-shaped answer they do need: their own entries for the day, which
 * is a different route, a different authority and a different date basis.
 *
 * IT IS KEYED ON `PAYMENT_RECEIVED_ON` — the clinic business day the money
 * arrived. THIS IS NOT THE DASHBOARD'S RECONCILIATION BASIS, and the difference
 * is deliberate: a payment received on Thursday and entered on Saturday appears
 * in this report under Thursday and in Saturday's reconciliation. One answers
 * "what did the clinic take in that week?", the other "what did I enter today?".
 * Both responses state their basis on the wire so no consumer has to remember
 * which is which.
 *
 * NO ALLOCATION APPEARS HERE, because none exists. A payment names no charge, no
 * session and no child (DECISION_LOG, 2026-08-15 — A payment is a family fact),
 * so no row in this report can say what a payment settled, and no total here is
 * a balance.
 */

/**
 * Which payments to report on.
 *
 * The range is mandatory and inclusive at both ends, compared against
 * `receivedOn`.
 *
 * `recordedByUserId` IS THE PER-USER FILTER, and it is an id — never a username
 * and never a display name, which are personal data and would put a colleague's
 * name in a query string. `method` narrows to one way money arrived, which is
 * how a card terminal is reconciled against a bank statement.
 *
 * `includeVoided` DEFAULTS TO TRUE, exactly as it does on every other financial
 * list in this system: financial history is visible unless somebody asks to hide
 * it, and a default that dropped voided rows would let this page silently
 * disagree with the audit trail. It is a filter on the LIST ONLY — a voided
 * payment is excluded from every confirmed total whether or not it is shown.
 */
export const paymentReportQuerySchema = ledgerPageQuerySchema
  .extend({
    from: isoDateSchema,
    to: isoDateSchema,
    familyId: z.uuid().optional(),
    method: paymentMethodSchema.optional(),
    recordedByUserId: z.uuid().optional(),
    includeVoided: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
  })
  .refine((value) => value.from <= value.to, 'the range must not end before it starts');

export type PaymentReportQuery = z.infer<typeof paymentReportQuerySchema>;

/**
 * One payment, as the report prints it.
 *
 * `recordedBy` AND `recordedAt` TRAVEL WITH `receivedOn`, so a back-dated
 * payment is visible as one and the person who entered it is named. That pairing
 * is the whole reason this report is manager-only.
 *
 * NO BANK REFERENCE AND NO NOTE. The reference is a banking identifier that
 * belongs on the payment record an operator opens deliberately, not on a page
 * that gets printed and left on a desk; the note is free text a family may be
 * described in. Both are read on the payment itself, and neither is needed to
 * reconcile a day's takings.
 *
 * `status` IS STATED, as it is everywhere: a voided payment says so rather than
 * being inferred from a null.
 */
export const paymentReportRowSchema = z.strictObject({
  id: z.uuid(),
  family: reportFamilySummarySchema,
  amountToman: tomanAmountSchema,
  method: paymentMethodSchema,
  receivedOn: isoDateSchema,
  status: paymentStatusSchema,
  recordedAt: z.iso.datetime(),
  recordedBy: reportUserSummarySchema,
});

export type PaymentReportRow = z.infer<typeof paymentReportRowSchema>;

/** One method's share of the filtered period. Zero-filled, all three, in order. */
export const paymentReportMethodTotalSchema = z.strictObject({
  method: paymentMethodSchema,
  confirmedCount: z.number().int().nonnegative(),
  confirmedTotalToman: tomanAmountSchema,
});

export type PaymentReportMethodTotal = z.infer<typeof paymentReportMethodTotalSchema>;

/** One user's share of the filtered period: the per-user attribution itself. */
export const paymentReportUserTotalSchema = z.strictObject({
  user: reportUserSummarySchema,
  confirmedCount: z.number().int().nonnegative(),
  confirmedTotalToman: tomanAmountSchema,
  voidedCount: z.number().int().nonnegative(),
});

export type PaymentReportUserTotal = z.infer<typeof paymentReportUserTotalSchema>;

/**
 * What the filtered period took in.
 *
 * OVER THE WHOLE FILTERED RESULT, NOT THE PAGE.
 *
 * FILTER-SCOPED, ALWAYS. Every number here describes the rows this query
 * matched — this method, this fortnight, this user — and none of them is a
 * whole-clinic-forever figure. There is deliberately no lifetime total anywhere
 * in Milestone 7.
 *
 * VOIDED MONEY IS COUNTED, NEVER SUMMED. `voidedCount` says how many reversals
 * fall in the period so a manager sees that corrections happened; the amounts
 * are not totalled, because a voided payment is money the clinic says it never
 * received and a "total voided" figure sitting beside a total received is an
 * invitation to subtract one from the other.
 */
export const paymentReportTotalsSchema = z.strictObject({
  confirmedCount: z.number().int().nonnegative(),
  confirmedTotalToman: tomanAmountSchema,
  voidedCount: z.number().int().nonnegative(),
  byMethod: z.array(paymentReportMethodTotalSchema),
  byUser: z.array(paymentReportUserTotalSchema),
});

export type PaymentReportTotals = z.infer<typeof paymentReportTotalsSchema>;

/**
 * The payments this filter matched, newest received date first.
 *
 * An empty result is a successful read of a quiet week.
 */
export const paymentReportResponseSchema = z.strictObject({
  range: reportRangeSchema,
  totals: paymentReportTotalsSchema,
  payments: z.array(paymentReportRowSchema),
  page: pageInfoSchema,
});

export type PaymentReportResponse = z.infer<typeof paymentReportResponseSchema>;
