import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  createRoomRequestSchema,
  updateCatalogStatusRequestSchema,
  updateRoomRequestSchema,
  type CreateRoomRequest,
  type RoomListResponse,
  type RoomResponse,
  type UpdateCatalogStatusRequest,
  type UpdateRoomRequest,
} from '@clinic/contracts';
import { RequirePermissions } from '../../auth/decorators/endpoint-access';
import { Ctx, CurrentSession } from '../../auth/decorators/request.decorators';
import type { RequestContext, ResolvedSession } from '../../common/request-context';
import { ZodBodyPipe } from '../../common/zod-validation.pipe';
import { RoomsService } from './rooms.service';

/**
 * Treatment rooms. Manager-only in this milestone, and no delete route: a room
 * will be named by appointment history. Deactivation is a status change.
 */
@Controller('catalog/rooms')
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Get()
  @RequirePermissions('room.read')
  async list(): Promise<RoomListResponse> {
    return { rooms: await this.rooms.list() };
  }

  @Get(':id')
  @RequirePermissions('room.read')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<RoomResponse> {
    return { room: await this.rooms.get(id) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('room.create')
  async create(
    @Body(new ZodBodyPipe(createRoomRequestSchema)) body: CreateRoomRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<RoomResponse> {
    return { room: await this.rooms.create(body, session, context) };
  }

  @Patch(':id')
  @RequirePermissions('room.update')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(updateRoomRequestSchema)) body: UpdateRoomRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<RoomResponse> {
    return { room: await this.rooms.update(id, body, session, context) };
  }

  @Patch(':id/status')
  @RequirePermissions('room.update_status')
  async changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(updateCatalogStatusRequestSchema)) body: UpdateCatalogStatusRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<RoomResponse> {
    return { room: await this.rooms.changeStatus(id, body.status, session, context) };
  }
}
