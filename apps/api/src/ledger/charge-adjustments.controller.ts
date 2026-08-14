import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  createChargeAdjustmentRequestSchema,
  voidChargeAdjustmentRequestSchema,
  type CreateChargeAdjustmentRequest,
  type SessionChargeResponse,
  type VoidChargeAdjustmentRequest,
} from '@clinic/contracts';
import { RequirePermissions } from '../auth/decorators/endpoint-access';
import { Ctx, CurrentSession } from '../auth/decorators/request.decorators';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { ZodBodyPipe } from '../common/zod-validation.pipe';
import { ChargeAdjustmentsService } from './charge-adjustments.service';

/**
 * Concessions on one session charge.
 *
 * NESTED UNDER THE CHARGE BECAUSE AN ADJUSTMENT HAS NO LIFE WITHOUT ONE. It
 * exists only to reduce a specific charge, its bound is that charge's amount, and
 * the response to every write here is that charge. A top-level
 * `/charge-adjustments` would name a resource nobody ever looks up on its own and
 * would let the void be addressed without stating what it belongs to.
 *
 * THE VOID NAMES BOTH IDS, and the parent is part of the lookup rather than a
 * check afterwards: an adjustment that belongs to a different charge is not this
 * charge's adjustment, and `ADJUSTMENT_NOT_FOUND` says exactly that.
 *
 * `charge.adjust` IS THE MANAGER'S, FOR BOTH OPERATIONS AND NO RECEPTIONIST HOLDS
 * IT (DECISION_LOG, 2026-08-14 — Charge adjustment and void authority is
 * manager-only). Deciding a family owes less is a financial concession, not diary
 * work, and it is the same authority whether it is granted or withdrawn — a
 * person who may not grant one may not undo somebody else's either. A
 * receptionist reaching either route is refused with 403 by the permission guard,
 * before any charge is read.
 *
 * 200 AND NOT 201, EVEN ON THE CREATE. The response body is the charge as it now
 * stands — the frozen `sessionChargeResponse`, the one read shape every ledger
 * write answers with — not the adjustment that was created, and there is no
 * location to point a caller at. So the screen that granted the concession
 * renders the new effective amount without a second request and without doing
 * arithmetic CLAUDE.md keeps out of the web tier.
 */
@Controller('session-charges/:chargeId/adjustments')
export class ChargeAdjustmentsController {
  constructor(private readonly adjustments: ChargeAdjustmentsService) {}

  @Post()
  @HttpCode(200)
  @RequirePermissions('charge.adjust')
  async create(
    @Param('chargeId', ParseUUIDPipe) chargeId: string,
    @Body(new ZodBodyPipe(createChargeAdjustmentRequestSchema)) body: CreateChargeAdjustmentRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<SessionChargeResponse> {
    return this.adjustments.create(chargeId, body, session, context);
  }

  /**
   * Withdraw a concession, restoring the amount it had removed.
   *
   * A separate request from voiding the charge, because it is a separate record:
   * this leaves the charge standing, and voiding the charge leaves the concession
   * attached to it. Neither performs the other.
   */
  @Post(':adjustmentId/void')
  @HttpCode(200)
  @RequirePermissions('charge.adjust')
  async void(
    @Param('chargeId', ParseUUIDPipe) chargeId: string,
    @Param('adjustmentId', ParseUUIDPipe) adjustmentId: string,
    @Body(new ZodBodyPipe(voidChargeAdjustmentRequestSchema)) body: VoidChargeAdjustmentRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<SessionChargeResponse> {
    return this.adjustments.void(chargeId, adjustmentId, body.reason, session, context);
  }
}
