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
 * IT IS ROLE-SENSITIVE, AND THE SENSITIVITY IS IN THE SHAPE OF THE RESPONSE.
 * The response is a discriminated union: a caller without
 * `report.read_financial` receives the `OWN_ENTRIES_ONLY` variant, which has no
 * clinic-wide financial key at all, and a caller who holds it receives the
 * `CLINIC_WIDE` variant, which carries one. `reconciliation` is always and only
 * the caller's own recorded payments, in both. Unauthorised clinic-wide content
 * is therefore ABSENT from the response rather than present and empty.
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
 * The pricing and data errors PROJECT_SPEC.md 10 asks the dashboard to show,
 * bounded to the two conditions this system can state from facts it already
 * holds.
 *
 * TWO COUNTS, BECAUSE THEY ARE TWO DIFFERENT PROBLEMS WITH TWO DIFFERENT FIXES —
 * and neither one implies the other in either direction. The repository makes
 * that concrete:
 *
 *   * A SESSION WHOSE PRICE CANNOT BE RESOLVED reads `MISSING` on the day view
 *     already (PROJECT_SPEC.md 5 — a missing tariff is a visible error, never a
 *     silent zero). It is usually still SCHEDULED when it matters: the fix is to
 *     record the tariff BEFORE the session is completed, because completing an
 *     unpriced session raises no charge at all —
 *     `ChargePostingService.post` returns `TARIFF_MISSING` and writes nothing,
 *     without failing the completion. A scheduled session with no price is
 *     therefore a warning, and it is not an uncharged completed session.
 *   * A COMPLETED, ATTENDED SEAT WITH NO VALID CHARGE is money the clinic has
 *     earned and not recorded. It survives the tariff being fixed: once the
 *     manager records the missing price, `MISSING` disappears from the day view
 *     and the charge still does not exist until somebody posts it, because
 *     nothing re-posts retrospectively. It also arises where no tariff was ever
 *     missing — a manager voids a charge (`charge.void`), and the seat is
 *     completed, attended and uncharged with a price list that resolves
 *     perfectly; `findValidChargeForParticipant` ignores voided rows, which is
 *     exactly what makes the re-post idempotent rather than blocked.
 *
 * So one count is "a price is missing" and the other is "a session is unbilled",
 * a state can be in either, both or neither, and a dashboard carrying only the
 * first would hide the backlog that actually costs the clinic money. Both are
 * scoped to the dashboard's day.
 *
 * THIS IS NOT A DATA-QUALITY SUBSYSTEM. Two counts over existing facts, no
 * severity, no category vocabulary, no rule engine and no stored issue record.
 *
 * THE OTHER TWO ITEMS ON PROJECT_SPEC.md 10's LIST ARE NOT HERE, AND THAT IS NOT
 * AN OVERSIGHT. Website requests belonged to the public-site inbox, which had no
 * table when this was written; Milestone 9 checkpoint A4 added the lifecycle and
 * the count now sits beside this block as `newWebsiteRequestCount` — outside
 * `dataIssues`, deliberately, because a parent writing in is not a defect. And
 * the spec's "conflicts" item is not a
 * DATA ISSUE at all: a therapist, room or child overlap is refused by a
 * PostgreSQL exclusion constraint at the moment of booking, so a conflicting
 * appointment never exists to be listed, and the reading the accepted plan
 * settled on — an authorised, recorded availability override — is a deliberate
 * act rather than an error, and is counted by `availabilityOverrideCount` below.
 */
export const dashboardDataIssuesSchema = z.strictObject({
  /**
   * Appointments on this clinic day, not cancelled, whose service, length and
   * date no tariff covers. The same `MISSING` the day view's tariff suggestion
   * states, counted.
   */
  missingTariffCount: z.number().int().nonnegative(),
  /**
   * Seats on this clinic day whose appointment is `COMPLETED` and whose
   * attendance is `ATTENDED`, carrying no charge that has not been voided. The
   * fix is a re-post (`charge.post`), which is idempotent — or, where the price
   * is also missing, recording the tariff first.
   */
  unchargedCompletedSessionCount: z.number().int().nonnegative(),
});

export type DashboardDataIssues = z.infer<typeof dashboardDataIssuesSchema>;

/**
 * THE SESSIONS SOMEBODY HAD TO AUTHORISE TO BOOK — PROJECT_SPEC.md 10's
 * "conflicts" item, as the accepted Milestone 7 plan resolved it.
 *
 * WHY A COUNT OF OVERRIDES AND NOT A CONFLICT BACKLOG. A therapist, room or
 * child overlap cannot exist: it is refused by a PostgreSQL exclusion constraint
 * at the moment of booking, so there is nothing to list and nothing for a
 * manager to resolve afterwards. The one out-of-availability booking this system
 * permits is the approved override (PROJECT_SPEC.md 5 — "blocked or requires an
 * authorized, recorded override"), which is written only by a caller holding
 * `appointment.override_availability` and only with a reason, an actor and an
 * instant that a CHECK requires to be present or absent as ONE fact. That is the
 * fact a manager reviews at the end of a day, and it is what this counts.
 *
 * IT IS DELIBERATELY NOT IN `dataIssues`. An override is a decision somebody was
 * authorised to make and recorded a reason for, not a defect: putting it beside
 * a missing tariff would tell a manager to fix something the clinic approved,
 * and would break the frozen promise that `dataIssues` states exactly two
 * conditions and nothing broader.
 *
 * IT IS NOT ON `appointmentDaySummary` EITHER. That shape belongs to
 * `GET /appointment-day` and to Milestone 4; widening an operational read to
 * carry a figure the dashboard wanted is how one screen's requirement becomes
 * another screen's contract.
 *
 * A DATED AVAILABILITY EXCEPTION IS NOT COUNTED HERE. A closed day or a dated
 * window on `therapist_availability_exception` is schedule CONFIGURATION — it
 * says when somebody works, and most of them are never booked against at all.
 * Only an APPOINTMENT that carries the recorded override fact appears in this
 * number, because only that is a session somebody placed outside the hours.
 *
 * CANCELLED APPOINTMENTS ARE EXCLUDED, for the reason they are excluded from
 * `missingTariffCount`: the session is not happening, so the authority that was
 * exercised to place it is no longer a thing to review. Both cancellation
 * statuses are excluded, and the appointment keeps its recorded override — the
 * history is not rewritten, it is simply not on this morning's list.
 *
 * A COUNT, NOT A LIST. The appointments themselves are read on
 * `GET /appointment-day`, where each one already carries its
 * `availabilityOverrideReason`; the dashboard states how many there are, exactly
 * as it states counts and never rows for everything else.
 */
export const dashboardAvailabilityOverrideCountSchema = z.number().int().nonnegative();

/**
 * THE WEBSITE REQUESTS NOBODY HAS LOOKED AT YET — the item PROJECT_SPEC.md 10
 * lists and that Milestone 7 could not implement.
 *
 * The comment on `dashboardDataIssuesSchema` above says why it was absent: the
 * public-site inbox belonged to Milestone 9 and had no table. Checkpoint A3 gave
 * it one and A4 gave it the five-status lifecycle, so this is that gap closed.
 *
 * `NEW` AND ONLY `NEW`, WHICH IS WHY THE FIELD IS NAMED FOR IT. It counts
 * requests in the ARRIVAL state — messages that have come in and that nobody at
 * the clinic has touched. Nothing in the accepted lifecycle returns to `NEW`, so
 * this number can only fall as the morning's work is done, and a colleague who
 * telephones somebody and marks the request `CONTACTED` sees it drop by one.
 * That is the property that makes a count worth putting on a dashboard;
 * a broader "open requests" figure that included `FOLLOW_UP_NEEDED` would sit
 * there all week and would be a workload metric this product has not asked for.
 *
 * IT IS NOT SCOPED TO THE DASHBOARD'S DAY, AND IT IS THE ONLY COUNT HERE THAT IS
 * NOT — the same exception `missedCount` already is, for the same reason. A
 * request that arrived three weeks ago and has never been read is exactly what
 * this exists to surface, and counting only today's arrivals would hide a
 * backlog behind a quiet morning.
 *
 * IT IS IN BOTH VARIANTS AND CARRIES NO FINANCIAL AUTHORITY. A message asking
 * for a call back is not money. What it DOES carry is `website_request.read`,
 * which is why that name joins `DASHBOARD_READ_PERMISSIONS`: a count of a
 * table's rows is a read of that table, and the permission model has to be an
 * accurate description of what the route reads.
 *
 * A COUNT, NEVER A LIST. The requests themselves are read in the inbox, under
 * the same authority — no name, no telephone number and no word a visitor typed
 * appears anywhere in this response.
 */
export const dashboardNewWebsiteRequestCountSchema = z.number().int().nonnegative();

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
 * receives is the `CLINIC_WIDE` variant below, under a dedicated authority. `scope` is
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
  /**
   * M10.5 phase 1: how many of `chargeCount` are no-show penalties for this
   * day's sessions — already counted there, stated so they can be labelled.
   */
  penaltyChargeCount: z.number().int().nonnegative(),
});

export type DashboardClinicCharges = z.infer<typeof dashboardClinicChargesSchema>;

export const dashboardClinicFinancialSchema = z.strictObject({
  payments: dashboardClinicPaymentsSchema,
  charges: dashboardClinicChargesSchema,
});

export type DashboardClinicFinancial = z.infer<typeof dashboardClinicFinancialSchema>;

/**
 * WHICH FINANCIAL VIEW THIS RESPONSE IS, STATED BY THE SERVER AS A WORD.
 *
 * The discriminator of the response below, and the reason a receptionist's
 * dashboard does not merely hide the clinic's finances — it does not contain
 * them. `OWN_ENTRIES_ONLY` is a response with no clinic-wide financial key at
 * all; `CLINIC_WIDE` is one that carries it, and only a caller holding
 * `report.read_financial` ever receives that variant.
 */
export const DASHBOARD_FINANCIAL_SCOPES = ['OWN_ENTRIES_ONLY', 'CLINIC_WIDE'] as const;

export type DashboardFinancialScope = (typeof DASHBOARD_FINANCIAL_SCOPES)[number];

export const dashboardFinancialScopeSchema = z.enum(DASHBOARD_FINANCIAL_SCOPES);

/**
 * What every dashboard carries, whoever asked for it.
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
 * `availabilityOverrideCount` IS AN OPERATIONAL FACT AND IS IN BOTH VARIANTS. It
 * is not money, so no authority beyond `appointment.read` gates it, and the
 * receptionist who booked under the override is exactly who reviews it.
 *
 * `reconciliation` IS ALWAYS THE CALLER'S OWN, in both variants below. A manager
 * balancing their own till reads the same block a receptionist does.
 *
 * NO ROW LIST OF APPOINTMENTS. The dashboard states the counts and the day view
 * — `GET /appointments/day` — is where the sessions themselves are read. One
 * request that returned both would return the busiest screen in the clinic twice
 * over on every poll.
 */
const dashboardCommonFields = {
  date: isoDateSchema,
  appointments: appointmentDaySummarySchema,
  availabilityOverrideCount: dashboardAvailabilityOverrideCountSchema,
  promises: dashboardPromiseSummarySchema,
  dataIssues: dashboardDataIssuesSchema,
  newWebsiteRequestCount: dashboardNewWebsiteRequestCountSchema,
  /**
   * M10.5 phase 1: absent seats of completed sessions with no standing manager
   * decision, clinic-wide and NOT scoped to the dashboard's day — like
   * `missedCount`, an absence nobody decided three weeks ago is still waiting.
   * Both roles see the count; deciding is `charge.adjust`.
   */
  noShowsToDecideCount: z.number().int().nonnegative(),
  reconciliation: dashboardReconciliationSchema,
} as const;

/**
 * The dashboard a caller WITHOUT `report.read_financial` receives.
 *
 * THE CLINIC-WIDE FINANCIAL CONTENT IS ABSENT, NOT NULL, AND NOT EMPTY. This is
 * a strict object with no `clinicFinancial` key, so a response carrying one —
 * even a null one, even a zeroed one — fails to parse in both tiers. An
 * unauthorised caller therefore cannot be sent clinic-wide totals, per-user
 * attribution or another user's payment rows by a serialisation mistake, and no
 * consumer has to remember to check a nullable field before rendering.
 *
 * The caller still gets everything the screen needs to work: the day's
 * appointments, the promises to chase, the two data-issue counts, and their own
 * recorded payments — scoped by NestJS to the authenticated actor, never to a
 * user id the request could state.
 */
export const ownScopedDashboardResponseSchema = z.strictObject({
  financialScope: z.literal('OWN_ENTRIES_ONLY'),
  ...dashboardCommonFields,
});

export type OwnScopedDashboardResponse = z.infer<typeof ownScopedDashboardResponseSchema>;

/**
 * The dashboard a caller WITH `report.read_financial` receives.
 *
 * `clinicFinancial` IS REQUIRED HERE, not optional and not nullable: this
 * variant exists precisely because the caller is authorised, so a `CLINIC_WIDE`
 * response that could not state the clinic's day would be a variant that means
 * nothing. A quiet day is zeros.
 */
export const clinicWideDashboardResponseSchema = z.strictObject({
  financialScope: z.literal('CLINIC_WIDE'),
  ...dashboardCommonFields,
  clinicFinancial: dashboardClinicFinancialSchema,
});

export type ClinicWideDashboardResponse = z.infer<typeof clinicWideDashboardResponseSchema>;

/**
 * One clinic day, in whichever of the two shapes the caller's authority allows.
 *
 * A DISCRIMINATED UNION RATHER THAN A NULLABLE FIELD. The authority decision is
 * made once, in NestJS, and travels as a word the consumer branches on — which
 * is the same reason `status` is stated on a payment instead of being inferred
 * from a null. It also makes the leak structurally impossible rather than
 * merely avoided: there is no shape in this package in which an
 * `OWN_ENTRIES_ONLY` response carries a clinic-wide figure.
 *
 * ONE ROUTE, TWO SHAPES. Two routes would mean two aggregations of one screen
 * and a second place for the authority rule to be stated — and a second place is
 * where it drifts.
 */
export const dashboardResponseSchema = z.discriminatedUnion('financialScope', [
  ownScopedDashboardResponseSchema,
  clinicWideDashboardResponseSchema,
]);

export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
