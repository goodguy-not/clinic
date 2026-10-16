import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AvailabilityExceptionListQuery,
  ClosureAffectedAppointment,
  ClosureConflictQuery,
  CreateAvailabilityExceptionRequest,
  ResolveAvailabilityQuery,
  ResolvedAvailability,
  ReplaceAvailabilityWindowsRequest,
  TherapistAvailability,
  TherapistAvailabilityException,
} from '@clinic/contracts';
import { isWithinAvailability } from '../appointments/booking-support';
import { AuditService } from '../audit/audit.service';
import type { AuditJsonObject } from '../audit/audit.types';
import { actorContext, canonicalOptionalText } from '../catalog/catalog-support';
import { AppError } from '../common/app-error';
import { violatesConstraint } from '../common/pg-error';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { uuidv7 } from '../common/uuid';
import { PrismaService } from '../prisma/prisma.service';
import { findOverlappingPair, mergeWindows, subtractWindows } from './window-merge';

/**
 * A therapist's working hours: the recurring week, the dated exceptions to it,
 * and the resolved answer for one date.
 *
 * WHAT THIS CHECKPOINT DOES NOT DO. Nothing here books, reschedules or refuses
 * an appointment. `resolve` answers "when does this therapist work on this
 * date"; whether an appointment outside that answer is blocked outright or
 * allowed with a recorded override (PROJECT_SPEC.md 5) is the booking
 * checkpoint's decision, and no method here presumes it.
 *
 * RECURRING AVAILABILITY IS CURRENT CONFIGURATION, WITH NO EFFECTIVE DATING.
 * A window is a weekday and two times. It applies whenever it is asked about,
 * and the way a therapist's hours change on a date is that somebody edits the
 * set on that date — the set that was replaced is history in `audit_log`, not a
 * row still sitting in the table waiting to apply.
 *
 * `therapist_availability` was created with `effective_from` and `effective_to`
 * for that capability; the availability migration drops both, so there is no
 * date on a window anywhere in this module — not in a request, not in a row, not
 * in a constraint and not in a response.
 *
 * THREE RULES SHAPE EVERY WRITE, AND THE DATABASE ENFORCES ALL THREE:
 *
 *  1. Two recurring windows may not cover the same weekday and overlapping
 *     hours. `therapist_availability_no_overlap_excl` decides that, which is
 *     what makes it hold when two managers save at once.
 *  2. A dated exception may not collide with another on the same date: closures
 *     on it may not overlap (a whole-day closure overlaps all of them), extra
 *     windows on it may not overlap each other, and a partial closure may not
 *     overlap an extra window (M10-A9).
 *  3. A window ends after it starts and carries no seconds. Two CHECKs.
 *
 * LOCKING. Every mutation takes the therapist row `FOR UPDATE` first and holds
 * it for the transaction. That is stronger than the `FOR SHARE` the tariff paths
 * take, and deliberately: replacing a set is a delete followed by inserts, and
 * two share-locked replacements would interleave into a union of both
 * submissions — a state neither manager asked for, and one the exclusion
 * constraint cannot always catch because two disjoint sets do not overlap. One
 * therapist's availability is therefore edited one request at a time. It is a
 * single lock and can form no cycle with any other path.
 *
 * INACTIVE THERAPISTS ARE READ-ONLY HERE, matching tariff creation: entering
 * hours for somebody who no longer works at the clinic is nearly always a
 * mistaken identity rather than an intention. Reads are unaffected, because a
 * past appointment was booked against hours that were real at the time.
 */

type AvailabilityRow = {
  id: string;
  therapist_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  created_at: Date;
};

type ConflictRow = {
  id: string;
  series_id: string | null;
  starts_at: Date;
  ends_at: Date;
  availability_override_reason: string | null;
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
};

type ConflictSeatRow = {
  appointment_id: string;
  id: string;
  family_id: string;
  first_name: string;
  last_name: string;
  file_number: string;
};

type ExceptionRow = {
  id: string;
  therapist_id: string;
  exception_date: string;
  is_available: boolean;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
  created_at: Date;
};

/**
 * Times and dates are formatted by PostgreSQL, never converted through a
 * JavaScript `Date`.
 *
 * A `time` column has no date and a `date` column has no time; the Prisma client
 * has a type for neither and hands both back as instants pinned to 1970 or to
 * midnight UTC. Those values answer timezone questions they have no business
 * answering, and the answers are wrong either side of midnight. `to_char` and
 * `::text` produce exactly the `HH:MM` and `YYYY-MM-DD` the contract carries,
 * with no instant in between.
 */
const AVAILABILITY_COLUMNS = Prisma.sql`
  id, therapist_id, weekday,
  to_char(start_time, 'HH24:MI') AS start_time,
  to_char(end_time, 'HH24:MI') AS end_time,
  created_at
`;

const EXCEPTION_COLUMNS = Prisma.sql`
  id, therapist_id,
  exception_date::text AS exception_date,
  is_available,
  to_char(start_time, 'HH24:MI') AS start_time,
  to_char(end_time, 'HH24:MI') AS end_time,
  reason, created_at
`;

/**
 * Saturday-first, from a `DATE`.
 *
 * PostgreSQL's `EXTRACT(DOW)` begins on Sunday; the clinic's week begins on
 * Saturday and that is what `therapist_availability.weekday` stores. The
 * translation happens here, at the boundary that reads a calendar value, and the
 * native numbering is never stored or returned. There is no `AT TIME ZONE` in
 * this expression because a `DATE` is already a calendar day — the conversion
 * from an instant to a clinic day belongs to the code that holds an instant,
 * which is the booking checkpoint.
 */
const CLINIC_WEEKDAY = (date: string): Prisma.Sql =>
  Prisma.sql`((EXTRACT(DOW FROM ${date}::date)::int + 1) % 7)`;

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The therapist's whole week.
   *
   * There is no date filter, and there is nothing for one to do: every window is
   * in force, which is what current configuration means.
   */
  async listWindows(therapistId: string): Promise<TherapistAvailability[]> {
    await this.assertTherapistExists(therapistId);

    const rows = await this.prisma.$queryRaw<AvailabilityRow[]>`
      SELECT ${AVAILABILITY_COLUMNS} FROM therapist_availability
      WHERE therapist_id = ${therapistId}::uuid
      ORDER BY weekday ASC, start_time ASC
    `;

    return rows.map(toAvailability);
  }

  async listExceptions(
    therapistId: string,
    query: AvailabilityExceptionListQuery,
  ): Promise<TherapistAvailabilityException[]> {
    await this.assertTherapistExists(therapistId);

    const from =
      query.from === undefined
        ? Prisma.empty
        : Prisma.sql`AND exception_date >= ${query.from}::date`;
    const to =
      query.to === undefined ? Prisma.empty : Prisma.sql`AND exception_date <= ${query.to}::date`;

    const rows = await this.prisma.$queryRaw<ExceptionRow[]>`
      SELECT ${EXCEPTION_COLUMNS} FROM therapist_availability_exception
      WHERE therapist_id = ${therapistId}::uuid ${from} ${to}
      -- Closed days first within a date: the whole-day fact before any window,
      -- because that is the order somebody reads the day in. NULLS FIRST is what
      -- puts it there, since a closed day carries no start.
      ORDER BY exception_date ASC, start_time ASC NULLS FIRST
    `;

    return rows.map(toException);
  }

  /**
   * Replaces the whole recurring set for one therapist.
   *
   * Wholesale rather than diffed, exactly as guardians and supported services
   * are: these rows carry no history of their own, nothing references them, and
   * the set that was replaced is preserved in `audit_log` as values. Both
   * statements are in one transaction, so a refused window leaves the previous
   * week intact rather than a half-applied one.
   *
   * An empty set is legitimate and clears the therapist's standing hours.
   */
  async replaceWindows(
    therapistId: string,
    input: ReplaceAvailabilityWindowsRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<TherapistAvailability[]> {
    // Refused before the transaction opens: a submission that contradicts itself
    // is an input mistake, and it must produce the same error as one that
    // contradicts a stored row rather than whichever insert landed second.
    if (findOverlappingPair(input.windows) !== null) {
      throw new AppError('AVAILABILITY_WINDOW_OVERLAP');
    }

    const rows = await this.prisma.$transaction(async (tx) => {
      await this.lockActiveTherapist(tx, therapistId);

      const before = await this.readWindows(tx, therapistId);

      await tx.$executeRaw`
        DELETE FROM therapist_availability WHERE therapist_id = ${therapistId}::uuid
      `;

      for (const window of input.windows) {
        try {
          await tx.$executeRaw`
            INSERT INTO therapist_availability (
              id, therapist_id, weekday, start_time, end_time,
              created_at, created_by_user_id
            ) VALUES (
              ${uuidv7()}::uuid,
              ${therapistId}::uuid,
              ${window.weekday},
              ${window.startTime}::time,
              ${window.endTime}::time,
              transaction_timestamp(),
              ${actor.userId}::uuid
            )
          `;
        } catch (error) {
          throw translateAvailabilityWrite(error);
        }
      }

      const after = await this.readWindows(tx, therapistId);

      // Recorded against the therapist, not against a window id: availability is
      // current configuration replaced as a set, so the change is the two sets,
      // and no audit row ever names a window that no longer exists.
      await this.audit.record(tx, actorContext(actor, context), {
        action: 'therapist_availability.updated',
        entityType: 'therapist',
        entityId: therapistId,
        before: { windows: before.map(auditWindow) },
        after: { windows: after.map(auditWindow) },
        metadata: { change: 'windows_replaced' },
      });

      return after;
    });

    return rows.map(toAvailability);
  }

  /**
   * Adds a closure (whole-day or partial) or an extra window.
   *
   * A closure cancels and moves nothing. The scheduled appointments it leaves
   * outside the therapist's hours are read on the same transaction and returned
   * with it, so the manager is shown them at the moment of closing; the same
   * list stays readable afterwards through `listClosureConflicts`.
   */
  async addException(
    therapistId: string,
    input: CreateAvailabilityExceptionRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<{
    exception: TherapistAvailabilityException;
    affectedAppointments: ClosureAffectedAppointment[];
  }> {
    const reason = canonicalOptionalText(input.reason);
    // Absent and null are one answer for a closure: no times is the whole day.
    const startTime = input.startTime ?? null;
    const endTime = input.endTime ?? null;
    const id = uuidv7();

    const row = await this.prisma.$transaction(async (tx) => {
      await this.lockActiveTherapist(tx, therapistId);

      try {
        await tx.$executeRaw`
          INSERT INTO therapist_availability_exception (
            id, therapist_id, exception_date, is_available, start_time, end_time,
            reason, created_at, created_by_user_id
          ) VALUES (
            ${id}::uuid,
            ${therapistId}::uuid,
            ${input.exceptionDate}::date,
            ${input.isAvailable},
            ${startTime}::time,
            ${endTime}::time,
            ${reason},
            transaction_timestamp(),
            ${actor.userId}::uuid
          )
        `;
      } catch (error) {
        throw translateExceptionWrite(error);
      }

      const written = await this.readException(tx, therapistId, id);

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'therapist_availability.updated',
        entityType: 'therapist',
        entityId: therapistId,
        after: { exception: auditException(written) },
        metadata: { change: 'exception_added' },
      });

      // An extra window only adds hours, so it can leave nothing outside them.
      const affected = written.is_available
        ? []
        : await this.closureConflictsOn(
            tx,
            therapistId,
            written.exception_date,
            written.exception_date,
          );

      return { written, affected };
    });

    return { exception: toException(row.written), affectedAppointments: row.affected };
  }

  /**
   * The scheduled appointments that closures in a date range have left outside
   * the therapist's hours (M10-A9).
   *
   * NOTHING IS CANCELLED OR MOVED, here or anywhere a closure is written. This
   * is how the conflict is surfaced: a manager who closed a day — or part of one
   * — sees which sessions still sit in it and decides with the families what
   * happens to each. Reads are allowed for an inactive therapist, as every
   * availability read is.
   */
  async listClosureConflicts(
    therapistId: string,
    query: ClosureConflictQuery,
  ): Promise<ClosureAffectedAppointment[]> {
    await this.assertTherapistExists(therapistId);

    return this.closureConflictsOn(this.prisma, therapistId, query.from, query.to);
  }

  /**
   * One rule for both callers. An appointment is a closure conflict when it is
   * `SCHEDULED`, falls on a date carrying a closure, overlaps a closed range on
   * that date (a whole-day closure is the whole date), and is not inside the
   * resolved availability of that date.
   *
   * The last condition is the resolution itself, read through `resolveOn`, so a
   * session inside an extra window on a closed day is not reported — the window
   * is exactly why it is still fine — and the precedence is stated once.
   *
   * The clinic's calendar and clock come from PostgreSQL (`clinic_date`,
   * `clinic_clock_time`, `clinic_day_start`), so Asia/Tehran is applied where it
   * always is and never in this process.
   */
  private async closureConflictsOn(
    client: PrismaService | Prisma.TransactionClient,
    therapistId: string,
    from: string,
    to: string,
  ): Promise<ClosureAffectedAppointment[]> {
    const closedDates = await client.$queryRaw<{ exception_date: string }[]>`
      SELECT DISTINCT exception_date::text AS exception_date
      FROM therapist_availability_exception
      WHERE therapist_id = ${therapistId}::uuid
        AND is_available = false
        AND exception_date BETWEEN ${from}::date AND ${to}::date
      ORDER BY exception_date
    `;
    if (closedDates.length === 0) return [];

    const dates = new Set(closedDates.map((row) => row.exception_date));

    const scheduled = await client.$queryRaw<ConflictRow[]>`
      SELECT a.id, a.series_id, a.starts_at, a.ends_at, a.availability_override_reason,
             clinic_date(a.starts_at)::text AS start_date,
             clinic_date(a.ends_at)::text AS end_date,
             clinic_clock_time(a.starts_at) AS start_time,
             clinic_clock_time(a.ends_at) AS end_time
      FROM appointment a
      WHERE a.therapist_id = ${therapistId}::uuid
        AND a.status = 'SCHEDULED'
        AND a.starts_at >= clinic_day_start(${from}::date)
        AND a.starts_at < clinic_day_start((${to}::date + 1))
      ORDER BY a.starts_at ASC, a.id ASC
    `;

    const resolvedByDate = new Map<string, ResolvedAvailability>();
    const conflicts: ConflictRow[] = [];

    for (const row of scheduled) {
      if (!dates.has(row.start_date)) continue;

      let resolved = resolvedByDate.get(row.start_date);
      if (resolved === undefined) {
        resolved = await this.resolveOn(client, therapistId, row.start_date);
        resolvedByDate.set(row.start_date, resolved);
      }

      const closed = resolved.isClosed
        ? [{ startTime: '00:00', endTime: '24:00' }]
        : resolved.closedRanges;
      // A session ending at midnight ends on the next date; on its own date it
      // runs to the end of the day.
      const endsAt = row.end_date === row.start_date ? row.end_time : '24:00';
      const overlapsClosure = closed.some(
        (range) => row.start_time < range.endTime && endsAt > range.startTime,
      );
      const span = {
        startDate: row.start_date,
        startTime: row.start_time,
        endDate: row.end_date,
        endTime: row.end_time,
      };

      if (overlapsClosure && !isWithinAvailability(span, resolved.windows)) conflicts.push(row);
    }

    if (conflicts.length === 0) return [];

    const seats = await client.$queryRaw<ConflictSeatRow[]>`
      SELECT ap.appointment_id, c.id, c.family_id, c.first_name, c.last_name, c.file_number
      FROM appointment_participant ap
      JOIN child c ON c.id = ap.child_id
      WHERE ap.appointment_id IN (${Prisma.join(conflicts.map((row) => Prisma.sql`${row.id}::uuid`))})
      ORDER BY ap.appointment_id, c.last_name, c.first_name, c.id
    `;

    return conflicts.map((row) => ({
      appointmentId: row.id,
      seriesId: row.series_id,
      date: row.start_date,
      startTime: row.start_time,
      endTime: row.end_time,
      startsAt: row.starts_at.toISOString(),
      endsAt: row.ends_at.toISOString(),
      availabilityOverrideReason: row.availability_override_reason,
      children: seats
        .filter((seat) => seat.appointment_id === row.id)
        .map((seat) => ({
          id: seat.id,
          familyId: seat.family_id,
          firstName: seat.first_name,
          lastName: seat.last_name,
          fileNumber: seat.file_number,
        })),
    }));
  }

  /**
   * Removes a dated exception.
   *
   * A physical delete, and correctly so: an exception is current configuration,
   * both availability tables are deliberately outside the no-delete triggers
   * that protect appointments and financial records, and a day off entered
   * against the wrong therapist must be removable rather than permanently
   * visible. What it said is preserved in `audit_log` before it goes.
   */
  async removeException(
    therapistId: string,
    exceptionId: string,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockActiveTherapist(tx, therapistId);

      const before = await this.readException(tx, therapistId, exceptionId);

      await tx.$executeRaw`
        DELETE FROM therapist_availability_exception
        WHERE id = ${exceptionId}::uuid AND therapist_id = ${therapistId}::uuid
      `;

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'therapist_availability.updated',
        entityType: 'therapist',
        entityId: therapistId,
        before: { exception: auditException(before) },
        metadata: { change: 'exception_removed' },
      });
    });
  }

  /**
   * What a therapist's availability actually is on one date.
   *
   * The rule, and it is the whole domain behaviour of this checkpoint:
   *
   *   1. A closed-day exception suspends the RECURRING WEEK for that date, and
   *      nothing else. A PARTIAL closure (M10-A9) does the same for its own
   *      time range only: that range is taken out of the recurring windows. It does not suppress the dated windows, because "not my
   *      usual Saturday hours this week, but I will come in for 15:00 to 18:00"
   *      is a real and common arrangement, and a closure plus an extra window is
   *      the only way to state it. The database allows the pair for exactly that
   *      reason; this method is where the precedence between them lives.
   *   2. Otherwise the day is the recurring windows for that weekday — all of
   *      them, since every window is current configuration and none is dated —
   *      PLUS any extra windows dated to it.
   *   3. The result is sorted, and touching windows are merged, so the answer is
   *      one non-overlapping reading of the day.
   *
   * `isClosed` reports a whole-day closure and `closedRanges` the partial ones,
   * which is why the day differs from the ordinary week. It is NOT the bookability test — `windows` is, always, and it
   * is empty on a closed day with no dated window as well as on a weekday the
   * therapist simply never works.
   *
   * One statement, so the two sources are read against the same snapshot: with
   * two round trips a manager could close the day in between, and the answer
   * would contain windows from a day that is shut.
   */
  async resolve(query: ResolveAvailabilityQuery): Promise<ResolvedAvailability> {
    await this.assertTherapistExists(query.therapistId);

    return this.resolveOn(this.prisma, query.therapistId, query.date);
  }

  /**
   * The same answer, read on a caller's own transaction.
   *
   * The booking checkpoint needs the resolved day INSIDE the transaction that
   * writes the appointment, against the same snapshot as its own locks — with a
   * separate connection, a manager could close the day between the check and the
   * insert and the booking would be written against hours that no longer exist.
   *
   * It is this method rather than a second query in that module deliberately:
   * the precedence between a closed day and a dated window is one rule, and a
   * second implementation of it would eventually disagree with this one. The
   * therapist's existence is not re-checked here — the caller has already locked
   * the row it is asking about.
   */
  resolveWithin(
    tx: Prisma.TransactionClient,
    therapistId: string,
    date: string,
  ): Promise<ResolvedAvailability> {
    return this.resolveOn(tx, therapistId, date);
  }

  private async resolveOn(
    client: PrismaService | Prisma.TransactionClient,
    therapistId: string,
    date: string,
  ): Promise<ResolvedAvailability> {
    const rows = await client.$queryRaw<
      {
        weekday: number;
        source: string;
        // Null only on a whole-day closure.
        start_time: string | null;
        end_time: string | null;
        reason: string | null;
      }[]
    >`
      SELECT ${CLINIC_WEEKDAY(date)} AS weekday,
             'closed' AS source,
             -- The first branch names the columns for the whole UNION.
             to_char(start_time, 'HH24:MI') AS start_time,
             to_char(end_time, 'HH24:MI') AS end_time,
             reason
      FROM therapist_availability_exception
      WHERE therapist_id = ${therapistId}::uuid
        AND exception_date = ${date}::date
        AND is_available = false

      UNION ALL

      SELECT ${CLINIC_WEEKDAY(date)} AS weekday,
             'exception' AS source,
             to_char(start_time, 'HH24:MI'), to_char(end_time, 'HH24:MI'), reason
      FROM therapist_availability_exception
      WHERE therapist_id = ${therapistId}::uuid
        AND exception_date = ${date}::date
        AND is_available = true

      UNION ALL

      SELECT ${CLINIC_WEEKDAY(date)} AS weekday,
             'recurring' AS source,
             to_char(start_time, 'HH24:MI'), to_char(end_time, 'HH24:MI'), NULL
      FROM therapist_availability
      WHERE therapist_id = ${therapistId}::uuid
        AND weekday = ${CLINIC_WEEKDAY(date)}
    `;

    // Derived rather than read from the rows, so the answer is right on a day
    // with no availability of any kind, when the query returns nothing at all.
    const weekday = clinicWeekday(date);
    const windowsFrom = (source: string) =>
      rows.flatMap((row) =>
        row.source === source && row.start_time !== null && row.end_time !== null
          ? [{ startTime: row.start_time, endTime: row.end_time, reason: row.reason }]
          : [],
      );

    const wholeDay = rows.find((row) => row.source === 'closed' && row.start_time === null);
    const closedRanges = windowsFrom('closed').sort((left, right) =>
      left.startTime.localeCompare(right.startTime),
    );

    // The one precedence rule: a closure removes the recurring week from the
    // day — the whole of it, or only its own range (M10-A9) — and leaves the
    // dated windows standing. A partial closure cannot overlap a dated window,
    // and closures of one date cannot overlap each other: two exclusion
    // constraints say so, so this subtraction never has to choose between them.
    const recurring = wholeDay !== undefined ? [] : windowsFrom('recurring');

    return {
      therapistId,
      date,
      weekday,
      isClosed: wholeDay !== undefined,
      closedReason: wholeDay?.reason ?? null,
      closedRanges,
      windows: mergeWindows([
        ...windowsFrom('exception'),
        ...subtractWindows(recurring, closedRanges),
      ]),
    };
  }

  /**
   * Locks the therapist for the whole transaction and refuses an inactive one.
   *
   * `FOR UPDATE`, not `FOR SHARE`: see the class comment. Locking before reading
   * the status is what makes the status true at write time rather than true of a
   * world a concurrent deactivation has already left.
   */
  private async lockActiveTherapist(
    tx: Prisma.TransactionClient,
    therapistId: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<{ status: string }[]>`
      SELECT status::text AS status FROM therapist WHERE id = ${therapistId}::uuid FOR UPDATE
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('THERAPIST_NOT_FOUND');
    if (row.status !== 'ACTIVE') throw new AppError('THERAPIST_INACTIVE');
  }

  /** Reads are permitted for an inactive therapist; only writes are not. */
  private async assertTherapistExists(therapistId: string): Promise<void> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM therapist WHERE id = ${therapistId}::uuid
    `;

    if (rows[0] === undefined) throw new AppError('THERAPIST_NOT_FOUND');
  }

  private readWindows(
    tx: Prisma.TransactionClient,
    therapistId: string,
  ): Promise<AvailabilityRow[]> {
    return tx.$queryRaw<AvailabilityRow[]>`
      SELECT ${AVAILABILITY_COLUMNS} FROM therapist_availability
      WHERE therapist_id = ${therapistId}::uuid
      ORDER BY weekday ASC, start_time ASC
    `;
  }

  /**
   * The therapist id is part of the lookup, not checked afterwards: an exception
   * belonging to another therapist must be indistinguishable from one that does
   * not exist, or the route becomes a way to probe for ids.
   */
  private async readException(
    tx: Prisma.TransactionClient,
    therapistId: string,
    id: string,
  ): Promise<ExceptionRow> {
    const rows = await tx.$queryRaw<ExceptionRow[]>`
      SELECT ${EXCEPTION_COLUMNS} FROM therapist_availability_exception
      WHERE id = ${id}::uuid AND therapist_id = ${therapistId}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('AVAILABILITY_EXCEPTION_NOT_FOUND');
    return row;
  }
}

/**
 * Saturday-first from a `YYYY-MM-DD` string, matching the SQL expression above.
 *
 * `Date.UTC` rather than `new Date(string)` so the result never depends on the
 * process timezone, and `getUTCDay` is Sunday-first exactly as PostgreSQL's
 * `EXTRACT(DOW)` is — so the same `+ 1) % 7` translation applies.
 */
function clinicWeekday(date: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));

  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 1) % 7;
}

/** Maps the exclusion constraint onto the contract code the interface explains. */
function translateAvailabilityWrite(error: unknown): unknown {
  if (violatesConstraint(error, 'therapist_availability_no_overlap_excl')) {
    return new AppError('AVAILABILITY_WINDOW_OVERLAP');
  }

  if (
    violatesConstraint(error, 'therapist_availability_window_chk') ||
    violatesConstraint(error, 'therapist_availability_time_precision_chk') ||
    violatesConstraint(error, 'therapist_availability_weekday_chk')
  ) {
    return new AppError('AVAILABILITY_WINDOW_INVALID');
  }

  return error;
}

function translateExceptionWrite(error: unknown): unknown {
  // Three constraints, one meaning — "this date already says something about
  // these hours": overlapping extra windows, overlapping closures (a whole-day
  // closure overlaps every closure of its date), and a partial closure over an
  // extra window. M10-A9 replaced the one-closure-per-date unique index with the
  // closure exclusion constraint, so every case is now matched by name.
  if (
    violatesConstraint(error, 'therapist_availability_exception_no_overlap_excl') ||
    violatesConstraint(error, 'therapist_availability_exception_closure_no_overlap_excl') ||
    violatesConstraint(error, 'therapist_availability_exception_closure_window_excl')
  ) {
    return new AppError('AVAILABILITY_EXCEPTION_CONFLICT');
  }

  if (
    violatesConstraint(error, 'therapist_availability_exception_window_chk') ||
    violatesConstraint(error, 'therapist_availability_exception_time_precision_chk')
  ) {
    return new AppError('AVAILABILITY_WINDOW_INVALID');
  }

  return error;
}

/**
 * What an audit row records about a window: the fact, never the row identity.
 *
 * No id and no `createdAt`. The set is replaced wholesale, so a window id names
 * nothing after the write and would only invite a reader to look it up.
 *
 * A weekday and two times is the whole of what a window is, so this is the whole
 * of what changed.
 */
function auditWindow(row: AvailabilityRow): AuditJsonObject {
  return {
    weekday: row.weekday,
    startTime: row.start_time,
    endTime: row.end_time,
  };
}

/**
 * An exception keeps its id in the audit trail, unlike a window: it is added and
 * removed individually, so "which one was removed" is a question the record has
 * to be able to answer.
 */
function auditException(row: ExceptionRow): AuditJsonObject {
  return {
    id: row.id,
    exceptionDate: row.exception_date,
    isAvailable: row.is_available,
    startTime: row.start_time,
    endTime: row.end_time,
    reason: row.reason,
  };
}

export function toAvailability(row: AvailabilityRow): TherapistAvailability {
  return {
    id: row.id,
    therapistId: row.therapist_id,
    weekday: row.weekday,
    startTime: row.start_time,
    endTime: row.end_time,
    createdAt: row.created_at.toISOString(),
  };
}

export function toException(row: ExceptionRow): TherapistAvailabilityException {
  return {
    id: row.id,
    therapistId: row.therapist_id,
    exceptionDate: row.exception_date,
    isAvailable: row.is_available,
    startTime: row.start_time,
    endTime: row.end_time,
    reason: row.reason,
    createdAt: row.created_at.toISOString(),
  };
}
