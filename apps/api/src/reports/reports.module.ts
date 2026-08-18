import { Module } from '@nestjs/common';
import { AppointmentsModule } from '../appointments/appointments.module';
import { AuditModule } from '../audit/audit.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { FamilyAccountReportService } from './family-account-report.service';
import { FinancialReportsController } from './financial-reports.controller';
import { OperationalReportsController } from './operational-reports.controller';
import { PaymentReportService } from './payment-report.service';
import { PromiseReportService } from './promise-report.service';
import { ReportExportController } from './report-export.controller';
import { ReportExportService } from './report-export.service';
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
 * NONE OF THE THREE OPERATIONAL READS TOUCHES MONEY. No charge, no tariff, no
 * payment, no share and no settlement: they are shared by both roles precisely
 * because they carry none. `PaymentsModule` is deliberately NOT imported — the
 * promise report needs two SQL fragments from `payments/promise-detail`, which is
 * a plain module of read helpers, and not a service that can write one.
 *
 * C4 ADDS THE TWO FINANCIAL READS, under `report.read_financial` and in a
 * controller of their own so the manager-only authority sits beside the only
 * routes that need it. They keep this module's defining property and sharpen it:
 * the family-accounts report derives NOTHING. Every position it prints comes out
 * of `ledger/family-position`, the same code `GET /families/:id/account` answers
 * with, so the clinic-wide report and the single-family account cannot state two
 * different answers to "what does this family owe?" — which is precisely the
 * second source of financial truth this module must never become. The payments
 * report borrows the payment module's own status derivation and read order for
 * the same reason.
 *
 * C5 ADDS THE CSV EXPORTS, AND WITH THEM THE ONE ROW THIS MODULE EVER WRITES.
 * `AuditModule` is imported for exactly that: a `report.exported` row per
 * successful export, written in the transaction that read the file's rows. It is
 * the deliberate Milestone 7 exception to "a read is not audited" — an export is
 * an ACT, because the data leaves the system — and it is the ONLY write this
 * module may ever make. The module still owns no table, stores no file, keeps no
 * aggregate and holds no domain rule; if a reporting service ever needs a second
 * kind of write, that is the moment to stop and ask whether a second source of
 * financial truth is being created.
 *
 * THE EXPORTS ADD NO REPORTING LOGIC. `ReportExportService` chooses columns and
 * writes bytes; every row it writes comes from the five services above, through
 * their own statements with the paging window removed. There is no export
 * pipeline, no generated-file table, no materialised view and no background job:
 * a file is built on the request that asks for it and is never seen again.
 */
@Module({
  imports: [AppointmentsModule, AuditModule],
  controllers: [
    DashboardController,
    OperationalReportsController,
    FinancialReportsController,
    ReportExportController,
  ],
  providers: [
    DashboardService,
    SessionReportService,
    PromiseReportService,
    TherapistActivityService,
    PaymentReportService,
    FamilyAccountReportService,
    ReportExportService,
  ],
})
export class ReportsModule {}
