import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  TherapistActivityQuery,
  TherapistActivityResponse,
  TherapistActivityRow,
  TherapistActivityTotals,
} from '@clinic/contracts';
import { SEAT_OUTCOME_UNRESOLVED } from '../appointments/appointment-read.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * HOW MUCH WORK EACH THERAPIST DID, AND NOT WHAT IT WAS WORTH.
 *
 * The frozen `GET /reports/therapist-activity` (Milestone 7, checkpoint C1),
 * implemented in C3. It writes nothing, locks nothing and stores nothing.
 *
 * NOT ONE FIELD OF MONEY EXISTS IN THIS FILE, AND THAT IS A DOMAIN RULE RATHER
 * THAN A SCOPE CUT. Therapist settlement is based on completed-session value and
 * on share percentages that may differ per therapist and change over time; those
 * rules belong to Milestone 8 and no part of them may be inferred before then
 * (CLAUDE.md — any settlement rule not explicitly approved remains unresolved and
 * must not be inferred). Nothing here reads `session_charge`, `tariff` or a
 * percentage of anything: a "session value" column would be the first half of a
 * settlement calculation published on a screen before anybody had approved the
 * second half.
 *
 * COUNTS AND DURATIONS ONLY, which is why this report is readable by both roles
 * under `appointment.read`: it says the same thing a person could count by
 * paging through the day views, and saves them doing it.
 *
 * THE COUNTS ARE SEATS, AS THE SESSION REPORT'S ARE. `attendedCount` is the work
 * that actually happened; `noShowCount` is the hour the therapist waited and the
 * room was held, which is precisely the number that makes a no-show policy
 * discussable when the clinic comes to approve one; `cancelledCount` released the
 * slot and is counted separately for the same reason. The three booking-status
 * counts and the two attendance counts are different questions asked of the same
 * row and are not meant to sum to each other.
 *
 * `unresolvedOutcomeCount` IS THE DAY VIEW'S OWN PREDICATE, imported rather than
 * restated (`SEAT_OUTCOME_UNRESOLVED`), so a therapist's outstanding-outcome
 * backlog reads the same here, on the dashboard and on the session report.
 *
 * IT IS NOT PAGED (frozen C1). A clinic has tens of therapists, not thousands,
 * and the whole point is that the rows are read against one another; a page two
 * would hide the comparison the reader came for.
 *
 * ONE STATEMENT, SO NO SNAPSHOT DISCIPLINE IS NEEDED. The roster and every
 * therapist's counts come out of a single query, and `totals` is the column sum
 * of the rows it returned — added up in TypeScript rather than by a second
 * aggregate, which is what makes it impossible for the two to describe different
 * databases. No transaction is opened because there is nothing for a second
 * statement to disagree with.
 */

type ActivityRow = {
  therapist_id: string;
  full_name: string;
  scheduled_count: number;
  completed_count: number;
  cancelled_count: number;
  attended_count: number;
  no_show_count: number;
  unresolved_outcome_count: number;
  attended_duration_minutes: number;
};

@Injectable()
export class TherapistActivityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every therapist the filter matched, by name.
   *
   * AN EMPTY RESULT IS A SUCCESSFUL READ (frozen C1) — a clinic with no
   * therapists yet, or a range narrowed to a service nobody active provides,
   * returns `200` with an empty array and zeroed totals.
   */
  async report(query: TherapistActivityQuery): Promise<TherapistActivityResponse> {
    const rows = await this.prisma.$queryRaw<ActivityRow[]>`
      WITH activity AS (
        SELECT
          a.therapist_id,
          count(*) FILTER (WHERE a.status = 'SCHEDULED')::int AS scheduled_count,
          count(*) FILTER (WHERE a.status = 'COMPLETED')::int AS completed_count,
          count(*) FILTER (
            WHERE a.status IN ('CANCELLED_BY_FAMILY', 'CANCELLED_BY_CLINIC')
          )::int AS cancelled_count,
          count(*) FILTER (WHERE ap.attendance = 'ATTENDED')::int AS attended_count,
          count(*) FILTER (WHERE ap.attendance = 'NO_SHOW')::int AS no_show_count,
          count(*) FILTER (WHERE ${SEAT_OUTCOME_UNRESOLVED})::int AS unresolved_outcome_count,
          coalesce(
            sum(a.duration_minutes) FILTER (WHERE ap.attendance = 'ATTENDED'), 0
          )::int AS attended_duration_minutes
        FROM appointment_participant ap
        JOIN appointment a ON a.id = ap.appointment_id
        WHERE ${activityFilters(query)}
        GROUP BY a.therapist_id
      )
      SELECT
        t.id AS therapist_id,
        t.full_name,
        coalesce(activity.scheduled_count, 0) AS scheduled_count,
        coalesce(activity.completed_count, 0) AS completed_count,
        coalesce(activity.cancelled_count, 0) AS cancelled_count,
        coalesce(activity.attended_count, 0) AS attended_count,
        coalesce(activity.no_show_count, 0) AS no_show_count,
        coalesce(activity.unresolved_outcome_count, 0) AS unresolved_outcome_count,
        coalesce(activity.attended_duration_minutes, 0) AS attended_duration_minutes
      FROM therapist t
      LEFT JOIN activity ON activity.therapist_id = t.id
      WHERE ${rosterFilter(query)}
      ORDER BY t.full_name ASC, t.id ASC
    `;

    const therapists = rows.map(toRow);

    return {
      range: { from: query.from, to: query.to, dateBasis: 'SESSION_DATE' },
      totals: totalsOf(therapists),
      therapists,
    };
  }
}

/**
 * WHICH SEATS ARE COUNTED — the range, and the one kind of work.
 *
 * KEYED ON `SESSION_DATE`, as an instant range over `starts_at` and not
 * `clinic_date(a.starts_at) BETWEEN $1 AND $2`: the range form is a half-open
 * comparison against a plain column and uses
 * `appointment_therapist_id_starts_at_idx` in the narrowed form and
 * `appointment_starts_at_idx` otherwise, while the function form is applied per
 * row and reads every appointment the clinic has ever booked. `clinic_date` is
 * `STABLE` and may not appear in an index expression at all.
 *
 * BOTH ENDS ARE INCLUSIVE, spelled as a range running to the start of the day
 * AFTER `to`, so a session on `to` itself is inside it. THERE IS NO MAXIMUM SPAN.
 *
 * `serviceId` NARROWS THE WORK, NOT THE ROSTER. It restricts which seats are
 * counted; who appears in the report is decided separately, below, so a
 * therapist on the active roster who did none of that service is a zero row
 * rather than a missing one.
 *
 * `therapistId` IS APPLIED HERE TOO, not only to the roster: narrowing the
 * counted seats as well as the listed rows means the same statement does less
 * work, and the two predicates are the same value so they cannot disagree.
 */
function activityFilters(query: TherapistActivityQuery): Prisma.Sql {
  const filters: Prisma.Sql[] = [
    Prisma.sql`a.starts_at >= clinic_day_start(${query.from}::date)`,
    Prisma.sql`a.starts_at < clinic_day_start((${query.to}::date + 1))`,
  ];

  if (query.therapistId !== undefined) {
    filters.push(Prisma.sql`a.therapist_id = ${query.therapistId}::uuid`);
  }
  if (query.serviceId !== undefined) {
    filters.push(Prisma.sql`a.service_id = ${query.serviceId}::uuid`);
  }

  return Prisma.join(filters, ' AND ');
}

/**
 * WHO APPEARS IN THE REPORT — which is a different question from whose work is
 * counted.
 *
 * A THERAPIST WHO HAS LEFT THE CLINIC DID THE WORK THEY DID, AND IT IS ALWAYS
 * COUNTED. Nothing above filters on `therapist.status`; what this decides is only
 * whether a therapist with NO activity in the period appears as a zero row
 * (frozen C1).
 *
 *   * `includeInactive=false` (the default) — the active roster, PLUS anybody
 *     who worked in the period whatever their status now is. That is the weekly
 *     review: the people who are here, and nobody's departure quietly deleting
 *     the sessions they ran.
 *   * `includeInactive=true` — every therapist the clinic has ever recorded,
 *     which is what a year-end comparison wants.
 *
 * A NAMED THERAPIST ALWAYS APPEARS. `therapistId` is how one person's own month
 * is read (frozen C1), and answering an explicit request for one therapist with
 * an empty list — because they are inactive and had a quiet fortnight — would
 * make the reader unable to tell "no sessions" from "wrong id". The zero row is
 * the answer to the question that was asked. `includeInactive` is therefore not
 * consulted at all when a therapist is named; it decides who joins a roster, and
 * a roster of one has already been decided.
 */
function rosterFilter(query: TherapistActivityQuery): Prisma.Sql {
  if (query.therapistId !== undefined) {
    return Prisma.sql`t.id = ${query.therapistId}::uuid`;
  }

  if (query.includeInactive) return Prisma.sql`TRUE`;

  return Prisma.sql`(t.status = 'ACTIVE' OR activity.therapist_id IS NOT NULL)`;
}

function toRow(row: ActivityRow): TherapistActivityRow {
  return {
    therapist: { id: row.therapist_id, fullName: row.full_name },
    scheduledCount: row.scheduled_count,
    completedCount: row.completed_count,
    cancelledCount: row.cancelled_count,
    attendedCount: row.attended_count,
    noShowCount: row.no_show_count,
    unresolvedOutcomeCount: row.unresolved_outcome_count,
    attendedDurationMinutes: row.attended_duration_minutes,
  };
}

/**
 * THE COLUMN SUM OF THE ROWS ABOVE — the clinic's own activity over the same
 * period, filter-scoped like every other total in this directory.
 *
 * ADDED UP FROM THE ROWS THAT WERE RETURNED, not by a second aggregate query.
 * The frozen contract says `totals` IS the column sum, so a reader who adds the
 * column by hand reaches the server's answer; computing it separately would let
 * the two describe different snapshots and would be the one number nobody
 * notices drifting.
 *
 * `therapistCount` is the number of ROWS, including zero rows: it says how many
 * therapists this report is about, not how many were busy.
 *
 * `attendedDurationMinutes` IS THE ONLY DURATION SUMMED, HERE AS ON EVERY ROW.
 * Adding the booked minutes of cancellations and no-shows into one "hours
 * worked" figure would produce a number that reads as time delivered and is not —
 * and it is a number somebody would eventually multiply by a rate.
 */
function totalsOf(rows: readonly TherapistActivityRow[]): TherapistActivityTotals {
  const sum = (pick: (row: TherapistActivityRow) => number): number =>
    rows.reduce((running, row) => running + pick(row), 0);

  return {
    therapistCount: rows.length,
    scheduledCount: sum((row) => row.scheduledCount),
    completedCount: sum((row) => row.completedCount),
    cancelledCount: sum((row) => row.cancelledCount),
    attendedCount: sum((row) => row.attendedCount),
    noShowCount: sum((row) => row.noShowCount),
    unresolvedOutcomeCount: sum((row) => row.unresolvedOutcomeCount),
    attendedDurationMinutes: sum((row) => row.attendedDurationMinutes),
  };
}
