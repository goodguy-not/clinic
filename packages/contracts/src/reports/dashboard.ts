import { z } from 'zod';
import { appointmentDaySummarySchema } from '../appointments/day';
import { isoDateSchema } from '../dates';
import { tomanAmountSchema } from '../money';
import { paymentMethodSchema, paymentSummarySchema } from '../payments/common';
import { reportFamilySummarySchema, reportUserSummarySchema } from './common';

/**
 * The clinic day at a glance (PROJECT_SPEC.md 10).
 *
 * ROUTE FROZEN HERE (Milestone 7, checkpoint C1). No controller implements it
 * yet; the shape is settled first so the API and web workstreams build against
 * one description rather than two guesses.
 *
 *   GET /dashboard   `dashboardQuerySchema` -> `dashboardResponseSchema`
 *
 * ONE REQUEST, ONE DAY, ONE ANSWER. The dashboard is the screen a receptionist
 * has open all morning, so it is a single aggregation NestJS performs rather
 * than four reads a browser stitches together — which is also the only way the
 * badge and the list beneath it can be guaranteed to agree
 * (`outcomeUnresolved`, the same reasoning, on the appointment day view).
 *
 * IT IS ROLE-SENSITIVE, AND THE SENSITIVITY IS IN THE RESPONSE RATHER THAN IN
 * TWO ROUTES. `clinicFinancial` is null for a caller without
 * `report.read_financial`, and `reconciliation` is always and only the caller's
 * own recorded payments. Two routes would mean two aggregations of one screen
 * and a second place for the authority rule to be stated — and a second place is
 * where it drifts.
 */

/**
 * Which day the dashboard describes.
 *
 * `date` IS OPTIONAL AND THE SERVER DECIDES THE DEFAULT. Omitted, it is the
 * clinic's own calendar day in Asia/Tehran, which a browser must not compute —
 * a receptionist opening the screen at 00:30 must see the day the clinic is in,
 * not the day the laptop's timezone is in. The response echoes the day that was
 * actually used.
 *
 * Supplying it is how yesterday is reviewed. There is no range: a range over
 * this shape is a report, and the reports have their own routes.
 */
export const dashboardQuerySchema = z.strictObject({
  date: isoDateSchema.optional(),
});

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

/**
 * What the clinic has promised itself to chase, counted and never summed.
 *
 * COUNTS ONLY, AS THE FAMILY POSITION COUNTS THEM (CLAUDE.md — a promise never
 * alters financial position). A promised total on a dashboard beside a day's
 * takings is an invitation to add the two together, and the sum would be a
 * number this product does not recognise.
 *
 * `dueTodayCount` is the open promises whose due date IS the dashboard's day;
 * `missedCount` is every open promise anywhere in the clinic whose due date is
 * earlier than the clinic's today — the derived `MISSED` reading, which is not
 * scoped to the dashboard's day, because an overdue promise from three weeks ago
 * is still overdue this morning and is exactly what the screen exists to
 * surface.
 */
export const dashboardPromiseSummarySchema = z.strictObject({
  dueTodayCount: z.number().int().nonnegative(),
  missedCount: z.number().int().nonnegative(),
});

export type DashboardPromiseSummary = z.infer<typeof dashboardPromiseSummarySchema>;

/**
 * The data errors PROJECT_SPEC.md 10 asks the dashboard to show, as far as this
 * product can currently produce any.
 *
 * ONE COUNT, AND IT IS THE PRICING ONE. A session whose date and service no
 * tariff covers reads `MISSING` on the day view already (PROJECT_SPEC.md 5 — a
 * missing tariff is a visible error, never a silent zero), and the dashboard
 * says how many of today's sessions are in that state so somebody records the
 * tariff before the sessions are completed and cannot be priced.
 *
 * THE OTHER TWO ITEMS ON THAT LIST ARE NOT HERE, AND THAT IS NOT AN OVERSIGHT.
 * Website requests belong to the public-site inbox, which is Milestone 9 and has
 * no table yet. Booking conflicts have no backlog to count: a therapist, room or
 * child overlap is refused by a PostgreSQL exclusion constraint at the moment of
 * booking, so a conflicting appointment never exists to be listed.
 */
export const dashboardDataIssuesSchema = z.strictObject({
  missingTariffCount: z.number().int().nonnegative(),
});

export type DashboardDataIssues = z.infer<typeof dashboardDataIssuesSchema>;

/**
 * One method's share of a day's money.
 *
 * ALWAYS ALL THREE METHODS, IN `PAYMENT_METHODS` ORDER, ZERO-FILLED. A method
 * with no payments is a zero row rather than an absent one, so a reconciliation
 * screen has the same three lines every day and a reader counting the cash
 * drawer never has to notice that "cash" is missing rather than empty.
 */
export const dashboardMethodTotalSchema = z.strictObject({
  method: paymentMethodSchema,
  count: z.number().int().nonnegative(),
  totalToman: tomanAmountSchema,
});

export type DashboardMethodTotal = z.infer<typeof dashboardMethodTotalSchema>;

/**
 * One payment entry in the caller's own reconciliation list.
 *
 * The family is named so the person reconciling can recognise the entry; the
 * payment is the frozen five-field summary, whose `status` is where a voided
 * entry declares itself.
 */
export const dashboardPaymentEntrySchema = z.strictObject({
  payment: paymentSummarySchema,
  family: reportFamilySummarySchema,
});

export type DashboardPaymentEntry = z.infer<typeof dashboardPaymentEntrySchema>;

/**
 * THE CALLER'S OWN DAY AT THE COUNTER — and the boundary that keeps a shared
 * dashboard from leaking the clinic's finances to a receptionist.
 *
 * THE AUTHORITY RULE, STATED ONCE AND ENFORCED IN NESTJS. Every entry, count and
 * sum in this block is limited to the payments THIS CALLER recorded. It contains
 * no other user's payments, no clinic-wide payment total and no clinic-wide
 * charge or revenue figure. A manager reading the dashboard sees their own
 * entries here too, exactly as a receptionist does; what a manager additionally
 * receives is `clinicFinancial` below, under a dedicated authority. `scope` is
 * carried on the wire so the screen can label the block honestly rather than
 * letting a reader assume they are looking at the clinic's day.
 *
 * IT IS KEYED ON `PAYMENT_RECORDED_AT`, NOT ON `PAYMENT_RECEIVED_ON`, AND THAT
 * IS THE WHOLE POINT OF THE BLOCK. This answers "what did I enter today?" — the
 * question a till is balanced against — so a payment received last Thursday and
 * entered this morning belongs here today. The payments report answers "what did
 * the clinic take in during this period?" and keys on the day the money arrived,
 * so the same payment appears there under Thursday. Neither is a correction of
 * the other, and a consumer must never treat one as a substitute for the other.
 *
 * VOIDED ENTRIES ARE COUNTED SEPARATELY AND SUMMED NOWHERE.
 * `confirmedTotalToman` and `byMethod` count confirmed payments only — voided
 * money is money the clinic says it never received — while `voidedCount` is
 * stated so a reversal is visible without switching a filter, exactly as
 * `voidedPaymentCount` is on the family position. `entries` lists both, and each
 * entry says which it is.
 *
 * THE LIST IS UNPAGED, DELIBERATELY. It is one person's entries on one day —
 * bounded by how many payments a human can take at a counter, which is tens —
 * and paging a reconciliation list would let somebody balance a till against
 * page one.
 */
export const dashboardReconciliationSchema = z.strictObject({
  scope: z.literal('RECORDED_BY_ME'),
  dateBasis: z.literal('PAYMENT_RECORDED_AT'),
  confirmedCount: z.number().int().nonnegative(),
  confirmedTotalToman: tomanAmountSchema,
  voidedCount: z.number().int().nonnegative(),
  byMethod: z.array(dashboardMethodTotalSchema),
  entries: z.array(dashboardPaymentEntrySchema),
});

export type DashboardReconciliation = z.infer<typeof dashboardReconciliationSchema>;

/**
 * The clinic's whole day of money. MANAGER-ONLY, under `report.read_financial`.
 *
 * NULL MEANS "NOT AUTHORISED", NEVER "ZERO". The key is present on every
 * response and carries null for a caller without the authority, so a screen can
 * distinguish a day with no money from a day it may not see. A response that
 * simply omitted the key would make the two indistinguishable to a consumer that
 * forgot to check.
 *
 * TWO BLOCKS, TWO BASES, AND THEY ARE NOT ADDED TOGETHER. `payments` is keyed on
 * `PAYMENT_RECORDED_AT` so it reconciles against every user's own block above
 * and sums to the clinic's entry day; `charges` is keyed on `SESSION_DATE`,
 * because a charge belongs to the session it prices and not to the day somebody
 * posted it. Charged and received are different facts about different days, and
 * no field here subtracts one from the other — what a family owes is the family
 * account's answer, and no clinic-wide balance is stated anywhere in Milestone 7.
 *
 * `byUser` IS THE PER-USER FINANCIAL ATTRIBUTION the accepted plan keeps with
 * the manager. It is the reason this whole block sits behind an authority of its
 * own rather than behind `payment.read`, which a receptionist holds.
 */
export const dashboardUserTotalSchema = z.strictObject({
  user: reportUserSummarySchema,
  confirmedCount: z.number().int().nonnegative(),
  confirmedTotalToman: tomanAmountSchema,
  voidedCount: z.number().int().nonnegative(),
});

export type DashboardUserTotal = z.infer<typeof dashboardUserTotalSchema>;

export const dashboardClinicPaymentsSchema = z.strictObject({
  dateBasis: z.literal('PAYMENT_RECORDED_AT'),
  confirmedCount: z.number().int().nonnegative(),
  confirmedTotalToman: tomanAmountSchema,
  voidedCount: z.number().int().nonnegative(),
  byMethod: z.array(dashboardMethodTotalSchema),
  byUser: z.array(dashboardUserTotalSchema),
});

export type DashboardClinicPayments = z.infer<typeof dashboardClinicPaymentsSchema>;

/**
 * What the clinic charged for the sessions of this day.
 *
 * `netChargedTotalToman` IS THE CHARGES LESS THE CONCESSIONS STILL ACTIVE
 * AGAINST THEM, the same arithmetic the family account states under the same
 * name — one meaning per name, across every response in this system. Voided
 * charges count for nothing and voided adjustments reduce nothing.
 *
 * IT IS NOT REVENUE AND IT IS NOT A BALANCE. It says what was charged for one
 * day's sessions; what has been paid is the payments block, on a different basis
 * and about a different fact.
 */
export const dashboardClinicChargesSchema = z.strictObject({
  dateBasis: z.literal('SESSION_DATE'),
  chargeCount: z.number().int().nonnegative(),
  netChargedTotalToman: tomanAmountSchema,
  voidedChargeCount: z.number().int().nonnegative(),
});

export type DashboardClinicCharges = z.infer<typeof dashboardClinicChargesSchema>;

export const dashboardClinicFinancialSchema = z.strictObject({
  payments: dashboardClinicPaymentsSchema,
  charges: dashboardClinicChargesSchema,
});

export type DashboardClinicFinancial = z.infer<typeof dashboardClinicFinancialSchema>;

/**
 * One clinic day, as both roles read it.
 *
 * `date` IS ECHOED because the request may not have stated one, and a screen
 * that cannot say which day it is showing is a screen that will eventually show
 * yesterday without saying so.
 *
 * `appointments` IS THE EXISTING DAY SUMMARY, REUSED RATHER THAN RESTATED. The
 * day view already counts the total, the scheduled, the completed, the
 * cancelled, the unresolved outcomes and the no-shows for a clinic date; a
 * second shape counting the same six things would be a second place for
 * "unresolved" to mean something slightly different.
 *
 * NO ROW LIST OF APPOINTMENTS. The dashboard states the counts and the day view
 * — `GET /appointments/day` — is where the sessions themselves are read. One
 * request that returned both would return the busiest screen in the clinic twice
 * over on every poll.
 */
export const dashboardResponseSchema = z.strictObject({
  date: isoDateSchema,
  appointments: appointmentDaySummarySchema,
  promises: dashboardPromiseSummarySchema,
  dataIssues: dashboardDataIssuesSchema,
  reconciliation: dashboardReconciliationSchema,
  clinicFinancial: dashboardClinicFinancialSchema.nullable(),
});

export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
