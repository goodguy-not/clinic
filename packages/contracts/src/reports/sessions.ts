import { z } from 'zod';
import { appointmentStatusSchema, attendanceOutcomeSchema } from '../appointments/common';
import { isoDateSchema } from '../dates';
import { chargeChildSummarySchema, ledgerPageQuerySchema, pageInfoSchema } from '../ledger/common';
import {
  reportFamilySummarySchema,
  reportNamedSchema,
  reportRangeSchema,
  reportTherapistSummarySchema,
} from './common';

/**
 * Sessions by date, family, child, therapist, service and status
 * (PROJECT_SPEC.md 10).
 *
 * ROUTE FROZEN HERE (Milestone 7, checkpoint C1). No controller implements it
 * yet.
 *
 *   GET /reports/sessions   `sessionReportQuerySchema` -> `sessionReportResponseSchema`
 *
 * AN OPERATIONAL REPORT, AND IT CARRIES NO MONEY AT ALL. Not a price, not a
 * charge, not a tariff suggestion, not a flag saying whether a session was
 * charged. That is what makes it readable by both roles under the diary
 * authority they already hold, and it is the accepted boundary: operational
 * reporting is shared, clinic-wide financial reporting is the manager's. A
 * reader who wants the money for these sessions opens the family account, which
 * states its own authority.
 *
 * A ROW IS A SEAT, NOT A BOOKING. Attendance is a fact about one child
 * (`ATTENDANCE_OUTCOMES` lives on the participant, never on the appointment), and
 * a report that could not say which child failed to arrive would be unable to
 * answer the question it is most often opened for. An individual appointment has
 * exactly one participant (CLAUDE.md), so today one booking is one row; when a
 * group booking exists, it will be several rows and every count below will still
 * mean the same thing.
 */

/**
 * Which sessions to report on.
 *
 * THE RANGE IS MANDATORY AND BOTH ENDS ARE INCLUSIVE. A clinic-wide session
 * report with no period is a request for every appointment ever booked; the
 * period is the question, not a refinement of it.
 *
 * IT IS KEYED ON `SESSION_DATE` — the clinic calendar day the session sits on,
 * in Asia/Tehran. Never the day the booking was entered, and never the reader's
 * timezone: the server compares against the clinic day boundary, which is the
 * only authority for where one day ends.
 *
 * EVERY FILTER IS AN OPAQUE ID OR A CLOSED ENUM. There is deliberately no name
 * search and no free-text field of any kind here, for the reason the appointment
 * day view has none: a child's name in a query string reaches the browser
 * history, the `Referer` header and every access log.
 *
 * `status` FILTERS THE BOOKING, `attendance` FILTERS THE SEAT, and they are two
 * different questions — "which sessions were cancelled?" and "which children did
 * not arrive?" A cancelled booking has no attendance worth reading, and a
 * completed one may still carry `PENDING`, which is the unresolved-outcome
 * backlog the dashboard counts.
 *
 * THERE IS NO MAXIMUM SPAN. The one range rule is that a range may not end
 * before it starts. A clinic asking for a year is asking a real question, and a
 * default opening window belongs to the surface that renders the report, not to
 * a refusal here (`reports/common.ts`).
 */
const sessionReportFilters = {
  from: isoDateSchema,
  to: isoDateSchema,
  familyId: z.uuid().optional(),
  childId: z.uuid().optional(),
  therapistId: z.uuid().optional(),
  serviceId: z.uuid().optional(),
  roomId: z.uuid().optional(),
  status: appointmentStatusSchema.optional(),
  attendance: attendanceOutcomeSchema.optional(),
} as const;

export const sessionReportQuerySchema = ledgerPageQuerySchema
  .extend(sessionReportFilters)
  .refine((value) => value.from <= value.to, 'the range must not end before it starts');

export type SessionReportQuery = z.infer<typeof sessionReportQuerySchema>;

/**
 * The same question, asked for a file instead of a screen (Milestone 7,
 * checkpoint C5).
 *
 *   GET /reports/sessions/export   `sessionReportExportQuerySchema` -> text/csv
 *
 * IT IS THE READ'S FILTERS AND NOTHING ELSE. One `sessionReportFilters` object
 * builds both schemas, so an export can never narrow differently from the screen
 * it was taken from — which is the whole of "an exported answer must not
 * disagree with its report".
 *
 * IT TAKES NO `page` OR `pageSize`, AND THE STRICT OBJECT REFUSES EITHER. A
 * file is the whole filtered result: paging a download would produce a
 * spreadsheet that silently omitted the rest of the period, which is precisely
 * the kind of quiet disagreement this checkpoint exists to prevent.
 *
 * THE AUTHORITY IS DIFFERENT FROM THE READ'S, and that is the frozen owner
 * decision rather than a shape: `SESSION_REPORT_EXPORT_PERMISSIONS` names
 * `report.export` beside the diary authority, and the receptionist holds only
 * the second.
 */
export const sessionReportExportQuerySchema = z
  .strictObject(sessionReportFilters)
  .refine((value) => value.from <= value.to, 'the range must not end before it starts');

export type SessionReportExportQuery = z.infer<typeof sessionReportExportQuerySchema>;

/**
 * One session, as the report prints it.
 *
 * DENORMALISED ON PURPOSE, exactly as the appointment day view is: a report of
 * two hundred sessions must print the child, the therapist, the service and the
 * room by name without an N+1 across an HTTP boundary.
 *
 * `date` IS THE CLINIC CALENDAR DAY and `startsAt` the instant. Both are carried
 * because a report is grouped and printed by the day — which the server has
 * already decided in Asia/Tehran — and sorted within it by the time.
 *
 * THE NAMES ARE RESOLVED FROM THE CURRENT CATALOG ROWS, as they are on the
 * family account: a therapist who has since been renamed prints under the new
 * name, and the ids are the fact.
 */
export const sessionReportRowSchema = z.strictObject({
  appointmentId: z.uuid(),
  participantId: z.uuid(),
  date: isoDateSchema,
  startsAt: z.iso.datetime(),
  durationMinutes: z.number().int().positive(),
  status: appointmentStatusSchema,
  attendance: attendanceOutcomeSchema,
  family: reportFamilySummarySchema,
  child: chargeChildSummarySchema,
  therapist: reportTherapistSummarySchema,
  service: reportNamedSchema,
  room: reportNamedSchema,
});

export type SessionReportRow = z.infer<typeof sessionReportRowSchema>;

/**
 * What the filtered report adds up to.
 *
 * OVER THE WHOLE FILTERED RESULT, NOT THE PAGE. A count that changed when the
 * reader turned the page would be read as a different clinic.
 *
 * FILTER-SCOPED, AND SAYS SO BY LIVING IN A BLOCK NAMED FOR THE FILTER. Every
 * number here describes exactly the rows this query matches — this therapist,
 * this fortnight — and none of them is a whole-clinic figure. That distinction
 * is the one the family account draws between `totals` and `position`, and it is
 * drawn the same way here so a reader carries one habit across both.
 *
 * `unresolvedOutcomes` is a seat that is not cancelled, whose session has ended,
 * and whose attendance is still `PENDING` — the same definition the day view's
 * `outcomeUnresolved` states, and stated by the server for the same reason: two
 * screens deciding for themselves what "already over" means eventually disagree.
 */
export const sessionReportSummarySchema = z.strictObject({
  total: z.number().int().nonnegative(),
  scheduled: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  attended: z.number().int().nonnegative(),
  noShows: z.number().int().nonnegative(),
  unresolvedOutcomes: z.number().int().nonnegative(),
  totalDurationMinutes: z.number().int().nonnegative(),
});

export type SessionReportSummary = z.infer<typeof sessionReportSummarySchema>;

/**
 * The sessions this filter matched, oldest first within the range.
 *
 * `range` IS ECHOED WITH ITS BASIS so a printed page can date itself. An empty
 * `sessions` array with zeroed counts is a successful read of a quiet week, not
 * a missing resource.
 */
export const sessionReportResponseSchema = z.strictObject({
  range: reportRangeSchema,
  summary: sessionReportSummarySchema,
  sessions: z.array(sessionReportRowSchema),
  page: pageInfoSchema,
});

export type SessionReportResponse = z.infer<typeof sessionReportResponseSchema>;
