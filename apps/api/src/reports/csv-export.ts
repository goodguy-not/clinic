import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import type { AuditService } from '../audit/audit.service';
import { actorContext } from '../catalog/catalog-support';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import type { PrismaService } from '../prisma/prisma.service';
import { csvFilename, toCsv, type CsvColumn } from './report-csv';
import { reportExportAudit, type ReportExportScope } from './report-export-audit';

/**
 * THE ONE PATH EVERY AUDITED CSV EXPORT IN THIS SYSTEM TAKES: read the rows,
 * write the bytes, record the act — in that order, in one transaction.
 *
 * IT WAS THE PRIVATE HEART OF `ReportExportService` AND IS NOW A PLAIN FUNCTION
 * (Milestone 8, checkpoint C8). The settlement statement is the sixth
 * exportable surface and the FIRST that does not live in `ReportsModule`: its
 * read model belongs to `SettlementModule`, and `ReportsModule` already reaches
 * into `AppointmentsModule` → `LedgerModule` → `SettlementModule`, so a provider
 * borrowed in the other direction would be a module cycle. A function that takes
 * its two collaborators as arguments has no module of its own to import, which
 * is what lets the sixth export reuse this machinery INSTEAD OF COPYING IT.
 *
 * NOTHING MOVED INTO IT AND NOTHING WAS ADDED. The transaction, its isolation
 * level, the single `report.exported` row and the filename are exactly what C5
 * accepted; the five Milestone 7 exports call this function and behave as they
 * did.
 *
 * ONE TRANSACTION PER EXPORT, AT `REPEATABLE READ`, HOLDING BOTH THE READ AND
 * THE AUDIT ROW. Three properties follow, and all three matter:
 *
 *   * the file is one snapshot, exactly as the corresponding report is — the
 *     same isolation level the screen reads at, so an export cannot be assembled
 *     from two different states of the clinic;
 *   * `clinic_date()` answers once, so a derived status cannot differ between
 *     two lines of one file;
 *   * the audit row is written in the same transaction as the read it describes,
 *     so `rowCount` is provably the count of the rows the caller received, and a
 *     failure between the two leaves neither.
 *
 * A REFUSED EXPORT NEVER REACHES THIS FUNCTION. `PermissionsGuard` rejects a
 * caller who lacks any named authority before the handler runs, so no statement
 * executes and no audit row is written for an export that did not happen. A read
 * that THROWS inside the transaction — an unknown therapist, a failed statement
 * — rolls the audit row back with it, so a failed export is not an audited one
 * either.
 *
 * `rows.length` IS THE ONLY THING THE FILE TELLS THE AUDIT ROW. Not a value from
 * it, not a name in it, not a total of it — the count of lines, which is what
 * makes an export of four rows and an export of nine thousand distinguishable
 * events without the trail holding either file's contents
 * (`report-export-audit.ts`).
 *
 * ONE ACTION FOR EVERY SURFACE, WITH THE SURFACE IN THE PAYLOAD.
 * "How often does data leave this system?" is asked of exports as a class, and
 * that is exactly the shape a reviewer filters on.
 */

/** What a controller hands to the HTTP layer: the bytes, and what to call them. */
export type ReportExportFile = {
  readonly filename: string;
  readonly csv: string;
  readonly rowCount: number;
};

/** The two collaborators an export needs, and deliberately no others. */
export type CsvExportDeps = {
  readonly prisma: PrismaService;
  readonly audit: AuditService;
};

/**
 * What is being exported: the scope the trail records, the file's name, its
 * columns, and the statement that produces its rows.
 *
 * `read` TAKES THE TRANSACTION CLIENT AND IS THE OWNING SERVICE'S OWN STATEMENT.
 * No caller of this function may derive a value: this file chooses no column,
 * computes nothing and knows nothing about any domain.
 */
export type CsvExportRequest<Row> = {
  readonly scope: ReportExportScope;
  readonly filePrefix: string;
  readonly columns: readonly CsvColumn<Row>[];
  readonly read: (tx: Prisma.TransactionClient) => Promise<Row[]>;
};

export async function runAuditedCsvExport<Row>(
  deps: CsvExportDeps,
  request: CsvExportRequest<Row>,
  actor: ResolvedSession,
  context: RequestContext,
): Promise<ReportExportFile> {
  return deps.prisma.$transaction(
    async (tx) => {
      const rows = await request.read(tx);

      await deps.audit.record(tx, actorContext(actor, context), {
        action: 'report.exported',
        // An export changes no row and therefore names none: `entity_id` is
        // null, and the surface is a value in the payload
        // (`audit/audit-actions.ts`).
        entityType: 'report',
        metadata: reportExportAudit(request.scope, rows.length),
      });

      return {
        filename: csvFilename(request.filePrefix, request.scope.range),
        csv: toCsv(request.columns, rows),
        rowCount: rows.length,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

/**
 * The download headers, set once for every CSV route in the system.
 *
 * THE FILENAME IS THE SERVER'S AND IS ASCII (`csvFilename`), so it survives a
 * header intact in every browser without RFC 5987 encoding that products
 * implement inconsistently. It is quoted, and it is built from a fixed prefix
 * and two validated ISO dates — no caller-supplied text reaches it, so there is
 * nothing in it that could break out of the quotes.
 *
 * `text/csv; charset=utf-8` WITH AN ATTACHMENT DISPOSITION, so a browser saves
 * the file rather than rendering it, and `X-Content-Type-Options: nosniff` so
 * nothing re-interprets bytes a family's own name contributed to. The global
 * `NoStoreInterceptor` has already set `Cache-Control: no-store` and
 * `Referrer-Policy: no-referrer` — these routes are not public, and a downloaded
 * financial file is the last thing that may sit in a proxy.
 */
export function sendCsvFile(response: Response, file: ReportExportFile): string {
  response.setHeader('content-type', 'text/csv; charset=utf-8');
  response.setHeader('content-disposition', `attachment; filename="${file.filename}"`);
  response.setHeader('x-content-type-options', 'nosniff');

  return file.csv;
}
