import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { RoomsController } from './rooms/rooms.controller';
import { RoomsService } from './rooms/rooms.service';
import { ServicesController } from './services/services.controller';
import { ServicesService } from './services/services.service';
import { TariffsController } from './tariffs/tariffs.controller';
import { TariffsService } from './tariffs/tariffs.service';
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
 * Availability — recurring therapist windows and dated exceptions — is not part
 * of this module. Nothing consumes it until appointment booking exists, and it
 * is built with the milestone that does.
 */
@Module({
  imports: [AuditModule],
  controllers: [ServicesController, RoomsController, TherapistsController, TariffsController],
  providers: [ServicesService, RoomsService, TherapistsService, TariffsService],
  exports: [ServicesService, RoomsService, TherapistsService, TariffsService],
})
export class CatalogModule {}
