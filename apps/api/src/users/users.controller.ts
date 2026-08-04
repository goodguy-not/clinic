import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  createUserRequestSchema,
  updateUserRoleRequestSchema,
  updateUserStatusRequestSchema,
  type CreateUserRequest,
  type CreateUserResponse,
  type PasswordResetResponse,
  type RevokeSessionsResponse,
  type UpdateUserRoleRequest,
  type UpdateUserStatusRequest,
  type UserListResponse,
  type UserResponse,
} from '@clinic/contracts';
import { ZodBodyPipe } from '../common/zod-validation.pipe';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { RequirePermissions } from '../auth/decorators/endpoint-access';
import { Ctx, CurrentSession } from '../auth/decorators/request.decorators';
import { UsersService } from './users.service';

/**
 * Manager-only staff administration.
 *
 * Every route names the single permission it needs. A receptionist holds no
 * permission at all in Milestone 1, so every route here returns
 * `AUTH_FORBIDDEN` for them — decided by NestJS from a role it read out of the
 * database on this request, never from anything the caller sent.
 *
 * Responses are built from an explicit projection that never selects
 * `password_hash`, and the shared contracts are strict, so an extra field is a
 * failing test rather than a leak.
 */
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('user.read')
  async list(): Promise<UserListResponse> {
    return { users: await this.users.list() };
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('user.create')
  create(
    @Body(new ZodBodyPipe(createUserRequestSchema)) body: CreateUserRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<CreateUserResponse> {
    return this.users.create(body, session, context);
  }

  @Patch(':id/role')
  @RequirePermissions('user.update_role')
  changeRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(updateUserRoleRequestSchema)) body: UpdateUserRoleRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<UserResponse> {
    return this.users.changeRole(id, body.role, session, context);
  }

  @Patch(':id/status')
  @RequirePermissions('user.update_status')
  changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(updateUserStatusRequestSchema)) body: UpdateUserStatusRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<UserResponse> {
    return this.users.changeStatus(id, body.status, session, context);
  }

  @Post(':id/password-reset')
  @HttpCode(200)
  @RequirePermissions('user.reset_password')
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<PasswordResetResponse> {
    return this.users.resetPassword(id, session, context);
  }

  @Post(':id/unlock')
  @HttpCode(200)
  @RequirePermissions('user.unlock')
  unlock(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<UserResponse> {
    return this.users.unlock(id, session, context);
  }

  @Post(':id/sessions/revoke')
  @HttpCode(200)
  @RequirePermissions('session.revoke_any')
  revokeSessions(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<RevokeSessionsResponse> {
    return this.users.revokeSessions(id, session, context);
  }
}
