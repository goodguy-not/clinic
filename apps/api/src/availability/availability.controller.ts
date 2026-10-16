import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  availabilityExceptionListQuerySchema,
  closureConflictQuerySchema,
  createAvailabilityExceptionRequestSchema,
  replaceAvailabilityWindowsRequestSchema,
  resolveAvailabilityQuerySchema,
  type AvailabilityExceptionListQuery,
  type AvailabilityExceptionListResponse,
  type AvailabilityExceptionResponse,
  type AvailabilityWindowListResponse,
  type ClosureConflictQuery,
  type ClosureConflictResponse,
  type CreateAvailabilityExceptionRequest,
  type ReplaceAvailabilityWindowsRequest,
  type ResolveAvailabilityQuery,
  type ResolveAvailabilityResponse,
} from '@clinic/contracts';
import { RequirePermissions } from '../auth/decorators/endpoint-access';
import { Ctx, CurrentSession } from '../auth/decorators/request.decorators';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { ZodBodyPipe } from '../common/zod-validation.pipe';
import { AvailabilityService } from './availability.service';

/**
 * Therapist availability: reading it, and managing it.
 *
 * TWO PERMISSIONS, NOT ONE. `availability.read` is on every read and
 * `availability.manage` on every write, because maintaining a schedule and
 * looking one up are plainly different authorities — a booking screen needs the
 * second only. Both are held by the manager alone in this checkpoint, exactly as
 * every catalog permission is: PROJECT_SPEC.md 4 places clinic configuration
 * with the manager, and `ROLE_PERMISSIONS` is unchanged by this work. Which
 * reads a receptionist gains is decided by the checkpoint that builds the screen
 * needing them.
 *
 * The recurring windows are replaced with a `PUT` and dated exceptions are added
 * and removed individually, which is the difference between configuration that
 * is edited as a whole and single-day facts that accumulate.
 *
 * There is no route that edits one window in place. A `PATCH` on a window id
 * would let two requests each change a different window against a schedule
 * neither had seen whole, and the audit trail would record the halves rather
 * than the week.
 */
@Controller('availability')
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  /**
   * The therapist's whole week. No date filter: a recurring window carries no
   * dates, so every one of them is in force.
   */
  @Get('therapists/:therapistId/windows')
  @RequirePermissions('availability.read')
  async listWindows(
    @Param('therapistId', ParseUUIDPipe) therapistId: string,
  ): Promise<AvailabilityWindowListResponse> {
    return { windows: await this.availability.listWindows(therapistId) };
  }

  /**
   * Replaces the therapist's whole recurring week.
   *
   * A `PUT` because that is what it is: the body is the complete set and what it
   * omits is deleted. An empty array is a legitimate submission and clears the
   * standing hours.
   */
  @Put('therapists/:therapistId/windows')
  @HttpCode(200)
  @RequirePermissions('availability.manage')
  async replaceWindows(
    @Param('therapistId', ParseUUIDPipe) therapistId: string,
    @Body(new ZodBodyPipe(replaceAvailabilityWindowsRequestSchema))
    body: ReplaceAvailabilityWindowsRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<AvailabilityWindowListResponse> {
    return { windows: await this.availability.replaceWindows(therapistId, body, session, context) };
  }

  @Get('therapists/:therapistId/exceptions')
  @RequirePermissions('availability.read')
  async listExceptions(
    @Param('therapistId', ParseUUIDPipe) therapistId: string,
    @Query(new ZodBodyPipe(availabilityExceptionListQuerySchema))
    query: AvailabilityExceptionListQuery,
  ): Promise<AvailabilityExceptionListResponse> {
    return { exceptions: await this.availability.listExceptions(therapistId, query) };
  }

  @Post('therapists/:therapistId/exceptions')
  @HttpCode(201)
  @RequirePermissions('availability.manage')
  async addException(
    @Param('therapistId', ParseUUIDPipe) therapistId: string,
    @Body(new ZodBodyPipe(createAvailabilityExceptionRequestSchema))
    body: CreateAvailabilityExceptionRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<AvailabilityExceptionResponse> {
    return this.availability.addException(therapistId, body, session, context);
  }

  /**
   * The scheduled appointments that closures in a date range have left outside
   * the therapist's hours (M10-A9).
   *
   * A read under `availability.read`, like every other read of a schedule: who
   * may close a day is unchanged (`availability.manage`, the manager), and a
   * closure cancels nothing — this is where the sessions it conflicts with are
   * shown, for a person to resolve with the families.
   */
  @Get('therapists/:therapistId/closure-conflicts')
  @RequirePermissions('availability.read')
  async listClosureConflicts(
    @Param('therapistId', ParseUUIDPipe) therapistId: string,
    @Query(new ZodBodyPipe(closureConflictQuerySchema)) query: ClosureConflictQuery,
  ): Promise<ClosureConflictResponse> {
    return { appointments: await this.availability.listClosureConflicts(therapistId, query) };
  }

  /**
   * The only DELETE in the application, and deliberately so.
   *
   * Everything else the clinic records is a historical fact and is voided or
   * deactivated rather than removed. A dated exception is not: it is
   * configuration about a day, it is named by nothing, and a day off entered
   * against the wrong therapist has to be removable. What it said is written to
   * `audit_log` in the same transaction that removes it.
   */
  @Delete('therapists/:therapistId/exceptions/:id')
  @HttpCode(204)
  @RequirePermissions('availability.manage')
  async removeException(
    @Param('therapistId', ParseUUIDPipe) therapistId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<void> {
    await this.availability.removeException(therapistId, id, session, context);
  }

  /**
   * The resolved availability for one therapist on one date.
   *
   * Deliberately not nested under the therapist path, for the reason
   * `/catalog/tariff-resolution` is not nested under `tariffs/`: it would sit in
   * the same space as an id segment and which route answered would depend on
   * declaration order.
   *
   * This answers what the hours ARE. It does not decide what happens to an
   * appointment outside them, which is the booking checkpoint's decision.
   */
  @Get('resolution')
  @RequirePermissions('availability.read')
  async resolve(
    @Query(new ZodBodyPipe(resolveAvailabilityQuerySchema)) query: ResolveAvailabilityQuery,
  ): Promise<ResolveAvailabilityResponse> {
    return { availability: await this.availability.resolve(query) };
  }
}
