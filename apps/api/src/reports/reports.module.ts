import { Module } from '@nestjs/common';
import { AppointmentsModule } from '../appointments/appointments.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { OperationalReportsController } from './operational-reports.controller';
import { PromiseReportService } from './promise-report.service';
import { SessionReportService } from './session-report.service';
import { TherapistActivityService } from './therapist-activity.service';

/**
 * Reporting: the clinic-wide READ of facts Milestones 4, 5 and 6 already own.
 *
 * IT OWNS NO TABLE, AND THAT IS THE DEFINING PROPERTY OF THIS MODULE. Every
 * other domain module owns rows and is the only code that writes them; this one
 * writes nothing anywhere — no financial row, no aggregate, no cache, no audit
 * row — and holds no transition, no lock and no domain rule of its own. If a
 * reporting module ever needs a table, that is the moment to stop and ask
 * whether a second source of financial truth is being created.
 *
 * IT REACHES INTO THE OTHER MODULES' READ MODELS RATHER THAN REIMPLEMENTING
 * THEM. `AppointmentsModule` is imported for `AppointmentReadService`, the one
 * class that states a clinic day's appointment counts and resolves the tariff
 * suggestion, so the dashboard's badge and `/appointment-day` cannot disagree.
 * The ledger's charge arithmetic and the payment summary mapping are used as the
 * plain read helpers they already are (`ledger/charge-detail`,
 * `payments/payment-detail`) — the same one-way, read-only reach
 * `FamilyAccountService` already has into `payment` and `payment_promise`.
 *
 * THE DEPENDENCIES POINT ONE WAY AND NO CYCLE EXISTS. Nothing in appointments,
 * the ledger or payments imports this module, and nothing here is exported: a
 * report is the last reader in the chain, and no domain rule may ever come to
 * depend on one.
 *
 * C2 ADDED THE DASHBOARD; C3 ADDS THE THREE RANGED OPERATIONAL READS — sessions,
 * promises and therapist activity. They keep the same property: nothing is
 * written, nothing is stored, and every derivation is somebody else's, borrowed
 * rather than copied. `SEAT_OUTCOME_UNRESOLVED` is the appointment read model's
 * statement of "the session is over and nobody said what happened", and
 * `PROMISE_WIRE_STATUS`/`promiseStatusFilter` are the payments module's
 * statement of derived `MISSED` — both imported, so a report can never mean
 * something slightly different by a word the rest of the system already owns.
 *
 * NONE OF THE THREE READS MONEY. No charge, no tariff, no payment, no share and
 * no settlement: the operational reports are shared by both roles precisely
 * because they carry none, and the financial reports (C4) arrive under their own
 * authorities. `PaymentsModule` is deliberately NOT imported — the promise report
 * needs two SQL fragments from `payments/promise-detail`, which is a plain module
 * of read helpers, and not a service that can write one.
 *
 * The financial reports (C4) join this module as they are built; export
 * behaviour is a separate authority and a later decision.
 */
@Module({
  imports: [AppointmentsModule],
  controllers: [DashboardController, OperationalReportsController],
  providers: [
    DashboardService,
    SessionReportService,
    PromiseReportService,
    TherapistActivityService,
  ],
})
export class ReportsModule {}
