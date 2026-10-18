import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import {
  updateTherapistPublicProfileRequestSchema,
  updateTherapistPublicVisibilityRequestSchema,
  type TherapistPublicProfileResponse,
  type UpdateTherapistPublicProfileRequest,
  type UpdateTherapistPublicVisibilityRequest,
} from '@clinic/contracts';
import { RequirePermissions } from '../../auth/decorators/endpoint-access';
import { Ctx, CurrentSession } from '../../auth/decorators/request.decorators';
import type { RequestContext, ResolvedSession } from '../../common/request-context';
import { ZodBodyPipe } from '../../common/zod-validation.pipe';
import { TherapistPublicProfileService } from './therapist-public-profile.service';

/**
 * A therapist's public profile. Manager-only, under one permission.
 *
 * Milestone 9, checkpoint A2. All three routes name `therapist.publish_profile`
 * and NOT `therapist.read` or `therapist.update` — including the read, which is
 * deliberate: a receptionist holds `therapist.read` to run the diary, and the
 * draft biography and photograph of a colleague who has not agreed to be
 * published is not diary information. A1 separated this authority so that
 * publishing a named human being could be granted and revoked on its own, and
 * that is worth nothing if the surface leaks back through a read.
 *
 * There is no create and no delete. A public profile is not a record: it is a
 * set of columns on a therapist who already exists, and it is emptied by
 * clearing them.
 */
@Controller('catalog/therapists/:id/public-profile')
export class TherapistPublicProfileController {
  constructor(private readonly profiles: TherapistPublicProfileService) {}

  @Get()
  @RequirePermissions('therapist.publish_profile')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<TherapistPublicProfileResponse> {
    return { profile: await this.profiles.get(id) };
  }

  /** The approved content. Publishes nobody; see the service. */
  @Patch()
  @RequirePermissions('therapist.publish_profile')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(updateTherapistPublicProfileRequestSchema))
    body: UpdateTherapistPublicProfileRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<TherapistPublicProfileResponse> {
    return { profile: await this.profiles.update(id, body, session, context) };
  }

  /**
   * The opt-in itself, separate from the content for the reason
   * `changeStatus` is separate from `update` on every catalog entity: it is a
   * different decision, and it must not happen as a side effect of correcting a
   * biography.
   */
  @Patch('visibility')
  @RequirePermissions('therapist.publish_profile')
  async setVisibility(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(updateTherapistPublicVisibilityRequestSchema))
    body: UpdateTherapistPublicVisibilityRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<TherapistPublicProfileResponse> {
    return { profile: await this.profiles.setVisibility(id, body.isPublic, session, context) };
  }
}
