import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import {
  updateTherapistProfileCopyRequestSchema,
  type TherapistProfileCopyListResponse,
  type TherapistProfileCopyResponse,
  type UpdateTherapistProfileCopyRequest,
} from '@clinic/contracts';
import { RequirePermissions } from '../../auth/decorators/endpoint-access';
import { Ctx, CurrentSession } from '../../auth/decorators/request.decorators';
import type { RequestContext, ResolvedSession } from '../../common/request-context';
import { ZodBodyPipe } from '../../common/zod-validation.pipe';
import { TherapistProfileCopyService } from './therapist-profile-copy.service';

/**
 * A colleague's public title and biography. ONE AUTHORITY, AND IT PUBLISHES
 * NOBODY.
 *
 * Milestone 9.5, checkpoint A6. All three routes name
 * `therapist.draft_public_profile`, which a RECEPTIONIST holds. There is no
 * publication route in this file and there will not be one: putting a named
 * human being on a public website is `therapist.publish_profile`, it lives on
 * `TherapistPublicProfileController`, and A1 separated it precisely so that it
 * could be granted and revoked on its own.
 *
 * A2 WITHHELD THE PROFILE READ FROM THIS ROLE, AND THIS FILE DOES NOT REOPEN
 * IT. That refusal was about the publication surface — a colleague's slug,
 * photograph, display order and opt-in, none of which is diary information and
 * none of which appears here. What this returns is the copy a drafting role
 * writes, the copy the website already shows, and the display name they see on
 * the diary every day; the manager's fuller read at
 * `/catalog/therapists/:id/public-profile` is unchanged and still refuses them.
 *
 * IT IS MOUNTED UNDER `/content` RATHER THAN UNDER `/catalog`, AND THE PATH IS
 * THE AUTHORITY BOUNDARY RESTATED: `/catalog/therapists` is the personnel and
 * publication surface, this is the editorial one, and it sits beside
 * `/content/articles` where the other drafting routes are.
 */
@Controller('content/therapist-profiles')
export class TherapistProfileCopyController {
  constructor(private readonly copy: TherapistProfileCopyService) {}

  @Get()
  @RequirePermissions('therapist.draft_public_profile')
  async list(): Promise<TherapistProfileCopyListResponse> {
    return { copies: await this.copy.list() };
  }

  @Get(':therapistId')
  @RequirePermissions('therapist.draft_public_profile')
  async get(
    @Param('therapistId', ParseUUIDPipe) therapistId: string,
  ): Promise<TherapistProfileCopyResponse> {
    return { copy: await this.copy.get(therapistId) };
  }

  /** Preparing the words. Publishes nobody; see the service. */
  @Patch(':therapistId')
  @RequirePermissions('therapist.draft_public_profile')
  async update(
    @Param('therapistId', ParseUUIDPipe) therapistId: string,
    @Body(new ZodBodyPipe(updateTherapistProfileCopyRequestSchema))
    body: UpdateTherapistProfileCopyRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<TherapistProfileCopyResponse> {
    return { copy: await this.copy.update(therapistId, body, session, context) };
  }
}
