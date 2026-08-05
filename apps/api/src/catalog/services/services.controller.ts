import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  createServiceRequestSchema,
  updateCatalogStatusRequestSchema,
  updateServiceRequestSchema,
  type CreateServiceRequest,
  type ServiceListResponse,
  type ServiceResponse,
  type UpdateCatalogStatusRequest,
  type UpdateServiceRequest,
} from '@clinic/contracts';
import { RequirePermissions } from '../../auth/decorators/endpoint-access';
import { Ctx, CurrentSession } from '../../auth/decorators/request.decorators';
import type { RequestContext, ResolvedSession } from '../../common/request-context';
import { ZodBodyPipe } from '../../common/zod-validation.pipe';
import { ServicesService } from './services.service';

/**
 * Clinic services. Manager-only in this milestone.
 *
 * Every route names the single permission it needs; a receptionist holds none
 * of them, so every route here returns `AUTH_FORBIDDEN` for them — decided from
 * a role NestJS read out of the database on this request, never from anything
 * the caller sent.
 *
 * There is no delete route, and there will not be one: a service is referenced
 * by tariffs now and by appointments later. Deactivation is a status change.
 */
@Controller('catalog/services')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get()
  @RequirePermissions('service.read')
  async list(): Promise<ServiceListResponse> {
    return { services: await this.services.list() };
  }

  @Get(':id')
  @RequirePermissions('service.read')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<ServiceResponse> {
    return { service: await this.services.get(id) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('service.create')
  async create(
    @Body(new ZodBodyPipe(createServiceRequestSchema)) body: CreateServiceRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<ServiceResponse> {
    return { service: await this.services.create(body, session, context) };
  }

  @Patch(':id')
  @RequirePermissions('service.update')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(updateServiceRequestSchema)) body: UpdateServiceRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<ServiceResponse> {
    return { service: await this.services.update(id, body, session, context) };
  }

  /**
   * Separate from `update` because activation is a different decision from
   * editing, needs its own permission, and must not be something a manager can
   * do by accident while correcting a description.
   */
  @Patch(':id/status')
  @RequirePermissions('service.update_status')
  async changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(updateCatalogStatusRequestSchema)) body: UpdateCatalogStatusRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<ServiceResponse> {
    return { service: await this.services.changeStatus(id, body.status, session, context) };
  }
}
