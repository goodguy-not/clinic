import { Controller, Get, Query } from '@nestjs/common';
import {
  dashboardQuerySchema,
  type DashboardQuery,
  type DashboardResponse,
} from '@clinic/contracts';
import { CurrentSession } from '../auth/decorators/request.decorators';
import { RequirePermissions } from '../auth/decorators/endpoint-access';
import { DASHBOARD_READ_PERMISSIONS } from '../auth/permissions';
import type { ResolvedSession } from '../common/request-context';
import { ZodBodyPipe } from '../common/zod-validation.pipe';
import { DashboardService } from './dashboard.service';

/**
 * The clinic day at a glance: `GET /dashboard` (PROJECT_SPEC.md 10).
 *
 * A PATH OF ITS OWN, like `/appointment-day` and `/catalog/tariff-resolution`.
 * The dashboard is not a report over a range and does not belong under a
 * `/reports` prefix that would imply it takes one; there is exactly one of it,
 * it describes one day, and a range over this shape is a report with a route of
 * its own.
 *
 * THREE OPERATIONAL AUTHORITIES, AND NO NEW ONE (`DASHBOARD_READ_PERMISSIONS`).
 * The screen shows the diary, the promises to chase and the caller's own
 * payments, so it demands `appointment.read`, `payment.read` and `promise.read`
 * — what a receptionist already holds for exactly these facts, read as a day
 * instead of one at a time. Inventing a `dashboard.read` would let a role map
 * grant somebody the summary of rows they may not open.
 *
 * THE FINANCIAL AUTHORITY IS CHECKED BY THE SERVICE, NOT BY THIS DECORATOR, AND
 * THAT IS THE DESIGN RATHER THAN AN OMISSION. `report.read_financial` does not
 * gate the ROUTE — it selects the response VARIANT. A route-level requirement
 * would refuse the receptionist the dashboard entirely; a second route would
 * mean two aggregations of one screen and a second place for the authority rule
 * to drift. So one route decides once, in NestJS, and states its decision on the
 * wire as `financialScope` for the consumer to branch on.
 *
 * THE ENFORCEMENT IS HERE AND NOT IN THE BROWSER. A caller without the financial
 * authority receives a response in which the clinic-wide block does not exist —
 * it is never queried, never assembled and absent from the JSON — so no web
 * rendering decision, feature flag or forgotten null check can expose it.
 *
 * NOTHING IS AUDITED AND NOTHING IS CACHED. `audit_log` is append-only and
 * permanent, and copying a financial READ into it would build a second,
 * undeletable store of who paid what, growing with every refresh of the screen a
 * clinic keeps open all morning; audit records financial ACTS, and this route
 * performs none. The global `NoStoreInterceptor` keeps the response — which
 * carries family names — out of every cache.
 *
 * IT WRITES NOTHING. No row, no financial fact, no stored aggregate: the
 * dashboard is derived from Milestone 4, 5 and 6 rows on the request that asks
 * for it.
 */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /**
   * `ZodBodyPipe` on the query string, as the day view and the family account
   * read theirs: one validation system, and a strict schema means an unknown
   * parameter is refused rather than silently ignored.
   *
   * THE ONLY PARAMETER IS A DATE, AND IT IS OPTIONAL. Omitted, the server uses
   * the clinic's own calendar day in Asia/Tehran — a browser must not compute it
   * — and the response echoes the day that was actually used. There is
   * deliberately no `userId`: the reconciliation block is scoped to the
   * authenticated actor, and `dashboardQuerySchema` being strict is what makes
   * "ask for somebody else's till" a refused request rather than an ignored one.
   */
  @Get()
  @RequirePermissions(...DASHBOARD_READ_PERMISSIONS)
  async get(
    @Query(new ZodBodyPipe(dashboardQuerySchema)) query: DashboardQuery,
    @CurrentSession() session: ResolvedSession,
  ): Promise<DashboardResponse> {
    return this.dashboard.dashboard(query, session);
  }
}
