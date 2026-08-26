import { Body, Controller, Get, Put } from '@nestjs/common';
import {
  updateClinicProfileRequestSchema,
  type PublicClinicProfileResponse,
  type UpdateClinicProfileRequest,
} from '@clinic/contracts';
import { RequirePermissions } from '../auth/decorators/endpoint-access';
import { Ctx, CurrentSession } from '../auth/decorators/request.decorators';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { ZodBodyPipe } from '../common/zod-validation.pipe';
import { ClinicProfileService } from './clinic-profile.service';

/**
 * The clinic's public profile, from the inside. Manager-only.
 *
 * Milestone 9, checkpoint A2, closing the last A1 column with no writer.
 *
 * `PUT` RATHER THAN `PATCH`, AND IT IS THE ONLY ONE IN THE PRODUCT. Every other
 * write here is a `PATCH` because every other write changes part of a record
 * that has other parts. This replaces the whole profile: thirteen boxes on one
 * screen, submitted together, and a field left empty means the website stops
 * saying it. `PUT` is what that is.
 *
 * There is no create and no delete. The row exists from the migration that
 * created it, and the table refuses a DELETE outright — emptying the profile is
 * saving it with every box blank, which is reversible and audited.
 */
@Controller('content/clinic-profile')
export class ClinicProfileController {
  constructor(private readonly profile: ClinicProfileService) {}

  @Get()
  @RequirePermissions('clinic_profile.read')
  async read(): Promise<PublicClinicProfileResponse> {
    return { clinic: await this.profile.read() };
  }

  @Put()
  @RequirePermissions('clinic_profile.update')
  async update(
    @Body(new ZodBodyPipe(updateClinicProfileRequestSchema)) body: UpdateClinicProfileRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<PublicClinicProfileResponse> {
    return { clinic: await this.profile.update(body, session, context) };
  }
}
