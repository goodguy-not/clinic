import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AvailabilityModule } from '../availability/availability.module';
import { AppointmentReadService } from './appointment-read.service';
import { AppointmentSeriesService } from './appointment-series.service';
import {
  AppointmentDayController,
  AppointmentSeriesController,
  AppointmentsController,
} from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { SchedulingRules } from './scheduling-rules';

/**
 * Appointments: the booking, and the seat in it.
 *
 * It owns `appointment` and `appointment_participant` and is the only code that
 * writes them. It READS `service`, `therapist`, `room`, `child` and `family` for
 * existence, status and the share locks that make a status true at write time,
 * and writes nothing in any of them.
 *
 * ONE SET OF SCHEDULING RULES, SHARED. `SchedulingRules` owns the locks, the
 * compatibility rules, the availability decision, the child recomputation and
 * the two constrained writes; `AppointmentsService` books one appointment with
 * them and `AppointmentSeriesService` books a whole series with them. It is a
 * provider rather than a base class so neither service can quietly specialise a
 * rule, and it is not exported: nothing outside this module decides where an
 * appointment may sit.
 *
 * `AvailabilityModule` is imported for one method: the resolved availability for
 * one therapist on one date, read on this module's own transaction. The
 * precedence between a closed day and a dated window is that module's rule and
 * stays there — a second implementation here would eventually disagree with it,
 * and the disagreement would decide whether somebody's booking was refused.
 *
 * NOTHING FINANCIAL IS WRITTEN, and only one thing financial is read. The
 * operational read model resolves the clinic's own price list as a suggestion,
 * with `resolveTariffSql` — the SQL `/catalog/tariff-resolution` answers with,
 * so there is one statement of "which price applies" rather than two that can
 * drift. It is a pure read: no price snapshot, no charge and no amount is
 * stored by anything in this module, and `AppointmentsService` — which owns
 * every write — cannot see a tariff at all. Pricing a session belongs to
 * Milestone 5.
 */
@Module({
  imports: [AuditModule, AvailabilityModule],
  controllers: [AppointmentsController, AppointmentSeriesController, AppointmentDayController],
  providers: [
    AppointmentsService,
    AppointmentSeriesService,
    AppointmentReadService,
    SchedulingRules,
  ],
  exports: [AppointmentsService, AppointmentSeriesService, AppointmentReadService],
})
export class AppointmentsModule {}
