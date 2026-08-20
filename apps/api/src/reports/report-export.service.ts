import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  FamilyAccountReportExportQuery,
  PaymentReportExportQuery,
  PromiseReportExportQuery,
  SessionReportExportQuery,
  TherapistActivityExportQuery,
} from '@clinic/contracts';
import { AuditService } from '../audit/audit.service';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { runAuditedCsvExport, type ReportExportFile } from './csv-export';
import { FamilyAccountReportService } from './family-account-report.service';
import { PaymentReportService } from './payment-report.service';
import { PromiseReportService } from './promise-report.service';
import type { CsvColumn } from './report-csv';
import {
  FAMILY_ACCOUNT_EXPORT_COLUMNS,
  PAYMENT_EXPORT_COLUMNS,
  PROMISE_EXPORT_COLUMNS,
  SESSION_EXPORT_COLUMNS,
  THERAPIST_ACTIVITY_EXPORT_COLUMNS,
} from './report-export-columns';
import type { ReportExportScope } from './report-export-audit';
import { SessionReportService } from './session-report.service';
import { TherapistActivityService } from './therapist-activity.service';

/**
 * TAKING AN APPROVED MILESTONE 7 REPORT OUT OF THE SYSTEM AS A CSV FILE
 * (checkpoint C5).
 *
 * FIVE SURFACES AND NOT ONE MORE. The five frozen C1 reports are exportable, and
 * the dashboard deliberately is not: it is a screen of blocks — today's counts, a
 * reconciliation, a backlog badge — rather than a table of rows, and a "CSV of
 * the dashboard" would have to invent a shape nobody approved. What a manager
 * would export from it is one of the five reports underneath it, filtered.
 *
 * IT IS THE ONLY THING IN THIS MODULE THAT WRITES A ROW, AND IT WRITES EXACTLY
 * ONE KIND. `ReportsModule` owns no table and every other route in it writes
 * nothing anywhere; the single `report.exported` audit row is the deliberate
 * exception the accepted M7 policy makes, because an export is an ACT — data
 * leaves the building — and not a read. Nothing else is stored: no file, no
 * generated artefact, no aggregate, no cache, no queue and no job. The bytes are
 * built on the request that asks for them and are never seen by this system
 * again.
 *
 * NO SECOND REPORTING IMPLEMENTATION EXISTS BEHIND THESE ROUTES. Every row comes
 * from the report service that owns it, through an `exportRows` method that is
 * the screen's own statement with the paging window removed: same predicate,
 * same joins, same order, same derivations, same mapping. This class chooses
 * columns and writes bytes; it computes nothing. A financial predicate, a void
 * rule, a date basis or a promise-status derivation appearing anywhere in this
 * file would be the exact failure C5 exists to avoid.
 *
 * ONE TRANSACTION PER EXPORT, AT `REPEATABLE READ`, HOLDING BOTH THE READ AND
 * THE AUDIT ROW. Three properties follow, and all three matter:
 *
 *   * the file is one snapshot, exactly as the corresponding report is — the same
 *     isolation level the screen reads at, so an export cannot be assembled from
 *     two different states of the clinic;
 *   * `clinic_date()` answers once, so a promise cannot be `MISSED` on one line
 *     of a file and `OPEN` on another;
 *   * the audit row is written in the same transaction as the read it describes,
 *     so `rowCount` is provably the count of the rows the caller received, and a
 *     failure between the two leaves neither.
 *
 * A REFUSED EXPORT NEVER REACHES THIS CLASS. `PermissionsGuard` rejects a caller
 * without `report.export` before any method here runs, so no statement executes
 * and no audit row is written for an export that did not happen.
 *
 * THE WHOLE FILE IS BUILT IN MEMORY, AND THAT IS THE ONE COST THIS DESIGN
 * ACCEPTS. Nothing truncates and nothing pages, so a manager exporting several
 * years of sessions materialises every row and the string built from them. It is
 * the right trade for a pilot clinic — a silently shortened financial file is a
 * far worse failure than a slow one — and the revisit trigger is measured
 * evidence from real data volumes, at which point streaming the rows out of a
 * cursor is the change to make. It is recorded in the C5 report.
 */

/**
 * Re-exported, not redeclared: the file shape belongs to the shared export
 * machinery (`csv-export.ts`), and the five routes below still hand it out.
 */
export type { ReportExportFile };

@Injectable()
export class ReportExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessionReport: SessionReportService,
    private readonly promiseReport: PromiseReportService,
    private readonly therapistActivityReport: TherapistActivityService,
    private readonly paymentReport: PaymentReportService,
    private readonly familyAccountReport: FamilyAccountReportService,
  ) {}

  async sessions(
    query: SessionReportExportQuery,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<ReportExportFile> {
    return this.export(
      {
        report: 'SESSIONS',
        range: { from: query.from, to: query.to, dateBasis: 'SESSION_DATE' },
        filters: {
          familyId: query.familyId,
          childId: query.childId,
          therapistId: query.therapistId,
          serviceId: query.serviceId,
          roomId: query.roomId,
          status: query.status,
          attendance: query.attendance,
        },
      },
      'sessions',
      SESSION_EXPORT_COLUMNS,
      (tx) => this.sessionReport.exportRows(tx, query),
      actor,
      context,
    );
  }

  async promises(
    query: PromiseReportExportQuery,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<ReportExportFile> {
    return this.export(
      {
        report: 'PROMISES',
        range: { from: query.from, to: query.to, dateBasis: 'PROMISE_DUE_ON' },
        filters: { familyId: query.familyId, status: query.status },
      },
      'promises',
      PROMISE_EXPORT_COLUMNS,
      (tx) => this.promiseReport.exportRows(tx, query),
      actor,
      context,
    );
  }

  async therapistActivity(
    query: TherapistActivityExportQuery,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<ReportExportFile> {
    return this.export(
      {
        report: 'THERAPIST_ACTIVITY',
        range: { from: query.from, to: query.to, dateBasis: 'SESSION_DATE' },
        filters: {
          therapistId: query.therapistId,
          serviceId: query.serviceId,
          includeInactive: query.includeInactive,
        },
      },
      'therapist-activity',
      THERAPIST_ACTIVITY_EXPORT_COLUMNS,
      (tx) => this.therapistActivityReport.exportRows(tx, query),
      actor,
      context,
    );
  }

  async payments(
    query: PaymentReportExportQuery,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<ReportExportFile> {
    return this.export(
      {
        report: 'PAYMENTS',
        range: { from: query.from, to: query.to, dateBasis: 'PAYMENT_RECEIVED_ON' },
        filters: {
          familyId: query.familyId,
          method: query.method,
          recordedByUserId: query.recordedByUserId,
          includeVoided: query.includeVoided,
        },
      },
      'payments',
      PAYMENT_EXPORT_COLUMNS,
      (tx) => this.paymentReport.exportRows(tx, query),
      actor,
      context,
    );
  }

  /**
   * `range: null`, because a position is not a period (frozen C1). The audit row
   * says so explicitly rather than omitting the key, so a reviewer can tell "this
   * report has no range" from "the range was lost".
   */
  async familyAccounts(
    query: FamilyAccountReportExportQuery,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<ReportExportFile> {
    return this.export(
      {
        report: 'FAMILY_ACCOUNTS',
        range: null,
        filters: { standing: query.standing, includeInactive: query.includeInactive },
      },
      'family-accounts',
      FAMILY_ACCOUNT_EXPORT_COLUMNS,
      (tx) => this.familyAccountReport.exportRows(tx, query),
      actor,
      context,
    );
  }

  /**
   * EVERY EXPORT ABOVE GOES THROUGH THE ONE AUDITED RUNNER, AND THIS CLASS ADDS
   * NOTHING TO IT.
   *
   * The transaction, its isolation level and the single `report.exported` row
   * live in `csv-export.ts`, where the Milestone 8 settlement export reaches
   * them too (checkpoint C8). What stays here is what has always been this
   * class's own: which surface, which columns, and whose statement reads the
   * rows. It still computes nothing.
   */
  private async export<Row>(
    scope: ReportExportScope,
    filePrefix: string,
    columns: readonly CsvColumn<Row>[],
    read: (tx: Prisma.TransactionClient) => Promise<Row[]>,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<ReportExportFile> {
    return runAuditedCsvExport(
      { prisma: this.prisma, audit: this.audit },
      { scope, filePrefix, columns, read },
      actor,
      context,
    );
  }
}
