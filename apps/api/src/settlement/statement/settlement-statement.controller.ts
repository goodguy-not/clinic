import { Controller, Get, Query } from '@nestjs/common';
import {
  settlementStatementQuerySchema,
  type SettlementStatementQuery,
  type SettlementStatementResponse,
} from '@clinic/contracts';
import { RequirePermissions } from '../../auth/decorators/endpoint-access';
import { ZodBodyPipe } from '../../common/zod-validation.pipe';
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
 * NOTHING IS AUDITED, AND THAT IS THE ACCEPTED FINANCIAL-READ POLICY rather than
 * an omission. `audit_log` is append-only and permanent, and copying a financial
 * READ into it would build a second, undeletable record of who looked at whose
 * earnings, growing with every refresh. Audit records financial ACTS — rating a
 * session, allocating a concession, withdrawing either — and this route performs
 * none. The Milestone 7 EXPORT audits, because taking the file out of the
 * building is an act; the export itself is a later checkpoint.
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
  constructor(private readonly statements: SettlementStatementService) {}

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
}
