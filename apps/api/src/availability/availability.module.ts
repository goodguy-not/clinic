import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';

/**
 * Therapist availability: recurring working windows and dated exceptions.
 *
 * A module of its own rather than part of `CatalogModule`, for the reason
 * `availability.manage` is a permission of its own: maintaining a schedule is a
 * different authority from editing the therapist record, and the two tables here
 * belong to the appointment domain that reads them, not to reference data.
 *
 * It owns `therapist_availability` and `therapist_availability_exception` and is
 * the only code that queries them. It reads `therapist` for existence, status
 * and the row lock that serialises a replacement, and writes nothing there.
 *
 * `AuditModule` is imported because every write here is audited in the same
 * transaction as the state change it records.
 *
 * The booking module that consumes `resolve` arrives with the checkpoint that
 * builds it; nothing in this module knows what an appointment is.
 */
@Module({
  imports: [AuditModule],
  controllers: [AvailabilityController],
  providers: [AvailabilityService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
