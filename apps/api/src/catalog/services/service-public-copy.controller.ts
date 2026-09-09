import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import {
  updateServicePublicCopyPublicationRequestSchema,
  updateServicePublicCopyRequestSchema,
  type ServicePublicCopyListResponse,
  type ServicePublicCopyResponse,
  type UpdateServicePublicCopyPublicationRequest,
  type UpdateServicePublicCopyRequest,
} from '@clinic/contracts';
import { RequirePermissions } from '../../auth/decorators/endpoint-access';
import { Ctx, CurrentSession } from '../../auth/decorators/request.decorators';
import type { RequestContext, ResolvedSession } from '../../common/request-context';
import { ZodBodyPipe } from '../../common/zod-validation.pipe';
import { ServicePublicCopyService } from './service-public-copy.service';

/**
 * A service's public description. TWO AUTHORITIES, VISIBLE IN THE DECORATORS.
 *
 * Milestone 9.5, checkpoint A6. Three of the four routes name
 * `service.draft_public_copy`, which a RECEPTIONIST holds; the fourth names
 * `service.update`, which only a MANAGER holds, and it is the only route in
 * this file that can change one word a visitor reads.
 *
 * That is the A2 split applied to a catalog row: draft authority does not imply
 * publish authority, and the permission that publishes is not the permission
 * that writes. It is enforced by `PermissionsGuard` from a role NestJS re-read
 * from the database on this request, and pinned in both directions by tests.
 *
 * IT IS MOUNTED UNDER `/content` RATHER THAN UNDER `/catalog`, AND THE PATH IS
 * THE AUTHORITY BOUNDARY RESTATED. `/catalog/services` is the operational
 * surface — durations, status, tariffable configuration — and everything on it
 * is manager-only. This is the editorial surface, it sits beside
 * `/content/articles`, and the one thing it can reach on a service is the
 * prose. A reader asking "what can the front desk write?" should be able to
 * find the answer by looking at one path prefix.
 *
 * THE PUBLICATION ROUTE INTRODUCES NO NEW PERMISSION NAME. A1 decided that
 * publishing a service is `service.update` and that a second name for it would
 * be vocabulary with no decision behind it; A6 changes when the act happens,
 * not who may perform it.
 *
 * NO CREATE AND NO DELETE. Public copy is not a record: it is two columns on a
 * service that already exists, and it is emptied by clearing them.
 */
@Controller('content/service-copy')
export class ServicePublicCopyController {
  constructor(private readonly copy: ServicePublicCopyService) {}

  @Get()
  @RequirePermissions('service.draft_public_copy')
  async list(): Promise<ServicePublicCopyListResponse> {
    return { copies: await this.copy.list() };
  }

  @Get(':serviceId')
  @RequirePermissions('service.draft_public_copy')
  async get(
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
  ): Promise<ServicePublicCopyResponse> {
    return { copy: await this.copy.get(serviceId) };
  }

  /** Preparing the words. Publishes nothing; see the service. */
  @Patch(':serviceId')
  @RequirePermissions('service.draft_public_copy')
  async update(
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @Body(new ZodBodyPipe(updateServicePublicCopyRequestSchema))
    body: UpdateServicePublicCopyRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<ServicePublicCopyResponse> {
    return { copy: await this.copy.update(serviceId, body, session, context) };
  }

  /**
   * THE MANAGER'S ROUTE, and the only one here a receptionist is refused.
   *
   * One route with a boolean rather than `/publish` and `/withdraw`: it is one
   * decision — does the website say this — and one control on the surface that
   * carries it, exactly as the article publication route is shaped.
   */
  @Patch(':serviceId/publication')
  @RequirePermissions('service.update')
  async setPublication(
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @Body(new ZodBodyPipe(updateServicePublicCopyPublicationRequestSchema))
    body: UpdateServicePublicCopyPublicationRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<ServicePublicCopyResponse> {
    return {
      copy: await this.copy.setPublication(serviceId, body.isPublished, session, context),
    };
  }
}
