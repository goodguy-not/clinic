import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  createShareRuleRequestSchema,
  resolveShareRuleQuerySchema,
  shareRuleListQuerySchema,
  voidShareRuleRequestSchema,
  type CreateShareRuleRequest,
  type ResolveShareRuleQuery,
  type ResolveShareRuleResponse,
  type ShareRuleListQuery,
  type ShareRuleListResponse,
  type ShareRuleResponse,
  type VoidShareRuleRequest,
} from '@clinic/contracts';
import { RequirePermissions } from '../../auth/decorators/endpoint-access';
import { Ctx, CurrentSession } from '../../auth/decorators/request.decorators';
import type { RequestContext, ResolvedSession } from '../../common/request-context';
import { ZodBodyPipe } from '../../common/zod-validation.pipe';
import { ShareRulesService } from './share-rules.service';

/**
 * Effective-dated therapist share percentages. MANAGER-ONLY IN EVERY DIRECTION,
 * including the read.
 *
 * This is where this controller differs from the tariff's, and the difference
 * is deliberate. A receptionist may read a tariff because running the diary
 * means looking up what a session costs a family; nothing about running the
 * diary requires knowing what each therapist takes home, and PROJECT_SPEC.md 4
 * keeps clinic configuration and financial correction away from the role. So
 * `therapist_share.read` is a manager permission too, and the receptionist
 * holds none of the three.
 *
 * THERE IS NO THERAPIST-FACING ROUTE HERE AND NO THERAPIST LOGIN ANYWHERE IN
 * THE PRODUCT. A therapist sees their agreement because a manager shows it to
 * them.
 *
 * There is no update route and no delete route, and neither is an oversight: a
 * rule is immutable once written, and a correction voids the row and inserts a
 * replacement so the percentage that applied on a past date stays readable.
 */
@Controller('settlement')
export class ShareRulesController {
  constructor(private readonly shareRules: ShareRulesService) {}

  // `ZodBodyPipe` is a plain Zod validation pipe; it is named for its usual
  // position but works anywhere a value needs parsing, including a query.
  @Get('share-rules')
  @RequirePermissions('therapist_share.read')
  async list(
    @Query(new ZodBodyPipe(shareRuleListQuerySchema)) query: ShareRuleListQuery,
  ): Promise<ShareRuleListResponse> {
    return { shareRules: await this.shareRules.list(query) };
  }

  /**
   * Deliberately not nested under `share-rules/`, for the reason
   * `/catalog/tariff-resolution` is not nested under `tariffs/`: it would sit
   * in the same space as `share-rules/:id`, and which one answered would depend
   * on the order the routes happen to be declared in. A distinct path cannot
   * collide at all.
   */
  @Get('share-rule-resolution')
  @RequirePermissions('therapist_share.read')
  async resolve(
    @Query(new ZodBodyPipe(resolveShareRuleQuerySchema)) query: ResolveShareRuleQuery,
  ): Promise<ResolveShareRuleResponse> {
    return { shareRule: await this.shareRules.resolve(query) };
  }

  @Get('share-rules/:id')
  @RequirePermissions('therapist_share.read')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<ShareRuleResponse> {
    return { shareRule: await this.shareRules.get(id) };
  }

  /**
   * Create a rule, optionally superseding one in the same transaction.
   *
   * The route demands `therapist_share.create`, and a request that supersedes
   * demands `therapist_share.void` ON TOP OF IT — checked in the service,
   * because the second authority is needed only when the request actually
   * withdraws something. Declaring both on the route would make stating a
   * therapist's FIRST agreement require the authority to withdraw one, which is
   * a different act; this is the shape
   * `appointment.override_availability` already uses.
   *
   * The request schema requires a reason exactly when it supersedes, so an
   * unexplained withdrawal is unrepresentable rather than merely refused.
   */
  @Post('share-rules')
  @HttpCode(201)
  @RequirePermissions('therapist_share.create')
  async create(
    @Body(new ZodBodyPipe(createShareRuleRequestSchema)) body: CreateShareRuleRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<ShareRuleResponse> {
    return { shareRule: await this.shareRules.create(body, session, context) };
  }

  @Post('share-rules/:id/void')
  @HttpCode(200)
  @RequirePermissions('therapist_share.void')
  async void(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(voidShareRuleRequestSchema)) body: VoidShareRuleRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<ShareRuleResponse> {
    return { shareRule: await this.shareRules.void(id, body.reason, session, context) };
  }
}
