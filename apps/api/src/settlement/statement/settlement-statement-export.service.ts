import { Injectable } from '@nestjs/common';
import type { SettlementStatementExportQuery } from '@clinic/contracts';
import { AuditService } from '../../audit/audit.service';
import type { RequestContext, ResolvedSession } from '../../common/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import { runAuditedCsvExport, type ReportExportFile } from '../../reports/csv-export';
import { SETTLEMENT_STATEMENT_EXPORT_COLUMNS } from './settlement-export-columns';
import { SettlementStatementService } from './settlement-statement.service';

/**
 * TAKING A THERAPIST'S SETTLEMENT STATEMENT OUT OF THE SYSTEM AS A CSV FILE
 * (Milestone 8, checkpoint C8).
 *
 * IT IS A REPRESENTATION, NOT A CALCULATION, AND THIS CLASS IS WHERE THAT IS
 * STRUCTURAL. It has no statement of its own, no predicate, no sum, no
 * percentage and no subtraction: it names a surface, hands the runner a column
 * list and delegates every row to `SettlementStatementService.exportRows`, which
 * is the screen's own read. A settlement figure appearing in this file that the
 * statement does not state would be the exact failure the checkpoint exists to
 * avoid — and there is no code path here by which one could.
 *
 * THE FILE STATES WHAT IT EXCLUDED, AND THAT IS NOT A SECOND CALCULATION EITHER.
 * A settlement CSV is opened months later beside no screen, so it carries the
 * statement's own exception counts as two rows of their own kind — how many
 * valid charges nobody has rated, and how many completed attended seats carry no
 * charge at all. They are read from `SettlementStatementService` in the same
 * snapshot as the lines, they carry a COUNT and no money, and they are never
 * zero-valued settlement rows: an unrated session is the absence of a decision
 * and not a session worth nothing. `rowCount` in the audit row therefore counts
 * every line of the file, exactly as it always has — the count of what the
 * caller received, which is what makes two exports distinguishable events.
 *
 * THE EXPORT MACHINERY IS MILESTONE 7'S, BORROWED WHOLE. `runAuditedCsvExport`
 * is the same runner the five report exports go through: one `REPEATABLE READ`
 * transaction holding the read and its audit row, one `report.exported` row per
 * successful export, `toCsv` for the bytes and `csvFilename` for the name. No
 * second export pipeline exists, nothing is stored, no file is kept and no
 * artefact outlives the request.
 *
 * IT SITS IN `SettlementModule` AND BORROWS TWO PLAIN FILES FROM `reports/`.
 * `ReportsModule` already reaches this module transitively
 * (`ReportsModule → AppointmentsModule → LedgerModule → SettlementModule`), so a
 * provider borrowed the other way would be a cycle; `csv-export.ts` and
 * `report-csv.ts` are functions rather than providers, which is what lets the
 * sixth export reuse the machinery without one.
 *
 * THIS IS THE ONLY WRITE ANY SETTLEMENT READ PATH MAKES, AND IT IS THE ACT AND
 * NEVER THE CONTENTS. Reading the statement on the screen is audited nowhere and
 * deliberately so (C5); an EXPORT is audited because the facts leave the system
 * as a file that outlives the session and that nothing here can observe again.
 * What the row carries is built from the REQUEST — the therapist id, the range,
 * its basis — plus the count of lines the caller received. It is impossible to
 * pass a line to `reportExportAudit`, so the colleague's NAME, the applied
 * PERCENTAGES, every AMOUNT and the file itself cannot reach the permanent
 * trail. `audit_log` is append-only: a copy of a therapist's earnings written
 * into it would be undeletable and would answer a question nobody asked.
 *
 * A REFUSED EXPORT IS AUDITED NOWHERE. `PermissionsGuard` refuses a caller
 * without BOTH `settlement.read` AND `report.export` before this class is
 * reached, and a `404` for an unknown therapist is thrown inside the transaction
 * before the audit row is committed, so it rolls back with the read.
 *
 * NOTHING ABOUT A PAYOUT IS RECORDED OR IMPLIED. Exporting a statement settles
 * nothing, closes nothing, pays nothing and changes no financial fact: the same
 * request may be made a hundred times and the clinic's records are identical
 * afterwards.
 */
@Injectable()
export class SettlementStatementExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly statements: SettlementStatementService,
  ) {}

  /**
   * THE SCOPE THE TRAIL RECORDS IS THE REQUEST, RESTATED.
   *
   * `therapistId` IS THE WHOLE FILTER, because it is the whole query: a
   * statement is one person's earnings over one range (frozen C1), and the
   * schema admits nothing else. It is an opaque id — a pointer whose meaning
   * requires the database that issued it — and never the name it resolves to.
   *
   * `SESSION_DATE` IS STATED RATHER THAN ASSUMED. It is the statement's own
   * basis and the only one it has; naming it in the row means a reader of the
   * trail in a year's time can tell what "2026-09-01 to 2026-09-30" counted
   * without reading this code.
   *
   * THE FILE IS NAMED FOR THE REPORT AND ITS PERIOD AND FOR NOBODY. A manager
   * exporting several therapists in one sitting gets several files with the same
   * name, which is the deliberate trade: `csvFilename` is ASCII so it survives a
   * `Content-Disposition` header intact in every browser, and a colleague's name
   * transliterated into a filename would put a person's identity into the one
   * place a downloaded file is read from a folder listing.
   */
  async statement(
    query: SettlementStatementExportQuery,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<ReportExportFile> {
    return runAuditedCsvExport(
      { prisma: this.prisma, audit: this.audit },
      {
        scope: {
          report: 'SETTLEMENT_STATEMENT',
          range: { from: query.from, to: query.to, dateBasis: 'SESSION_DATE' },
          filters: { therapistId: query.therapistId },
        },
        filePrefix: 'settlement-statement',
        columns: SETTLEMENT_STATEMENT_EXPORT_COLUMNS,
        read: (tx) => this.statements.exportRows(tx, query),
      },
      actor,
      context,
    );
  }
}
