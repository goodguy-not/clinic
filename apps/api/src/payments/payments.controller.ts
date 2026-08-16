import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  createPaymentRequestSchema,
  type CreatePaymentRequest,
  type PaymentResponse,
} from '@clinic/contracts';
import { RequirePermissions } from '../auth/decorators/endpoint-access';
import { Ctx, CurrentSession } from '../auth/decorators/request.decorators';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { ZodBodyPipe } from '../common/zod-validation.pipe';
import { PaymentsService } from './payments.service';

/**
 * Money the clinic received from a family.
 *
 * A PAYMENTS CONTROLLER ON THE FAMILY'S PATH, exactly as `FamilyAccountController`
 * is a ledger controller on it. The URL belongs to the family because the family
 * is what the money is about — balance is family-level (CLAUDE.md) — and Nest
 * matches `families/:id/payments` here without any effect on `families/:id` or
 * `families/:id/account` next door. The code lives in `PaymentsModule` because
 * the row is money-in's, and `FamiliesModule` still reads no financial table.
 *
 * THE FAMILY IS THE PATH AND IS NOT IN THE BODY (frozen F1). A `familyId` in the
 * body would be a second copy of a fact that can disagree with the first, and the
 * server would have to decide which one it believed.
 *
 * `payment.create` AND NOT `family.update`. Recording money is a financial
 * authority, and both the manager and the receptionist hold it: money arrives at
 * the counter, where the receptionist is standing. `payment.void` is the
 * manager's alone (DECISION_LOG, 2026-08-15 — Payment void is manager-only) and
 * is not this route.
 *
 * 200, AS THE APPROVED MILESTONE 6 ROUTE DECISION STATES. Recording money does
 * create a row, and `POST /appointments` answers 201 for exactly that reason —
 * but this route's status was decided when the payment contract was approved,
 * and a convention borrowed from another module is not a reason to overrule it.
 * The interface reads the outcome from the payment it is handed, not from the
 * code, and the frozen response body is what says what happened.
 *
 * THE RESPONSE IS THE PAYMENT AND ONLY THE PAYMENT (frozen `paymentResponse`).
 * It carries no family position: the balance is the account read's, and putting
 * it here would give an interface two places to learn one number and a reason
 * for them to disagree.
 */
@Controller('families')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /**
   * `createPaymentRequestSchema` is strict, so a caller that sends `status`,
   * `createdAt`, `createdByUserId` or a `familyId` is refused rather than having
   * it silently dropped — those are the server's, and a request that states one
   * has misunderstood what it is recording.
   */
  @Post(':id/payments')
  @HttpCode(200)
  @RequirePermissions('payment.create')
  async record(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(createPaymentRequestSchema)) body: CreatePaymentRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<PaymentResponse> {
    return this.payments.record(id, body, session, context);
  }
}
