import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  confirmDraftRequestSchema,
  createFamilyRequestSchema,
  familySearchRequestSchema,
  type ConfirmDraftRequest,
  type CreateFamilyRequest,
  type FamilyDetailResponse,
  type FamilyListResponse,
  type FamilySearchRequest,
  type FamilyWriteResponse,
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
 * CHECKPOINT C SCOPE: search, detail and registration. There is no PATCH, no
 * PUT and no DELETE — update and status change are Checkpoint D, and a family is
 * deactivated rather than deleted in any case.
 *
 * ROUTE ORDER MATTERS. `POST /families/search` is declared before nothing that
 * could shadow it, and cannot be shadowed: the only other `POST /families…`
 * route is the collection root, and `search` is a literal segment where `:id`
 * never appears on a POST. `GET /families/:id` is a different method entirely.
 * The literal is spelled out rather than nested under an id for the same reason
 * `/catalog/tariff-resolution` sits outside `/catalog/tariffs/`.
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
   * Registers a family and its guardians.
   *
   * Returns 201, or 409 `FAMILY_POSSIBLE_DUPLICATE` carrying masked candidates
   * and a registration-draft token when an active family already answers on one
   * of the submitted mobile numbers.
   *
   * No child is included. Registration is two steps — the family, then the first
   * child — because one request carrying both would produce two duplicate
   * verdicts in one response.
   */
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
