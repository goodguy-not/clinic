import { Controller, Get, Query } from '@nestjs/common';
import {
  promiseReportQuerySchema,
  sessionReportQuerySchema,
  therapistActivityQuerySchema,
  type PromiseReportQuery,
  type PromiseReportResponse,
  type SessionReportQuery,
  type SessionReportResponse,
  type TherapistActivityQuery,
  type TherapistActivityResponse,
} from '@clinic/contracts';
import { RequirePermissions } from '../auth/decorators/endpoint-access';
import { ZodBodyPipe } from '../common/zod-validation.pipe';
import { PromiseReportService } from './promise-report.service';
import { SessionReportService } from './session-report.service';
import { TherapistActivityService } from './therapist-activity.service';

/**
 * The three OPERATIONAL reports of Milestone 7 (frozen C1, implemented in C3):
 *
 *   GET /reports/sessions
 *   GET /reports/promises
 *   GET /reports/therapist-activity
 *
 * THEY SHARE A PREFIX AND NOT AN AUTHORITY. Each route names exactly what it
 * reads, and the three named here are authorities BOTH ROLES ALREADY HOLD — the
 * diary and the promise workflow, read over a range instead of a day. That is the
 * accepted Milestone 7 boundary: operational reporting is shared, clinic-wide
 * FINANCIAL reporting is the manager's, and the financial reports arrive under
 * their own authorities in C4.
 *
 * NO NEW `report.*` PERMISSION IS INTRODUCED AND NO EXISTING ONE IS WIDENED. The
 * two names Milestone 7 added — `report.read_financial` and `report.export` —
 * stay with the manager and are not consulted by any route here, because none of
 * these three reads a single field of money. `report.read_financial` is exactly
 * why the session report carries no price and the therapist activity report no
 * share: if an operational report ever needs it, the report has stopped being
 * operational.
 *
 * ONE PERMISSION EACH, SO NO SHARED CONSTANT IS DECLARED. The lists in
 * `@clinic/contracts` — `DASHBOARD_READ_PERMISSIONS` and the two report ones —
 * exist because a route demanding SEVERAL authorities has to be named identically
 * by the page that renders it. A single permission cannot drift from itself, and
 * inventing a one-element constant would suggest the set is expected to grow.
 *
 * `appointment.read` FOR TWO OF THEM. The session report and the therapist
 * activity report state diary facts and nothing else: the booking, the seat, the
 * attendance, the durations and the names an interface prints instead of a uuid.
 * A person holding `appointment.read` can already read every one of those a day
 * at a time through `/appointment-day`; these routes save them the paging. No
 * charge, tariff or payment table is touched by either service, so — unlike the
 * dashboard, which names `charge.read` because it reads `session_charge` — there
 * is no second kind of fact to name.
 *
 * `promise.read` FOR THE PROMISE REPORT, for the same reason read the same way:
 * it reads `payment_promise` and the family names beside it, chasing an overdue
 * promise is the receptionist's own work, and no payment, charge or balance is
 * read anywhere in it.
 *
 * NOTHING IS AUDITED AND NOTHING IS CACHED. `audit_log` is append-only and
 * permanent, and copying a READ into it would build a second, undeletable store
 * of who was seen and what was promised, growing with every refresh. Audit
 * records ACTS, and these routes perform none. The global `NoStoreInterceptor`
 * keeps responses — which carry family and child names — out of every cache.
 *
 * THEY WRITE NOTHING. No row, no financial fact, no stored aggregate, no
 * reporting table and no materialised view: every figure is derived from
 * Milestone 4 and 6 rows on the request that asks for it.
 */
@Controller('reports')
export class OperationalReportsController {
  constructor(
    private readonly sessions: SessionReportService,
    private readonly promises: PromiseReportService,
    private readonly therapistActivity: TherapistActivityService,
  ) {}

  /**
   * Sessions by date, family, child, therapist, service, room and status
   * (PROJECT_SPEC.md 10).
   *
   * `ZodBodyPipe` on the query string, as the day view, the family account and
   * the dashboard read theirs: one validation system, and a strict schema means
   * an unknown parameter is REFUSED rather than silently ignored — which is what
   * makes "search by the child's name" a rejected request rather than a filter
   * somebody adds later without noticing it reaches every access log.
   *
   * The mandatory range and the "may not end before it starts" rule are the
   * schema's, so a malformed period is `VALIDATION_FAILED` before any statement
   * runs. No maximum span is enforced anywhere.
   */
  @Get('sessions')
  @RequirePermissions('appointment.read')
  async sessionReport(
    @Query(new ZodBodyPipe(sessionReportQuerySchema)) query: SessionReportQuery,
  ): Promise<SessionReportResponse> {
    return this.sessions.report(query);
  }

  /**
   * Promises due, overdue, fulfilled, rescheduled and cancelled, across the
   * whole clinic (PROJECT_SPEC.md 10).
   *
   * `status=MISSED` IS ACCEPTED HERE THOUGH POSTGRESQL HAS NO SUCH VALUE. The
   * five wire statuses partition the result and the server derives the fifth
   * against the clinic's own calendar day; a browser must never compute it.
   */
  @Get('promises')
  @RequirePermissions('promise.read')
  async promiseReport(
    @Query(new ZodBodyPipe(promiseReportQuerySchema)) query: PromiseReportQuery,
  ): Promise<PromiseReportResponse> {
    return this.promises.report(query);
  }

  /**
   * Therapist activity: counts and durations, and no money of any kind
   * (PROJECT_SPEC.md 10 — "therapist activity, without share until rules are
   * approved").
   *
   * UNPAGED BY CONTRACT, so this route takes no `page` or `pageSize` and the
   * strict schema refuses either. A clinic has tens of therapists and the rows
   * are read against one another.
   */
  @Get('therapist-activity')
  @RequirePermissions('appointment.read')
  async therapistActivityReport(
    @Query(new ZodBodyPipe(therapistActivityQuerySchema)) query: TherapistActivityQuery,
  ): Promise<TherapistActivityResponse> {
    return this.therapistActivity.report(query);
  }
}
