import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import type { RegistrationDraftResponse } from '@clinic/contracts';
import { RequirePermissions } from '../../auth/decorators/endpoint-access';
import { CurrentSession } from '../../auth/decorators/request.decorators';
import type { ResolvedSession } from '../../common/request-context';
import { DraftToken } from './draft-token.decorator';
import { RegistrationDraftsService } from './registration-drafts.service';

/**
 * The two routes that read and abandon a registration draft.
 *
 * Both carry `family.read`. A draft only ever exists inside the family
 * registration flow, and every role that can reach that flow holds it — but the
 * permission is not the real authorisation here. That is the row's own binding
 * to the user and the session that created it, checked in the service, which is
 * what stops one member of staff resolving a draft belonging to another.
 *
 * Confirmation is deliberately NOT here. It performs a domain write, so it lives
 * on the controller that owns that write and carries `family.create`.
 *
 * CHECKPOINT D SCOPE. The service handles every `DraftPurpose` generically, but
 * only `FAMILY_CREATE` drafts can exist yet, because only blocked family
 * creation makes one.
 */
@Controller('registration-drafts')
export class RegistrationDraftsController {
  constructor(private readonly drafts: RegistrationDraftsService) {}

  /**
   * What was typed, and what currently looks like a duplicate.
   *
   * Reads without consuming: somebody may refresh the confirmation screen, or
   * open it in a second tab, and neither should destroy the draft they are
   * still deciding about.
   *
   * The candidates come from a fresh recomputation rather than from the ids
   * stored when the block happened. The screen shows what is true now.
   */
  @Get('current')
  @RequirePermissions('family.read')
  async current(
    @DraftToken() token: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<RegistrationDraftResponse> {
    return this.drafts.resolve(token, session);
  }

  /**
   * "It is the same family after all."
   *
   * 204: there is nothing to say. The row is gone, and a second attempt with the
   * same token answers `DRAFT_NOT_FOUND` like every other unusable token — which
   * is what makes replay indistinguishable from a token that never existed.
   *
   * A POST rather than a DELETE because the browser reaches it from a form, and
   * the token travels in a header rather than in the path.
   */
  @Post('discard')
  @HttpCode(204)
  @RequirePermissions('family.read')
  async discard(
    @DraftToken() token: string,
    @CurrentSession() session: ResolvedSession,
  ): Promise<void> {
    return this.drafts.discard(token, session);
  }
}
