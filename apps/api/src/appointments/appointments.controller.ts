import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  appointmentDayQuerySchema,
  cancelAppointmentRequestSchema,
  cancelAppointmentSeriesFromRequestSchema,
  completeAppointmentRequestSchema,
  createAppointmentRequestSchema,
  createAppointmentSeriesRequestSchema,
  moveAppointmentRequestSchema,
  recordAttendanceRequestSchema,
  reopenAppointmentRequestSchema,
  updateAppointmentSeriesFromRequestSchema,
  type AppointmentDayQuery,
  type AppointmentDayResponse,
  type AppointmentResponse,
  type AppointmentSeriesOperationResponse,
  type AppointmentSeriesResponse,
  type AppointmentViewResponse,
  type CancelAppointmentRequest,
  type CancelAppointmentSeriesFromRequest,
  type CreateAppointmentRequest,
  type CreateAppointmentSeriesRequest,
  type MoveAppointmentRequest,
  type RecordAttendanceRequest,
  type RecurrencePreviewResponse,
  type ReopenAppointmentRequest,
  type SeriesUpdatePreviewResponse,
  type UpdateAppointmentSeriesFromRequest,
} from '@clinic/contracts';
import { RequirePermissions } from '../auth/decorators/endpoint-access';
import { Ctx, CurrentSession } from '../auth/decorators/request.decorators';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { ZodBodyPipe } from '../common/zod-validation.pipe';
import { AppointmentReadService } from './appointment-read.service';
import { AppointmentSeriesService } from './appointment-series.service';
import { AppointmentsService } from './appointments.service';

/**
 * One appointment: booking it, moving it, recording what happened, and reading
 * it back.
 *
 * A PERMISSION PER AUTHORITY, NOT PER ROUTE SHAPE. `appointment.update` moves a
 * booking, `appointment.cancel` calls it off, `appointment.complete` records
 * that it happened, and `appointment.reopen` reverses that — four different
 * authorities over one row, and the last is held by no receptionist
 * (PROJECT_SPEC.md 4) because reversing a completion will void or offset a
 * financial record. Collapsing them into one `appointment.write` would make the
 * role map unable to express that.
 *
 * The one override is checked by the SERVICE and not by a decorator:
 * `appointment.override_availability` is required only when a booking or a move
 * actually falls outside availability, and a route-level requirement would
 * refuse every ordinary booking by a receptionist instead.
 *
 * THE DAY VIEW IS NOT HERE. `/appointment-day` is its own path, for the reason
 * `/catalog/tariff-resolution` is: a `GET /appointments/day` would sit in the
 * same route space as `GET /appointments/:id`, and which one answered would
 * depend on the order the routes happen to be declared in.
 */
@Controller('appointments')
export class AppointmentsController {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly read: AppointmentReadService,
  ) {}

  @Post()
  @HttpCode(201)
  @RequirePermissions('appointment.create')
  async create(
    @Body(new ZodBodyPipe(createAppointmentRequestSchema)) body: CreateAppointmentRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<AppointmentResponse> {
    return this.appointments.create(body, session, context);
  }

  /**
   * One booking and its seats.
   *
   * The shape every write returns, readable again by id: what a caller re-reads
   * to confirm a transition, with no name resolved and no price suggested. The
   * screen-ready reading of the same appointment is `:id/view`.
   */
  @Get(':id')
  @RequirePermissions('appointment.read')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<AppointmentResponse> {
    return this.appointments.get(id);
  }

  /**
   * The same appointment as an interface renders it: the child, therapist, room
   * and service by name, and the read-only tariff suggestion.
   *
   * Deliberately not merged into `GET :id`. That response is also what every
   * write returns, and a price has no business travelling out of a transaction
   * that books a session.
   */
  @Get(':id/view')
  @RequirePermissions('appointment.read')
  async view(@Param('id', ParseUUIDPipe) id: string): Promise<AppointmentViewResponse> {
    return this.read.view(id);
  }

  /**
   * Move a scheduled appointment: a new time, length, therapist or room.
   *
   * `PATCH` on the appointment itself rather than a `/move` action, because a
   * move is an ordinary edit of the row — the same reason the catalog edits are
   * `PATCH :id`. The body is the complete new placement, so the server never
   * merges a partial request with a stored row to find out what was meant.
   */
  @Patch(':id')
  @RequirePermissions('appointment.update')
  async move(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(moveAppointmentRequestSchema)) body: MoveAppointmentRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<AppointmentResponse> {
    return this.appointments.move(id, body, session, context);
  }

  /** Call the session off, saying who cancelled it and why. */
  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('appointment.cancel')
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(cancelAppointmentRequestSchema)) body: CancelAppointmentRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<AppointmentResponse> {
    return this.appointments.cancel(id, body, session, context);
  }

  /**
   * Record that the session took place.
   *
   * The body is an empty strict object rather than no body at all, so a caller
   * that sends a status, an attendance or an amount is told it is not accepted
   * instead of having it silently ignored. Repeating the request is safe and
   * returns the same appointment.
   */
  @Post(':id/complete')
  @HttpCode(200)
  @RequirePermissions('appointment.complete')
  async complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(completeAppointmentRequestSchema)) _body: unknown,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<AppointmentResponse> {
    return this.appointments.complete(id, session, context);
  }

  /**
   * Reverse a completion entered by mistake.
   *
   * `appointment.reopen` is manager-only, and the reason is required: this is
   * the correction of a recorded outcome, and in Milestone 5 it is where a
   * session charge will have to be voided or offset.
   */
  @Post(':id/reopen')
  @HttpCode(200)
  @RequirePermissions('appointment.reopen')
  async reopen(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(reopenAppointmentRequestSchema)) body: ReopenAppointmentRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<AppointmentResponse> {
    return this.appointments.reopen(id, body.reason, session, context);
  }

  /**
   * Record what one child did with their seat.
   *
   * `PUT` because it sets a value rather than accumulating one: recording the
   * same outcome twice is the same fact, and the second request changes nothing.
   * It requires `appointment.complete` — the authority to say what happened to a
   * session — and not `appointment.update`, which places bookings in the diary.
   *
   * The seat is addressed under its appointment, and the service checks the
   * pairing: a participant id from another booking is
   * `APPOINTMENT_PARTICIPANT_NOT_FOUND`, never an outcome written to the wrong
   * child.
   */
  @Put(':id/participants/:participantId/attendance')
  @RequirePermissions('appointment.complete')
  async recordAttendance(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('participantId', ParseUUIDPipe) participantId: string,
    @Body(new ZodBodyPipe(recordAttendanceRequestSchema)) body: RecordAttendanceRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<AppointmentResponse> {
    return this.appointments.recordAttendance(id, participantId, body, session, context);
  }
}

/**
 * A weekly series: previewing one, creating it, and changing or calling off the
 * rest of it.
 *
 * A PATH OF ITS OWN, for the reason `/appointment-day` has one: `/appointments/preview`
 * would sit in the same route space as `/appointments/:id` and which one
 * answered would depend on declaration order. A distinct path cannot collide.
 *
 * NO PERMISSION IS INVENTED FOR RECURRENCE. Creating twelve appointments is
 * `appointment.create`, calling them off is `appointment.cancel`, re-placing
 * them is `appointment.update`, and reading the series is `appointment.read` —
 * the same authorities over the same rows, exercised in bulk. A
 * `series.manage` permission would let a role map grant somebody the power to
 * cancel twelve sessions while withholding the power to cancel one, which is
 * not a distinction the clinic makes.
 *
 * The one override is checked by the SERVICE, exactly as it is for a single
 * booking: `appointment.override_availability` is required only when an
 * occurrence actually falls outside the therapist's hours.
 *
 * THE SINGLE-OCCURRENCE OPERATIONS ARE NOT HERE. Moving or cancelling one week
 * of a series is `PATCH /appointments/:id` and `POST /appointments/:id/cancel`,
 * unchanged: an occurrence is an appointment, and there is one appointment
 * lifecycle.
 */
@Controller('appointment-series')
export class AppointmentSeriesController {
  constructor(private readonly series: AppointmentSeriesService) {}

  /**
   * A dry run: what the rule would generate, and what is in the way.
   *
   * `POST` rather than `GET` because the request is a whole booking plus a rule
   * — too large for a query string, and it would put a child id in the browser
   * history and every access log, which is the reason family search is a POST
   * (DECISION_LOG, Milestone 3). It writes nothing; `200` rather than `201`
   * says so.
   */
  @Post('preview')
  @HttpCode(200)
  @RequirePermissions('appointment.create')
  async preview(
    @Body(new ZodBodyPipe(createAppointmentSeriesRequestSchema))
    body: CreateAppointmentSeriesRequest,
    @CurrentSession() session: ResolvedSession,
  ): Promise<RecurrencePreviewResponse> {
    return this.series.preview(body, session);
  }

  /** Create the series and every occurrence it generates, or nothing at all. */
  @Post()
  @HttpCode(201)
  @RequirePermissions('appointment.create')
  async create(
    @Body(new ZodBodyPipe(createAppointmentSeriesRequestSchema))
    body: CreateAppointmentSeriesRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<AppointmentSeriesResponse> {
    return this.series.create(body, session, context);
  }

  /** The series and every occurrence that belongs to it, in start order. */
  @Get(':id')
  @RequirePermissions('appointment.read')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<AppointmentSeriesResponse> {
    return this.series.get(id);
  }

  /**
   * Call off this occurrence and every later one still scheduled.
   *
   * An action rather than a `DELETE`: nothing is deleted, a cancelled occurrence
   * stays visible in its day and in every report of it, and the request has to
   * carry who cancelled and why.
   */
  @Post(':id/cancel-from')
  @HttpCode(200)
  @RequirePermissions('appointment.cancel')
  async cancelFrom(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(cancelAppointmentSeriesFromRequestSchema))
    body: CancelAppointmentSeriesFromRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<AppointmentSeriesOperationResponse> {
    return this.series.cancelFrom(id, body, session, context);
  }

  /**
   * Re-place this occurrence and every later one still scheduled.
   *
   * `PATCH` for the reason moving one appointment is `PATCH /appointments/:id`:
   * re-placing sessions is an edit of rows that already exist, and this is the
   * same edit applied to the tail of a series. The path names the pivot rather
   * than the whole series because the series row itself is unchanged — the rule
   * and its bound stay exactly as they were.
   *
   * Cancelling stays a `POST` action, exactly as `POST /appointments/:id/cancel`
   * does: it records who cancelled and why, which is a stated act rather than an
   * edit of a placement.
   *
   * All or nothing: the first occurrence that cannot be placed refuses the whole
   * operation and the series is left as it was.
   */
  @Patch(':id/update-from')
  @HttpCode(200)
  @RequirePermissions('appointment.update')
  async updateFrom(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(updateAppointmentSeriesFromRequestSchema))
    body: UpdateAppointmentSeriesFromRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<AppointmentSeriesOperationResponse> {
    return this.series.updateFrom(id, body, session, context);
  }

  /**
   * A dry run of `update-from`: the same body, the same targets, and what is in
   * the way of each, written nowhere (M10-A10, T-023). `POST` and `200` for the
   * reason the creation preview is; `appointment.update` because it answers
   * the question that permission is needed to act on.
   */
  @Post(':id/update-from/preview')
  @HttpCode(200)
  @RequirePermissions('appointment.update')
  async previewUpdateFrom(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(updateAppointmentSeriesFromRequestSchema))
    body: UpdateAppointmentSeriesFromRequest,
    @CurrentSession() session: ResolvedSession,
  ): Promise<SeriesUpdatePreviewResponse> {
    return this.series.previewUpdateFrom(id, body, session);
  }
}

/**
 * "What is happening on this day?"
 *
 * A path of its own rather than `/appointments/day`, which would sit in the same
 * route space as `/appointments/:id` — the collision `/catalog/tariff-resolution`
 * was separated to avoid. A distinct path cannot collide at all.
 *
 * `appointment.read` and nothing more. The day carries a read-only price
 * suggestion, which is the clinic's own price list rather than any family's
 * financial data, and no permission beyond reading the diary is required to see
 * it.
 */
@Controller('appointment-day')
export class AppointmentDayController {
  constructor(private readonly read: AppointmentReadService) {}

  @Get()
  @RequirePermissions('appointment.read')
  async day(
    @Query(new ZodBodyPipe(appointmentDayQuerySchema)) query: AppointmentDayQuery,
  ): Promise<AppointmentDayResponse> {
    return this.read.day(query);
  }
}
