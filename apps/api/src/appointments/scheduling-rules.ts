import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Permission } from '@clinic/contracts';
import type { AuditJsonObject } from '../audit/audit.types';
import { AvailabilityService } from '../availability/availability.service';
import { AppError } from '../common/app-error';
import { isForeignKeyViolation, violatesConstraint } from '../common/pg-error';
import type { ResolvedSession } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import {
  isWithinAvailability,
  type AppointmentRow,
  type ClinicSpan,
  type ParticipantRow,
} from './booking-support';

/**
 * EVERY RULE THAT DECIDES WHERE AN APPOINTMENT MAY SIT, IN ONE PLACE.
 *
 * The locks, the two catalog compatibility rules, the clinic's reading of a
 * span, the availability decision and its one recorded override, the child
 * overlap recomputation, and the two writes the resource exclusion constraints
 * are enforced by. `AppointmentsService` books and moves ONE appointment with
 * them; `AppointmentSeriesService` creates and re-places a whole series with
 * them. Neither has a copy.
 *
 * THIS FILE IS A MOVE, NOT A REWRITE. Every method here was a private method of
 * `AppointmentsService` in the accepted booking checkpoint and is unchanged
 * except for the two generalisations recurrence needs: an insert may name a
 * series, and a placement is a shape rather than one request type. Extracting
 * it is what makes "recurrence must not create a weaker or parallel conflict
 * implementation" true by construction instead of by review — there is nothing
 * to diverge from, because a series occurrence is booked by exactly the code
 * that books a single appointment.
 *
 * The reasoning behind each rule — why the child overlap cannot be a
 * constraint, why the availability override is decided in this order, why the
 * catalog rows are locked `FOR SHARE`, why the lock order is what it is — is
 * documented on the methods and in the class comment of `AppointmentsService`,
 * which remains the entry point a reader arrives from.
 */

const CHILD_SCHEDULE_LOCK_NAMESPACE = 'child-schedule:';

export const APPOINTMENT_COLUMNS = Prisma.sql`
  id, service_id, duration_minutes, therapist_id, room_id, starts_at, ends_at,
  status::text AS status, series_id, note, completed_at, cancelled_at,
  cancellation_reason, availability_override_reason, created_at
`;

export const PARTICIPANT_COLUMNS = Prisma.sql`
  id, appointment_id, child_id, attendance::text AS attendance, attendance_recorded_at
`;

const OVERRIDE_PERMISSION: Permission = 'appointment.override_availability';

/**
 * What the availability check concluded: the reason to persist on the row, and
 * the metadata to hang on the audit row of the state change that carried it.
 * Both are null for an ordinary booking.
 */
export type AvailabilityDecision = {
  readonly overrideReason: string | null;
  readonly audit: AuditJsonObject | null;
};

/**
 * Where a session sits: the four fields a booking and a move both decide.
 *
 * A shape rather than a request type, because three callers now supply one —
 * a create, a move, and each occurrence a series generates — and the rules care
 * about the placement rather than about which endpoint proposed it.
 */
export type AppointmentPlacement = {
  readonly durationMinutes: number;
  readonly therapistId: string;
  readonly roomId: string;
  readonly startsAt: string;
};

@Injectable()
export class SchedulingRules {
  constructor(private readonly availability: AvailabilityService) {}

  /**
   * The appointment row, held for the transaction.
   *
   * `FOR UPDATE` rather than a plain read: every method that changes an
   * appointment decides what it may do from the status it reads here, and a
   * status read without a lock is a fact about a moment that has already passed.
   * It is what makes a second completion see `COMPLETED` rather than race the
   * first one.
   */
  async lockAppointment(tx: Prisma.TransactionClient, id: string): Promise<AppointmentRow> {
    const rows = await tx.$queryRaw<AppointmentRow[]>`
      SELECT ${APPOINTMENT_COLUMNS} FROM appointment WHERE id = ${id}::uuid FOR UPDATE
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('APPOINTMENT_NOT_FOUND');
    return row;
  }

  /**
   * A placement's write, and the three rules PostgreSQL decides as it runs.
   *
   * `ends_at` is recomputed from the new start and length with the same
   * `make_interval` expression `appointment_window_chk` uses, so the stored
   * window cannot drift from the submitted one. The therapist overlap, the room
   * overlap and "this service offers this length" are decided by the constraints
   * as this statement lands, exactly as they are for an insert.
   */
  async writePlacement(
    tx: Prisma.TransactionClient,
    id: string,
    placement: AppointmentPlacement,
    note: string | null,
    overrideReason: string | null,
    actor: ResolvedSession,
  ): Promise<void> {
    const overrideBy = overrideReason === null ? null : actor.userId;
    const overrideAt =
      overrideReason === null ? Prisma.sql`NULL` : Prisma.sql`transaction_timestamp()`;

    try {
      await tx.$executeRaw`
        UPDATE appointment
        SET duration_minutes = ${placement.durationMinutes},
            therapist_id = ${placement.therapistId}::uuid,
            room_id = ${placement.roomId}::uuid,
            starts_at = ${placement.startsAt}::timestamptz,
            ends_at = ${placement.startsAt}::timestamptz
                      + make_interval(mins => ${placement.durationMinutes}::int),
            note = ${note},
            availability_override_reason = ${overrideReason},
            availability_override_by_user_id = ${overrideBy}::uuid,
            availability_override_at = ${overrideAt}
        WHERE id = ${id}::uuid
      `;
    } catch (error) {
      throw translateSchedulingWrite(error);
    }
  }

  /**
   * Decides whether this booking may sit outside the therapist's working hours.
   *
   * The availability is resolved ON THIS TRANSACTION, against the same snapshot
   * as the locks the caller already holds. Read on a separate connection, a
   * manager could close the day between the check and the insert and the booking
   * would be written against hours that no longer exist.
   *
   * The order of the three refusals matters. "Not available" is decided first,
   * because a caller who supplies a reason for a booking that needs none must not
   * be told they lack a permission; only once the rule has actually been broken
   * does the reason, and then the authority to use it, come into question.
   *
   * The span is supplied by the caller rather than read here, because a session
   * crossing midnight is refused as an invalid time BEFORE this method is
   * reached. Availability is a question about a day, and a booking that has two
   * of them is not one this decision — or the override in it — may answer.
   */
  async decideAvailability(
    tx: Prisma.TransactionClient,
    span: ClinicSpan,
    placement: { therapistId: string },
    submittedReason: string | null,
    actor: ResolvedSession,
  ): Promise<AvailabilityDecision> {
    const resolved = await this.availability.resolveWithin(
      tx,
      placement.therapistId,
      span.startDate,
    );

    if (isWithinAvailability(span, resolved.windows)) {
      return { overrideReason: null, audit: null };
    }

    if (submittedReason === null) throw new AppError('APPOINTMENT_OUTSIDE_AVAILABILITY');

    // The permission list was resolved from the database by `SessionGuard` for
    // this request, never taken from anything the caller sent. `AUTH_FORBIDDEN`
    // names no permission, exactly as `PermissionsGuard` does not.
    if (!actor.permissions.includes(OVERRIDE_PERMISSION)) throw new AppError('AUTH_FORBIDDEN');

    return {
      overrideReason: submittedReason,
      // The metadata of the state change that carried the override, flat rather
      // than nested: "how often is a booking made outside a therapist's hours?"
      // is a question the pilot will ask, and `metadata->>'availabilityOverride'`
      // answers it without unwrapping anything.
      audit: {
        availabilityOverride: true,
        reason: submittedReason,
        permission: OVERRIDE_PERMISSION,
        date: span.startDate,
        startTime: span.startTime,
        endTime: span.endTime,
        // What the therapist's day actually said, recorded as values: the rows
        // it was resolved from are current configuration and may be edited
        // tomorrow, and an audit row that pointed at them would answer a
        // different question every time it was read.
        isClosed: resolved.isClosed,
        availableWindows: resolved.windows.map((window) => ({
          startTime: window.startTime,
          endTime: window.endTime,
        })),
      },
    };
  }

  /**
   * Is this placement outside the therapist's hours, as a question rather than
   * as a decision?
   *
   * The read half of `decideAvailability`, and the ONLY caller is the recurrence
   * preview, which has to report "outside her hours" for one week without
   * refusing anything. It cannot be used to book: nothing here returns a reason
   * to persist, and no write path can reach it.
   *
   * It resolves through the same `AvailabilityService` method the decision does,
   * so the precedence between a closed day and a dated window is stated once. A
   * preview that answered this question its own way would eventually disagree
   * with the booking it is previewing.
   */
  async isOutsideAvailability(
    tx: Prisma.TransactionClient,
    therapistId: string,
    span: ClinicSpan,
  ): Promise<boolean> {
    const resolved = await this.availability.resolveWithin(tx, therapistId, span.startDate);

    return !isWithinAvailability(span, resolved.windows);
  }

  /**
   * The session as the clinic's own calendar and clock read it.
   *
   * Both halves come from PostgreSQL — `clinic_date` and `clinic_clock_time` —
   * so `Asia/Tehran` is applied in exactly one place in the system and the date
   * and the time cannot come from two different timezones. `ends_at` is computed
   * with the same `make_interval` expression `appointment_window_chk` uses, so
   * the window checked is the window stored.
   */
  async readClinicSpan(
    client: PrismaService | Prisma.TransactionClient,
    startsAt: string,
    durationMinutes: number,
  ): Promise<ClinicSpan> {
    const rows = await client.$queryRaw<ClinicSpan[]>`
      WITH span AS (
        SELECT ${startsAt}::timestamptz AS starts_at,
               ${startsAt}::timestamptz + make_interval(mins => ${durationMinutes}::int) AS ends_at
      )
      SELECT clinic_date(starts_at)::text AS "startDate",
             clinic_clock_time(starts_at) AS "startTime",
             clinic_date(ends_at)::text   AS "endDate",
             clinic_clock_time(ends_at)   AS "endTime"
      FROM span
    `;

    const span = rows[0];
    // Unreachable: the query is a projection over one synthetic row. Stated so a
    // future edit that makes it a join cannot silently return no span.
    if (span === undefined) throw new AppError('APPOINTMENT_TIME_INVALID');

    return span;
  }

  /**
   * Refuses a child already booked into an overlapping session.
   *
   * The advisory lock is taken FIRST and the recomputation runs UNDER it, which
   * is the whole point: without it two bookings both read "free" and both
   * insert, and the child is in two rooms at once. The key is derived by
   * PostgreSQL's own `hashtextextended` — a second implementation in Node would
   * have to agree bit for bit forever, and the day it stopped agreeing the two
   * writers would take different locks and the mechanism would fail open
   * silently (DECISION_LOG, 2026-08-09).
   *
   * A key collision costs unnecessary serialisation between two unrelated
   * children and never a wrong answer: the lock is mutual exclusion, and the
   * authoritative decision is the SQL below it.
   *
   * `[)` bounds and the two occupying statuses, matching the resource exclusion
   * constraints exactly — back-to-back sessions do not conflict, and a cancelled
   * booking releases the child as it releases the room.
   *
   * `excludeAppointmentId` is the appointment being moved. Without it a booking
   * would conflict with the position it is leaving, and no session could be
   * moved by less than its own length — the commonest correction there is.
   *
   * A SERIES TAKES THE SAME LOCK ONCE AND RE-ASKS PER OCCURRENCE. The key is the
   * child's, `pg_advisory_xact_lock` is re-entrant within a transaction, and
   * every occurrence inserted earlier in that transaction is visible to the
   * recomputation of the next — so a rule that would book a child against
   * themselves is caught by the same statement that catches a clash with an
   * unrelated appointment.
   */
  async assertChildIsFree(
    tx: Prisma.TransactionClient,
    placement: { childId: string; startsAt: string; durationMinutes: number },
    excludeAppointmentId: string | null = null,
  ): Promise<void> {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${CHILD_SCHEDULE_LOCK_NAMESPACE} || ${placement.childId}, 0)
      )
    `;

    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT a.id
      FROM appointment_participant ap
      JOIN appointment a ON a.id = ap.appointment_id
      WHERE ap.child_id = ${placement.childId}::uuid
        AND a.status IN ('SCHEDULED', 'COMPLETED')
        AND a.id IS DISTINCT FROM ${excludeAppointmentId}::uuid
        AND tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(
              ${placement.startsAt}::timestamptz,
              ${placement.startsAt}::timestamptz
                + make_interval(mins => ${placement.durationMinutes}::int),
              '[)'
            )
      LIMIT 1
    `;

    if (rows.length > 0) throw new AppError('APPOINTMENT_CHILD_CONFLICT');
  }

  /**
   * The INSERT, and the three rules it does not check first.
   *
   * The therapist overlap, the room overlap and "this service offers this session
   * length" are all decided by PostgreSQL as this statement runs. Translating the
   * failure is not a fallback for a check that was skipped — it is the check, and
   * it is the only form of it that holds when two requests arrive together.
   *
   * `seriesId` is null for a one-off booking and names the series for every
   * occurrence one generated. It is written here rather than patched in
   * afterwards, so an occurrence is never briefly a loose appointment and no
   * path exists that attaches an arbitrary booking to a series.
   */
  async insertAppointment(
    tx: Prisma.TransactionClient,
    args: {
      appointmentId: string;
      seriesId: string | null;
      serviceId: string;
      placement: AppointmentPlacement;
      note: string | null;
      overrideReason: string | null;
      actor: ResolvedSession;
    },
  ): Promise<void> {
    const { appointmentId, seriesId, serviceId, placement, note, overrideReason, actor } = args;
    const overrideBy = overrideReason === null ? null : actor.userId;
    // The instant comes from `transaction_timestamp()`, never from Node: it must
    // be the same clock `created_at` is written with, or the two would disagree
    // by whatever skew exists between the API host and the database.
    const overrideAt =
      overrideReason === null ? Prisma.sql`NULL` : Prisma.sql`transaction_timestamp()`;

    try {
      await tx.$executeRaw`
        INSERT INTO appointment (
          id, service_id, duration_minutes, therapist_id, room_id,
          starts_at, ends_at, status, series_id, note,
          availability_override_reason, availability_override_by_user_id,
          availability_override_at, created_at, created_by_user_id
        ) VALUES (
          ${appointmentId}::uuid,
          ${serviceId}::uuid,
          ${placement.durationMinutes},
          ${placement.therapistId}::uuid,
          ${placement.roomId}::uuid,
          ${placement.startsAt}::timestamptz,
          ${placement.startsAt}::timestamptz
            + make_interval(mins => ${placement.durationMinutes}::int),
          'SCHEDULED'::appointment_status,
          ${seriesId}::uuid,
          ${note},
          ${overrideReason},
          ${overrideBy}::uuid,
          ${overrideAt},
          transaction_timestamp(),
          ${actor.userId}::uuid
        )
      `;
    } catch (error) {
      throw translateSchedulingWrite(error);
    }
  }

  /** The seat, always written in the same transaction as the booking around it. */
  async insertParticipant(
    tx: Prisma.TransactionClient,
    args: { participantId: string; appointmentId: string; childId: string },
  ): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO appointment_participant (id, appointment_id, child_id, attendance)
      VALUES (
        ${args.participantId}::uuid, ${args.appointmentId}::uuid, ${args.childId}::uuid,
        'PENDING'::attendance_outcome
      )
    `;
  }

  /**
   * TWO ASSOCIATIONS, TWO DELIBERATELY DIFFERENT MEANINGS.
   *
   * `therapist_service` IS THE THERAPIST'S SUPPORTED SERVICES — the Milestone 2
   * model states them explicitly (PROJECT_SPEC.md 5, "Therapist: … supported
   * services"), and a booking requires the association to exist. No rows means
   * this therapist provides nothing yet, not everything: an unstated competency
   * list is exactly what a clinic must not book against, and reading silence as
   * permission would let any therapist be assigned to any service.
   *
   * `room_service` IS A RESTRICTION, and no rows means unrestricted — documented
   * that way in the Milestone 2 contract, and the common case that needs no data
   * entry. The asymmetry is the point: one list says what somebody does, the
   * other says what a room is not allowed to host.
   *
   * Neither check consults the service's or the therapist's status: those were
   * decided under a lock a moment ago, and this is a question about
   * configuration, not lifecycle.
   */
  async assertTherapistProvidesService(
    client: PrismaService | Prisma.TransactionClient,
    therapistId: string,
    serviceId: string,
  ): Promise<void> {
    const rows = await client.$queryRaw<{ supported: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM therapist_service
        WHERE therapist_id = ${therapistId}::uuid AND service_id = ${serviceId}::uuid
      ) AS supported
    `;

    if (rows[0]?.supported !== true) {
      throw new AppError('APPOINTMENT_THERAPIST_SERVICE_NOT_SUPPORTED');
    }
  }

  /** The restriction half: no rows means unrestricted, unchanged from Milestone 2. */
  async assertRoomAllowsService(
    client: PrismaService | Prisma.TransactionClient,
    roomId: string,
    serviceId: string,
  ): Promise<void> {
    const rows = await client.$queryRaw<{ allowed: boolean }[]>`
      SELECT
        NOT EXISTS (SELECT 1 FROM room_service WHERE room_id = ${roomId}::uuid)
        OR EXISTS (
          SELECT 1 FROM room_service
          WHERE room_id = ${roomId}::uuid AND service_id = ${serviceId}::uuid
        ) AS allowed
    `;

    if (rows[0]?.allowed !== true) throw new AppError('APPOINTMENT_ROOM_SERVICE_NOT_ALLOWED');
  }

  /**
   * `FOR SHARE`, not `FOR UPDATE`, on all four rows.
   *
   * A share lock still conflicts with the `UPDATE` a deactivation performs —
   * which is the requirement, and what makes "active" true at write time rather
   * than true of a world a concurrent deactivation has already left — while
   * letting two unrelated bookings against the same service proceed together.
   * `FOR UPDATE` would serialise every booking in the clinic behind whichever
   * one holds the busiest service, for no additional safety.
   */
  async lockActiveService(tx: Prisma.TransactionClient, id: string): Promise<void> {
    const rows = await tx.$queryRaw<{ status: string }[]>`
      SELECT status::text AS status FROM service WHERE id = ${id}::uuid FOR SHARE
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('SERVICE_NOT_FOUND');
    if (row.status !== 'ACTIVE') throw new AppError('SERVICE_INACTIVE');
  }

  async lockActiveTherapist(tx: Prisma.TransactionClient, id: string): Promise<void> {
    const rows = await tx.$queryRaw<{ status: string }[]>`
      SELECT status::text AS status FROM therapist WHERE id = ${id}::uuid FOR SHARE
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('THERAPIST_NOT_FOUND');
    if (row.status !== 'ACTIVE') throw new AppError('THERAPIST_INACTIVE');
  }

  async lockActiveRoom(tx: Prisma.TransactionClient, id: string): Promise<void> {
    const rows = await tx.$queryRaw<{ status: string }[]>`
      SELECT status::text AS status FROM room WHERE id = ${id}::uuid FOR SHARE
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('ROOM_NOT_FOUND');
    if (row.status !== 'ACTIVE') throw new AppError('ROOM_INACTIVE');
  }

  /**
   * The child and the family that owes for the session, locked in that global
   * order: family before child, as every Milestone 3 path takes them.
   *
   * The family is checked as well as the child, and it is not redundant: a family
   * deactivated after a child was left active is a family the clinic has stopped
   * treating, and booking a session it would be billed for is exactly what
   * deactivation is for. The child is read once unlocked to learn which family to
   * lock, then re-read under the lock — the second read is the one that decides.
   */
  async lockActiveChild(tx: Prisma.TransactionClient, childId: string): Promise<void> {
    const found = await tx.$queryRaw<{ family_id: string }[]>`
      SELECT family_id FROM child WHERE id = ${childId}::uuid
    `;

    const familyId = found[0]?.family_id;
    if (familyId === undefined) throw new AppError('CHILD_NOT_FOUND');

    const families = await tx.$queryRaw<{ status: string }[]>`
      SELECT status::text AS status FROM family WHERE id = ${familyId}::uuid FOR SHARE
    `;

    if (families[0]?.status !== 'ACTIVE') throw new AppError('FAMILY_INACTIVE');

    const children = await tx.$queryRaw<{ status: string }[]>`
      SELECT status::text AS status FROM child WHERE id = ${childId}::uuid FOR SHARE
    `;

    const child = children[0];
    if (child === undefined) throw new AppError('CHILD_NOT_FOUND');
    if (child.status !== 'ACTIVE') throw new AppError('CHILD_INACTIVE');
  }

  async readAppointment(
    client: PrismaService | Prisma.TransactionClient,
    id: string,
  ): Promise<AppointmentRow> {
    const rows = await client.$queryRaw<AppointmentRow[]>`
      SELECT ${APPOINTMENT_COLUMNS} FROM appointment WHERE id = ${id}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('APPOINTMENT_NOT_FOUND');
    return row;
  }

  readParticipants(
    client: PrismaService | Prisma.TransactionClient,
    appointmentId: string,
  ): Promise<ParticipantRow[]> {
    return client.$queryRaw<ParticipantRow[]>`
      SELECT ${PARTICIPANT_COLUMNS} FROM appointment_participant
      WHERE appointment_id = ${appointmentId}::uuid
      ORDER BY id ASC
    `;
  }
}

/**
 * Maps what PostgreSQL refused onto what the receptionist is told.
 *
 * Each conflict names its own resource because each is fixed by changing a
 * different field, and the constraint that fired is the authority — a re-read
 * afterwards could disagree with it, and would be answering a question about a
 * different moment.
 */
export function translateSchedulingWrite(error: unknown): unknown {
  if (violatesConstraint(error, 'appointment_no_therapist_overlap_excl')) {
    return new AppError('APPOINTMENT_THERAPIST_CONFLICT');
  }

  if (violatesConstraint(error, 'appointment_no_room_overlap_excl')) {
    return new AppError('APPOINTMENT_ROOM_CONFLICT');
  }

  // The composite foreign key to `service_duration`: this service does not offer
  // this session length. Distinguished from the two single-column foreign keys
  // by name, because "the service does not exist" is a different message and
  // cannot be reached here in any case — the service was locked and read first.
  if (
    violatesConstraint(error, 'appointment_service_id_duration_minutes_fkey') ||
    (isForeignKeyViolation(error) && violatesConstraint(error, 'service_duration'))
  ) {
    return new AppError('APPOINTMENT_DURATION_NOT_ALLOWED');
  }

  if (
    violatesConstraint(error, 'appointment_duration_chk') ||
    violatesConstraint(error, 'appointment_window_chk') ||
    violatesConstraint(error, 'appointment_starts_at_precision_chk')
  ) {
    return new AppError('APPOINTMENT_TIME_INVALID');
  }

  return error;
}

/**
 * What the audit trail records about an appointment, on either side of a change.
 *
 * The seats travel with it: an appointment without its participants does not say
 * who was booked, which is most of what the record is for. No price, no tariff
 * and no amount appears — there is none to appear.
 *
 * The outcome fields are here so a cancellation's audit row carries the reason
 * and the instant as values rather than making a reader join back to a row that
 * may have moved on since. `before` and `after` are the same shape, so a diff of
 * a move, a completion and a cancellation reads the same way.
 */
export function auditAppointment(
  appointment: AppointmentRow,
  participants: readonly ParticipantRow[],
): AuditJsonObject {
  return {
    serviceId: appointment.service_id,
    durationMinutes: appointment.duration_minutes,
    therapistId: appointment.therapist_id,
    roomId: appointment.room_id,
    startsAt: appointment.starts_at.toISOString(),
    endsAt: appointment.ends_at.toISOString(),
    status: appointment.status,
    seriesId: appointment.series_id,
    note: appointment.note,
    completedAt: appointment.completed_at?.toISOString() ?? null,
    cancelledAt: appointment.cancelled_at?.toISOString() ?? null,
    cancellationReason: appointment.cancellation_reason,
    availabilityOverrideReason: appointment.availability_override_reason,
    participants: participants.map((participant) => ({
      id: participant.id,
      childId: participant.child_id,
      attendance: participant.attendance,
    })),
  };
}
