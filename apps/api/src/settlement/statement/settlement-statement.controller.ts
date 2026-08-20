import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  settlementStatementExportQuerySchema,
  settlementStatementQuerySchema,
  type SettlementStatementExportQuery,
  type SettlementStatementQuery,
  type SettlementStatementResponse,
} from '@clinic/contracts';
import { RequirePermissions } from '../../auth/decorators/endpoint-access';
import { Ctx, CurrentSession } from '../../auth/decorators/request.decorators';
import { SETTLEMENT_EXPORT_PERMISSIONS } from '../../auth/permissions';
import type { RequestContext, ResolvedSession } from '../../common/request-context';
import { ZodBodyPipe } from '../../common/zod-validation.pipe';
import { sendCsvFile } from '../../reports/csv-export';
import { SettlementStatementExportService } from './settlement-statement-export.service';
import { SettlementStatementService } from './settlement-statement.service';

/**
 * `GET /settlement/statement` — one therapist's earnings over one explicit range
 * of clinic days (Milestone 8, checkpoint C5).
 *
 * MANAGER-ONLY, AND THE REFUSAL IS THE WHOLE RESPONSE. `settlement.read` is a
 * manager permission and the receptionist has never held it, so a receptionist
 * calling this route is refused by `PermissionsGuard` before any statement runs.
 * There is deliberately NO redacted variant with the money removed: the
 * dashboard's shape — a shared screen whose financial block is manager-only —
 * belongs to a screen both roles need, and this route is financial in its
 * entirety, so there is no useful response to give somebody who may not read it.
 * That is the same line `FinancialReportsController` draws.
 *
 * THERE IS NO THERAPIST-FACING ROUTE AND NO `settlement.read_own`. A therapist
 * has no account in this product, so an authority they could hold would describe
 * a role that cannot log in; a therapist sees their statement because a manager
 * shows it to them.
 *
 * `GET /settlement/statement/export` IS THE SAME QUESTION ASKED FOR A FILE
 * (checkpoint C8), and it is `/export` on this report's own path for the reason
 * the five Milestone 7 files carry that suffix: the file and the screen are
 * visibly one report asked for in two ways, and the query string is the same
 * query string. It demands `SETTLEMENT_EXPORT_PERMISSIONS` — `settlement.read`
 * AND `report.export` — so revoking the read takes the download with it and the
 * export authority alone opens nothing. The receptionist holds neither name and
 * is refused the whole surface by `PermissionsGuard`, on a direct call, before
 * any statement runs.
 *
 * NOTHING IS AUDITED, AND THAT IS THE ACCEPTED FINANCIAL-READ POLICY rather than
 * an omission. `audit_log` is append-only and permanent, and copying a financial
 * READ into it would build a second, undeletable record of who looked at whose
 * earnings, growing with every refresh. Audit records financial ACTS — rating a
 * session, allocating a concession, withdrawing either — and this route performs
 * none. THE EXPORT BELOW IS THE ONE EXCEPTION, and it is the M7 policy applied
 * unchanged: taking the file out of the building is an ACT, so it writes exactly
 * one `report.exported` row recording the scope of the request and no value from
 * the file.
 *
 * IT WRITES NOTHING AND CREATES NO FINANCIAL FACT. No settlement period, no
 * settlement line, no stored aggregate, no materialised view and no cached
 * total: every figure is derived on the request that asks for it, from rows C3
 * and C4 already own. The global `NoStoreInterceptor` keeps the response — which
 * carries a colleague's name and their earnings — out of every cache.
 *
 * A PATH OF ITS OWN, NOT NESTED UNDER `share-rules/` OR `session-charges/`. The
 * statement is a question about a therapist and a period rather than about any
 * one rule or charge, and a distinct path cannot collide with `share-rules/:id`
 * the way a sibling segment could — the reason `share-rule-resolution` sits where
 * it does.
 */
@Controller('settlement')
export class SettlementStatementController {
  constructor(
    private readonly statements: SettlementStatementService,
    private readonly exports: SettlementStatementExportService,
  ) {}

  /**
   * `ZodBodyPipe` on the query string, as every other read in this system uses:
   * one validation system, and a strict schema means an unknown parameter is a
   * `400` rather than a filter that silently did nothing. The therapist and both
   * ends of the range are required, an inverted range is refused by the schema,
   * and there is no maximum span — introducing one would need an approved
   * product decision and measured evidence, not a number written into a route.
   *
   * EVERY FILTER IS AN OPAQUE ID OR A CALENDAR DATE. No name, no free text: a
   * query string reaches the browser history, the `Referer` header and every
   * access log.
   */
  @Get('statement')
  @RequirePermissions('settlement.read')
  async statement(
    @Query(new ZodBodyPipe(settlementStatementQuerySchema)) query: SettlementStatementQuery,
  ): Promise<SettlementStatementResponse> {
    return this.statements.statement(query);
  }

  /**
   * The statement as a file: `GET /settlement/statement/export`.
   *
   * THE SAME SCHEMA AS THE SCREEN, not a copy of it
   * (`settlementStatementExportQuerySchema` is the read's own schema). The
   * statement is not paged, so the file and the screen are the same question
   * with nothing to drop, and one schema is what stops a later filter from
   * reaching one surface and not the other.
   *
   * ERRORS STAY JSON. `@Res({ passthrough: true })` sets the download headers and
   * lets NestJS send the body, so a refusal, a `404` for an unknown therapist or
   * a validation failure still travels through `ErrorEnvelopeFilter` as the same
   * error envelope every other route answers with — a caller never receives a
   * `.csv` file containing an error.
   *
   * THE AUDIT ROW IS THE SERVICE'S, in the transaction that read the lines.
   * Nothing about the act is recorded here, because a controller cannot know how
   * many lines the snapshot returned.
   */
  @Get('statement/export')
  @RequirePermissions(...SETTLEMENT_EXPORT_PERMISSIONS)
  async export(
    @Query(new ZodBodyPipe(settlementStatementExportQuerySchema))
    query: SettlementStatementExportQuery,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    return sendCsvFile(response, await this.exports.statement(query, session, context));
  }
}
