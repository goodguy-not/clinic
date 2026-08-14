import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  postSessionChargeRequestSchema,
  type PostSessionChargeResponse,
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
}
