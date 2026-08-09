import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AvailabilityExceptionListQuery,
  CreateAvailabilityExceptionRequest,
  ResolveAvailabilityQuery,
  ResolvedAvailability,
  ReplaceAvailabilityWindowsRequest,
  TherapistAvailability,
  TherapistAvailabilityException,
} from '@clinic/contracts';
import { AuditService } from '../audit/audit.service';
import type { AuditJsonObject } from '../audit/audit.types';
import { actorContext, canonicalOptionalText } from '../catalog/catalog-support';
import { AppError } from '../common/app-error';
import { isUniqueViolation, violatesConstraint } from '../common/pg-error';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { uuidv7 } from '../common/uuid';
import { PrismaService } from '../prisma/prisma.service';
import { findOverlappingPair, mergeWindows } from './window-merge';

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
 *  2. A dated exception may not collide with another on the same date: a date is
 *     closed at most once, and extra windows on it may not overlap each other.
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

  async addException(
    therapistId: string,
    input: CreateAvailabilityExceptionRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<TherapistAvailabilityException> {
    const reason = canonicalOptionalText(input.reason);
    const startTime = input.isAvailable ? input.startTime : null;
    const endTime = input.isAvailable ? input.endTime : null;
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

      return written;
    });

    return toException(row);
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
   *      nothing else. It does not suppress the dated windows, because "not my
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
   * `isClosed` reports the closure, which is why the day differs from the
   * ordinary week. It is NOT the bookability test — `windows` is, always, and it
   * is empty on a closed day with no dated window as well as on a weekday the
   * therapist simply never works.
   *
   * One statement, so the two sources are read against the same snapshot: with
   * two round trips a manager could close the day in between, and the answer
   * would contain windows from a day that is shut.
   */
  async resolve(query: ResolveAvailabilityQuery): Promise<ResolvedAvailability> {
    await this.assertTherapistExists(query.therapistId);

    const rows = await this.prisma.$queryRaw<
      {
        weekday: number;
        source: string;
        start_time: string;
        end_time: string;
        reason: string | null;
      }[]
    >`
      SELECT ${CLINIC_WEEKDAY(query.date)} AS weekday,
             'closed' AS source, '00:00' AS start_time, '00:00' AS end_time, reason
      FROM therapist_availability_exception
      WHERE therapist_id = ${query.therapistId}::uuid
        AND exception_date = ${query.date}::date
        AND is_available = false

      UNION ALL

      SELECT ${CLINIC_WEEKDAY(query.date)} AS weekday,
             'exception' AS source,
             to_char(start_time, 'HH24:MI'), to_char(end_time, 'HH24:MI'), reason
      FROM therapist_availability_exception
      WHERE therapist_id = ${query.therapistId}::uuid
        AND exception_date = ${query.date}::date
        AND is_available = true

      UNION ALL

      SELECT ${CLINIC_WEEKDAY(query.date)} AS weekday,
             'recurring' AS source,
             to_char(start_time, 'HH24:MI'), to_char(end_time, 'HH24:MI'), NULL
      FROM therapist_availability
      WHERE therapist_id = ${query.therapistId}::uuid
        AND weekday = ${CLINIC_WEEKDAY(query.date)}
    `;

    // Derived rather than read from the rows, so the answer is right on a day
    // with no availability of any kind, when the query returns nothing at all.
    const weekday = clinicWeekday(query.date);
    const closed = rows.find((row) => row.source === 'closed');

    // The one precedence rule: a closure removes the recurring week from the
    // day and leaves the dated windows standing. There is at most one closure
    // per date — a partial unique index says so.
    const contributing = rows.filter(
      (row) => row.source === 'exception' || (row.source === 'recurring' && closed === undefined),
    );

    return {
      therapistId: query.therapistId,
      date: query.date,
      weekday,
      isClosed: closed !== undefined,
      closedReason: closed?.reason ?? null,
      windows: mergeWindows(
        contributing.map((row) => ({ startTime: row.start_time, endTime: row.end_time })),
      ),
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
  // Two mechanisms, one meaning: overlapping extra windows raise the exclusion
  // constraint, a second closure of one date raises the partial unique index.
  // Both are "this date already says that", which is one thing to explain.
  //
  // The unique violation is matched by its SQLSTATE rather than by name:
  // PostgreSQL reports a partial unique index by its key columns and not by its
  // index name, so there is no name in the error to match. This insert has
  // exactly one unique index over it, so the class is unambiguous.
  if (
    violatesConstraint(error, 'therapist_availability_exception_no_overlap_excl') ||
    isUniqueViolation(error)
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
