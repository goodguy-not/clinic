import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  createSpaceRequestSchema,
  updateSpacePublicationRequestSchema,
  updateSpaceRequestSchema,
  type CreateSpaceRequest,
  type SpaceListResponse,
  type SpaceResponse,
  type UpdateSpacePublicationRequest,
  type UpdateSpaceRequest,
} from '@clinic/contracts';
import { RequirePermissions } from '../auth/decorators/endpoint-access';
import { Ctx, CurrentSession } from '../auth/decorators/request.decorators';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { ZodBodyPipe } from '../common/zod-validation.pipe';
import { SpacesService } from './spaces.service';

/**
 * Public spaces. FOUR DRAFT ROUTES AND ONE MANAGER ROUTE.
 *
 * Milestone 9.5, checkpoint A7. `public_space.read` and `public_space.draft`
 * are a receptionist's: the person at the front desk is the one who hears what
 * families ask about the building and is the right author of a first
 * description of it. `public_space.publish` is a manager's alone.
 *
 * THIS CONTROLLER IS NOT `RoomsController` AND SHARES NOTHING WITH IT. These
 * routes live under `/content`, beside articles and testimonials, because a
 * public space is editorial content. The operational room lives under the
 * catalog, behind `room.*`, and neither controller can reach the other's table.
 * A receptionist who may write a paragraph about the waiting area still cannot
 * create a bookable room; a manager creating a room publishes nothing.
 *
 * THE PUBLICATION ROUTE CANNOT BE REACHED BY ACCIDENT FROM A DRAFT ONE.
 * Creating and editing cannot set `isPublic`; it is not a field on their
 * requests, so there is no value a caller holding only `public_space.draft`
 * could send that would put words on the website.
 *
 * NO ROUTE HERE TOUCHES A PHOTOGRAPH. A space's images are attached and
 * published through the media surface under `media.attach` and `media.publish`,
 * which are separate permissions on separate routes in a separate module.
 *
 * NO DELETE ROUTE. A space is unpublished — which is immediate — and the table
 * refuses a DELETE outright.
 */
@Controller('content/spaces')
export class SpacesController {
  constructor(private readonly spaces: SpacesService) {}

  @Get()
  @RequirePermissions('public_space.read')
  async list(): Promise<SpaceListResponse> {
    return { spaces: await this.spaces.list() };
  }

  @Get(':id')
  @RequirePermissions('public_space.read')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<SpaceResponse> {
    return { space: await this.spaces.get(id) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('public_space.draft')
  async create(
    @Body(new ZodBodyPipe(createSpaceRequestSchema)) body: CreateSpaceRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<SpaceResponse> {
    return { space: await this.spaces.create(body, session, context) };
  }

  @Patch(':id')
  @RequirePermissions('public_space.draft')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(updateSpaceRequestSchema)) body: UpdateSpaceRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<SpaceResponse> {
    return { space: await this.spaces.update(id, body, session, context) };
  }

  /** The publication decision. Manager-only, and never inferred from anything. */
  @Patch(':id/publication')
  @RequirePermissions('public_space.publish')
  async setPublication(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(updateSpacePublicationRequestSchema))
    body: UpdateSpacePublicationRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<SpaceResponse> {
    return { space: await this.spaces.setPublication(id, body.isPublic, session, context) };
  }
}
