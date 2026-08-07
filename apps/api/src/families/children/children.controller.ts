import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  confirmDraftRequestSchema,
  createChildRequestSchema,
  updateChildRequestSchema,
  updateRecordStatusRequestSchema,
  type ChildDetailResponse,
  type ChildWriteResponse,
  type ConfirmDraftRequest,
  type CreateChildRequest,
  type UpdateChildRequest,
  type UpdateRecordStatusRequest,
} from '@clinic/contracts';
import { RequirePermissions } from '../../auth/decorators/endpoint-access';
import { Ctx, CurrentSession } from '../../auth/decorators/request.decorators';
import type { RequestContext, ResolvedSession } from '../../common/request-context';
import { ZodBodyPipe } from '../../common/zod-validation.pipe';
import { DraftToken } from '../drafts/draft-token.decorator';
import { ChildrenService } from './children.service';

/**
 * Children.
 *
 * No delete route, and there will not be one: a child is named by a session
 * charge from Milestone 5 onward. Deactivation is a status change, and the
 * database refuses a `DELETE` regardless of what the application asks for.
 *
 * No route moves a child between families either. `family_id` is immutable at
 * the database level, so registration is where a child's family is decided and
 * a genuine reassignment is a designed repair operation, not an edit.
 *
 * The literal `confirm-registration` and `confirm-update` segments cannot
 * collide with `:id`, which appears only on `GET` and `PATCH`.
 */
@Controller()
export class ChildrenController {
  constructor(private readonly children: ChildrenService) {}

  /**
   * Registers a child under a family.
   *
   * Nested under the family because a child cannot exist without one, and the
   * family is what the duplicate check is scoped to.
   */
  @Post('families/:familyId/children')
  @HttpCode(201)
  @RequirePermissions('child.create')
  async create(
    @Param('familyId', ParseUUIDPipe) familyId: string,
    @Body(new ZodBodyPipe(createChildRequestSchema)) body: CreateChildRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<ChildWriteResponse> {
    return this.children.create(familyId, body, session, context);
  }

  /** Consumes a `CHILD_CREATE` draft and registers the child it was holding. */
  @Post('children/confirm-registration')
  @HttpCode(201)
  @RequirePermissions('child.create')
  async confirmRegistration(
    @DraftToken() token: string,
    @Body(new ZodBodyPipe(confirmDraftRequestSchema)) body: ConfirmDraftRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<ChildWriteResponse> {
    return this.children.confirm(
      'CHILD_CREATE',
      token,
      body.acknowledgedDuplicateIds,
      session,
      context,
    );
  }

  /**
   * Consumes a `CHILD_UPDATE` draft and applies the edit it was holding.
   *
   * 200 rather than the 201 a POST defaults to: the child already exists.
   */
  @Post('children/confirm-update')
  @HttpCode(200)
  @RequirePermissions('child.update')
  async confirmUpdate(
    @DraftToken() token: string,
    @Body(new ZodBodyPipe(confirmDraftRequestSchema)) body: ConfirmDraftRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<ChildWriteResponse> {
    return this.children.confirm(
      'CHILD_UPDATE',
      token,
      body.acknowledgedDuplicateIds,
      session,
      context,
    );
  }

  @Get('children/:id')
  @RequirePermissions('child.read')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<ChildDetailResponse> {
    return this.children.get(id);
  }

  @Patch('children/:id')
  @RequirePermissions('child.update')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(updateChildRequestSchema)) body: UpdateChildRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<ChildWriteResponse> {
    return this.children.update(id, body, session, context);
  }

  /**
   * Separate from `update` because deactivating a child is a different decision
   * from correcting one, needs its own permission, and must not happen as a side
   * effect of fixing a spelling.
   */
  @Patch('children/:id/status')
  @RequirePermissions('child.update_status')
  async changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(updateRecordStatusRequestSchema)) body: UpdateRecordStatusRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<ChildDetailResponse> {
    return this.children.changeStatus(id, body.status, session, context);
  }
}
