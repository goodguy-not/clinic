import { z } from 'zod';
import { isoDateSchema } from '../dates';

/**
 * The vocabulary every Milestone 7 read is spoken in: which day a report is
 * keyed on, how wide a window it may ask for, and the small identifying shapes
 * a report row prints instead of a uuid.
 *
 * WHAT MILESTONE 7 IS, AND IS NOT. It is the first clinic-wide READ of facts
 * Milestones 4, 5 and 6 already own. Nothing in this directory records anything,
 * changes anything, or introduces a second source of financial truth: there is
 * no stored balance, no reporting aggregate, no materialised view and no cached
 * total anywhere behind these shapes. Every figure is derived by NestJS on the
 * request that asks for it, over the same rows the family account is derived
 * from (CLAUDE.md, Architecture boundary — the web tier never adds money up).
 *
 * MONEY CROSSES THIS BOUNDARY EXACTLY AS IT ALREADY DOES: unsigned canonical
 * decimal strings of whole toman (`tomanAmountSchema`), never numbers.
 *
 * NO FREE TEXT IN A REPORT FILTER. Every filter in this directory is an opaque
 * entity id, a calendar date, or a closed enum. A guardian's name, a child's
 * name or a mobile number in a query string reaches the browser history, the
 * `Referer` header and every access log, which is why family search is a POST
 * (DECISION_LOG, Milestone 3) and why nothing here reopens that.
 *
 * AN EMPTY REPORT IS A SUCCESSFUL READ. A range the clinic did nothing in
 * returns `200` with an empty row array and zeroed totals — never `404`, and
 * never an error code. There is no `REPORT_NOT_FOUND` anywhere in
 * `ERROR_CODES`, deliberately: a report is a question about a period, and "no
 * sessions happened that week" is an answer.
 *
 * NO THERAPIST SHARE AND NO SETTLEMENT (CLAUDE.md — any settlement rule not
 * explicitly approved remains unresolved). Nothing here carries a percentage, a
 * therapist earning or a clinic net; the therapist activity report carries
 * counts and durations and no money at all.
 */

/**
 * WHICH DAY A REPORT IS KEYED ON, STATED BY THE SERVER RATHER THAN ASSUMED BY
 * THE READER.
 *
 * This is the distinction Milestone 7 exists to keep straight. Four different
 * business dates already live in this system, they answer four different
 * questions, and two of them are attached to the same payment row:
 *
 *   * `SESSION_DATE` — the clinic calendar day a session happened on. It is
 *     `appointment.starts_at` read in Asia/Tehran for an operational report, and
 *     `session_charge.service_date` for a financial one; the two agree by
 *     construction, because a charge snapshots the day of the session it prices.
 *     A charge posted late belongs to the session's day, never to the day it was
 *     entered.
 *   * `PAYMENT_RECEIVED_ON` — the clinic business day money ARRIVED. It may be
 *     back-dated without limit and may never be in the future, and it is the
 *     basis the payments report answers "what did the clinic take in during this
 *     period?" on.
 *   * `PAYMENT_RECORDED_AT` — the clinic day a payment was ENTERED, derived from
 *     `payment.created_at` in Asia/Tehran. It is the basis the DAILY
 *     RECONCILIATION on the dashboard uses, and it is deliberately a different
 *     question: money handed over on Thursday and entered on Saturday is in
 *     Saturday's drawer and on Thursday's takings. A single basis would make one
 *     of those two readings wrong, and the wrong one would be discovered by a
 *     receptionist whose till does not balance.
 *   * `PROMISE_DUE_ON` — the day a family said it would pay. A promise moves no
 *     money in any state, so this basis appears on no financial total anywhere.
 *
 * EVERY RANGED RESPONSE ECHOES ITS BASIS in `reportRangeSchema` below, so a
 * screen, a print header and a future export all say which day they are talking
 * about, and no consumer has to infer it from the route name.
 */
export const REPORT_DATE_BASES = [
  'SESSION_DATE',
  'PAYMENT_RECEIVED_ON',
  'PAYMENT_RECORDED_AT',
  'PROMISE_DUE_ON',
] as const;

export type ReportDateBasis = (typeof REPORT_DATE_BASES)[number];

export const reportDateBasisSchema = z.enum(REPORT_DATE_BASES);

/**
 * The widest window a single report request may ask for: one year and a day.
 *
 * A BOUND ON THE QUESTION, NOT A PERFORMANCE FEATURE. These reads are
 * clinic-wide and date-keyed, which is a new access pattern for this system: an
 * unbounded range is a request to scan every session, charge and payment the
 * clinic has ever recorded, and it arrives as a query string anybody can edit.
 * Refusing it in the contract turns a silently enormous read into a validation
 * error naming the limit.
 *
 * 366 rather than 365 so a whole year — including a leap one, and including both
 * endpoints of a full Persian year — fits without the reader discovering an
 * off-by-one at the boundary. Both ends are INCLUSIVE everywhere in this
 * directory: `from = to` is one day, and is the narrowest legal range.
 *
 * It is a range bound and nothing else. No caching, no pre-aggregation and no
 * analytics infrastructure is implied by it or permitted behind it.
 */
export const REPORT_RANGE_MAX_DAYS = 366;

/**
 * The window a ranged report was actually run over, echoed back with the day it
 * was keyed on.
 *
 * ECHOED FOR THE REASON `familyId` IS ECHOED ON EVERY FAMILY-SCOPED RESPONSE: a
 * cached, printed or shared report that does not state its own period is a page
 * of numbers nobody can date afterwards. `dateBasis` travels beside the dates
 * because the period alone does not say what was measured — "12 to 18 Mordad" is
 * three different reports depending on which day it counts.
 */
export const reportRangeSchema = z.strictObject({
  from: isoDateSchema,
  to: isoDateSchema,
  dateBasis: reportDateBasisSchema,
});

export type ReportRange = z.infer<typeof reportRangeSchema>;

/**
 * The family a report row belongs to, as a report prints it.
 *
 * TWO FIELDS, AND NEITHER IS CONTACT DATA. No guardian, no mobile, no landline,
 * no address — deliberately narrower than `familySummarySchema`, which carries
 * the primary guardian and their number because a search result is how a
 * receptionist telephones somebody. A report is a page that gets printed and
 * left on a desk (PROJECT_SPEC.md 10 requires a readable print view), so it
 * carries the name that identifies the row and the id that leads to the account.
 */
export const reportFamilySummarySchema = z.strictObject({
  id: z.uuid(),
  familyName: z.string(),
});

export type ReportFamilySummary = z.infer<typeof reportFamilySummarySchema>;

/**
 * The staff member who recorded something, as a report prints them.
 *
 * PER-USER ATTRIBUTION IS MANAGER-ONLY (the accepted Milestone 7 decision), so
 * this shape appears only inside responses that already require
 * `report.read_financial`. It carries the display name and no username, no role
 * and no account state: a report says who took the money, not who they are in
 * the user administration surface.
 */
export const reportUserSummarySchema = z.strictObject({
  id: z.uuid(),
  displayName: z.string(),
});

export type ReportUserSummary = z.infer<typeof reportUserSummarySchema>;

/** The names an interface prints instead of a uuid, as elsewhere in this package. */
export const reportNamedSchema = z.strictObject({ id: z.uuid(), name: z.string() });

export type ReportNamed = z.infer<typeof reportNamedSchema>;

/** A therapist, who has one full name rather than a name. */
export const reportTherapistSummarySchema = z.strictObject({
  id: z.uuid(),
  fullName: z.string(),
});

export type ReportTherapistSummary = z.infer<typeof reportTherapistSummarySchema>;
