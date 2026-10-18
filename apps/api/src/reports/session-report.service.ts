import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AppointmentStatus,
  AttendanceOutcome,
  SessionReportExportQuery,
  SessionReportQuery,
  SessionReportResponse,
  SessionReportRow,
  SessionReportSummary,
} from '@clinic/contracts';
import { SEAT_OUTCOME_UNRESOLVED } from '../appointments/appointment-read.service';
import { PrismaService } from '../prisma/prisma.service';
import { pageWindow, windowClause, type ReportWindow } from './report-window';

/**
 * SESSIONS ACROSS THE WHOLE CLINIC, OVER A PERIOD.
 *
 * The frozen `GET /reports/sessions` (Milestone 7, checkpoint C1), implemented
 * in C3. It writes nothing — no row, no aggregate, no audit row — takes no lock
 * and stores no total: every figure below is derived from Milestone 4 rows on
 * the request that asks for it.
 *
 * IT CARRIES NO MONEY AT ALL, and that is the reason it is readable under the
 * diary authority both roles already hold. Not a price, not a charge, not a
 * tariff suggestion, not a flag saying whether a session was charged. A reader
 * who wants the money for these sessions opens the family account, which states
 * its own authority. Nothing in this file touches `session_charge`, and the
 * operational report must never become a financial one.
 *
 * A ROW IS A SEAT, NOT A BOOKING (frozen C1). Attendance is a fact about one
 * child — `ATTENDANCE_OUTCOMES` lives on the participant, never on the
 * appointment — so the statement below is driven from
 * `appointment_participant` and joins the booking, rather than the reverse. An
 * individual appointment has exactly one participant (CLAUDE.md), so today one
 * booking is one row; when a group booking exists it will be several, and every
 * count keeps meaning the same thing. Collapsing the seat into the booking would
 * make the question this report is most often opened for — WHICH child did not
 * arrive — unanswerable.
 *
 * THE UNRESOLVED-OUTCOME DEFINITION IS THE DAY VIEW'S, IMPORTED RATHER THAN
 * RESTATED. `SEAT_OUTCOME_UNRESOLVED` is the same predicate `/appointment-day`
 * and the dashboard badge are computed from, so a receptionist cannot be shown
 * one backlog on the dashboard and a different one on the report.
 *
 * ONE SNAPSHOT FOR THE SUMMARY AND THE PAGE. `REPEATABLE READ`, for the reason
 * the family account and the dashboard take one: this response is two
 * statements, and under `READ COMMITTED` a session completed between them would
 * produce totals describing one database and rows describing another. It takes
 * no lock and blocks no writer.
 */

/** One seat, joined to every name the report prints instead of a uuid. */
type SessionRow = {
  appointment_id: string;
  participant_id: string;
  date: string;
  starts_at: Date;
  duration_minutes: number;
  status: AppointmentStatus;
  attendance: AttendanceOutcome;
  family_id: string;
  family_name: string;
  child_id: string;
  first_name: string;
  last_name: string;
  file_number: string;
  therapist_id: string;
  therapist_name: string;
  service_id: string;
  service_name: string;
  room_id: string;
  room_name: string;
};

type SummaryRow = {
  total: number;
  scheduled: number;
  completed: number;
  cancelled: number;
  attended: number;
  no_shows: number;
  unresolved_outcomes: number;
  total_duration_minutes: number;
};

/**
 * The seats, and the booking and catalog rows a report row prints.
 *
 * DRIVEN FROM THE SEAT. `appointment_participant` leads because the row IS the
 * seat; every join from it is inner, because a seat cannot exist without its
 * appointment, its child, that child's family, and the appointment's therapist,
 * service and room — foreign keys with `ON DELETE RESTRICT` say so, and a LEFT
 * JOIN would quietly hide a broken row instead of failing loudly.
 *
 * THE NAMES ARE THE CURRENT CATALOG ROWS (frozen C1), as they are on the family
 * account: a therapist who has since been renamed prints under the new name, and
 * the ids are the fact.
 *
 * NO TARIFF LATERAL. The day view resolves a price because a receptionist is
 * arranging a booking; this report may not carry one at all, so the join simply
 * does not exist here.
 */
const SESSION_SOURCE = Prisma.sql`
  FROM appointment_participant ap
  JOIN appointment a ON a.id = ap.appointment_id
  JOIN child c ON c.id = ap.child_id
  JOIN family f ON f.id = c.family_id
  JOIN therapist t ON t.id = a.therapist_id
  JOIN service s ON s.id = a.service_id
  JOIN room r ON r.id = a.room_id
`;

@Injectable()
export class SessionReportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The sessions this filter matched, oldest first within the range.
   *
   * AN EMPTY RANGE IS A SUCCESSFUL READ (frozen C1): a fortnight the clinic did
   * nothing in returns `200`, an empty array and zeroed counts. There is no
   * `REPORT_NOT_FOUND` in `ERROR_CODES`, deliberately.
   */
  async report(query: SessionReportQuery): Promise<SessionReportResponse> {
    const filters = sessionFilters(query);
    const window = pageWindow(query);

    return this.prisma.$transaction(
      async (tx) => {
        const summary = await this.summary(tx, filters);
        const sessions = await this.rows(tx, filters, window);

        return {
          range: { from: query.from, to: query.to, dateBasis: 'SESSION_DATE' },
          summary,
          sessions,
          page: {
            page: query.page,
            pageSize: query.pageSize,
            total: summary.total,
            // Stated by the server rather than re-derived from the three numbers
            // above it by every consumer (frozen `pageInfo`).
            hasMore: window.offset + sessions.length < summary.total,
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /**
   * EVERY MATCHING SEAT, FOR THE CSV EXPORT (checkpoint C5).
   *
   * IT IS `rows` WITH NO WINDOW, AND THAT IS THE WHOLE METHOD. The same
   * predicate, the same joins, the same total order and the same mapping the
   * screen is drawn from — so an exported file cannot key a session on a
   * different day, resolve a name from a different row or classify a seat by a
   * different rule than the report it was taken from. There is no second
   * statement here to drift, and there is deliberately no summary: the file is
   * the rows.
   *
   * IT TAKES THE CALLER'S TRANSACTION rather than opening one. The export writes
   * its audit row in the same transaction that read these rows, so the recorded
   * row count describes the snapshot that was actually delivered.
   */
  async exportRows(
    tx: Prisma.TransactionClient,
    query: SessionReportExportQuery,
  ): Promise<SessionReportRow[]> {
    return this.rows(tx, sessionFilters(query), null);
  }

  /**
   * WHAT THE FILTERED REPORT ADDS UP TO — OVER THE WHOLE RESULT, NOT THE PAGE.
   *
   * A count that changed when the reader turned the page would be read as a
   * different clinic (frozen C1), so this is a separate aggregate over exactly
   * the predicate the page is drawn from — the same `filters` fragment, so the
   * two can never narrow differently — and `total` here IS the page's `total`,
   * read once rather than counted twice.
   *
   * EVERY COUNT IS A COUNT OF SEATS, INCLUDING THE BOOKING-LEVEL ONES.
   * `scheduled`, `completed` and `cancelled` classify the seat by the status of
   * the booking it sits in, and `attended`/`noShows` by the seat's own
   * attendance. The two are different questions asked of the same row, which is
   * why they do not sum to `total` and are not meant to: a completed booking may
   * still carry `PENDING`, and a cancelled one has no attendance worth reading.
   *
   * `totalDurationMinutes` IS THE BOOKED LENGTH OF EVERY MATCHED SEAT, cancelled
   * and no-show seats included, because `total` counts them too and a block whose
   * rows and duration described different sets would be read as hours delivered.
   * The therapist activity report states the narrower figure — attended minutes
   * only — under a name that says so, and is the report to read for time worked.
   *
   * The counts are cast to `int` and the duration summed as one: both are counts
   * of small integers, and neither is money.
   */
  private async summary(
    tx: Prisma.TransactionClient,
    filters: Prisma.Sql,
  ): Promise<SessionReportSummary> {
    const rows = await tx.$queryRaw<SummaryRow[]>`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE a.status = 'SCHEDULED')::int AS scheduled,
        count(*) FILTER (WHERE a.status = 'COMPLETED')::int AS completed,
        count(*) FILTER (
          WHERE a.status IN ('CANCELLED_BY_FAMILY', 'CANCELLED_BY_CLINIC')
        )::int AS cancelled,
        count(*) FILTER (WHERE ap.attendance = 'ATTENDED')::int AS attended,
        count(*) FILTER (WHERE ap.attendance = 'NO_SHOW')::int AS no_shows,
        count(*) FILTER (WHERE ${SEAT_OUTCOME_UNRESOLVED})::int AS unresolved_outcomes,
        coalesce(sum(a.duration_minutes), 0)::int AS total_duration_minutes
      ${SESSION_SOURCE}
      WHERE ${filters}
    `;

    const row = rows[0];
    // Unreachable: an ungrouped aggregate returns exactly one row, zeroed when
    // nothing matched — which is what makes an empty report a successful read.
    if (row === undefined) throw new Error('the session summary returned no row');

    return {
      total: row.total,
      scheduled: row.scheduled,
      completed: row.completed,
      cancelled: row.cancelled,
      attended: row.attended,
      noShows: row.no_shows,
      unresolvedOutcomes: row.unresolved_outcomes,
      totalDurationMinutes: row.total_duration_minutes,
    };
  }

  /**
   * The matched seats, oldest first — one page of them for a screen, all of
   * them for an export (`windowClause`).
   *
   * THE ORDER IS TOTAL, so a seat cannot appear on two pages or on neither: the
   * instant the session starts, then the booking, then the seat within it. Both
   * ids are uuidv7, so the tie-breaks are still creation order.
   *
   * `date` IS THE CLINIC CALENDAR DAY and `startsAt` the instant (frozen C1).
   * The day is decided by PostgreSQL through `clinic_date`, never by the reader's
   * timezone, and read `::text` for the reason every `DATE` in this system is:
   * Prisma maps a PostgreSQL `DATE` onto a JavaScript `Date` at UTC midnight, and
   * every conversion back through a local timezone is a chance for the day to
   * move by one.
   */
  private async rows(
    tx: Prisma.TransactionClient,
    filters: Prisma.Sql,
    window: ReportWindow | null,
  ): Promise<SessionReportRow[]> {
    const rows = await tx.$queryRaw<SessionRow[]>`
      SELECT
        a.id AS appointment_id,
        ap.id AS participant_id,
        clinic_date(a.starts_at)::text AS date,
        a.starts_at,
        a.duration_minutes,
        a.status::text AS status,
        ap.attendance::text AS attendance,
        f.id AS family_id, f.family_name,
        c.id AS child_id, c.first_name, c.last_name, c.file_number,
        t.id AS therapist_id, t.full_name AS therapist_name,
        s.id AS service_id, s.name AS service_name,
        r.id AS room_id, r.name AS room_name
      ${SESSION_SOURCE}
      WHERE ${filters}
      ORDER BY a.starts_at ASC, a.id ASC, ap.id ASC
      ${windowClause(window)}
    `;

    return rows.map((row) => ({
      appointmentId: row.appointment_id,
      participantId: row.participant_id,
      date: row.date,
      startsAt: row.starts_at.toISOString(),
      durationMinutes: row.duration_minutes,
      status: row.status,
      attendance: row.attendance,
      family: { id: row.family_id, familyName: row.family_name },
      child: {
        id: row.child_id,
        firstName: row.first_name,
        lastName: row.last_name,
        fileNumber: row.file_number,
      },
      therapist: { id: row.therapist_id, fullName: row.therapist_name },
      service: { id: row.service_id, name: row.service_name },
      room: { id: row.room_id, name: row.room_name },
      // M10.5 P1.0: before the decision table exists every absent seat of a
      // completed session is awaiting the manager. P1.3 reads the decisions.
      noShowDecision:
        row.status === 'COMPLETED' && row.attendance === 'NO_SHOW'
          ? { state: 'AWAITING' as const }
          : null,
    }));
  }
}

/**
 * THE ONE PREDICATE THE SUMMARY AND THE PAGE SHARE, so one can never narrow and
 * not the other.
 *
 * THE RANGE IS AN INSTANT RANGE OVER `starts_at`, NOT `clinic_date(a.starts_at)
 * BETWEEN $1 AND $2`. The two ask the same question, but this form is a
 * half-open comparison against a plain column and uses
 * `appointment_starts_at_idx`, while the function form is applied per row and
 * reads every appointment the clinic has ever booked. `clinic_date` is `STABLE`
 * rather than `IMMUTABLE` — timezone definitions can change — so it may not
 * appear in an index expression at all, which is exactly why the question is
 * asked from this side. It is the pattern Milestone 4's day view established and
 * the reason C1 added no `appointment` index.
 *
 * BOTH ENDS ARE INCLUSIVE (frozen C1), and the half-open instant bound is how
 * that is spelled: the range runs to the start of the day AFTER `to`, so every
 * session on `to` itself is inside it and a session at exactly midnight is
 * counted once. `clinic_day_start` keeps `Asia/Tehran` written in the database.
 *
 * THERE IS NO MAXIMUM SPAN, and the schema's only range rule — a range may not
 * end before it starts — has already been enforced by the time this runs. No
 * numeric bound is invented here.
 *
 * EVERY FILTER IS AN OPAQUE ID OR A CLOSED ENUM. There is deliberately no name
 * search and no free-text field of any kind: a child's name in a query string
 * reaches the browser history, the `Referer` header and every access log.
 *
 * `status` NARROWS THE BOOKING AND `attendance` THE SEAT, which are two different
 * questions asked of one row — "which sessions were cancelled?" and "which
 * children did not arrive?" — so they are written against the two different
 * tables rather than folded into one condition.
 *
 * `familyId` IS THE CHILD'S FAMILY. A seat belongs to a child and a child to a
 * family, and `appointment` carries no family column at all, so the predicate is
 * stated where the fact lives rather than by a second copy of the relation.
 */
function sessionFilters(query: SessionReportExportQuery): Prisma.Sql {
  const filters: Prisma.Sql[] = [
    Prisma.sql`a.starts_at >= clinic_day_start(${query.from}::date)`,
    Prisma.sql`a.starts_at < clinic_day_start((${query.to}::date + 1))`,
  ];

  if (query.familyId !== undefined) {
    filters.push(Prisma.sql`c.family_id = ${query.familyId}::uuid`);
  }
  if (query.childId !== undefined) {
    filters.push(Prisma.sql`ap.child_id = ${query.childId}::uuid`);
  }
  if (query.therapistId !== undefined) {
    filters.push(Prisma.sql`a.therapist_id = ${query.therapistId}::uuid`);
  }
  if (query.serviceId !== undefined) {
    filters.push(Prisma.sql`a.service_id = ${query.serviceId}::uuid`);
  }
  if (query.roomId !== undefined) {
    filters.push(Prisma.sql`a.room_id = ${query.roomId}::uuid`);
  }
  if (query.status !== undefined) {
    filters.push(Prisma.sql`a.status = ${query.status}::appointment_status`);
  }
  if (query.attendance !== undefined) {
    filters.push(Prisma.sql`ap.attendance = ${query.attendance}::attendance_outcome`);
  }

  return Prisma.join(filters, ' AND ');
}
