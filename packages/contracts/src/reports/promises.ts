import { z } from 'zod';
import { isoDateSchema } from '../dates';
import { ledgerPageQuerySchema, pageInfoSchema } from '../ledger/common';
import { tomanAmountSchema } from '../money';
import { promiseStatusSchema } from '../payments/common';
import { reportFamilySummarySchema, reportRangeSchema } from './common';

/**
 * Promises due, overdue, fulfilled, rescheduled and cancelled, across the whole
 * clinic (PROJECT_SPEC.md 10).
 *
 * ROUTE FROZEN HERE (Milestone 7, checkpoint C1). No controller implements it
 * yet.
 *
 *   GET /reports/promises   `promiseReportQuerySchema` -> `promiseReportResponseSchema`
 *
 * READABLE BY BOTH ROLES, UNDER `promise.read`. Chasing an overdue promise is
 * the receptionist's own work — the whole promise workflow is theirs
 * (DECISION_LOG, 2026-08-15) — and this report tells them which families to
 * telephone. It is not clinic-wide financial reporting, and the shape below is
 * what keeps that true rather than a claim about intent.
 *
 * PROMISES ARE COUNTED, NEVER SUMMED, AND THAT RULE SURVIVES INTO REPORTING. A
 * promise never alters a family's financial position in any state (CLAUDE.md),
 * so there is no `totalPromisedToman` anywhere in this file: a clinic-wide
 * promised total is a number that looks like money the clinic is owed, sits one
 * line from the amounts that really are owed, and would be added to them. Each
 * ROW carries its own promised amount, which is a fact of that promise and is
 * already visible to anybody holding `promise.read`.
 *
 * `MISSED` REMAINS DERIVED, HERE TOO. The server compares `dueOn` against the
 * clinic's calendar day in Asia/Tehran; PostgreSQL stores four states and the
 * wire carries five, exactly as it does on the family account.
 */

/**
 * Which promises to report on.
 *
 * KEYED ON `PROMISE_DUE_ON` — the day the family said it would pay. Not the day
 * the promise was recorded: a report of what falls due next week is the question
 * this surface answers, and the entry date answers a different one nobody has
 * asked for.
 *
 * `status` FILTERS THE DERIVED WORD, NOT THE STORED COLUMN, exactly as the
 * family's own promise list does: `MISSED` is accepted and means "stored `OPEN`,
 * and due before today at the clinic", and `OPEN` is the complement — still on
 * time. The five statuses partition the result, so the counts below add up.
 *
 * THERE IS NO MAXIMUM SPAN. The one range rule is that a range may not end
 * before it starts. A clinic asking for a year is asking a real question, and a
 * default opening window belongs to the surface that renders the report, not to
 * a refusal here (`reports/common.ts`).
 */
export const promiseReportQuerySchema = ledgerPageQuerySchema
  .extend({
    from: isoDateSchema,
    to: isoDateSchema,
    familyId: z.uuid().optional(),
    status: promiseStatusSchema.optional(),
  })
  .refine((value) => value.from <= value.to, 'the range must not end before it starts');

export type PromiseReportQuery = z.infer<typeof promiseReportQuerySchema>;

/**
 * One promise, as the report prints it.
 *
 * DELIBERATELY NOT THE WHOLE `promiseSchema`. A report row is what a person
 * reads down a printed column: the family to call, the amount agreed, the day it
 * was agreed for, and what became of it. The reschedule chain, the fulfilling
 * payment, the resolution actor and the note are the family promise list's, and
 * carrying them here would put a payment id and a resolution reason on every row
 * of a page that gets printed and left on a desk.
 *
 * `amountToman` IS THE AMOUNT PROMISED. It is not owed, not due and not part of
 * any total in this response.
 */
export const promiseReportRowSchema = z.strictObject({
  id: z.uuid(),
  family: reportFamilySummarySchema,
  amountToman: tomanAmountSchema,
  dueOn: isoDateSchema,
  status: promiseStatusSchema,
  createdAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
});

export type PromiseReportRow = z.infer<typeof promiseReportRowSchema>;

/**
 * How the filtered promises fall across the five statuses.
 *
 * OVER THE WHOLE FILTERED RESULT, NOT THE PAGE, and counts only — there is no
 * amount anywhere in this block, for the reason stated at the top of the file.
 *
 * The five partition the result: `open` is still on time and `missed` is open
 * and overdue, so a reader asking "how many are still on time?" reads a number
 * rather than subtracting two.
 */
export const promiseReportSummarySchema = z.strictObject({
  total: z.number().int().nonnegative(),
  open: z.number().int().nonnegative(),
  missed: z.number().int().nonnegative(),
  fulfilled: z.number().int().nonnegative(),
  rescheduled: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
});

export type PromiseReportSummary = z.infer<typeof promiseReportSummarySchema>;

/**
 * The promises this filter matched, soonest due date first.
 *
 * An empty result is a successful read: a fortnight in which nobody promised
 * anything is an answer.
 */
export const promiseReportResponseSchema = z.strictObject({
  range: reportRangeSchema,
  summary: promiseReportSummarySchema,
  promises: z.array(promiseReportRowSchema),
  page: pageInfoSchema,
});

export type PromiseReportResponse = z.infer<typeof promiseReportResponseSchema>;
