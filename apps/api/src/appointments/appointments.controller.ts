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
  completeAppointmentRequestSchema,
  createAppointmentRequestSchema,
  moveAppointmentRequestSchema,
  recordAttendanceRequestSchema,
  reopenAppointmentRequestSchema,
  type AppointmentDayQuery,
  type AppointmentDayResponse,
  type AppointmentResponse,
  type AppointmentViewResponse,
  type CancelAppointmentRequest,
  type CreateAppointmentRequest,
  type MoveAppointmentRequest,
  type RecordAttendanceRequest,
  type ReopenAppointmentRequest,
} from '@clinic/contracts';
import { RequirePermissions } from '../auth/decorators/endpoint-access';
import { Ctx, CurrentSession } from '../auth/decorators/request.decorators';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { ZodBodyPipe } from '../common/zod-validation.pipe';
import { AppointmentReadService } from './appointment-read.service';
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
