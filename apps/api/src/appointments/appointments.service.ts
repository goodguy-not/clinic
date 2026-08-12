import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AppointmentDetail,
  AppointmentStatus,
  CancelAppointmentRequest,
  CreateAppointmentRequest,
  MoveAppointmentRequest,
  Permission,
  RecordAttendanceRequest,
} from '@clinic/contracts';
import { AuditService } from '../audit/audit.service';
import type { AuditJsonObject } from '../audit/audit.types';
import { AvailabilityService } from '../availability/availability.service';
import { actorContext, canonicalOptionalText, canonicalText } from '../catalog/catalog-support';
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
 * The life of one appointment: booking it, moving it, and recording what
 * happened to it.
 *
 * EVERY WRITE TO `appointment` AND `appointment_participant` IS HERE, and every
 * rule that decides one. Recurrence is a later checkpoint and appears nowhere.
 * Neither does anything financial: no tariff is read, no price is snapshotted,
 * no charge is created. Pricing a session is Milestone 5's, and this class could
 * not do it — it never looks at a tariff. The read-only price suggestion an
 * operational screen shows is computed by `AppointmentReadService`, which
 * writes nothing, and is deliberately not visible from any method here.
 *
 * TWO FACTS, RECORDED SEPARATELY AND NEVER DERIVED FROM EACH OTHER. The
 * booking's `status` says what happened to the session; a seat's `attendance`
 * says what one child did with it. A child may fail to arrive for a session
 * that took place, so `recordAttendance` does not complete an appointment and
 * `complete` does not resolve an outcome. Milestone 5's rule — only an attended
 * participant in a completed appointment may be charged — needs both facts, and
 * gets them because neither was invented from the other.
 *
 * THE FOUR STATUSES ARE THE WHOLE LIFECYCLE. A move is an audited in-place
 * update of a `SCHEDULED` row, not a new state and not a new row: there is no
 * `RESCHEDULED`, because the appointment that moved is the same appointment,
 * and its history is in `audit_log` where a before/after can be read. There is
 * no `VOIDED` either — reversing a completion returns the booking to
 * `SCHEDULED`, and voiding a financial record is a Milestone 5 operation on a
 * financial record.
 *
 * WHAT EACH STATUS DOES TO THE SLOT, which is the property every conflict rule
 * is written against: `SCHEDULED` and `COMPLETED` occupy the therapist, the room
 * and the child; both cancellations release all three. So cancelling frees the
 * hour for somebody else, completing does not, and reopening a completed
 * appointment cannot conflict with anything — it moves between two statuses that
 * occupy identically. The update is still made through the same constraint
 * translation, so if that ever stops being true the caller is told which
 * resource is busy rather than seeing an internal error.
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
 *     appointment -> service -> therapist -> room -> family -> child -> advisory keys
 *
 * A transaction that touches an existing appointment takes that row `FOR UPDATE`
 * FIRST and holds it for the transaction. It is what serialises two people
 * acting on the same booking — a move against a cancellation, a completion
 * against a second completion — so every one of them decides against the status
 * the previous one committed rather than against a stale read. Each transaction
 * locks at most one appointment row, so no cycle can form among them.
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
   * Moves a `SCHEDULED` appointment: a new time, length, therapist or room.
   *
   * AN IN-PLACE UPDATE OF THE SAME ROW, audited with a before and an after. The
   * alternative — cancel and rebook — would make one session look like two in
   * every report that counts them, and would lose the fact that the family kept
   * their appointment.
   *
   * IT RUNS EVERY RULE A BOOKING RUNS, and for the same reason: the placement
   * being new is what the rules are about, and a move that skipped them would be
   * a way to reach a state `create` refuses. The therapist and room overlaps are
   * decided by the two exclusion constraints as the UPDATE lands — a row never
   * conflicts with itself, so moving by ten minutes is not blocked by its own
   * old position — and the child overlap is recomputed under the same advisory
   * lock, excluding this appointment for exactly that reason.
   *
   * ONLY FROM `SCHEDULED`. A completed session is a record of something that
   * happened and its time is a fact, not a plan; a cancelled one is released,
   * and re-placing it would resurrect a booking the family was told was off. A
   * manager who completed the wrong appointment reopens it first, which is a
   * separate, MANAGER-only, reasoned act.
   *
   * WHAT A MOVE MAY NOT CHANGE: the service and the child. Either would make
   * this a different booking wearing the same id, and the seat's `child_id` is
   * immutable in the database precisely so an edit cannot rewrite who was
   * treated.
   *
   * REPEATING THE SAME MOVE CHANGES NOTHING AND AUDITS NOTHING. A resubmitted
   * form is the ordinary cause, and an audit trail that records a move to where
   * the appointment already is describes an event that did not happen.
   */
  async move(
    id: string,
    input: MoveAppointmentRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<AppointmentDetail> {
    if (!isWholeMinute(input.startsAt)) throw new AppError('APPOINTMENT_TIME_INVALID');

    const note = canonicalOptionalText(input.note);
    const submittedReason = canonicalOptionalText(input.availabilityOverrideReason);

    return this.prisma.$transaction(async (tx) => {
      const current = await this.lockAppointment(tx, id);
      if (current.status !== 'SCHEDULED') throw new AppError('APPOINTMENT_TRANSITION_INVALID');

      const participants = await this.readParticipants(tx, id);

      if (isSamePlacement(current, input, note, submittedReason)) {
        return detailOf(current, participants);
      }

      await this.lockActiveTherapist(tx, input.therapistId);
      await this.lockActiveRoom(tx, input.roomId);

      // Against the appointment's OWN service, which a move cannot change. The
      // pairings are re-checked because the therapist and the room may be new:
      // a booking moved to a colleague who does not provide this service, or to
      // a room not allowed to host it, is the same mistake as making it that way.
      await this.assertTherapistProvidesService(tx, input.therapistId, current.service_id);
      await this.assertRoomAllowsService(tx, input.roomId, current.service_id);

      const span = await this.readClinicSpan(tx, input.startsAt, input.durationMinutes);
      if (span.startDate !== span.endDate) throw new AppError('APPOINTMENT_TIME_INVALID');

      const decision = await this.decideAvailability(tx, span, input, submittedReason, actor);

      for (const participant of participants) {
        await this.assertChildIsFree(
          tx,
          {
            childId: participant.child_id,
            startsAt: input.startsAt,
            durationMinutes: input.durationMinutes,
          },
          // Excluded, or an appointment would conflict with the position it is
          // leaving and no session could ever be moved by less than its length.
          id,
        );
      }

      await this.writePlacement(tx, id, input, note, decision.overrideReason, actor);

      const moved = await this.readAppointment(tx, id);

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'appointment.updated',
        entityType: 'appointment',
        entityId: id,
        // Both sides, because a move is only legible as a difference: "10:00 to
        // 11:30, room 2 to room 4" is the fact, and neither half states it.
        before: auditAppointment(current, participants),
        after: auditAppointment(moved, participants),
        metadata: decision.audit,
      });

      return detailOf(moved, participants);
    });
  }

  /**
   * Cancels a scheduled appointment, and says who cancelled it.
   *
   * TWO STATUSES FOR ONE ACT, because the clinic counts them apart:
   * "cancellations by us" is an operational failure to look at, and
   * "cancellations by families" is not. The request names the party and this
   * derives the status, so the two lists cannot be filled from a free choice of
   * status.
   *
   * THE SLOT IS RELEASED as the status changes, by the two exclusion constraints
   * and the child recomputation all being conditional on the occupying statuses.
   * Nothing here deletes, frees or rebuilds anything: the row stays, the hour
   * becomes bookable, and the cancelled appointment remains visible in its day
   * and in every report of it (PROJECT_SPEC.md 14).
   *
   * NO CHARGE, AND NO FINANCIAL CONSEQUENCE OF ANY KIND. Cancellation creates
   * none by default (CLAUDE.md, non-negotiable rules), and a policy that ever
   * changes that is a Milestone 5 decision about charges, not a change here.
   *
   * CANCELLING AN ALREADY-CANCELLED APPOINTMENT THE SAME WAY IS A NO-OP: a
   * double-submitted form must not overwrite the reason and the instant somebody
   * recorded, and must not write a second audit row for one cancellation.
   * Cancelling it the OTHER way is refused — changing who cancelled is a
   * correction of a recorded fact, not a repeat of it, and no approved operation
   * makes one.
   */
  async cancel(
    id: string,
    input: CancelAppointmentRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<AppointmentDetail> {
    const reason = canonicalText(input.reason);
    const target: AppointmentStatus =
      input.cancelledBy === 'FAMILY' ? 'CANCELLED_BY_FAMILY' : 'CANCELLED_BY_CLINIC';

    return this.prisma.$transaction(async (tx) => {
      const current = await this.lockAppointment(tx, id);
      const participants = await this.readParticipants(tx, id);

      if (current.status === target) return detailOf(current, participants);
      if (current.status !== 'SCHEDULED') throw new AppError('APPOINTMENT_TRANSITION_INVALID');

      await tx.$executeRaw`
        UPDATE appointment
        SET status = ${target}::appointment_status,
            cancelled_at = transaction_timestamp(),
            cancellation_reason = ${reason}
        WHERE id = ${id}::uuid
      `;

      const cancelled = await this.readAppointment(tx, id);

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'appointment.cancelled',
        entityType: 'appointment',
        entityId: id,
        before: auditAppointment(current, participants),
        after: auditAppointment(cancelled, participants),
        // The party, flat, as its own key: "how many sessions did the clinic
        // cancel last month?" is answered by counting `metadata->>'cancelledBy'`
        // without parsing a status name out of a diff.
        metadata: { cancelledBy: input.cancelledBy },
      });

      return detailOf(cancelled, participants);
    });
  }

  /**
   * Records that a scheduled session took place.
   *
   * THE TRANSITION MILESTONE 5 WILL HANG THE SESSION CHARGE ON, and the reason
   * this is a single, guarded, audited step from `SCHEDULED` rather than a
   * status a caller may set. Nothing financial happens here yet, and nothing
   * here presumes what will: it changes a status and writes an audit row.
   *
   * IDEMPOTENT BY DESIGN, not by luck. A completed appointment completed again
   * returns exactly what the first request produced and writes no second audit
   * row — the appointment row is held `FOR UPDATE`, so two simultaneous requests
   * cannot both see `SCHEDULED`, and PROJECT_SPEC.md 6 requires repeated
   * submissions to be idempotent because this is the transition that will create
   * money. A cancelled appointment cannot be completed: it did not happen.
   *
   * IT DOES NOT TOUCH ATTENDANCE. Completing the session and saying which child
   * arrived are two facts, and inferring one from the other is what would let a
   * no-show be charged as an attended session.
   */
  async complete(
    id: string,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<AppointmentDetail> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.lockAppointment(tx, id);
      const participants = await this.readParticipants(tx, id);

      if (current.status === 'COMPLETED') return detailOf(current, participants);
      if (current.status !== 'SCHEDULED') throw new AppError('APPOINTMENT_TRANSITION_INVALID');

      await tx.$executeRaw`
        UPDATE appointment
        SET status = 'COMPLETED'::appointment_status,
            completed_at = transaction_timestamp()
        WHERE id = ${id}::uuid
      `;

      const completed = await this.readAppointment(tx, id);

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'appointment.completed',
        entityType: 'appointment',
        entityId: id,
        before: auditAppointment(current, participants),
        after: auditAppointment(completed, participants),
      });

      return detailOf(completed, participants);
    });
  }

  /**
   * Reverses a completion entered by mistake, back to `SCHEDULED`.
   *
   * MANAGER-ONLY AND ALWAYS EXPLAINED. `appointment.reopen` is held by no
   * receptionist (PROJECT_SPEC.md 4), the reason is required, and the whole act
   * is one audit row of its own — this is the correction of a recorded outcome,
   * which CLAUDE.md requires to preserve actor, time and reason.
   *
   * ONLY FROM `COMPLETED`, and deliberately not idempotent. A second reopen sees
   * a scheduled appointment and is refused rather than silently accepted:
   * unlike a repeated completion, "reopen it again" describes nothing, and
   * telling the manager that the appointment is already open is the useful
   * answer.
   *
   * THE OCCUPANCY IT RESTORES IS THE ONE IT ALREADY HAD — `COMPLETED` and
   * `SCHEDULED` occupy the therapist, the room and the child identically — so
   * this can conflict with nothing, and the hour cannot have been given away
   * while the session was completed. The write still goes through the same
   * constraint translation, so a future change to what occupies a slot surfaces
   * as a named conflict instead of an internal error.
   *
   * ATTENDANCE IS LEFT EXACTLY AS RECORDED. What a child did is a separate fact
   * from the booking's status, and the manager reversing a wrong completion did
   * not say the child was absent.
   *
   * IN MILESTONE 5 this is where a session charge must be voided or offset
   * (PROJECT_SPEC.md 6). Nothing financial exists yet; the audit action is
   * separate so that rule has a fact to key on.
   */
  async reopen(
    id: string,
    reason: string,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<AppointmentDetail> {
    const canonicalReason = canonicalText(reason);

    return this.prisma.$transaction(async (tx) => {
      const current = await this.lockAppointment(tx, id);
      if (current.status !== 'COMPLETED') throw new AppError('APPOINTMENT_TRANSITION_INVALID');

      const participants = await this.readParticipants(tx, id);

      try {
        await tx.$executeRaw`
          UPDATE appointment
          SET status = 'SCHEDULED'::appointment_status,
              completed_at = NULL
          WHERE id = ${id}::uuid
        `;
      } catch (error) {
        throw translateSchedulingWrite(error);
      }

      const reopened = await this.readAppointment(tx, id);

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'appointment.reopened',
        entityType: 'appointment',
        entityId: id,
        before: auditAppointment(current, participants),
        after: auditAppointment(reopened, participants),
        metadata: { reason: canonicalReason },
      });

      return detailOf(reopened, participants);
    });
  }

  /**
   * Records what one child did with their seat.
   *
   * THE SEAT'S OWN FACT. `ATTENDED` and `NO_SHOW` are recorded here and nowhere
   * else, and neither changes the booking's status: the room was held and the
   * therapist waited whether or not the child arrived. A `NO_SHOW` creates no
   * charge, and will create none until the clinic approves a policy (CLAUDE.md,
   * non-negotiable rules) — nothing in this method knows what a session costs.
   *
   * THE APPOINTMENT IS LOCKED FIRST, even though the write is to the seat: an
   * attendance recorded against an appointment being cancelled in the same
   * instant must land on one side of that change or the other, and it is also
   * the lock order every other method here takes.
   *
   * A CANCELLED APPOINTMENT HAS NO OUTCOME TO RECORD. The session did not
   * happen, so neither "attended" nor "did not arrive" is a true thing to say
   * about it, and `NO_SHOW` on a cancelled booking is exactly the entry that
   * would later be read as an absence the family is answerable for. Recording an
   * outcome on a `SCHEDULED` appointment IS allowed: a receptionist marks the
   * arrival when the child walks in, and the session is completed afterwards.
   *
   * REPEATING THE SAME OUTCOME IS A NO-OP, so a double-submitted form neither
   * moves the instant it was recorded at nor writes a second audit row.
   * Recording the OTHER outcome is a correction and is audited as the change it
   * is, with both values on the row. There is no way back to `PENDING`: the
   * request schema does not accept it, because un-recording an entry is not a
   * correction of it.
   */
  async recordAttendance(
    appointmentId: string,
    participantId: string,
    input: RecordAttendanceRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<AppointmentDetail> {
    return this.prisma.$transaction(async (tx) => {
      const appointment = await this.lockAppointment(tx, appointmentId);

      const rows = await tx.$queryRaw<ParticipantRow[]>`
        SELECT ${PARTICIPANT_COLUMNS} FROM appointment_participant
        WHERE id = ${participantId}::uuid AND appointment_id = ${appointmentId}::uuid
        FOR UPDATE
      `;

      const participant = rows[0];
      if (participant === undefined) throw new AppError('APPOINTMENT_PARTICIPANT_NOT_FOUND');

      if (isCancelled(appointment.status)) throw new AppError('APPOINTMENT_TRANSITION_INVALID');

      if (participant.attendance === input.attendance) {
        return detailOf(appointment, await this.readParticipants(tx, appointmentId));
      }

      await tx.$executeRaw`
        UPDATE appointment_participant
        SET attendance = ${input.attendance}::attendance_outcome,
            attendance_recorded_at = transaction_timestamp()
        WHERE id = ${participantId}::uuid
      `;

      const participants = await this.readParticipants(tx, appointmentId);

      await this.audit.record(tx, actorContext(actor, context), {
        // The row names the SEAT, not the booking: this is one child's outcome,
        // and it is the row a session charge will name in Milestone 5.
        action: 'appointment.attendance_recorded',
        entityType: 'appointment_participant',
        entityId: participantId,
        before: { attendance: participant.attendance, childId: participant.child_id },
        after: { attendance: input.attendance, childId: participant.child_id },
        // The booking this seat belongs to, so an appointment's outcomes can be
        // read out of the audit trail without joining the seat table.
        metadata: { appointmentId, appointmentStatus: appointment.status },
      });

      return detailOf(appointment, participants);
    });
  }

  /**
   * The appointment row, held for the transaction.
   *
   * `FOR UPDATE` rather than a plain read: every method that changes an
   * appointment decides what it may do from the status it reads here, and a
   * status read without a lock is a fact about a moment that has already passed.
   * It is what makes a second completion see `COMPLETED` rather than race the
   * first one.
   */
  private async lockAppointment(tx: Prisma.TransactionClient, id: string): Promise<AppointmentRow> {
    const rows = await tx.$queryRaw<AppointmentRow[]>`
      SELECT ${APPOINTMENT_COLUMNS} FROM appointment WHERE id = ${id}::uuid FOR UPDATE
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('APPOINTMENT_NOT_FOUND');
    return row;
  }

  /**
   * The move's write, and the three rules PostgreSQL decides as it runs.
   *
   * `ends_at` is recomputed from the new start and length with the same
   * `make_interval` expression `appointment_window_chk` uses, so the stored
   * window cannot drift from the submitted one. The therapist overlap, the room
   * overlap and "this service offers this length" are decided by the constraints
   * as this statement lands, exactly as they are for an insert.
   */
  private async writePlacement(
    tx: Prisma.TransactionClient,
    id: string,
    input: MoveAppointmentRequest,
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
        SET duration_minutes = ${input.durationMinutes},
            therapist_id = ${input.therapistId}::uuid,
            room_id = ${input.roomId}::uuid,
            starts_at = ${input.startsAt}::timestamptz,
            ends_at = ${input.startsAt}::timestamptz
                      + make_interval(mins => ${input.durationMinutes}::int),
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
  private async decideAvailability(
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
   *
   * `excludeAppointmentId` is the appointment being moved. Without it a booking
   * would conflict with the position it is leaving, and no session could be
   * moved by less than its own length — the commonest correction there is.
   */
  private async assertChildIsFree(
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
      throw translateSchedulingWrite(error);
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
function translateSchedulingWrite(error: unknown): unknown {
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

/** The response every write in this class returns: the booking and its seats. */
function detailOf(
  appointment: AppointmentRow,
  participants: readonly ParticipantRow[],
): AppointmentDetail {
  return {
    appointment: toAppointment(appointment),
    participants: participants.map(toParticipant),
  };
}

function isCancelled(status: string): boolean {
  return status === 'CANCELLED_BY_FAMILY' || status === 'CANCELLED_BY_CLINIC';
}

/**
 * Is this move asking for the placement the appointment already has?
 *
 * Compared on the epoch value rather than on the submitted string, so the same
 * instant spelled two ways — `…T06:30:00.000Z` and `…T10:00:00+03:30` — is
 * recognised as unchanged. Every field a move may write is compared, including
 * the note and the override reason, because "nothing changed" has to mean all of
 * it: an audit row recording a move that moved nothing is a false record, and a
 * repeated request must produce exactly one.
 *
 * An unchanged placement submitted WITHOUT the override reason the row carries
 * is deliberately not a no-op. It falls through to the availability decision and
 * is refused unless the caller restates the reason and holds the permission —
 * the authority to sit outside a therapist's hours is granted per write, and
 * inheriting it from the row would let it be re-used by somebody who never had
 * it.
 */
function isSamePlacement(
  current: AppointmentRow,
  input: MoveAppointmentRequest,
  note: string | null,
  submittedReason: string | null,
): boolean {
  return (
    current.starts_at.getTime() === Date.parse(input.startsAt) &&
    current.duration_minutes === input.durationMinutes &&
    current.therapist_id === input.therapistId &&
    current.room_id === input.roomId &&
    current.note === note &&
    current.availability_override_reason === submittedReason
  );
}
