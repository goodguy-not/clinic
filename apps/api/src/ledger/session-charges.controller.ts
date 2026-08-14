import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  postSessionChargeRequestSchema,
  voidSessionChargeRequestSchema,
  type PostSessionChargeResponse,
  type SessionChargeResponse,
  type VoidSessionChargeRequest,
} from '@clinic/contracts';
import { RequirePermissions } from '../auth/decorators/endpoint-access';
import { Ctx, CurrentSession } from '../auth/decorators/request.decorators';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { ZodBodyPipe } from '../common/zod-validation.pipe';
import { SessionChargesService } from './session-charges.service';

/**
 * Raising the primary charge for a session that happened.
 *
 * THE SEAT IS NAMED BY THE PATH AND THE BODY IS EMPTY, which is the frozen F1
 * shape: the participant identifies what is being charged, the actor and the
 * instant are the request's own, and every financial value is resolved by the
 * server from the session as recorded. A caller that sends an amount is refused
 * by `strictObject` rather than having it silently dropped — the same treatment
 * `POST /appointments/:id/complete` gives a caller that sends a status.
 *
 * `participants/:participantId` rather than a bare `POST /session-charges` with
 * the seat in the body. A charge is not a document a caller composes; it is what
 * one seat costs, and the resource being acted on is that seat. It also cannot
 * collide with the `:id`-shaped charge operations that arrive in later
 * checkpoints, because the literal segment is matched before any uuid parameter.
 *
 * 200 AND NEVER 201, EVEN ON A FIRST POST. The response is an outcome union that
 * says `POSTED` or `ALREADY_POSTED`, and that distinction is what the interface
 * renders; a status code that changed underneath it would be a second, weaker
 * statement of the same fact for a caller to disagree with.
 *
 * `charge.post` IS HELD BY THE RECEPTIONIST. Raising the charge for a session
 * that happened is the ordinary end of the diary work they already own, and
 * holding it can never duplicate money — the post is idempotent by rule. Voiding
 * a charge and reducing one are the manager's (DECISION_LOG, 2026-08-14 — Charge
 * adjustment and void authority is manager-only) and are not this route.
 */
@Controller('session-charges')
export class SessionChargesController {
  constructor(private readonly charges: SessionChargesService) {}

  @Post('participants/:participantId')
  @HttpCode(200)
  @RequirePermissions('charge.post')
  async post(
    @Param('participantId', ParseUUIDPipe) participantId: string,
    @Body(new ZodBodyPipe(postSessionChargeRequestSchema)) _body: unknown,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<PostSessionChargeResponse> {
    return this.charges.post(participantId, session, context);
  }

  /**
   * Withdraw a charge that should not stand.
   *
   * `charge.void` IS THE MANAGER'S AND NO RECEPTIONIST HOLDS IT (DECISION_LOG,
   * 2026-08-14 — Charge adjustment and void authority is manager-only). Raising
   * the charge for a session that happened is diary work and cannot duplicate
   * money; taking one back is a financial correction, and the person who entered
   * the session is not the person who decides it should not be owed. A
   * receptionist reaching this route is refused with 403 by the permission guard,
   * before any charge is read.
   *
   * NAMED BY THE CHARGE, NOT BY THE SEAT. A seat may hold many charges over its
   * life — one valid and any number withdrawn — so "void the charge for this
   * participant" would be ambiguous the moment a correction had already happened.
   * The path cannot collide with `participants/:participantId` above: the second
   * segment is a literal there and a literal here, and they differ.
   *
   * 200, AND THE WHOLE CHARGE COMES BACK. One read shape for every ledger write
   * (frozen F1 `sessionChargeResponse`), so the screen that asked for the void
   * renders the result — voided, with its reason, its adjustments and its
   * recomputed totals — without a second request and without doing arithmetic
   * CLAUDE.md keeps out of the web tier.
   *
   * THIS DOES NOT REOPEN THE SESSION. The lifecycle correction is its own request
   * with its own reason and its own audit fact.
   */
  @Post(':id/void')
  @HttpCode(200)
  @RequirePermissions('charge.void')
  async void(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(voidSessionChargeRequestSchema)) body: VoidSessionChargeRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<SessionChargeResponse> {
    return this.charges.void(id, body.reason, session, context);
  }
}
