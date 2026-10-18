import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { RoomsController } from './rooms/rooms.controller';
import { RoomsService } from './rooms/rooms.service';
import { ServicePublicCopyController } from './services/service-public-copy.controller';
import { ServicePublicCopyService } from './services/service-public-copy.service';
import { ServicesController } from './services/services.controller';
import { ServicesService } from './services/services.service';
import { TariffsController } from './tariffs/tariffs.controller';
import { TariffsService } from './tariffs/tariffs.service';
import { TherapistProfileCopyController } from './therapists/therapist-profile-copy.controller';
import { TherapistProfileCopyService } from './therapists/therapist-profile-copy.service';
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
 * MILESTONE 9.5, CHECKPOINT A6 ADDS A THIRD AND A FOURTH SERVICE ON THOSE SAME
 * TWO TABLES, AND THE REASON IS THE SAME ONE AGAIN. `ServicePublicCopyService`
 * and `TherapistProfileCopyService` are the EDITORIAL authority — the public
 * description, the public title, the biography — reachable under
 * `service.draft_public_copy` and `therapist.draft_public_profile`, which the
 * front desk holds. The operational services beside them carry durations,
 * status, restrictions and the publication decision, and the front desk holds
 * none of that. Their controllers are mounted under `/content` rather than
 * `/catalog` for the same reason, but the CODE stays here, because this module
 * owns `service` and `therapist` and remains the only thing that writes them.
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
    ServicePublicCopyController,
    TherapistProfileCopyController,
    TariffsController,
  ],
  providers: [
    ServicesService,
    RoomsService,
    TherapistsService,
    TherapistPublicProfileService,
    ServicePublicCopyService,
    TherapistProfileCopyService,
    TariffsService,
  ],
  exports: [ServicesService, RoomsService, TherapistsService, TariffsService],
})
export class CatalogModule {}
