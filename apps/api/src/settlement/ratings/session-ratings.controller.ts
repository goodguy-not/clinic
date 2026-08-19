import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  correctSessionRatingRequestSchema,
  rateSessionRequestSchema,
  voidSessionRatingRequestSchema,
  SETTLEMENT_RATING_CORRECTION_PERMISSIONS,
  type CorrectSessionRatingRequest,
  type RateSessionRequest,
  type SessionSettlementResponse,
  type VoidSessionRatingRequest,
} from '@clinic/contracts';
import { RequirePermissions } from '../../auth/decorators/endpoint-access';
import { Ctx, CurrentSession } from '../../auth/decorators/request.decorators';
import type { RequestContext, ResolvedSession } from '../../common/request-context';
import { ZodBodyPipe } from '../../common/zod-validation.pipe';
import { SessionRatingService } from './session-rating.service';

/**
 * The applied therapist share snapshot. MANAGER-ONLY IN EVERY DIRECTION,
 * INCLUDING THE READ — the same line `ShareRulesController` draws, for the same
 * reason: a receptionist runs the diary and raises the charge for a session that
 * happened, and what a therapist takes home is not diary work
 * (PROJECT_SPEC.md 4). The receptionist holds none of the four settlement
 * permissions and is refused by `PermissionsGuard` before any statement runs.
 *
 * THERE IS NO THERAPIST-FACING ROUTE HERE AND NO THERAPIST LOGIN ANYWHERE IN THE
 * PRODUCT.
 *
 * THERE IS NO UPDATE ROUTE AND NO DELETE ROUTE, and neither is an oversight. A
 * rating is written once; a wrong percentage is withdrawn and replaced, so both
 * the figure that was applied and the one that replaced it stay readable.
 *
 * NO ROUTE HERE CAN CREATE A RATING BY ACCIDENT. The two that write are `POST`
 * and say so; `GET` refuses an unrated session with `SESSION_NOT_RATED` rather
 * than resolving a percentage on the caller's behalf, because a settlement
 * figure nobody decided is indistinguishable in next month's report from one
 * somebody did.
 */
@Controller('settlement')
export class SessionRatingsController {
  constructor(private readonly ratings: SessionRatingService) {}

  /**
   * Rate a session that is still unrated.
   *
   * NAMED BY THE CHARGE, WHICH IS WHAT IS BEING SETTLED. The basis is the
   * charge's posted amount and the applied percentage is resolved against the
   * charge's SERVICE DATE, so the charge is the resource this acts on — not the
   * seat, which may hold a withdrawn charge and a live one over its life.
   *
   * THE BODY IS THE FROZEN DISCRIMINATED UNION AND CARRIES NO AMOUNT. An
   * `AUTOMATIC` request carries nothing at all and the server resolves the rule;
   * an `EXPLICIT` one carries the percentage and a required reason. A caller
   * that sends a base amount is refused by `strictObject` rather than having it
   * silently dropped — a caller who could state the basis could state a
   * different one.
   *
   * 201, BECAUSE THIS CREATES A SETTLEMENT FACT THAT DID NOT EXIST. It is not
   * idempotent and deliberately not: a second rating of an already-rated session
   * is `SESSION_ALREADY_RATED`, and the fix is to CORRECT the existing one so
   * the figure that was replaced stays readable. That is the opposite of the
   * charge post, which answers `ALREADY_POSTED` — posting the charge for a
   * session that happened cannot duplicate money, and re-rating one silently
   * could.
   */
  @Post('session-charges/:chargeId/rating')
  @HttpCode(201)
  @RequirePermissions('settlement.rate')
  async rate(
    @Param('chargeId', ParseUUIDPipe) chargeId: string,
    @Body(new ZodBodyPipe(rateSessionRequestSchema)) body: RateSessionRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<SessionSettlementResponse> {
    return { settlement: await this.ratings.rate(chargeId, body, session, context) };
  }

  /**
   * What this session earned, if anybody has decided.
   *
   * THE SAME URL AS THE POST, WITH THE METHOD SAYING WHICH. One resource — "this
   * session's rating" — and no second vocabulary for the same thing.
   *
   * 422 `SESSION_NOT_RATED` FOR AN UNRATED SESSION, never an empty success and
   * never a zero. The absence is the state, and it has to be reported as one.
   */
  @Get('session-charges/:chargeId/rating')
  @RequirePermissions('settlement.read')
  async read(
    @Param('chargeId', ParseUUIDPipe) chargeId: string,
  ): Promise<SessionSettlementResponse> {
    return { settlement: await this.ratings.read(chargeId) };
  }

  /**
   * Withdraw a rating that should not stand, and say why.
   *
   * NAMED BY THE RATING, NOT BY THE SESSION. A session may hold many ratings
   * over its life — one standing and any number withdrawn — so "withdraw the
   * rating of this session" would be ambiguous the moment a correction had
   * already happened.
   *
   * `settlement.void_rating` AND NOT `settlement.rate`. Withdrawing a
   * therapist's earnings is a different authority from deciding them, which is
   * the whole reason the two names exist separately.
   */
  @Post('session-ratings/:id/void')
  @HttpCode(200)
  @RequirePermissions('settlement.void_rating')
  async void(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(voidSessionRatingRequestSchema)) body: VoidSessionRatingRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<SessionSettlementResponse> {
    return { settlement: await this.ratings.void(id, body.reason, session, context) };
  }

  /**
   * Withdraw a rating and write its replacement as one act.
   *
   * ITS OWN PATH RATHER THAN A FLAG ON EITHER OF THE TWO ABOVE, because it is
   * genuinely a third act with a third authority: one endpoint with two
   * behaviours would have very different consequences depending on a field, and
   * the consequences here are a closed month.
   *
   * BOTH PERMISSIONS, AND, NOT OR — the frozen
   * `SETTLEMENT_RATING_CORRECTION_PERMISSIONS`. A caller who may withdraw but
   * not re-rate must not reach a request that re-rates, and a caller who may
   * rate but not withdraw must not reach one that withdraws.
   *
   * NOT NESTED UNDER `session-ratings/:id`, for the reason
   * `share-rule-resolution` is not nested under `share-rules/`: the request
   * names both the rating and the charge in its body and the server checks that
   * they agree, so putting one of the two in the path would state it twice with
   * nothing making the two statements agree.
   *
   * 200 AND THE REPLACEMENT COMES BACK — the rating that now stands, with
   * `supersedesSessionSettlementId` naming the one that was withdrawn, so the
   * whole correction is reachable from the response.
   */
  @Post('rating-corrections')
  @HttpCode(200)
  @RequirePermissions(...SETTLEMENT_RATING_CORRECTION_PERMISSIONS)
  async correct(
    @Body(new ZodBodyPipe(correctSessionRatingRequestSchema)) body: CorrectSessionRatingRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<SessionSettlementResponse> {
    return { settlement: await this.ratings.correct(body, session, context) };
  }
}
