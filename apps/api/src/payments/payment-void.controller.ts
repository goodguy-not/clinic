import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  voidPaymentRequestSchema,
  type PaymentResponse,
  type VoidPaymentRequest,
} from '@clinic/contracts';
import { RequirePermissions } from '../auth/decorators/endpoint-access';
import { Ctx, CurrentSession } from '../auth/decorators/request.decorators';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { ZodBodyPipe } from '../common/zod-validation.pipe';
import { PaymentsService } from './payments.service';

/**
 * Withdrawing money that should not have been recorded.
 *
 * ITS OWN CONTROLLER BECAUSE IT IS ON ITS OWN PATH ROOT, not because it is its
 * own concern. `PaymentsController` hangs off `families`, since recording money
 * is something done TO a family; this route is addressed by the payment itself
 * (frozen F1 `POST /payments/:paymentId/void`), exactly as a charge void is
 * addressed by the charge. The family is already on the row, so a family segment
 * here would be a second copy of a fact the server would then have to check for
 * agreement. Both classes call the one `PaymentsService`, so there is no second
 * place where a payment's rules could be stated.
 *
 * `payment.void` IS THE MANAGER'S ALONE, with no same-day receptionist window
 * and no expiring authority (DECISION_LOG, 2026-08-15 — Payment void is
 * manager-only). Taking the money is counter work and cannot invent money;
 * reversing a recorded financial fact is the authority PROJECT_SPEC.md 4 keeps
 * away from that role, and a same-day exception would be exactly the back door
 * withholding `charge.void` closed. A receptionist reaching this route is
 * refused with 403 by the permission guard, before any payment is read — and
 * before the caller learns whether the id even exists.
 *
 * 200, AND THE WHOLE PAYMENT COMES BACK. One shape for every write that touches
 * a payment (frozen `paymentResponse`), so the screen that asked for the void
 * renders the result — `VOIDED`, with its actor, instant and reason — without a
 * second request.
 *
 * NO UN-VOID, NO DELETE, NO REPLACEMENT AND NO REFUND. The frozen contract has
 * no un-void request, the database permits exactly one transition, and
 * re-recording corrected money is a separate later request with its own reason.
 *
 * THE RESPONSE CARRIES NO FAMILY POSITION. What the family now owes is derived
 * by the account read; stating it here would give an interface two places to
 * learn one number and a reason for them to disagree.
 */
@Controller('payments')
export class PaymentVoidController {
  constructor(private readonly payments: PaymentsService) {}

  /**
   * `voidPaymentRequestSchema` is strict and its one field is mandatory: a
   * financial reversal nobody can explain is what CLAUDE.md forbids of a
   * correction, and a caller that sends `voidedAt` or `voidedByUserId` is
   * refused rather than having it silently dropped — those are the server's.
   */
  @Post(':id/void')
  @HttpCode(200)
  @RequirePermissions('payment.void')
  async void(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(voidPaymentRequestSchema)) body: VoidPaymentRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<PaymentResponse> {
    return this.payments.void(id, body.reason, session, context);
  }
}
