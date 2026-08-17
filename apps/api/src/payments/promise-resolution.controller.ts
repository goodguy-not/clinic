import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  cancelPromiseRequestSchema,
  fulfillPromiseRequestSchema,
  reschedulePromiseRequestSchema,
  type CancelPromiseRequest,
  type FulfillPromiseRequest,
  type PromiseResponse,
  type ReschedulePromiseRequest,
  type RescheduledPromiseResponse,
} from '@clinic/contracts';
import { RequirePermissions } from '../auth/decorators/endpoint-access';
import { Ctx, CurrentSession } from '../auth/decorators/request.decorators';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { ZodBodyPipe } from '../common/zod-validation.pipe';
import { PromisesService } from './promises.service';

/**
 * How a promise ends: kept, moved, or abandoned.
 *
 * ITS OWN CONTROLLER BECAUSE IT IS ON ITS OWN PATH ROOT, not because it is its
 * own concern — the same split `PaymentVoidController` makes. `PromisesController`
 * hangs off `families`, since making a promise is something done WITH a family;
 * these three routes are addressed by the promise itself (frozen F1), because the
 * family is already on the row and a family segment here would be a second copy
 * of a fact the server would then have to check for agreement. Both classes call
 * the one `PromisesService`, so there is no second place where a promise's rules
 * could be stated.
 *
 * ONE PERMISSION FOR ALL THREE, AND BOTH INTERNAL ROLES HOLD IT (frozen
 * `promise.resolve`). None of the three moves a rial, so there is no financial
 * authority to withhold: unlike `payment.void`, which is the manager's alone,
 * resolving a promise reverses no financial record and changes no total. There is
 * deliberately NO manager-only promise correction — a promise is corrected by
 * being rescheduled or cancelled, both of which are ordinary counter work with a
 * recorded reason, and inventing a second, privileged verb would be granularity
 * with no decision behind it.
 *
 * THE AUDIT IS THREE ACTIONS EVEN THOUGH THE PERMISSION IS ONE. "How often does a
 * family reschedule rather than pay?" is precisely the question a pilot asks of
 * promises, and an answer buried in a status diff is not something you can count.
 *
 * A DERIVED `MISSED` PROMISE IS RESOLVED THROUGH THESE ROUTES NORMALLY. It is
 * stored `OPEN`; being overdue is a reading of the clock, never a reason to
 * refuse, and it is the commonest state a promise is in when somebody acts on it.
 *
 * 200 ON ALL THREE, and the promise comes back whole, so the screen that asked
 * for the change renders the result — including the fulfilling payment and the
 * successor link — without a second request.
 */
@Controller('promises')
export class PromiseResolutionController {
  constructor(private readonly promises: PromisesService) {}

  /**
   * Marking a promise kept, by naming the payment that kept it.
   *
   * `fulfillPromiseRequestSchema` is strict and its one field is mandatory: the
   * payment is never inferred from one landing near the due date (DECISION_LOG,
   * 2026-08-15), and a caller that sends an `amountToman` is refused rather than
   * having it dropped — there is no partial fulfilment and no allocation row for
   * a portion to live in.
   *
   * NO REASON, because `payment_promise_resolution_chk` makes it optional on
   * `FULFILLED` alone: a kept promise needs no explanation, and demanding prose
   * for one produces prose nobody means.
   */
  @Post(':id/fulfill')
  @HttpCode(200)
  @RequirePermissions('promise.resolve')
  async fulfill(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(fulfillPromiseRequestSchema)) body: FulfillPromiseRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<PromiseResponse> {
    return this.promises.fulfill(id, body.paymentId, session, context);
  }

  /**
   * Agreeing a new date instead of the one that was promised.
   *
   * THE ONE ROUTE THAT ANSWERS WITH TWO PROMISES (frozen
   * `rescheduledPromiseResponse`), named rather than paired: the old one, now
   * `RESCHEDULED` and pointing at its successor, and the successor, `OPEN` on the
   * new date. Returning one of them would leave the caller re-reading the list to
   * find out what it just created.
   *
   * THE REASON IS MANDATORY and neither the amount nor the note may be restated:
   * a different amount is a different intention, which is a cancel and a new
   * promise.
   */
  @Post(':id/reschedule')
  @HttpCode(200)
  @RequirePermissions('promise.resolve')
  async reschedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(reschedulePromiseRequestSchema)) body: ReschedulePromiseRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<RescheduledPromiseResponse> {
    return this.promises.reschedule(id, body.dueOn, body.reason, session, context);
  }

  /**
   * Abandoning a promise.
   *
   * `cancelPromiseRequestSchema` is strict and its one field is mandatory, for the
   * reason a void's is: a promise abandoned with no explanation is exactly what
   * CLAUDE.md forbids of a correction. Nothing is deleted and no total moves — a
   * promise never changed the balance in the first place.
   */
  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('promise.resolve')
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(cancelPromiseRequestSchema)) body: CancelPromiseRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<PromiseResponse> {
    return this.promises.cancel(id, body.reason, session, context);
  }
}
