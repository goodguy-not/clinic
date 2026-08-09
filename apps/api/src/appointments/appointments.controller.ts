import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  createAppointmentRequestSchema,
  type AppointmentResponse,
  type CreateAppointmentRequest,
} from '@clinic/contracts';
import { RequirePermissions } from '../auth/decorators/endpoint-access';
import { Ctx, CurrentSession } from '../auth/decorators/request.decorators';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { ZodBodyPipe } from '../common/zod-validation.pipe';
import { AppointmentsService } from './appointments.service';

/**
 * Booking, and reading back what was booked.
 *
 * TWO ROUTES, AND NO MORE. Rescheduling, cancelling, completing, recording
 * attendance, generating a series and the day view each belong to the checkpoint
 * that builds them, with their own permissions and their own audit actions.
 *
 * `POST` requires `appointment.create`, which a receptionist holds:
 * PROJECT_SPEC.md 3 makes receptionist-entered appointments the product's core
 * workflow. The one override inside it is checked by the SERVICE and not by this
 * decorator — `appointment.override_availability` is required only when the
 * booking actually falls outside availability, and a route-level requirement
 * would refuse every ordinary booking by a receptionist instead.
 */
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

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
   * Not a day view and not a list: this is the record the create response
   * returned, readable again by id. The scheduling surfaces that answer "what is
   * happening on Saturday" are a read model of their own and arrive with the
   * checkpoint that designs them.
   */
  @Get(':id')
  @RequirePermissions('appointment.read')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<AppointmentResponse> {
    return this.appointments.get(id);
  }
}
