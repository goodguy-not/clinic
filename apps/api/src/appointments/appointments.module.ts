import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AvailabilityModule } from '../availability/availability.module';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';

/**
 * Appointments: the booking, and the seat in it.
 *
 * It owns `appointment` and `appointment_participant` and is the only code that
 * writes them. It READS `service`, `therapist`, `room`, `child` and `family` for
 * existence, status and the share locks that make a status true at write time,
 * and writes nothing in any of them.
 *
 * `AvailabilityModule` is imported for one method: the resolved availability for
 * one therapist on one date, read on this module's own transaction. The
 * precedence between a closed day and a dated window is that module's rule and
 * stays there — a second implementation here would eventually disagree with it,
 * and the disagreement would decide whether somebody's booking was refused.
 *
 * Nothing financial is imported, because nothing financial exists. There is no
 * tariff lookup, no price snapshot and no charge in this module; those belong to
 * Milestone 5.
 */
@Module({
  imports: [AuditModule, AvailabilityModule],
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
