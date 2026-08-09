import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AppointmentDetail, CreateAppointmentRequest, Permission } from '@clinic/contracts';
import { AuditService } from '../audit/audit.service';
import type { AuditJsonObject } from '../audit/audit.types';
import { AvailabilityService } from '../availability/availability.service';
import { actorContext, canonicalOptionalText } from '../catalog/catalog-support';
import { AppError } from '../common/app-error';
import { isForeignKeyViolation, violatesConstraint } from '../common/pg-error';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { uuidv7 } from '../common/uuid';
import { PrismaService } from '../prisma/prisma.service';
import {
  isWholeMinute,
  isWithinAvailability,
  toAppointment,
  toParticipant,
  type AppointmentRow,
  type ClinicSpan,
  type ParticipantRow,
} from './booking-support';

/**
 * Booking one appointment.
 *
 * ONE ENDPOINT, AND EVERY RULE THAT DECIDES IT. Recurrence, rescheduling,
 * completion, cancellation, attendance and the day view are later checkpoints
 * and appear nowhere here. Neither does anything financial: no tariff is read,
 * no price is snapshotted, no charge is created. Pricing a session is
 * Milestone 5's, and this module could not do it — it never looks at a tariff.
 *
 * ------------------------------------------------------------------------
 * THE THREE CONFLICTS, AND THREE DIFFERENT MECHANISMS.
 *
 *  1. THERAPIST OVERLAP and 2. ROOM OVERLAP are decided by
 *     `appointment_no_therapist_overlap_excl` and `appointment_no_room_overlap_excl`,
 *     two partial GiST exclusion constraints. Nothing here reads before writing:
 *     two simultaneous bookings for the same room cannot both pass a constraint,
 *     whatever an application check saw first. The INSERT is the check, and the
 *     constraint that fired decides which code the receptionist is told —
 *     "the room is busy" and "the therapist is busy" are different problems with
 *     different fixes.
 *
 *  3. CHILD OVERLAP cannot be a constraint. The child is on
 *     `appointment_participant` and the window is on `appointment`, so no
 *     single-row exclusion constraint can compare them. It is recomputed in SQL
 *     while a transaction-scoped advisory lock is held on the child — the exact
 *     mechanism DECISION_LOG 2026-08-09 approved for blocking duplicate rules,
 *     and for the same reason: a check that reads before it writes is not a check
 *     under concurrency. Two receptionists booking the same child into
 *     overlapping sessions serialise on that lock, and the second one recomputes
 *     against the row the first committed.
 *
 * NONE OF THE THREE MAY BE OVERRIDDEN. There is no flag, no permission and no
 * request field that books over any of them, and there must not be: a
 * double-booked room is not a policy the clinic may set aside, it is two sessions
 * that cannot both happen.
 * ------------------------------------------------------------------------
 * THE ONE OVERRIDE: booking outside the therapist's availability.
 *
 * PROJECT_SPEC.md 5 permits exactly this, and only as an "authorized, recorded
 * override". Three things are therefore true of it: the caller must hold
 * `appointment.override_availability` — held by the receptionist as well as the
 * manager, because the person running the diary is the person a therapist tells
 * "I will come in for this one" — they must state a reason, and the override is
 * recorded twice over: the reason, the actor and the instant on the appointment
 * itself for operational visibility, and the whole decision — reason, hours and
 * the windows it fell outside — in the `metadata` of the creation's own audit
 * row. There is deliberately NO separate override action: an override qualifies
 * the state change that carried it rather than being a second one. The authority
 * is separately granted rather than implied by `appointment.create`, so it stays
 * visible in the permission map and revocable on its own.
 *
 * IT SETS ASIDE AVAILABILITY AND NOTHING ELSE. A session crossing midnight is
 * refused as an invalid time before the override is considered at all: the
 * approved model records working hours as a weekday and two wall-clock times, so
 * an overnight appointment is not a shape it can express, and no reason makes it
 * one.
 *
 * A reason supplied for a booking that is INSIDE availability is not an error and
 * is not recorded: nothing was overridden, so there is nothing to explain and
 * nothing to count. The permission is not consulted in that case either, which is
 * what keeps a stray field on a request from turning an ordinary booking into a
 * forbidden one.
 * ------------------------------------------------------------------------
 * LOCK ORDER — one rule, extending the two that already exist:
 *
 *     service -> therapist -> room -> family -> child -> advisory keys
 *
 * It is consistent with Milestone 2's `service -> therapist -> tariff` and with
 * Milestone 3's `registration_draft -> family -> child -> advisory keys`; no path
 * in the system takes a family or child lock before a catalog one, so no cycle
 * exists. The catalog and family rows are locked `FOR SHARE`, which still
 * conflicts with the `UPDATE` a deactivation performs — the requirement — while
 * letting unrelated bookings proceed together. Two bookings never block each
 * other on a row lock; they meet at the exclusion constraint or at the child's
 * advisory key, which is where they should.
 *
 * The one advisory class here is never mixed with Milestone 3's, and a booking
 * takes exactly one key, so there is no ordering to get wrong within it.
 */

const CHILD_SCHEDULE_LOCK_NAMESPACE = 'child-schedule:';

const APPOINTMENT_COLUMNS = Prisma.sql`
  id, service_id, duration_minutes, therapist_id, room_id, starts_at, ends_at,
  status::text AS status, series_id, note, completed_at, cancelled_at,
  cancellation_reason, availability_override_reason, created_at
`;

const PARTICIPANT_COLUMNS = Prisma.sql`
  id, appointment_id, child_id, attendance::text AS attendance, attendance_recorded_at
`;

const OVERRIDE_PERMISSION: Permission = 'appointment.override_availability';

/**
 * What the availability check concluded: the reason to persist on the row, and
 * the metadata to hang on the audit row of the state change that carried it.
 * Both are null for an ordinary booking.
 */
type AvailabilityDecision = {
  readonly overrideReason: string | null;
  readonly audit: AuditJsonObject | null;
};

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly availability: AvailabilityService,
  ) {}

  async get(id: string): Promise<AppointmentDetail> {
    const appointment = await this.readAppointment(this.prisma, id);
    const participants = await this.readParticipants(this.prisma, id);

    return {
      appointment: toAppointment(appointment),
      participants: participants.map(toParticipant),
    };
  }

  /**
   * Books one appointment for one child.
   *
   * One transaction: the locks, every rule, the availability decision, the two
   * inserts and the audit rows. Keeping the decision and the write together is
   * what removes the window a competing booking could land in — and the two
   * rules that cannot be decided by reading (the resource overlaps) are not
   * decided by reading at all.
   */
  async create(
    input: CreateAppointmentRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<AppointmentDetail> {
    // Refused before the transaction opens: the value is malformed on its own
    // terms and no stored row could make it acceptable. `appointment_starts_at_precision_chk`
    // says the same thing to anything that bypasses this service.
    if (!isWholeMinute(input.startsAt)) throw new AppError('APPOINTMENT_TIME_INVALID');

    const note = canonicalOptionalText(input.note);
    const submittedReason = canonicalOptionalText(input.availabilityOverrideReason);
    const appointmentId = uuidv7();
    const participantId = uuidv7();

    return this.prisma.$transaction(async (tx) => {
      await this.lockActiveService(tx, input.serviceId);
      await this.lockActiveTherapist(tx, input.therapistId);
      await this.lockActiveRoom(tx, input.roomId);
      await this.lockActiveChild(tx, input.childId);

      await this.assertTherapistProvidesService(tx, input.therapistId, input.serviceId);
      await this.assertRoomAllowsService(tx, input.roomId, input.serviceId);

      const span = await this.readClinicSpan(tx, input.startsAt, input.durationMinutes);

      // A HARD BLOCK, DECIDED BEFORE THE OVERRIDE IS EVEN CONSIDERED. The
      // approved model records a session as a weekday and two wall-clock times,
      // and an appointment that ends on a different clinic day is not a session
      // that model can express — so it is an invalid time, not an unavailable
      // one, and the availability override must not reach it. Placing this above
      // `decideAvailability` is what makes that true rather than merely intended.
      if (span.startDate !== span.endDate) throw new AppError('APPOINTMENT_TIME_INVALID');

      const decision = await this.decideAvailability(tx, span, input, submittedReason, actor);

      await this.assertChildIsFree(tx, input);

      await this.insertAppointment(tx, {
        appointmentId,
        input,
        note,
        overrideReason: decision.overrideReason,
        actor,
      });

      await tx.$executeRaw`
        INSERT INTO appointment_participant (id, appointment_id, child_id, attendance)
        VALUES (
          ${participantId}::uuid, ${appointmentId}::uuid, ${input.childId}::uuid,
          'PENDING'::attendance_outcome
        )
      `;

      const appointment = await this.readAppointment(tx, appointmentId);
      const participants = await this.readParticipants(tx, appointmentId);

      // ONE ROW FOR ONE STATE CHANGE. An override is not a second thing that
      // happened; it is a property of this booking, so it travels in this row's
      // `metadata` rather than in an action of its own. `metadata` is null for
      // the ordinary booking, so "was this one an exception?" is answered by the
      // presence of the key rather than by joining two rows on an entity id.
      await this.audit.record(tx, actorContext(actor, context), {
        action: 'appointment.created',
        entityType: 'appointment',
        entityId: appointmentId,
        after: auditAppointment(appointment, participants),
        metadata: decision.audit,
      });

      return {
        appointment: toAppointment(appointment),
        participants: participants.map(toParticipant),
      };
    });
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
  private async decideAvailability(
    tx: Prisma.TransactionClient,
    span: ClinicSpan,
    input: CreateAppointmentRequest,
    submittedReason: string | null,
    actor: ResolvedSession,
  ): Promise<AvailabilityDecision> {
    const resolved = await this.availability.resolveWithin(tx, input.therapistId, span.startDate);

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
   * The session as the clinic's own calendar and clock read it.
   *
   * Both halves come from PostgreSQL — `clinic_date` and `clinic_clock_time` —
   * so `Asia/Tehran` is applied in exactly one place in the system and the date
   * and the time cannot come from two different timezones. `ends_at` is computed
   * with the same `make_interval` expression `appointment_window_chk` uses, so
   * the window checked is the window stored.
   */
  private async readClinicSpan(
    tx: Prisma.TransactionClient,
    startsAt: string,
    durationMinutes: number,
  ): Promise<ClinicSpan> {
    const rows = await tx.$queryRaw<ClinicSpan[]>`
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
   */
  private async assertChildIsFree(
    tx: Prisma.TransactionClient,
    input: CreateAppointmentRequest,
  ): Promise<void> {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${CHILD_SCHEDULE_LOCK_NAMESPACE} || ${input.childId}, 0)
      )
    `;

    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT a.id
      FROM appointment_participant ap
      JOIN appointment a ON a.id = ap.appointment_id
      WHERE ap.child_id = ${input.childId}::uuid
        AND a.status IN ('SCHEDULED', 'COMPLETED')
        AND tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(
              ${input.startsAt}::timestamptz,
              ${input.startsAt}::timestamptz + make_interval(mins => ${input.durationMinutes}::int),
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
   */
  private async insertAppointment(
    tx: Prisma.TransactionClient,
    args: {
      appointmentId: string;
      input: CreateAppointmentRequest;
      note: string | null;
      overrideReason: string | null;
      actor: ResolvedSession;
    },
  ): Promise<void> {
    const { appointmentId, input, note, overrideReason, actor } = args;
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
          ${input.serviceId}::uuid,
          ${input.durationMinutes},
          ${input.therapistId}::uuid,
          ${input.roomId}::uuid,
          ${input.startsAt}::timestamptz,
          ${input.startsAt}::timestamptz + make_interval(mins => ${input.durationMinutes}::int),
          'SCHEDULED'::appointment_status,
          NULL,
          ${note},
          ${overrideReason},
          ${overrideBy}::uuid,
          ${overrideAt},
          transaction_timestamp(),
          ${actor.userId}::uuid
        )
      `;
    } catch (error) {
      throw translateBookingWrite(error);
    }
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
  private async assertTherapistProvidesService(
    tx: Prisma.TransactionClient,
    therapistId: string,
    serviceId: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<{ supported: boolean }[]>`
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
  private async assertRoomAllowsService(
    tx: Prisma.TransactionClient,
    roomId: string,
    serviceId: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<{ allowed: boolean }[]>`
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
  private async lockActiveService(tx: Prisma.TransactionClient, id: string): Promise<void> {
    const rows = await tx.$queryRaw<{ status: string }[]>`
      SELECT status::text AS status FROM service WHERE id = ${id}::uuid FOR SHARE
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('SERVICE_NOT_FOUND');
    if (row.status !== 'ACTIVE') throw new AppError('SERVICE_INACTIVE');
  }

  private async lockActiveTherapist(tx: Prisma.TransactionClient, id: string): Promise<void> {
    const rows = await tx.$queryRaw<{ status: string }[]>`
      SELECT status::text AS status FROM therapist WHERE id = ${id}::uuid FOR SHARE
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('THERAPIST_NOT_FOUND');
    if (row.status !== 'ACTIVE') throw new AppError('THERAPIST_INACTIVE');
  }

  private async lockActiveRoom(tx: Prisma.TransactionClient, id: string): Promise<void> {
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
  private async lockActiveChild(tx: Prisma.TransactionClient, childId: string): Promise<void> {
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

  private async readAppointment(
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

  private readParticipants(
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
function translateBookingWrite(error: unknown): unknown {
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
 * What the audit trail records about a new booking.
 *
 * The seats travel with it: an appointment without its participants does not say
 * who was booked, which is most of what the record is for. No price, no tariff
 * and no amount appears — there is none to appear.
 */
function auditAppointment(
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
    availabilityOverrideReason: appointment.availability_override_reason,
    participants: participants.map((participant) => ({
      id: participant.id,
      childId: participant.child_id,
      attendance: participant.attendance,
    })),
  };
}
