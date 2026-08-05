import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';

/**
 * Clinic reference data: therapists, services, rooms and tariffs.
 *
 * This module owns those four tables and their join tables, and is the only
 * code that queries them.
 *
 * It is deliberately empty in this checkpoint. The schema, its constraints and
 * the shared contracts land first and are verified on their own; controllers
 * and services arrive one entity at a time in the vertical slices that follow,
 * so each is reviewable against a database that already refuses the invalid
 * states it is meant to prevent.
 *
 * `AuditModule` is imported now because every write this module will perform is
 * audited in the same transaction as the state change, and importing it here
 * keeps that visible in the dependency graph rather than arriving quietly with
 * the first service.
 *
 * Availability — recurring therapist windows and dated exceptions — is not part
 * of this module yet. Nothing consumes it until appointment booking exists, and
 * it is built with the milestone that does.
 */
@Module({
  imports: [AuditModule],
  controllers: [],
  providers: [],
  exports: [],
})
export class CatalogModule {}
