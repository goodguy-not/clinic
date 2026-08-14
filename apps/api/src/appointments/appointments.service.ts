import { Injectable } from '@nestjs/common';
import type {
  AppointmentDetail,
  AppointmentStatus,
  CancelAppointmentRequest,
  CreateAppointmentRequest,
  MoveAppointmentRequest,
  RecordAttendanceRequest,
} from '@clinic/contracts';
import { AuditService } from '../audit/audit.service';
import { actorContext, canonicalOptionalText, canonicalText } from '../catalog/catalog-support';
import { ChargeLifecycleGuard } from '../ledger/charge-lifecycle-guard';
import { ChargePostingService } from '../ledger/charge-posting.service';
import { AppError } from '../common/app-error';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { uuidv7 } from '../common/uuid';
import { PrismaService } from '../prisma/prisma.service';
import {
  detailOf,
  isWholeMinute,
  toAppointment,
  toParticipant,
  type AppointmentRow,
  type ParticipantRow,
} from './booking-support';
import {
  auditAppointment,
  PARTICIPANT_COLUMNS,
  SchedulingRules,
  translateSchedulingWrite,
} from './scheduling-rules';

/**
 * The life of one appointment: booking it, moving it, and recording what
 * happened to it.
 *
 * EVERY WRITE TO `appointment` AND `appointment_participant` IS HERE OR IN
 * `AppointmentSeriesService`, and both decide what they may write with the same
 * `SchedulingRules` — the locks, the compatibility rules, the availability
 * decision, the child recomputation and the two constrained writes. A series
 * occurrence is booked by exactly the code that books a single appointment, and
 * the recurrence checkpoint added no second answer to any conflict question.
 *
 * NO FINANCIAL RULE APPEARS IN EITHER: no tariff is read here, no price is
 * decided, no amount is computed. This class could not price a session — it never
 * looks at a tariff. The read-only price suggestion an operational screen shows
 * is computed by `AppointmentReadService`, which writes nothing, and is
 * deliberately not visible from any method here.
 *
 * TWO FACTS, RECORDED SEPARATELY AND NEVER DERIVED FROM EACH OTHER. The
 * booking's `status` says what happened to the session; a seat's `attendance`
 * says what one child did with it. A child may fail to arrive for a session
 * that took place, so `recordAttendance` does not complete an appointment and
 * `complete` does not resolve an outcome. Milestone 5's rule — only an attended
 * participant in a completed appointment may be charged — needs both facts, and
 * gets them because neither was invented from the other.
 *
 * AND WHILE A CHARGE STANDS ON THEM, NEITHER MAY BE TAKEN BACK. Reopening a
 * completed session and reversing an `ATTENDED` seat both falsify the premise the
 * money rests on, so `ChargeLifecycleGuard` refuses them while a non-voided charge
 * exists for an affected seat. NOTHING IS AUTO-VOIDED: "this did not happen as
 * recorded" and "this should not be owed" are two decisions with two reasons and
 * two audit facts, and the manager makes the financial one first, explicitly. The
 * refusal is thrown under the same lock and inside the same transaction as the
 * write it prevents, so the status, the attendance and every financial row are
 * left exactly as they were.
 *
 * WHICHEVER OF THE TWO IS RECORDED SECOND POSTS THE CHARGE. Both writes hand the
 * seat to `ChargePostingService` on their own transaction once their own fact is
 * recorded, and that routine — not this class — decides whether the seat may be
 * charged, at what price, and whether it already has been. Neither method knows
 * the eligibility rule and neither may skip a call to avoid it: a `NO_SHOW`, a
 * cancellation and a still-`PENDING` seat all produce nothing because the ledger
 * refuses them, not because a caller remembered a condition. The charge commits
 * with the fact that caused it or not at all.
 *
 * THE FOUR STATUSES ARE THE WHOLE LIFECYCLE, FOR A RECURRING OCCURRENCE AS MUCH
 * AS FOR A ONE-OFF. A move is an audited in-place update of a `SCHEDULED` row,
 * not a new state and not a new row: there is no `RESCHEDULED`, because the
 * appointment that moved is the same appointment, and its history is in
 * `audit_log` where a before/after can be read. There is no `VOIDED` either —
 * reversing a completion returns the booking to `SCHEDULED`, and voiding a
 * financial record is a Milestone 5 operation on a financial record. Moving or
 * cancelling ONE occurrence of a series is these methods, unchanged and
 * unaware of the series; there is deliberately no second lifecycle for a
 * recurring appointment.
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
 * locks at most one appointment row, so no cycle can form among them. A series
 * operation is the one exception to "at most one", and it takes its appointment
 * rows in `starts_at` order behind the series row, which is documented where it
 * happens.
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
@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rules: SchedulingRules,
    private readonly charges: ChargePostingService,
    private readonly chargeGuard: ChargeLifecycleGuard,
  ) {}

  async get(id: string): Promise<AppointmentDetail> {
    const appointment = await this.rules.readAppointment(this.prisma, id);
    const participants = await this.rules.readParticipants(this.prisma, id);

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
   *
   * `seriesId` is null here and is not accepted from the caller. An occurrence
   * belongs to the series that generated it, and attaching an arbitrary booking
   * to a series would make "every occurrence of this series matches its pattern"
   * a property nothing enforces.
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
      await this.rules.lockActiveService(tx, input.serviceId);
      await this.rules.lockActiveTherapist(tx, input.therapistId);
      await this.rules.lockActiveRoom(tx, input.roomId);
      await this.rules.lockActiveChild(tx, input.childId);

      await this.rules.assertTherapistProvidesService(tx, input.therapistId, input.serviceId);
      await this.rules.assertRoomAllowsService(tx, input.roomId, input.serviceId);

      const span = await this.rules.readClinicSpan(tx, input.startsAt, input.durationMinutes);

      // A HARD BLOCK, DECIDED BEFORE THE OVERRIDE IS EVEN CONSIDERED. The
      // approved model records a session as a weekday and two wall-clock times,
      // and an appointment that ends on a different clinic day is not a session
      // that model can express — so it is an invalid time, not an unavailable
      // one, and the availability override must not reach it. Placing this above
      // `decideAvailability` is what makes that true rather than merely intended.
      if (span.startDate !== span.endDate) throw new AppError('APPOINTMENT_TIME_INVALID');

      const decision = await this.rules.decideAvailability(tx, span, input, submittedReason, actor);

      await this.rules.assertChildIsFree(tx, input);

      await this.rules.insertAppointment(tx, {
        appointmentId,
        seriesId: null,
        serviceId: input.serviceId,
        placement: input,
        note,
        overrideReason: decision.overrideReason,
        actor,
      });

      await this.rules.insertParticipant(tx, {
        participantId,
        appointmentId,
        childId: input.childId,
      });

      const appointment = await this.rules.readAppointment(tx, appointmentId);
      const participants = await this.rules.readParticipants(tx, appointmentId);

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
   * ONE OCCURRENCE OF A SERIES MOVES THROUGH HERE, exactly as a one-off does.
   * Changing one occurrence leaves the others alone (PROJECT_SPEC.md 6), the
   * appointment keeps its `series_id`, and no series-level rule is consulted:
   * the series is an identity and a termination rule, not a template that has to
   * keep agreeing with its occurrences.
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
      const current = await this.rules.lockAppointment(tx, id);
      if (current.status !== 'SCHEDULED') throw new AppError('APPOINTMENT_TRANSITION_INVALID');

      const participants = await this.rules.readParticipants(tx, id);

      if (isSamePlacement(current, input, note, submittedReason)) {
        return detailOf(current, participants);
      }

      await this.rules.lockActiveTherapist(tx, input.therapistId);
      await this.rules.lockActiveRoom(tx, input.roomId);

      // Against the appointment's OWN service, which a move cannot change. The
      // pairings are re-checked because the therapist and the room may be new:
      // a booking moved to a colleague who does not provide this service, or to
      // a room not allowed to host it, is the same mistake as making it that way.
      await this.rules.assertTherapistProvidesService(tx, input.therapistId, current.service_id);
      await this.rules.assertRoomAllowsService(tx, input.roomId, current.service_id);

      const span = await this.rules.readClinicSpan(tx, input.startsAt, input.durationMinutes);
      if (span.startDate !== span.endDate) throw new AppError('APPOINTMENT_TIME_INVALID');

      const decision = await this.rules.decideAvailability(tx, span, input, submittedReason, actor);

      for (const participant of participants) {
        await this.rules.assertChildIsFree(
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

      await this.rules.writePlacement(tx, id, input, note, decision.overrideReason, actor);

      const moved = await this.rules.readAppointment(tx, id);

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
      const current = await this.rules.lockAppointment(tx, id);
      const participants = await this.rules.readParticipants(tx, id);

      if (current.status === target) return detailOf(current, participants);
      if (current.status !== 'SCHEDULED') throw new AppError('APPOINTMENT_TRANSITION_INVALID');

      await tx.$executeRaw`
        UPDATE appointment
        SET status = ${target}::appointment_status,
            cancelled_at = transaction_timestamp(),
            cancellation_reason = ${reason}
        WHERE id = ${id}::uuid
      `;

      const cancelled = await this.rules.readAppointment(tx, id);

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
   * THE TRANSITION THE SESSION CHARGE HANGS ON, and the reason this is a single,
   * guarded, audited step from `SCHEDULED` rather than a status a caller may set.
   *
   * EVERY SEAT IS OFFERED TO THE LEDGER, unconditionally, on this transaction.
   * The ones that are already `ATTENDED` are charged; a `PENDING` or `NO_SHOW`
   * seat is declined by `ChargePostingService` and nothing is written for it.
   * Filtering here instead would put a second copy of the eligibility rule in the
   * one place that must not have one — and the filter, not the rule, is what a
   * later edit would quietly get wrong.
   *
   * IDEMPOTENT BY DESIGN, not by luck. A completed appointment completed again
   * returns exactly what the first request produced and writes no second audit
   * row — the appointment row is held `FOR UPDATE`, so two simultaneous requests
   * cannot both see `SCHEDULED`, and PROJECT_SPEC.md 6 requires repeated
   * submissions to be idempotent because this is the transition that creates
   * money. The early return also posts nothing: a repeated submission is not a
   * request to raise a charge, and a session left unpriced by a missing tariff is
   * recovered through the explicit re-post, which says so out loud instead of
   * depending on somebody pressing a button twice. A cancelled appointment cannot
   * be completed: it did not happen, so it can produce no charge either.
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
      const current = await this.rules.lockAppointment(tx, id);
      const participants = await this.rules.readParticipants(tx, id);

      if (current.status === 'COMPLETED') return detailOf(current, participants);
      if (current.status !== 'SCHEDULED') throw new AppError('APPOINTMENT_TRANSITION_INVALID');

      await tx.$executeRaw`
        UPDATE appointment
        SET status = 'COMPLETED'::appointment_status,
            completed_at = transaction_timestamp()
        WHERE id = ${id}::uuid
      `;

      const completed = await this.rules.readAppointment(tx, id);

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'appointment.completed',
        entityType: 'appointment',
        entityId: id,
        before: auditAppointment(current, participants),
        after: auditAppointment(completed, participants),
      });

      // After the status is recorded and audited, so the charge is raised against
      // a session the same transaction has already established as completed.
      for (const participant of participants) {
        await this.charges.post(tx, {
          participantId: participant.id,
          actor,
          context,
          trigger: 'APPOINTMENT_COMPLETED',
        });
      }

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
   * A VALID CHARGE BLOCKS IT, AND IS NOT VOIDED ON THE MANAGER'S BEHALF
   * (PROJECT_SPEC.md 6). While any seat under this booking carries a charge that
   * has not been voided, the ledger refuses the reopen with
   * `CHARGE_EXISTS_FOR_PARTICIPANT` and the appointment is left `COMPLETED`. The
   * manager voids the charge — a separate manager-only request, with a financial
   * reason of its own — and reopens afterwards with a lifecycle reason. Two
   * decisions, two audit rows; and if the session is later completed and attended
   * again, the ordinary posting path raises a NEW charge while the withdrawn one
   * stays permanently visible.
   */
  async reopen(
    id: string,
    reason: string,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<AppointmentDetail> {
    const canonicalReason = canonicalText(reason);

    return this.prisma.$transaction(async (tx) => {
      const current = await this.rules.lockAppointment(tx, id);
      if (current.status !== 'COMPLETED') throw new AppError('APPOINTMENT_TRANSITION_INVALID');

      const participants = await this.rules.readParticipants(tx, id);

      // BEFORE ANY WRITE, AND UNDER THE LOCK TAKEN ABOVE. Reopening says the
      // session did not happen as recorded, which is the premise every charge
      // under it stands on; the ledger refuses while any seat still carries one,
      // and the manager voids it — with a financial reason of its own — first.
      // Nothing here voids anything, and nothing here needs to be undone when it
      // refuses: the throw rolls back a transaction that has written nothing.
      await this.chargeGuard.assertNoValidCharge(
        tx,
        participants.map((participant) => participant.id),
      );

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

      const reopened = await this.rules.readAppointment(tx, id);

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
   * non-negotiable rules) — nothing in this method knows what a session costs,
   * and the ledger declines the seat rather than this method skipping it.
   *
   * RECORDING `ATTENDED` ON AN ALREADY-COMPLETED SESSION RAISES THE CHARGE, which
   * is the second of the two orders the rule has to survive. The seat is offered
   * to the ledger on this transaction once the outcome is recorded; if the
   * appointment is still `SCHEDULED`, nothing is written and the completion that
   * follows raises it instead. Repeating the same outcome stays a no-op and posts
   * nothing — the fact did not change, so nothing new happened to charge for.
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
   *
   * `ATTENDED -> NO_SHOW` IS REFUSED WHILE THE SEAT CARRIES A VALID CHARGE. The
   * correction is legitimate, but it says the child was never treated, and the
   * money raised because they were must be withdrawn deliberately first — by a
   * manager, with a financial reason. Recording `ATTENDED` is never guarded: it
   * makes the charge's premise true rather than false.
   */
  async recordAttendance(
    appointmentId: string,
    participantId: string,
    input: RecordAttendanceRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<AppointmentDetail> {
    return this.prisma.$transaction(async (tx) => {
      const appointment = await this.rules.lockAppointment(tx, appointmentId);

      const rows = await tx.$queryRaw<ParticipantRow[]>`
        SELECT ${PARTICIPANT_COLUMNS} FROM appointment_participant
        WHERE id = ${participantId}::uuid AND appointment_id = ${appointmentId}::uuid
        FOR UPDATE
      `;

      const participant = rows[0];
      if (participant === undefined) throw new AppError('APPOINTMENT_PARTICIPANT_NOT_FOUND');

      if (isCancelled(appointment.status)) throw new AppError('APPOINTMENT_TRANSITION_INVALID');

      if (participant.attendance === input.attendance) {
        return detailOf(appointment, await this.rules.readParticipants(tx, appointmentId));
      }

      // MOVING AWAY FROM `ATTENDED` FALSIFIES THE OTHER HALF OF A CHARGE'S
      // PREMISE, so the ledger refuses it while this seat still carries one. Only
      // this seat: another child's outcome is their own fact and their own
      // charge. Recording `ATTENDED` is never guarded — it makes the premise true
      // rather than false, and it is the path that raises the charge below.
      if (input.attendance !== 'ATTENDED') {
        await this.chargeGuard.assertNoValidCharge(tx, [participantId]);
      }

      await tx.$executeRaw`
        UPDATE appointment_participant
        SET attendance = ${input.attendance}::attendance_outcome,
            attendance_recorded_at = transaction_timestamp()
        WHERE id = ${participantId}::uuid
      `;

      const participants = await this.rules.readParticipants(tx, appointmentId);

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

      // THE OTHER ORDER. If the session was already completed, this is the fact
      // that arrived last and the charge is raised now. Offered unconditionally:
      // a `NO_SHOW` recorded against a completed session is declined by the
      // ledger, which is where "a no-show creates no charge" is enforced.
      await this.charges.post(tx, {
        participantId,
        actor,
        context,
        trigger: 'ATTENDANCE_RECORDED',
      });

      return detailOf(appointment, participants);
    });
  }
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
