import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  confirmDraftRequestSchema,
  createFamilyRequestSchema,
  familySearchRequestSchema,
  updateFamilyRequestSchema,
  updateRecordStatusRequestSchema,
  type ConfirmDraftRequest,
  type CreateFamilyRequest,
  type FamilyDetailResponse,
  type FamilyListResponse,
  type FamilySearchRequest,
  type FamilyWriteResponse,
  type UpdateFamilyRequest,
  type UpdateRecordStatusRequest,
} from '@clinic/contracts';
import { RequirePermissions } from '../../auth/decorators/endpoint-access';
import { Ctx, CurrentSession } from '../../auth/decorators/request.decorators';
import type { RequestContext, ResolvedSession } from '../../common/request-context';
import { ZodBodyPipe } from '../../common/zod-validation.pipe';
import { DraftToken } from '../drafts/draft-token.decorator';
import { FamiliesService } from './families.service';

/**
 * Families.
 *
 * The first surface a receptionist can reach. Manager and receptionist both hold
 * every permission named here; nobody else holds any of them, and an anonymous
 * request never gets past the session guard.
 *
 * There is no DELETE and there will not be one: a family holds the balance and
 * is named by every charge from Milestone 5 onward, so it is deactivated rather
 * than removed and the database refuses a `DELETE` outright.
 *
 * ROUTE SHAPES. `search`, `confirm-registration` and `confirm-update` are
 * literal segments on POST, and no `POST /families/:id` route exists, so none of
 * them can be shadowed by a parameter. They are spelled out rather than nested
 * under an id for the same reason `/catalog/tariff-resolution` sits outside
 * `/catalog/tariffs/` — and in the confirmation cases because there is no id
 * yet: the family being created does not exist.
 */
@Controller('families')
export class FamiliesController {
  constructor(private readonly families: FamiliesService) {}

  /**
   * A POST that reads, deliberately.
   *
   * A search term here is a guardian's name, a child's name, a mobile number or
   * a file number — personal data. A query string reaches the address bar,
   * browser history, the `Referer` header and every access log in between, and
   * none of those is a place to keep it. `@HttpCode(200)` because nothing is
   * created; the method is about where the term travels, not about state.
   */
  @Post('search')
  @HttpCode(200)
  @RequirePermissions('family.read')
  async search(
    @Body(new ZodBodyPipe(familySearchRequestSchema)) body: FamilySearchRequest,
  ): Promise<FamilyListResponse> {
    return this.families.search(body);
  }

  @Get(':id')
  @RequirePermissions('family.read')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<FamilyDetailResponse> {
    return this.families.get(id);
  }

  /**
   * Edits a family and replaces its guardian set.
   *
   * The whole guardian list is submitted, not a delta: a guardian is current
   * configuration rather than history, and replacing the set is how the interface
   * expresses "these are the people to call now".
   */
  @Patch(':id')
  @RequirePermissions('family.update')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(updateFamilyRequestSchema)) body: UpdateFamilyRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<FamilyWriteResponse> {
    return this.families.update(id, body, session, context);
  }

  /**
   * Consumes a `FAMILY_UPDATE` draft and applies the edit it was holding.
   *
   * 200, not the 201 a POST defaults to: this completes an edit to a family that
   * already exists. The method is a POST because the token travels in a header
   * and the body carries an acknowledgement, not because anything is created.
   */
  @Post('confirm-update')
  @HttpCode(200)
  @RequirePermissions('family.update')
  async confirmUpdate(
    @DraftToken() token: string,
    @Body(new ZodBodyPipe(confirmDraftRequestSchema)) body: ConfirmDraftRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<FamilyWriteResponse> {
    return this.families.confirmUpdate(token, body.acknowledgedDuplicateIds, session, context);
  }

  /**
   * Activates or deactivates a family.
   *
   * Separate from `update` because it is a different decision with a different
   * permission, and must not happen as a side effect of correcting an address.
   * There is no delete: a family with history is deactivated, and the database
   * refuses a `DELETE` regardless.
   */
  @Patch(':id/status')
  @RequirePermissions('family.update_status')
  async changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(updateRecordStatusRequestSchema)) body: UpdateRecordStatusRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<FamilyDetailResponse> {
    return this.families.changeStatus(id, body.status, session, context);
  }

  /**
   * Completes a registration that was refused as a possible duplicate.
   *
   * The body carries the acknowledgement and nothing else: the family and its
   * guardians come out of the server-side draft named by `x-draft-token`, so the
   * personal data somebody typed is never asked for twice and never has to
   * survive a round trip through the browser.
   *
   * A literal segment, and deliberately not `POST /families/:id/confirm` — there
   * is no id yet, because the family this creates does not exist.
   *
   * `family.create`, not `family.read`: this writes.
   */
  @Post('confirm-registration')
  @HttpCode(201)
  @RequirePermissions('family.create')
  async confirmRegistration(
    @DraftToken() token: string,
    @Body(new ZodBodyPipe(confirmDraftRequestSchema)) body: ConfirmDraftRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<FamilyWriteResponse> {
    return this.families.confirmRegistration(
      token,
      body.acknowledgedDuplicateIds,
      session,
      context,
    );
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('family.create')
  async create(
    @Body(new ZodBodyPipe(createFamilyRequestSchema)) body: CreateFamilyRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<FamilyWriteResponse> {
    return this.families.create(body, session, context);
  }
}
