import { z } from 'zod';
import { isoDateSchema } from '../dates';
import { ledgerPageQuerySchema, pageInfoSchema } from '../ledger/common';
import { tomanAmountSchema } from '../money';
import {
  paymentAmountTomanSchema,
  paymentMethodSchema,
  paymentNoteSchema,
  paymentReasonSchema,
  paymentReceivedOnSchema,
  paymentReferenceSchema,
  paymentStatusSchema,
} from './common';

/**
 * Money the clinic received from a family, as the wire carries it.
 *
 * ROUTES FROZEN HERE (Milestone 6, checkpoint A2). No controller implements them
 * yet; the shapes are settled first so the API and web workstreams build against
 * one description rather than two guesses.
 *
 *   POST /families/:familyId/payments   `createPaymentRequestSchema`  -> `paymentResponseSchema`
 *   GET  /families/:familyId/payments   `paymentListQuerySchema`      -> `paymentListResponseSchema`
 *   POST /payments/:paymentId/void      `voidPaymentRequestSchema`    -> `paymentResponseSchema`
 *
 * THE VOID ROUTE IS ADDRESSED BY PAYMENT, NOT BY FAMILY, exactly as a charge
 * void is: a payment id names one row and the family is already on it, so a
 * family segment in that path would be a second copy of a fact the server would
 * have to check for agreement.
 *
 * EVERY AMOUNT IS AN UNSIGNED CANONICAL DECIMAL STRING (DECISION_LOG,
 * 2026-08-15 — Money on the wire). Nothing here is signed, because nothing here
 * can be negative: a payment is money that arrived, and a void does not make it
 * a negative payment, it makes it not count.
 *
 * NO ALLOCATION, NO BALANCE, NO SETTLEMENT. A payment names no charge, no
 * session and no child (DECISION_LOG, 2026-08-15 — A payment is a family fact),
 * and it carries no running balance: what a family owes is the whole-family
 * position on the account read, computed by the server over every valid charge
 * and confirmed payment, not a number attached to one row.
 */

/**
 * One payment, whole.
 *
 * `status` IS STATED, NOT INFERRED. It is derived by the server from `voidedAt`
 * — there is no status column — and it is put on the wire so no consumer has to
 * re-derive it. The refinement is what keeps the two from drifting: a response
 * saying `CONFIRMED` while carrying a void instant, or `VOIDED` without one,
 * could not have come from the database and is refused here rather than rendered.
 *
 * THE VOID TRIPLE TRAVELS TOGETHER. Actor, instant and mandatory reason are one
 * fact stated whole (`payment_void_consistency_chk`), so all three are present
 * or all three are null; a partial triple is refused for the same reason.
 *
 * `createdAt` AND `createdByUserId` ARE EXPOSED, as they are on a session charge
 * and its adjustments: who recorded the money and when is what makes a
 * back-dated `receivedOn` visible as a back-date rather than as history.
 *
 * `reference` IS ON THE READ. It is stored on the payment and only kept out of
 * the audit trail (DECISION_LOG, 2026-08-15) — the operator reconciling a
 * transfer needs to see it, and this is where they look it up.
 *
 * THERE IS NO UPDATE REQUEST FOR THIS RECORD ANYWHERE IN THIS PACKAGE. A wrong
 * payment is voided and re-recorded; nothing about a payment is ever rewritten.
 */
export const paymentSchema = z
  .strictObject({
    id: z.uuid(),
    familyId: z.uuid(),
    amountToman: tomanAmountSchema,
    method: paymentMethodSchema,
    /** The clinic business day the money arrived, with no time and no offset. */
    receivedOn: isoDateSchema,
    reference: z.string().nullable(),
    note: z.string().nullable(),
    status: paymentStatusSchema,
    createdAt: z.iso.datetime(),
    createdByUserId: z.uuid(),
    voidedAt: z.iso.datetime().nullable(),
    voidedByUserId: z.uuid().nullable(),
    voidReason: z.string().nullable(),
  })
  .refine(
    (value) => (value.status === 'VOIDED') === (value.voidedAt !== null),
    'a payment is voided exactly when it carries a void instant',
  )
  .refine(
    (value) =>
      (value.voidedAt === null) === (value.voidedByUserId === null) &&
      (value.voidedAt === null) === (value.voidReason === null),
    'a void states its actor, its instant and its reason together',
  );

export type Payment = z.infer<typeof paymentSchema>;

/**
 * Recording money that arrived.
 *
 * FIVE FIELDS, AND EVERY ONE OF THEM IS SOMETHING THE OPERATOR ACTUALLY TYPES.
 * The actor, the entry instant and the status are the server's (a payment is
 * confirmed the moment it is recorded), and a caller that tries to state one is
 * refused rather than ignored, because the schema is strict.
 *
 * THE FAMILY IS THE PATH, NOT THE BODY. `POST /families/:familyId/payments`
 * names it once; a `familyId` in the body would be a second copy that can
 * disagree with the first.
 *
 * NO `isPrepayment`, NO CREDIT FLAG AND NO ALLOCATION (DECISION_LOG, 2026-08-15
 * — Credit is derived). Intent is not observable at the counter, and a family
 * paying while owing nothing produces exactly the same row as one paying a debt;
 * the surplus is visible as credit on the family position, derived from rows.
 *
 * `receivedOn` MAY BE IN THE PAST WITH NO LIMIT AND MAY NOT BE IN THE FUTURE.
 * The future refusal is the server's, as `PAYMENT_DATE_IN_FUTURE`: today is the
 * clinic's calendar day in Asia/Tehran and a browser must not decide it.
 */
export const createPaymentRequestSchema = z.strictObject({
  amountToman: paymentAmountTomanSchema,
  method: paymentMethodSchema,
  receivedOn: paymentReceivedOnSchema,
  reference: paymentReferenceSchema.optional(),
  note: paymentNoteSchema.optional(),
});

export type CreatePaymentRequest = z.infer<typeof createPaymentRequestSchema>;

/**
 * Withdrawing a payment that should not have been recorded.
 *
 * ONE FIELD, AND IT IS MANDATORY. Final financial records are voided, never
 * deleted (CLAUDE.md), and a reversal nobody can explain is what CLAUDE.md
 * forbids of a correction. The actor and the instant are the request's own.
 *
 * MANAGER-ONLY (`payment.void`), with no same-day receptionist window
 * (DECISION_LOG, 2026-08-15 — Payment void is manager-only). The void is
 * one-way: there is no un-void request here, because the database permits
 * exactly one confirmed -> voided transition.
 *
 * VOIDING A PAYMENT DOES NOT TOUCH A PROMISE IT FULFILLED. The promise stays
 * `FULFILLED` and its linked payment now reads `VOIDED`, which is the honest
 * record of what happened; the audit row for the void names the promise so the
 * consequence is traceable without a second mutation.
 */
export const voidPaymentRequestSchema = z.strictObject({
  reason: paymentReasonSchema,
});

export type VoidPaymentRequest = z.infer<typeof voidPaymentRequestSchema>;

/**
 * ONE RESPONSE SHAPE FOR EVERY WRITE THAT TOUCHES A PAYMENT.
 *
 * Recording one and voiding one both return the payment as it now stands, for
 * the reason `sessionChargeResponseSchema` does: the caller is looking at a
 * screen that has to show the row it just changed, and a bare 204 would need a
 * second request to render it.
 *
 * IT DOES NOT CARRY THE FAMILY POSITION. The position is the account read's, and
 * embedding it here would give an interface two places to learn one number and
 * a reason for them to disagree.
 */
export const paymentResponseSchema = z.strictObject({
  payment: paymentSchema,
});

export type PaymentResponse = z.infer<typeof paymentResponseSchema>;

/**
 * Which slice of a family's payment history to read.
 *
 * SEPARATELY PAGINATED FROM CHARGES AND FROM PROMISES. Three histories of
 * different lengths are read on one screen, and one page number across all three
 * would move a reader through payments they were not looking at.
 *
 * THE DATE BOUNDS COMPARE AGAINST `receivedOn` — the day the money arrived,
 * never the day it was entered — for the reason the account's bounds compare
 * against `serviceDate`: a back-dated payment belongs to the day it arrived.
 *
 * `includeVoided` DEFAULTS TO TRUE, exactly as it does on the account: financial
 * history is visible unless somebody asks to hide it, and a default that dropped
 * a voided payment would let this list silently disagree with the audit trail.
 * It is a filter on the LIST ONLY — a voided payment is excluded from every
 * total whether or not it is shown.
 *
 * NOT `z.coerce.boolean()`: `Boolean('false')` is `true`, so a default-true
 * filter written that way could never be turned off.
 */
export const paymentListQuerySchema = ledgerPageQuerySchema.extend({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  includeVoided: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});

export type PaymentListQuery = z.infer<typeof paymentListQuerySchema>;

/**
 * A family's payments, newest received date first.
 *
 * `familyId` is echoed so a cached or shared response can never be read against
 * the wrong family, exactly as the account echoes it.
 *
 * NO TOTALS BLOCK. What the family has paid in total is a whole-family number
 * and lives on the account position, where it is not filtered by this list's
 * date window; a filter-scoped payment total next to it would be the second
 * number people quote as the balance.
 */
export const paymentListResponseSchema = z.strictObject({
  familyId: z.uuid(),
  payments: z.array(paymentSchema),
  page: pageInfoSchema,
});

export type PaymentListResponse = z.infer<typeof paymentListResponseSchema>;
