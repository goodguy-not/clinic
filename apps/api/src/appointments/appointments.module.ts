import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AvailabilityModule } from '../availability/availability.module';
import { LedgerModule } from '../ledger/ledger.module';
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
 * NO FINANCIAL RULE LIVES HERE, and no financial row is written by this module's
 * own SQL. Two financial things touch it, and both belong to somebody else.
 *
 * The operational read model resolves the clinic's own price list as a
 * SUGGESTION, with `resolveTariffSql` — the SQL `/catalog/tariff-resolution`
 * answers with, so there is one statement of "which price applies" rather than
 * two that can drift. It is a pure read: no price snapshot and no amount is
 * stored by anything here, and `AppointmentsService` still cannot see a tariff at
 * all.
 *
 * From Milestone 5 the two lifecycle writes that can make a session chargeable —
 * completing it, and recording that a child attended — CALL THE LEDGER'S posting
 * routine inside their own transaction, so the charge and the fact that caused it
 * commit together. `LedgerModule` decides everything about that charge:
 * eligibility, price, snapshot, idempotency and audit. This module supplies a
 * transaction and a participant id, and would be unable to write a charge if it
 * wanted to — it holds no charge SQL and the ledger exports no other way in.
 * The dependency points one way and no cycle exists.
 */
@Module({
  imports: [AuditModule, AvailabilityModule, LedgerModule],
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
