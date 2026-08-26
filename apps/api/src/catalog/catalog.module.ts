import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { RoomsController } from './rooms/rooms.controller';
import { RoomsService } from './rooms/rooms.service';
import { ServicesController } from './services/services.controller';
import { ServicesService } from './services/services.service';
import { TariffsController } from './tariffs/tariffs.controller';
import { TariffsService } from './tariffs/tariffs.service';
import { TherapistPublicProfileController } from './therapists/therapist-public-profile.controller';
import { TherapistPublicProfileService } from './therapists/therapist-public-profile.service';
import { TherapistsController } from './therapists/therapists.controller';
import { TherapistsService } from './therapists/therapists.service';

/**
 * Clinic reference data: therapists, services, rooms and tariffs.
 *
 * This module owns those four tables and their join tables, and is the only
 * code that queries them.
 *
 * All four entities are implemented.
 *
 * `AuditModule` is imported because every write here is audited in the same
 * transaction as the state change it records.
 *
 * A THERAPIST'S PUBLIC PROFILE IS A SECOND SERVICE ON THE SAME TABLE
 * (Milestone 9, checkpoint A2), and that is the authority boundary made
 * structural rather than a filing accident: the personnel record is written
 * under `therapist.update`, and putting a named colleague's photograph and
 * biography on a public website is written under `therapist.publish_profile`,
 * which A1 separated so it could be granted and revoked on its own. It stays in
 * THIS module because `CatalogModule` owns the `therapist` table and remains
 * the only code that writes it.
 *
 * Availability — recurring therapist windows and dated exceptions — is not part
 * of this module. Nothing consumes it until appointment booking exists, and it
 * is built with the milestone that does.
 */
@Module({
  imports: [AuditModule],
  controllers: [
    ServicesController,
    RoomsController,
    TherapistsController,
    TherapistPublicProfileController,
    TariffsController,
  ],
  providers: [
    ServicesService,
    RoomsService,
    TherapistsService,
    TherapistPublicProfileService,
    TariffsService,
  ],
  exports: [ServicesService, RoomsService, TherapistsService, TariffsService],
})
export class CatalogModule {}
