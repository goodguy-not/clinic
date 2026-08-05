import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { RoomsController } from './rooms/rooms.controller';
import { RoomsService } from './rooms/rooms.service';
import { ServicesController } from './services/services.controller';
import { ServicesService } from './services/services.service';

/**
 * Clinic reference data: therapists, services, rooms and tariffs.
 *
 * This module owns those four tables and their join tables, and is the only
 * code that queries them.
 *
 * Services and rooms are implemented. Therapists and tariffs arrive in the
 * checkpoints that follow, one entity at a time, so each is reviewable against
 * a database that already refuses the invalid states it is meant to prevent.
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
  controllers: [ServicesController, RoomsController],
  providers: [ServicesService, RoomsService],
  exports: [ServicesService, RoomsService],
})
export class CatalogModule {}
