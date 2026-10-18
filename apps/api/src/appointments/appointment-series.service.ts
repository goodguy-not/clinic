import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  type AppointmentConflict,
  type AppointmentDetail,
  type AppointmentSeries,
  type AppointmentSeriesDetail,
  type AppointmentSeriesOperationResponse,
  type AppointmentStatus,
  type CancelAppointmentSeriesFromRequest,
  type CreateAppointmentSeriesRequest,
  type RecurrenceBlockCode,
  type RecurrencePreviewOccurrence,
  type RecurrencePreviewResponse,
  type RecurrenceRule,
  type SeriesUpdatePreviewOccurrence,
  type SeriesUpdatePreviewResponse,
  type UpdateAppointmentSeriesFromRequest,
  type AvailabilityRefusalReason,
} from '@clinic/contracts';
import { AuditService } from '../audit/audit.service';
import type { AuditJsonObject } from '../audit/audit.types';
import { actorContext, canonicalOptionalText, canonicalText } from '../catalog/catalog-support';
import { AppError } from '../common/app-error';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { uuidv7 } from '../common/uuid';
import { PrismaService } from '../prisma/prisma.service';
import { detailOf, isWholeMinute, type AppointmentRow, type ClinicSpan } from './booking-support';
import { exceedsRecurrenceBounds, occurrenceDates } from './recurrence-support';
import {
  APPOINTMENT_COLUMNS,
  auditAppointment,
  SchedulingRules,
  type AppointmentPlacement,
} from './scheduling-rules';

/**
 * Weekly recurrence: previewing a pattern, creating the series, and changing or
 * calling off the rest of it from one occurrence onwards.
 *
 * ------------------------------------------------------------------------
 * IT ADDS NO SCHEDULING RULE AND RELAXES NONE.
 *
 * Every occurrence is booked through `SchedulingRules` — the same locks, the
 * same therapist/service and room/service compatibility, the same availability
 * decision and its one recorded override, the same child recomputation under
 * the same advisory lock, and the same two INSERTs the resource exclusion
 * constraints are enforced by. There is deliberately no recurrence-only
 * conflict check anywhere in this file: a series occurrence is a booking, and a
 * booking is decided in exactly one place.
 *
 * ------------------------------------------------------------------------
 * CREATION IS ALL OR NOTHING.
 *
 * One transaction generates every occurrence or none of them. There is no
 * `skipConflicting`, no partial success and no occurrence quietly omitted,
 * because a family told "your term is booked" and given eleven of twelve weeks
 * is worse off than one told "week four clashes, choose another hour" — the
 * first failure is invisible until somebody arrives to a locked room. The
 * preview exists so the receptionist can see all twelve findings BEFORE
 * submitting the one request that refuses the lot.
 *
 * The occurrences are inserted in order inside that transaction, so each one is
 * visible to the rules deciding the next: a rule that would book a child, a
 * therapist or a room against itself is caught by the same mechanism that
 * catches a clash with somebody else's appointment.
 *
 * ------------------------------------------------------------------------
 * PREVIEW WRITES NOTHING, AND IS ADVISORY.
 *
 * It reads the diary and reports per-occurrence findings. It cannot be a
 * rehearsal of the write — an aborted INSERT would report the first conflict
 * and lose the other eleven, which is the one thing a preview exists to avoid —
 * so it asks the same questions as a read. It is therefore a statement about a
 * moment that has passed by the time the create runs, and the create re-decides
 * everything under its own locks and constraints rather than trusting anything
 * from here.
 *
 * ------------------------------------------------------------------------
 * THIS-AND-FUTURE PRESERVES HISTORY.
 *
 * `cancel-from` and `update-from` operate on the eligible future occurrences
 * from the pivot onwards: those still `SCHEDULED`, ordered by when they happen.
 * A session already completed is a record of something that happened, and one
 * already cancelled has been communicated to a family; neither is rewritten by
 * a decision about the weeks ahead. Each occurrence that IS changed is changed
 * as itself, with its own audit row carrying its own before and after, so an
 * appointment's history remains complete when read on its own.
 *
 * Both are all-or-nothing for the same reason creation is: a term half-moved to
 * a new room is worse than one that did not move.
 *
 * ------------------------------------------------------------------------
 * LOCK ORDER, extending the one `AppointmentsService` documents:
 *
 *     appointment_series -> appointment -> service -> therapist -> room
 *       -> family -> child -> advisory keys
 *
 * A series operation takes the SERIES row `FOR UPDATE` first, so two people
 * acting on one series serialise before either touches an occurrence, then its
 * appointment rows in `starts_at` order. No cycle can form with a
 * single-appointment operation: those take exactly one appointment row and
 * never a series row, and an appointment belongs to at most one series, so two
 * series operations that hold different series rows can never want each other's
 * appointments.
 *
 * Series CREATION inserts the series row rather than locking one, so it
 * contends with nobody there; its catalog locks are taken in the order above.
 *
 * ------------------------------------------------------------------------
 * NOTHING FINANCIAL. A series reads no tariff, snapshots no price and creates
 * no charge, exactly as a single booking does none of those. Cancelling twelve
 * weeks creates no charge and no credit (CLAUDE.md, non-negotiable rules).
 */

/** One generated occurrence, before anything has been decided about it. */
type GeneratedOccurrence = {
  readonly index: number;
  readonly date: string;
  readonly weekday: number;
  readonly startsAt: string;
  readonly endsAt: string;
};

type SeriesRow = {
  id: string;
  interval_weeks: number;
  starts_on: Date;
  end_mode: string;
  occurrence_count: number | null;
  ends_on: Date | null;
  created_at: Date;
};

const SERIES_COLUMNS = Prisma.sql`
  id, interval_weeks, starts_on, end_mode::text AS end_mode, occurrence_count, ends_on, created_at
`;

@Injectable()
export class AppointmentSeriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rules: SchedulingRules,
  ) {}

  /** A series and every occurrence that belongs to it, whatever happened to each. */
  async get(id: string): Promise<AppointmentSeriesDetail> {
    const series = await this.readSeries(this.prisma, id);
    const occurrences = await this.readOccurrences(this.prisma, id);

    return { series: toSeries(series), occurrences };
  }

  /**
   * What the rule would generate, and what the diary currently says about each
   * week. Writes nothing.
   *
   * It runs in one transaction so all twelve findings describe one snapshot of
   * the diary rather than twelve moments a few milliseconds apart. The catalog
   * and family rows are read under the same `FOR SHARE` locks a booking takes:
   * the alternative is a second implementation of "is this still active", and
   * these are short read-only transactions that block nothing but a concurrent
   * deactivation.
   */
  async preview(
    input: CreateAppointmentSeriesRequest,
    actor: ResolvedSession,
  ): Promise<RecurrencePreviewResponse> {
    if (!isWholeMinute(input.startsAt)) throw new AppError('APPOINTMENT_TIME_INVALID');

    const submittedReason = canonicalOptionalText(input.availabilityOverrideReason);

    return this.prisma.$transaction(async (tx) => {
      const first = await this.prepare(tx, input);
      const occurrences = await this.generate(tx, first.span, input);

      const findings: RecurrencePreviewOccurrence[] = [];

      for (const occurrence of occurrences) {
        const span = await this.rules.readClinicSpan(
          tx,
          occurrence.startsAt,
          input.durationMinutes,
        );
        const outsideReason = await this.rules.isOutsideAvailability(tx, input.therapistId, span);
        const conflicts = await this.rules.findConflicts(
          tx,
          { ...input, startsAt: occurrence.startsAt },
          [input.childId],
        );

        findings.push({
          index: occurrence.index,
          date: occurrence.date,
          startsAt: occurrence.startsAt,
          endsAt: occurrence.endsAt,
          outsideAvailability: outsideReason !== null,
          outsideAvailabilityReason: outsideReason,
          conflicts,
          blockedBy: blockOf({ outsideReason, conflicts, submittedReason, intoPast: false }),
        });
      }

      // The same refusal the create would raise, raised at the same point: a
      // caller who states an override reason they are not authorised to use is
      // told so, rather than being shown a preview whose bookable weeks they
      // could not actually book. The authority is only in question once the
      // rule has actually been broken somewhere in the series.
      if (submittedReason !== null && findings.some((finding) => finding.outsideAvailability)) {
        this.assertMayOverride(actor);
      }

      const blockedCount = findings.filter((finding) => finding.blockedBy !== null).length;

      return {
        pattern: {
          weekday: occurrences[0]?.weekday ?? 0,
          startTime: first.span.startTime,
          endTime: first.span.endTime,
          durationMinutes: input.durationMinutes,
          intervalWeeks: input.recurrence.intervalWeeks,
          endMode: input.recurrence.endMode,
          occurrenceCount: boundCount(input.recurrence),
          endsOn: boundDate(input.recurrence),
        },
        occurrences: findings,
        blockedCount,
        bookable: blockedCount === 0,
      };
    });
  }

  /**
   * Creates the series and every occurrence it generates, or nothing at all.
   *
   * The first occurrence is the pattern: its clinic weekday and wall-clock time
   * are what the rest repeat, read from `startsAt` rather than submitted twice.
   */
  async create(
    input: CreateAppointmentSeriesRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<AppointmentSeriesDetail> {
    if (!isWholeMinute(input.startsAt)) throw new AppError('APPOINTMENT_TIME_INVALID');

    const note = canonicalOptionalText(input.note);
    const submittedReason = canonicalOptionalText(input.availabilityOverrideReason);
    const seriesId = uuidv7();

    return this.prisma.$transaction(async (tx) => {
      const first = await this.prepare(tx, input);
      await this.rules.lockActiveChild(tx, input.childId);

      const occurrences = await this.generate(tx, first.span, input);

      await this.insertSeries(tx, seriesId, first.span.startDate, input.recurrence, actor);

      for (const occurrence of occurrences) {
        const appointmentId = uuidv7();
        const placement: AppointmentPlacement = {
          durationMinutes: input.durationMinutes,
          therapistId: input.therapistId,
          roomId: input.roomId,
          startsAt: occurrence.startsAt,
        };

        const span = await this.rules.readClinicSpan(
          tx,
          occurrence.startsAt,
          placement.durationMinutes,
        );

        // Unreachable for a generated occurrence — every one repeats the first
        // one's wall-clock time, and the first was refused above if it crossed
        // midnight — but stated rather than assumed, because it is the one rule
        // the availability override must never be able to reach.
        if (span.startDate !== span.endDate) throw new AppError('APPOINTMENT_TIME_INVALID');

        const decision = await this.rules.decideAvailability(
          tx,
          span,
          placement,
          submittedReason,
          actor,
        );

        await this.rules.assertPlacementIsFree(tx, placement, [input.childId]);

        await this.rules.insertAppointment(tx, {
          appointmentId,
          seriesId,
          serviceId: input.serviceId,
          placement,
          note,
          overrideReason: decision.overrideReason,
          actor,
          childIds: [input.childId],
        });

        await this.rules.insertParticipant(tx, {
          participantId: uuidv7(),
          appointmentId,
          childId: input.childId,
        });

        const appointment = await this.rules.readAppointment(tx, appointmentId);
        const participants = await this.rules.readParticipants(tx, appointmentId);

        // ONE ROW PER OCCURRENCE, and the same action a single booking writes.
        // An occurrence is an appointment: read its history on its own and the
        // creation is there, in the shape every other appointment's is. The
        // series and the position it was generated at travel in `metadata`.
        await this.audit.record(tx, actorContext(actor, context), {
          action: 'appointment.created',
          entityType: 'appointment',
          entityId: appointmentId,
          after: auditAppointment(appointment, participants),
          metadata: {
            ...(decision.audit ?? {}),
            seriesId,
            occurrenceIndex: occurrence.index,
          },
        });
      }

      const created = await this.readOccurrences(tx, seriesId);
      const series = await this.readSeries(tx, seriesId);

      // AND ONE ROW FOR THE SERIES, in the same transaction as every occurrence
      // it names. "Twelve Saturdays at ten were booked as one act" is a fact the
      // per-occurrence rows do not state, and it is the row that makes the
      // membership of a generated occurrence traceable from the series end.
      await this.audit.record(tx, actorContext(actor, context), {
        action: 'appointment_series.created',
        entityType: 'appointment_series',
        entityId: seriesId,
        after: auditSeries(series, created),
        metadata: {
          weekday: occurrences[0]?.weekday ?? null,
          startTime: first.span.startTime,
          durationMinutes: input.durationMinutes,
          serviceId: input.serviceId,
          therapistId: input.therapistId,
          roomId: input.roomId,
          childId: input.childId,
        },
      });

      return { series: toSeries(series), occurrences: created };
    });
  }

  /**
   * Calls off the rest of a series from one occurrence onwards.
   *
   * Each week is cancelled as the appointment it is: the same two statuses
   * derived from the same party, the same required reason, the same released
   * slot and its own audit row. Completed and already-cancelled occurrences are
   * left exactly as they are.
   *
   * A PIVOT THAT IS ITSELF COMPLETED OR CANCELLED IS NOT AN ERROR. It names a
   * boundary in time — "from this session onwards" — and whether that session
   * can still be cancelled is a separate question, answered by leaving it alone.
   *
   * CANCELLING AN ALREADY-CANCELLED TAIL CHANGES NOTHING AND AUDITS NOTHING, so
   * a resubmitted form does not write a second reason over the one somebody
   * recorded.
   */
  async cancelFrom(
    seriesId: string,
    input: CancelAppointmentSeriesFromRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<AppointmentSeriesOperationResponse> {
    const reason = canonicalText(input.reason);
    const target: AppointmentStatus =
      input.cancelledBy === 'FAMILY' ? 'CANCELLED_BY_FAMILY' : 'CANCELLED_BY_CLINIC';

    return this.prisma.$transaction(async (tx) => {
      const series = await this.lockSeries(tx, seriesId);
      const pivot = await this.readPivot(tx, seriesId, input.fromAppointmentId);
      const eligible = await this.eligibleFrom(tx, seriesId, pivot, true);

      const changed: string[] = [];

      for (const occurrence of eligible) {
        const participants = await this.rules.readParticipants(tx, occurrence.id);

        await tx.$executeRaw`
          UPDATE appointment
          SET status = ${target}::appointment_status,
              cancelled_at = transaction_timestamp(),
              cancellation_reason = ${reason}
          WHERE id = ${occurrence.id}::uuid
        `;

        const cancelled = await this.rules.readAppointment(tx, occurrence.id);
        changed.push(occurrence.id);

        await this.audit.record(tx, actorContext(actor, context), {
          action: 'appointment.cancelled',
          entityType: 'appointment',
          entityId: occurrence.id,
          before: auditAppointment(occurrence, participants),
          after: auditAppointment(cancelled, participants),
          metadata: {
            cancelledBy: input.cancelledBy,
            seriesId,
            seriesOperation: 'CANCEL_FROM',
            pivotAppointmentId: input.fromAppointmentId,
          },
        });
      }

      if (changed.length > 0) {
        await this.audit.record(tx, actorContext(actor, context), {
          action: 'appointment_series.updated',
          entityType: 'appointment_series',
          entityId: seriesId,
          metadata: {
            operation: 'CANCEL_FROM',
            pivotAppointmentId: input.fromAppointmentId,
            cancelledBy: input.cancelledBy,
            reason,
            changedAppointmentIds: changed,
          },
        });
      }

      return {
        series: toSeries(series),
        occurrences: await this.readOccurrences(tx, seriesId),
        changedAppointmentIds: changed,
      };
    });
  }

  /**
   * Re-places the rest of a series: a new therapist, room, length, hour or
   * weekday, from one occurrence onwards.
   *
   * EACH OCCURRENCE STAYS IN ITS OWN CLINIC WEEK. Without a weekday it keeps its
   * own clinic date and takes the new wall-clock time on it; with one (M10-A10,
   * T-023) it moves to that weekday of its own Saturday-first week. Either way
   * the rhythm and the count are untouched, nothing is cancelled, and the
   * occurrences before the pivot — and every completed or cancelled one — are
   * left exactly as they are. The new instant is computed by PostgreSQL's
   * `clinic_moment`, so the zone is applied in the one place it is applied
   * everywhere else.
   *
   * NO OCCURRENCE THAT HAS NOT STARTED IS MOVED INTO THE PAST. Moving the
   * weekday earlier in the current week could otherwise place a future session
   * at an hour that has gone, where an outcome — and a charge — could be
   * recorded at once for a session that never happened.
   *
   * EVERY RULE A MOVE RUNS, RUN PER OCCURRENCE: the catalog compatibility of the
   * new therapist and room, the availability decision for that week's own date —
   * which is why a dated closure part-way through a term is caught rather than
   * assumed away — and the conflict check excluding the occurrence itself. The
   * two resource overlaps are decided by the exclusion constraints as each
   * UPDATE lands. `previewUpdateFrom` reports the same findings first.
   *
   * ALL OR NOTHING. The first occurrence that cannot be placed aborts the
   * transaction, and the series is left exactly as it was.
   *
   * AN OCCURRENCE ALREADY WHERE IT IS ASKED TO GO IS SKIPPED, and audits
   * nothing: a resubmitted form must not fill the trail with moves that moved
   * nothing.
   */
  async updateFrom(
    seriesId: string,
    input: UpdateAppointmentSeriesFromRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<AppointmentSeriesOperationResponse> {
    const note = canonicalOptionalText(input.note);
    const submittedReason = canonicalOptionalText(input.availabilityOverrideReason);
    const weekday = input.weekday ?? null;

    return this.prisma.$transaction(async (tx) => {
      const series = await this.lockSeries(tx, seriesId);
      const pivot = await this.readPivot(tx, seriesId, input.fromAppointmentId);
      const eligible = await this.eligibleFrom(tx, seriesId, pivot, true);

      await this.rules.lockActiveTherapist(tx, input.therapistId);
      await this.rules.lockActiveRoom(tx, input.roomId);

      const changed: string[] = [];

      for (const occurrence of eligible) {
        const target = await this.targetOf(tx, occurrence, input);
        const participants = await this.rules.readParticipants(tx, occurrence.id);

        if (isSameSeriesPlacement(occurrence, target.placement, note, submittedReason)) continue;

        if (target.intoPast) {
          throw new AppError('RECURRENCE_OCCURRENCE_IN_PAST', {
            appointmentId: occurrence.id,
            startsAt: target.placement.startsAt,
          });
        }

        const decision = await this.rules.decideAvailability(
          tx,
          target.span,
          target.placement,
          submittedReason,
          actor,
        );

        const childIds = participants.map((participant) => participant.child_id);

        // Excluded, or an occurrence would conflict with the position it is
        // leaving whenever the hour moves by less than a session's length.
        await this.rules.assertPlacementIsFree(tx, target.placement, childIds, occurrence.id);

        await this.rules.writePlacement(
          tx,
          occurrence.id,
          target.placement,
          note,
          decision.overrideReason,
          actor,
          childIds,
        );

        const moved = await this.rules.readAppointment(tx, occurrence.id);
        changed.push(occurrence.id);

        await this.audit.record(tx, actorContext(actor, context), {
          action: 'appointment.updated',
          entityType: 'appointment',
          entityId: occurrence.id,
          before: auditAppointment(occurrence, participants),
          after: auditAppointment(moved, participants),
          metadata: {
            ...(decision.audit ?? {}),
            seriesId,
            seriesOperation: 'UPDATE_FROM',
            pivotAppointmentId: input.fromAppointmentId,
          },
        });
      }

      if (changed.length > 0) {
        await this.audit.record(tx, actorContext(actor, context), {
          action: 'appointment_series.updated',
          entityType: 'appointment_series',
          entityId: seriesId,
          metadata: {
            operation: 'UPDATE_FROM',
            pivotAppointmentId: input.fromAppointmentId,
            // Null when every occurrence kept its own date.
            weekday,
            startTime: input.startTime,
            durationMinutes: input.durationMinutes,
            therapistId: input.therapistId,
            roomId: input.roomId,
            changedAppointmentIds: changed,
          },
        });
      }

      return {
        series: toSeries(series),
        occurrences: await this.readOccurrences(tx, seriesId),
        changedAppointmentIds: changed,
      };
    });
  }

  /**
   * What `updateFrom` would do with the same request, and what the diary says
   * about each new placement right now. Writes nothing.
   *
   * The same targets from the same `targetOf`, the same compatibility refusals
   * for the whole request, and per occurrence the same findings the creation
   * preview gives — so the receptionist sees every clash before applying.
   * Nothing is locked `FOR UPDATE`: a preview must not block the desk.
   */
  async previewUpdateFrom(
    seriesId: string,
    input: UpdateAppointmentSeriesFromRequest,
    actor: ResolvedSession,
  ): Promise<SeriesUpdatePreviewResponse> {
    const note = canonicalOptionalText(input.note);
    const submittedReason = canonicalOptionalText(input.availabilityOverrideReason);

    return this.prisma.$transaction(async (tx) => {
      await this.readSeries(tx, seriesId);
      const pivot = await this.readPivot(tx, seriesId, input.fromAppointmentId);
      const eligible = await this.eligibleFrom(tx, seriesId, pivot, false);

      await this.rules.lockActiveTherapist(tx, input.therapistId);
      await this.rules.lockActiveRoom(tx, input.roomId);

      const findings: SeriesUpdatePreviewOccurrence[] = [];

      for (const occurrence of eligible) {
        const target = await this.targetOf(tx, occurrence, input);
        const participants = await this.rules.readParticipants(tx, occurrence.id);
        const unchanged = isSameSeriesPlacement(
          occurrence,
          target.placement,
          note,
          submittedReason,
        );

        const outsideReason = await this.rules.isOutsideAvailability(
          tx,
          input.therapistId,
          target.span,
        );
        const conflicts = unchanged
          ? []
          : await this.rules.findConflicts(
              tx,
              target.placement,
              participants.map((participant) => participant.child_id),
              occurrence.id,
            );

        findings.push({
          appointmentId: occurrence.id,
          currentStartsAt: occurrence.starts_at.toISOString(),
          date: target.span.startDate,
          startsAt: target.placement.startsAt,
          endsAt: target.endsAt,
          unchanged,
          outsideAvailability: outsideReason !== null,
          outsideAvailabilityReason: outsideReason,
          conflicts,
          blockedBy: unchanged
            ? null
            : blockOf({ outsideReason, conflicts, submittedReason, intoPast: target.intoPast }),
        });
      }

      // The authority check the update would make, at the same point.
      if (
        submittedReason !== null &&
        findings.some((finding) => !finding.unchanged && finding.outsideAvailability)
      ) {
        this.assertMayOverride(actor);
      }

      const blockedCount = findings.filter((finding) => finding.blockedBy !== null).length;

      return { occurrences: findings, blockedCount, applicable: blockedCount === 0 };
    });
  }

  /**
   * Where `update-from` puts one occurrence: the catalog compatibility of the
   * new therapist and room against the occurrence's OWN service (which a series
   * update cannot change any more than a single move can), the new instant, the
   * clinic's reading of it, and whether it would move a session that has not
   * started into the past. One method, so the preview and the update cannot
   * compute a different target.
   */
  private async targetOf(
    tx: Prisma.TransactionClient,
    occurrence: AppointmentRow,
    input: UpdateAppointmentSeriesFromRequest,
  ): Promise<{
    placement: AppointmentPlacement;
    span: ClinicSpan;
    endsAt: string;
    intoPast: boolean;
  }> {
    await this.rules.assertTherapistProvidesService(tx, input.therapistId, occurrence.service_id);
    await this.rules.assertRoomAllowsService(tx, input.roomId, occurrence.service_id);

    const weekday = input.weekday ?? null;
    const current = occurrence.starts_at.toISOString();

    const rows = await tx.$queryRaw<{ moment: Date; ends_at: Date; into_past: boolean }[]>`
      WITH own AS (
        SELECT clinic_date(${current}::timestamptz) AS day
      ),
      target AS (
        SELECT clinic_moment(
                 CASE
                   WHEN ${weekday}::int IS NULL THEN own.day
                   -- Saturday-first: back to the week's Saturday, then forward.
                   ELSE own.day - ((EXTRACT(DOW FROM own.day)::int + 1) % 7) + ${weekday}::int
                 END,
                 ${input.startTime}::time
               ) AS moment
        FROM own
      )
      SELECT moment,
             moment + make_interval(mins => ${input.durationMinutes}::int) AS ends_at,
             (${current}::timestamptz > transaction_timestamp()
               AND moment < transaction_timestamp()) AS into_past
      FROM target
    `;

    const row = rows[0];
    // Unreachable: a projection over one synthetic row, stated so a future edit
    // that makes it a join cannot silently produce no instant.
    if (row === undefined) throw new AppError('APPOINTMENT_TIME_INVALID');

    const placement: AppointmentPlacement = {
      durationMinutes: input.durationMinutes,
      therapistId: input.therapistId,
      roomId: input.roomId,
      startsAt: row.moment.toISOString(),
    };

    const span = await this.rules.readClinicSpan(tx, placement.startsAt, placement.durationMinutes);
    // A session that ends on another clinic day is refused before availability
    // is considered, here as everywhere; the override must not reach it.
    if (span.startDate !== span.endDate) throw new AppError('APPOINTMENT_TIME_INVALID');

    return { placement, span, endsAt: row.ends_at.toISOString(), intoPast: row.into_past };
  }

  /**
   * Everything a series creation decides before it knows how many occurrences
   * there are: the catalog locks, the two compatibility rules, and the clinic's
   * reading of the first session.
   *
   * The child is deliberately NOT locked here. The preview shares this method
   * and has no business holding a lock on a family it is only looking at; the
   * create takes it immediately afterwards, in the documented order.
   */
  private async prepare(tx: Prisma.TransactionClient, input: CreateAppointmentSeriesRequest) {
    await this.rules.lockActiveService(tx, input.serviceId);
    await this.rules.lockActiveTherapist(tx, input.therapistId);
    await this.rules.lockActiveRoom(tx, input.roomId);

    await this.rules.assertTherapistProvidesService(tx, input.therapistId, input.serviceId);
    await this.rules.assertRoomAllowsService(tx, input.roomId, input.serviceId);

    const span = await this.rules.readClinicSpan(tx, input.startsAt, input.durationMinutes);

    // Before the rule is even read: a session that ends on another clinic day is
    // not a shape the weekly model can express, so it cannot be the pattern of
    // anything, and no override may authorise it.
    if (span.startDate !== span.endDate) throw new AppError('APPOINTMENT_TIME_INVALID');

    return { span };
  }

  /**
   * The occurrences a rule generates: a calendar day each, and the instant each
   * one starts at.
   *
   * The days are counted in `recurrence-support`, where the arithmetic is pure
   * and testable without a database. Turning each day plus the pattern's
   * wall-clock time into an instant is PostgreSQL's, because that is where
   * `Asia/Tehran` lives — and it is also where the Saturday-first weekday
   * numbering is translated from `EXTRACT(DOW)`, rather than in a second Node
   * implementation that would have to keep agreeing with it.
   *
   * THE APPROVED BOUNDS ARE DECIDED HERE, WHICH IS WHY THE PREVIEW AND THE
   * CREATE CANNOT DISAGREE ABOUT THEM: both reach the rule through this method,
   * and a preview that showed eighty weeks the create would refuse would be
   * worse than no preview at all.
   */
  private async generate(
    tx: Prisma.TransactionClient,
    span: { startDate: string; startTime: string },
    input: CreateAppointmentSeriesRequest,
  ): Promise<GeneratedOccurrence[]> {
    const dates = occurrenceDates(span.startDate, input.recurrence);

    // Three refusals, one code, and all of them about the RULE rather than
    // about any week it names: a last date before the first session generates
    // nothing, more than `RECURRENCE_OCCURRENCES_MAX` sessions is past the
    // approved count, and a last session past `RECURRENCE_HORIZON_MONTHS` is
    // past the approved horizon. None is truncated to fit — a receptionist who
    // asked for two years and was quietly given one would find out when a
    // family arrived to a session nobody had booked.
    if (dates.length === 0 || exceedsRecurrenceBounds(span.startDate, dates)) {
      throw new AppError('RECURRENCE_RULE_INVALID');
    }

    const rows = await tx.$queryRaw<
      { index: number; date: string; weekday: number; starts_at: Date; ends_at: Date }[]
    >`
      SELECT (u.pos - 1)::int AS index,
             u.occurrence_day::text AS date,
             ((EXTRACT(DOW FROM u.occurrence_day)::int + 1) % 7) AS weekday,
             clinic_moment(u.occurrence_day, ${span.startTime}::time) AS starts_at,
             clinic_moment(u.occurrence_day, ${span.startTime}::time)
               + make_interval(mins => ${input.durationMinutes}::int) AS ends_at
      FROM unnest(ARRAY[${Prisma.join(dates)}]::date[])
           WITH ORDINALITY AS u(occurrence_day, pos)
      ORDER BY u.pos
    `;

    return rows.map((row) => ({
      index: row.index,
      date: row.date,
      weekday: row.weekday,
      startsAt: row.starts_at.toISOString(),
      endsAt: row.ends_at.toISOString(),
    }));
  }

  /**
   * The same authority check `decideAvailability` makes, made once for a
   * request that decides nothing.
   *
   * The permission list was resolved from the database by `SessionGuard` for
   * this request, never taken from anything the caller sent.
   */
  private assertMayOverride(actor: ResolvedSession): void {
    if (!actor.permissions.includes('appointment.override_availability')) {
      throw new AppError('AUTH_FORBIDDEN');
    }
  }

  private async insertSeries(
    tx: Prisma.TransactionClient,
    seriesId: string,
    startsOn: string,
    rule: RecurrenceRule,
    actor: ResolvedSession,
  ): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO appointment_series (
        id, interval_weeks, starts_on, end_mode, occurrence_count, ends_on,
        created_at, created_by_user_id
      ) VALUES (
        ${seriesId}::uuid,
        ${rule.intervalWeeks},
        ${startsOn}::date,
        ${rule.endMode}::recurrence_end,
        ${boundCount(rule)},
        ${boundDate(rule)}::date,
        transaction_timestamp(),
        ${actor.userId}::uuid
      )
    `;
  }

  /**
   * The series row, held for the transaction.
   *
   * `FOR UPDATE` and taken FIRST, so two people running this-and-future
   * operations on one series serialise before either has touched an occurrence.
   * Without it both would read the same eligible set and the second would decide
   * against a tail the first had already moved.
   */
  private async lockSeries(tx: Prisma.TransactionClient, id: string): Promise<SeriesRow> {
    const rows = await tx.$queryRaw<SeriesRow[]>`
      SELECT ${SERIES_COLUMNS} FROM appointment_series WHERE id = ${id}::uuid FOR UPDATE
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('APPOINTMENT_SERIES_NOT_FOUND');
    return row;
  }

  private async readSeries(
    client: PrismaService | Prisma.TransactionClient,
    id: string,
  ): Promise<SeriesRow> {
    const rows = await client.$queryRaw<SeriesRow[]>`
      SELECT ${SERIES_COLUMNS} FROM appointment_series WHERE id = ${id}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('APPOINTMENT_SERIES_NOT_FOUND');
    return row;
  }

  /**
   * The occurrence the operation counts from.
   *
   * It must belong to THIS series. An appointment id from another series — or
   * from no series — is `APPOINTMENT_NOT_FOUND` rather than a quiet no-op,
   * because a this-and-future operation whose pivot is somewhere else would
   * silently change either everything or nothing.
   */
  private async readPivot(
    tx: Prisma.TransactionClient,
    seriesId: string,
    appointmentId: string,
  ): Promise<AppointmentRow> {
    const rows = await tx.$queryRaw<AppointmentRow[]>`
      SELECT ${APPOINTMENT_COLUMNS} FROM appointment
      WHERE id = ${appointmentId}::uuid AND series_id = ${seriesId}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('APPOINTMENT_NOT_FOUND');
    return row;
  }

  /**
   * The occurrences a this-and-future operation may act on, locked in the order
   * they happen.
   *
   * `starts_at >= pivot` rather than an index or a creation order: an occurrence
   * that was individually moved sits where it now sits, and "this and everything
   * after it" is a statement about the diary rather than about a row order.
   *
   * ONLY `SCHEDULED`. A completed session is a record of something that
   * happened and an already-cancelled one has been communicated to a family;
   * both are preserved, and filtering them here is what makes that true for
   * every operation rather than being restated in each.
   */
  private async eligibleFrom(
    tx: Prisma.TransactionClient,
    seriesId: string,
    pivot: AppointmentRow,
    lock: boolean,
  ): Promise<AppointmentRow[]> {
    // A preview reads the same set without holding it.
    const forUpdate = lock ? Prisma.sql`FOR UPDATE` : Prisma.empty;

    return tx.$queryRaw<AppointmentRow[]>`
      SELECT ${APPOINTMENT_COLUMNS} FROM appointment
      WHERE series_id = ${seriesId}::uuid
        AND status = 'SCHEDULED'::appointment_status
        AND starts_at >= ${pivot.starts_at.toISOString()}::timestamptz
      ORDER BY starts_at ASC, id ASC
      ${forUpdate}
    `;
  }

  /** Every occurrence of the series, in start order, whatever its status. */
  private async readOccurrences(
    client: PrismaService | Prisma.TransactionClient,
    seriesId: string,
  ): Promise<AppointmentDetail[]> {
    const rows = await client.$queryRaw<AppointmentRow[]>`
      SELECT ${APPOINTMENT_COLUMNS} FROM appointment
      WHERE series_id = ${seriesId}::uuid
      ORDER BY starts_at ASC, id ASC
    `;

    const occurrences: AppointmentDetail[] = [];

    for (const row of rows) {
      occurrences.push(detailOf(row, await this.rules.readParticipants(client, row.id)));
    }

    return occurrences;
  }
}

/**
 * Why a previewed occurrence cannot be placed as submitted, or null.
 *
 * In the order the write decides them: a move into the past, then
 * availability (unless a reason covers it), then the first conflicting
 * dimension (child, therapist, room), so the preview names the refusal the
 * write would actually raise. Every conflict is still listed beside it.
 */
function blockOf(finding: {
  outsideReason: AvailabilityRefusalReason | null;
  conflicts: readonly AppointmentConflict[];
  submittedReason: string | null;
  intoPast: boolean;
}): RecurrenceBlockCode | null {
  if (finding.intoPast) return 'RECURRENCE_OCCURRENCE_IN_PAST';
  if (finding.outsideReason !== null && finding.submittedReason === null) {
    return 'APPOINTMENT_OUTSIDE_AVAILABILITY';
  }

  const first = finding.conflicts[0];
  if (first === undefined) return null;

  return BLOCK_BY_RESOURCE[first.resource];
}

const BLOCK_BY_RESOURCE = {
  CHILD: 'APPOINTMENT_CHILD_CONFLICT',
  THERAPIST: 'APPOINTMENT_THERAPIST_CONFLICT',
  ROOM: 'APPOINTMENT_ROOM_CONFLICT',
} as const satisfies Record<AppointmentConflict['resource'], RecurrenceBlockCode>;

function boundCount(rule: RecurrenceRule): number | null {
  return rule.endMode === 'OCCURRENCE_COUNT' ? rule.occurrenceCount : null;
}

function boundDate(rule: RecurrenceRule): string | null {
  return rule.endMode === 'END_DATE' ? rule.endsOn : null;
}

function toSeries(row: SeriesRow): AppointmentSeries {
  return {
    id: row.id,
    intervalWeeks: row.interval_weeks,
    startsOn: row.starts_on.toISOString().slice(0, 10),
    endMode: row.end_mode as AppointmentSeries['endMode'],
    occurrenceCount: row.occurrence_count,
    endsOn: row.ends_on?.toISOString().slice(0, 10) ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * What the series audit row records: the rule, and the occurrences it names.
 *
 * The occurrence ids and their instants travel as VALUES rather than as a
 * pointer to rows that may have moved since — the whole point of an audit row
 * is that it still answers the question it was written for.
 */
function auditSeries(
  row: SeriesRow,
  occurrences: readonly { appointment: { id: string; startsAt: string } }[],
): AuditJsonObject {
  return {
    intervalWeeks: row.interval_weeks,
    startsOn: row.starts_on.toISOString().slice(0, 10),
    endMode: row.end_mode,
    occurrenceCount: row.occurrence_count,
    endsOn: row.ends_on?.toISOString().slice(0, 10) ?? null,
    occurrences: occurrences.map((occurrence) => ({
      id: occurrence.appointment.id,
      startsAt: occurrence.appointment.startsAt,
    })),
  };
}

/**
 * Is this occurrence already exactly where the series update asks it to go?
 *
 * The same comparison a single move makes, on the same fields, and on the epoch
 * value rather than the string so two spellings of one instant are recognised as
 * equal. Skipping an unchanged occurrence is what keeps a resubmitted form from
 * filling the audit trail with moves that moved nothing.
 */
function isSameSeriesPlacement(
  current: AppointmentRow,
  placement: AppointmentPlacement,
  note: string | null,
  submittedReason: string | null,
): boolean {
  return (
    current.starts_at.getTime() === Date.parse(placement.startsAt) &&
    current.duration_minutes === placement.durationMinutes &&
    current.therapist_id === placement.therapistId &&
    current.room_id === placement.roomId &&
    current.note === note &&
    current.availability_override_reason === submittedReason
  );
}
