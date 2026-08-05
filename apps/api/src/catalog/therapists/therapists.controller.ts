import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  createTherapistRequestSchema,
  updateCatalogStatusRequestSchema,
  updateTherapistRequestSchema,
  type CreateTherapistRequest,
  type TherapistListResponse,
  type TherapistResponse,
  type UpdateCatalogStatusRequest,
  type UpdateTherapistRequest,
} from '@clinic/contracts';
import { RequirePermissions } from '../../auth/decorators/endpoint-access';
import { Ctx, CurrentSession } from '../../auth/decorators/request.decorators';
import type { RequestContext, ResolvedSession } from '../../common/request-context';
import { ZodBodyPipe } from '../../common/zod-validation.pipe';
import { TherapistsService } from './therapists.service';

/**
 * Therapists. Manager-only in this milestone.
 *
 * Every route names the single permission it needs; a receptionist holds none
 * of them, so every route here returns `AUTH_FORBIDDEN` for them — decided from
 * a role NestJS read out of the database on this request.
 *
 * No delete route, and there will not be one: a therapist is referenced by
 * tariffs now and by appointments and settlement history later. Deactivation is
 * a status change.
 *
 * No authentication route either. A therapist is a record staff manage, not an
 * account.
 */
@Controller('catalog/therapists')
export class TherapistsController {
  constructor(private readonly therapists: TherapistsService) {}

  @Get()
  @RequirePermissions('therapist.read')
  async list(): Promise<TherapistListResponse> {
    return { therapists: await this.therapists.list() };
  }

  @Get(':id')
  @RequirePermissions('therapist.read')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<TherapistResponse> {
    return { therapist: await this.therapists.get(id) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('therapist.create')
  async create(
    @Body(new ZodBodyPipe(createTherapistRequestSchema)) body: CreateTherapistRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<TherapistResponse> {
    return { therapist: await this.therapists.create(body, session, context) };
  }

  @Patch(':id')
  @RequirePermissions('therapist.update')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(updateTherapistRequestSchema)) body: UpdateTherapistRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<TherapistResponse> {
    return { therapist: await this.therapists.update(id, body, session, context) };
  }

  /**
   * Separate from `update` because activation is a different decision from
   * editing, needs its own permission, and must not happen as a side effect of
   * correcting a specialty.
   */
  @Patch(':id/status')
  @RequirePermissions('therapist.update_status')
  async changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(updateCatalogStatusRequestSchema)) body: UpdateCatalogStatusRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<TherapistResponse> {
    return { therapist: await this.therapists.changeStatus(id, body.status, session, context) };
  }
}
