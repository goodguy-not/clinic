import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import {
  updateClinicContentEntryRequestSchema,
  updateClinicProfileRequestSchema,
  type ClinicContentEntryResponse,
  type ClinicContentResponse,
  type PublicClinicProfileResponse,
  type UpdateClinicContentEntryRequest,
  type UpdateClinicProfileRequest,
} from '@clinic/contracts';
import { RequirePermissions } from '../auth/decorators/endpoint-access';
import { Ctx, CurrentSession } from '../auth/decorators/request.decorators';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { ZodBodyPipe } from '../common/zod-validation.pipe';
import { ClinicContentService } from './clinic-content.service';
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
 *
 * MILESTONE 9.5, CHECKPOINT A8 ADDS THE CLINIC'S ROUTINE COPY TO THIS SAME
 * SURFACE, under the SAME TWO PERMISSIONS. The home and about blocks are what
 * the clinic says in exactly the way the address is what the clinic is: one
 * manager owns both, neither has a publication act, and a receptionist holds
 * neither name. A separate permission pair would have suggested there is a
 * separate authority here, and there is not.
 *
 * THE BLOCK ROUTES ARE A LIST AND A `PUT` PER BLOCK, and there is deliberately
 * no `POST` and no `DELETE`. The set of blocks IS the accepted page design: it
 * arrives with a migration, the database refuses to delete one, and what a
 * manager changes is what each block says. A block leaves the website by having
 * its heading cleared.
 */
@Controller('content/clinic-profile')
export class ClinicProfileController {
  constructor(
    private readonly profile: ClinicProfileService,
    private readonly content: ClinicContentService,
  ) {}

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

  /**
   * Every editorial block, written or not. Milestone 9.5, checkpoint A8.
   *
   * IT RETURNS THE EMPTY ONES, unlike the public read, because an empty box is
   * exactly what a manager has come here to fill in.
   */
  @Get('entries')
  @RequirePermissions('clinic_profile.read')
  async listEntries(): Promise<ClinicContentResponse> {
    return { entries: await this.content.list() };
  }

  /**
   * Replaces one block's copy. `PUT` for the reason the profile is a `PUT`:
   * four boxes on one card, submitted together, and a box left empty means the
   * block stops saying it.
   *
   * CLEARING `heading` TAKES THE BLOCK OFF THE WEBSITE, and any photograph
   * published on it with it. That is not a special case in this handler — it is
   * `heading IS NULL` being the one rule the public projection and the media
   * predicate both read.
   */
  @Put('entries/:entryId')
  @RequirePermissions('clinic_profile.update')
  async updateEntry(
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @Body(new ZodBodyPipe(updateClinicContentEntryRequestSchema))
    body: UpdateClinicContentEntryRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<ClinicContentEntryResponse> {
    return { entry: await this.content.update(entryId, body, session, context) };
  }
}
