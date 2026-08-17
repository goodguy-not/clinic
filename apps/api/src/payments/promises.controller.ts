import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  createPromiseRequestSchema,
  promiseListQuerySchema,
  type CreatePromiseRequest,
  type PromiseListQuery,
  type PromiseListResponse,
  type PromiseResponse,
} from '@clinic/contracts';
import { RequirePermissions } from '../auth/decorators/endpoint-access';
import { Ctx, CurrentSession } from '../auth/decorators/request.decorators';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { ZodBodyPipe } from '../common/zod-validation.pipe';
import { PromiseHistoryService } from './promise-history.service';
import { PromisesService } from './promises.service';

/**
 * What a family said it would pay.
 *
 * A PROMISES CONTROLLER ON THE FAMILY'S PATH, exactly as `PaymentsController` is
 * a payments controller on it. The URL belongs to the family because balance is
 * family-level (CLAUDE.md) and a promise is a family fact — it names no child, no
 * session and no charge — and Nest matches `families/:id/promises` here without
 * any effect on `families/:id`, `families/:id/account` or
 * `families/:id/payments` next door.
 *
 * THE FAMILY IS THE PATH AND IS NOT IN THE BODY (frozen F1). A `familyId` in the
 * body would be a second copy of a fact that can disagree with the first, and the
 * server would have to decide which one it believed.
 *
 * `promise.create` AND `promise.read`, AND BOTH INTERNAL ROLES HOLD THEM. A
 * promise moves no money in any state, so there is no financial authority here
 * for the manager to keep: agreeing a payment date with a family at the counter
 * is the receptionist's work, and the payment that eventually settles it is
 * created under `payment.create` and voided under `payment.void`, which is where
 * the money authority stays.
 *
 * 200 ON THE CREATE, as the approved Milestone 6 route decision states and as
 * `POST /families/:id/payments` answers. The interface reads the outcome from the
 * promise it is handed, not from the code.
 *
 * THE RESPONSE CARRIES NO FAMILY POSITION AND NO TOTAL. A promise changes neither,
 * and stating a balance here would give an interface two places to learn one
 * number and a reason for them to disagree.
 */
@Controller('families')
export class PromisesController {
  constructor(
    private readonly promises: PromisesService,
    private readonly history: PromiseHistoryService,
  ) {}

  /**
   * `createPromiseRequestSchema` is strict and carries three fields, so a caller
   * that sends `status`, `createdAt`, `createdByUserId`, a `familyId` or a
   * `paymentId` is refused rather than having it silently dropped — those are the
   * server's, and the payment that settles a promise is named later through the
   * fulfil route.
   *
   * A PAST `dueOn` IS ACCEPTED HERE and reads immediately as derived `MISSED`
   * (DECISION_LOG, 2026-08-15 — A promise may be born late). This is the one
   * route where that is true: a rescheduled successor may not be due in the past.
   */
  @Post(':id/promises')
  @HttpCode(200)
  @RequirePermissions('promise.create')
  async create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(createPromiseRequestSchema)) body: CreatePromiseRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<PromiseResponse> {
    return this.promises.create(id, body, session, context);
  }

  /**
   * A family's promise history, terminal promises included.
   *
   * `promise.read` ALONE, WHICH IS LESS THAN THE ACCOUNT ASKS FOR. The account
   * carries charges and money beside the promise counts and therefore names three
   * authorities; this response is promises and nothing else — no charge, no
   * balance, and no payment beyond the summary of the one that fulfilled a
   * promise, which `promise.read` is precisely the authority to see.
   *
   * A GET WITH THE FILTERS IN THE QUERY STRING, as both other family reads are.
   * What travels is a family id already in the path and a status word; no personal
   * data appears in the URL.
   *
   * NOTHING HERE IS AUDITED. Audit records financial acts, and this route performs
   * none.
   *
   * `promiseListQuerySchema` is strict, so a caller that invents a `childId`,
   * mistypes `status` or asks for a stored value the wire does not have is refused
   * rather than shown a list nobody asked for.
   */
  @Get(':id/promises')
  @RequirePermissions('promise.read')
  async list(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodBodyPipe(promiseListQuerySchema)) query: PromiseListQuery,
  ): Promise<PromiseListResponse> {
    return this.history.list(id, query);
  }
}
