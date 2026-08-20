import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  closeSettlementPeriodRequestSchema,
  settlementPeriodListQuerySchema,
  type CloseSettlementPeriodRequest,
  type CloseSettlementPeriodResponse,
  type SettlementPeriodDetailResponse,
  type SettlementPeriodListQuery,
  type SettlementPeriodListResponse,
} from '@clinic/contracts';
import { RequirePermissions } from '../../auth/decorators/endpoint-access';
import { Ctx, CurrentSession } from '../../auth/decorators/request.decorators';
import type { RequestContext, ResolvedSession } from '../../common/request-context';
import { ZodBodyPipe } from '../../common/zod-validation.pipe';
import { SettlementCloseService } from './settlement-close.service';

/**
 * Closed settlement periods (Milestone 8, checkpoint C6).
 *
 * TWO ROUTES, AND THERE ARE ONLY EVER TWO. A period is created by closing it and
 * read afterwards; there is NO update route, NO delete route and NO reopen
 * route, and none of the three is an oversight. A closed period is immutable and
 * is never reopened — a figure that can be reopened is a figure that was never
 * agreed — so the capability is absent from the frozen contract, from the
 * service, from this controller and from the database, which refuses every
 * UPDATE on both tables outright.
 *
 * CLOSING IS ITS OWN AUTHORITY. `settlement.close` is held by the manager alone,
 * and it is deliberately not folded into `settlement.rate` or
 * `settlement.void_rating`: closing is IRREVERSIBLE in a way neither of those is
 * — a wrong rating is corrected, a wrong close is permanent — so the authority
 * to perform it is granted separately.
 *
 * THE RECEPTIONIST IS REFUSED WHOLE, on both routes. They hold none of the
 * settlement permissions and `PermissionsGuard` rejects the request before any
 * service runs. There is deliberately no redacted variant with the money
 * removed: these routes are financial in their entirety, so there is no useful
 * partial response to give somebody who may not read them. The same line
 * `FinancialReportsController` and `SettlementStatementController` draw.
 *
 * THERE IS NO THERAPIST-FACING ROUTE AND NO THERAPIST LOGIN ANYWHERE IN THE
 * PRODUCT. A therapist sees their closed period because a manager shows it to
 * them.
 *
 * NOTHING HERE RECORDS A PAYOUT. No route accepts, returns or implies money
 * leaving the clinic; `settled` means "closed off in a period", never "paid".
 */
@Controller('settlement/periods')
export class SettlementPeriodsController {
  constructor(private readonly periods: SettlementCloseService) {}

  /**
   * Close one therapist's period over one explicit inclusive range.
   *
   * 200 AND AN OUTCOME, NOT 201 — the shape `POST /session-charges` already
   * uses. A first close answers `CLOSED`; repeating the IDENTICAL request
   * answers `ALREADY_CLOSED` and carries the same period. Nothing was refused in
   * either case, so neither is an error envelope, and the interface still has to
   * say "closed" in one case and "already closed" in the other, which a bare 200
   * could not distinguish.
   *
   * A RANGE THAT MERELY OVERLAPS AN EXISTING PERIOD IS `SETTLEMENT_PERIOD_OVERLAP`
   * AND IS REFUSED WHOLE. It is not trimmed to the free days, not merged with
   * the neighbour and not reinterpreted: overlapping coverage would settle some
   * sessions twice, and silently succeeding is how somebody is paid for one
   * session in two months. GAPS BETWEEN PERIODS ARE PERMITTED and are not an
   * error.
   *
   * THE BODY CARRIES A THERAPIST AND TWO DATES AND NOTHING ELSE. There is no
   * reason field — a close is an ordinary, expected act rather than a correction
   * or an override, and requiring an explanation would train managers to type a
   * word to get past a box — and no amount of any kind: every figure on the
   * period is computed by the server from the recorded facts, never submitted.
   * `strictObject` refuses a request that tries.
   *
   * IT SUCCEEDS WITH UNRATED SESSIONS IN THE RANGE and records how many it left
   * out. There is deliberately no error code for that state.
   */
  @Post()
  @HttpCode(200)
  @RequirePermissions('settlement.close')
  async close(
    @Body(new ZodBodyPipe(closeSettlementPeriodRequestSchema)) body: CloseSettlementPeriodRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<CloseSettlementPeriodResponse> {
    return this.periods.close(body, session, context);
  }

  /**
   * Which periods this therapist has had closed.
   *
   * `settlement.read`, the same authority the statement is read under: this is a
   * read of settlement figures, and closing is what needs the separate one.
   *
   * THE RANGE IS OPTIONAL HERE, unlike on the statement, and when it is given it
   * selects periods that INTERSECT it — a period straddling the boundary is
   * still a fact about the range. `ZodBodyPipe` on the query string, as every
   * other read in this system uses, so an unknown parameter is a 400 rather than
   * a filter that silently did nothing.
   *
   * EVERY FILTER IS AN OPAQUE ID OR A CALENDAR DATE. No name and no free text: a
   * query string reaches the browser history, the `Referer` header and every
   * access log.
   */
  @Get()
  @RequirePermissions('settlement.read')
  async list(
    @Query(new ZodBodyPipe(settlementPeriodListQuerySchema)) query: SettlementPeriodListQuery,
  ): Promise<SettlementPeriodListResponse> {
    return this.periods.list(query);
  }

  /**
   * The materialised lines of ONE closed period.
   *
   * `settlement.read`, the same authority the list and the statement are read
   * under, and manager-only for the same reason: this is the detail BEHIND those
   * aggregates and shows nothing a reader of them could not already total. There
   * is deliberately no therapist-facing variant and no narrowed partial view — a
   * caller without the permission is refused the whole response rather than
   * served a redacted one, which is what stops a reception screen from ever
   * displaying part of somebody's earnings.
   *
   * A `GET` THAT ONLY READS. It opens no write and records no audit entry;
   * looking at a closed period is not an act performed on it, and a closed period
   * is immutable in any case — there is no reopen route here or anywhere.
   */
  @Get(':id/lines')
  @RequirePermissions('settlement.read')
  async detail(@Param('id', ParseUUIDPipe) id: string): Promise<SettlementPeriodDetailResponse> {
    return this.periods.detail(id);
  }
}
