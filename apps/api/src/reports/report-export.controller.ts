import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  familyAccountReportExportQuerySchema,
  paymentReportExportQuerySchema,
  promiseReportExportQuerySchema,
  sessionReportExportQuerySchema,
  therapistActivityExportQuerySchema,
  type FamilyAccountReportExportQuery,
  type PaymentReportExportQuery,
  type PromiseReportExportQuery,
  type SessionReportExportQuery,
  type TherapistActivityExportQuery,
} from '@clinic/contracts';
import { RequirePermissions } from '../auth/decorators/endpoint-access';
import { Ctx, CurrentSession } from '../auth/decorators/request.decorators';
import {
  FAMILY_ACCOUNT_REPORT_EXPORT_PERMISSIONS,
  PAYMENT_REPORT_EXPORT_PERMISSIONS,
  PROMISE_REPORT_EXPORT_PERMISSIONS,
  SESSION_REPORT_EXPORT_PERMISSIONS,
  THERAPIST_ACTIVITY_EXPORT_PERMISSIONS,
} from '../auth/permissions';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { ZodBodyPipe } from '../common/zod-validation.pipe';
import { ReportExportService, type ReportExportFile } from './report-export.service';

/**
 * THE FIVE CSV EXPORTS OF MILESTONE 7 (checkpoint C5):
 *
 *   GET /reports/sessions/export
 *   GET /reports/promises/export
 *   GET /reports/therapist-activity/export
 *   GET /reports/payments/export
 *   GET /reports/family-accounts/export
 *
 * A CONTROLLER OF THEIR OWN, BECAUSE EXPORT IS AN AUTHORITY AND NOT A FORMAT.
 * The operational reads sit in one controller because both roles hold them and
 * the financial reads in another because the manager alone does; these five sit
 * in a third because they share something neither of those does — `report.export`,
 * the authority to carry data out of the building. Keeping them here means the
 * export authority is stated beside the only routes that need it, and a report
 * added to either of the other files cannot become downloadable by accident.
 *
 * MANAGER-ONLY, ALL FIVE, INCLUDING THE THREE OPERATIONAL ONES A RECEPTIONIST
 * READS ALL DAY. That is the frozen owner decision, and it is enforced by
 * `PermissionsGuard` in NestJS on a DIRECT call — never by a hidden button, never
 * by the web tier, and never by a thinner file. Each route names its report's
 * READ authorities as well as `report.export`, so revoking a read takes its
 * export with it and `report.export` alone opens nothing.
 *
 * `/export` AS A SUFFIX ON THE REPORT'S OWN PATH, so the file and the screen are
 * visibly one report asked for in two ways, and the query string is the same
 * query string. The strict export schemas refuse `page` and `pageSize`: a file
 * is the whole filtered result, and a paged download would silently omit the
 * rest of the period.
 *
 * THE RESPONSE IS A FILE, NOT AN ENVELOPE. `text/csv; charset=utf-8` with an
 * attachment disposition, so a browser saves it rather than rendering it, and
 * `X-Content-Type-Options: nosniff` so nothing re-interprets bytes a family's own
 * name contributed to. The global `NoStoreInterceptor` has already set
 * `Cache-Control: no-store` and `Referrer-Policy: no-referrer` — these routes are
 * not public, and a downloaded report of every family's balance is the last thing
 * that may sit in a proxy.
 *
 * ERRORS STAY JSON. `@Res({ passthrough: true })` sets headers and lets NestJS
 * send the body, so a refusal or a validation failure still travels through
 * `ErrorEnvelopeFilter` as the same error envelope every other route answers with
 * — a caller does not receive a `.csv` file containing an error.
 *
 * THE AUDIT ROW IS THE SERVICE'S, in the transaction that read the rows. Nothing
 * about the act is recorded here, because a controller cannot know how many rows
 * a snapshot returned.
 */
@Controller('reports')
export class ReportExportController {
  constructor(private readonly exports: ReportExportService) {}

  @Get('sessions/export')
  @RequirePermissions(...SESSION_REPORT_EXPORT_PERMISSIONS)
  async sessions(
    @Query(new ZodBodyPipe(sessionReportExportQuerySchema)) query: SessionReportExportQuery,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    return send(response, await this.exports.sessions(query, session, context));
  }

  @Get('promises/export')
  @RequirePermissions(...PROMISE_REPORT_EXPORT_PERMISSIONS)
  async promises(
    @Query(new ZodBodyPipe(promiseReportExportQuerySchema)) query: PromiseReportExportQuery,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    return send(response, await this.exports.promises(query, session, context));
  }

  @Get('therapist-activity/export')
  @RequirePermissions(...THERAPIST_ACTIVITY_EXPORT_PERMISSIONS)
  async therapistActivity(
    @Query(new ZodBodyPipe(therapistActivityExportQuerySchema)) query: TherapistActivityExportQuery,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    return send(response, await this.exports.therapistActivity(query, session, context));
  }

  @Get('payments/export')
  @RequirePermissions(...PAYMENT_REPORT_EXPORT_PERMISSIONS)
  async payments(
    @Query(new ZodBodyPipe(paymentReportExportQuerySchema)) query: PaymentReportExportQuery,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    return send(response, await this.exports.payments(query, session, context));
  }

  @Get('family-accounts/export')
  @RequirePermissions(...FAMILY_ACCOUNT_REPORT_EXPORT_PERMISSIONS)
  async familyAccounts(
    @Query(new ZodBodyPipe(familyAccountReportExportQuerySchema))
    query: FamilyAccountReportExportQuery,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    return send(response, await this.exports.familyAccounts(query, session, context));
  }
}

/**
 * The download headers, set once for all five.
 *
 * THE FILENAME IS THE SERVER'S AND IS ASCII (`csvFilename`), so it survives a
 * header intact in every browser without RFC 5987 encoding that products
 * implement inconsistently. It is quoted, and it is built from a fixed prefix and
 * two validated ISO dates — no caller-supplied text reaches it, so there is
 * nothing in it that could break out of the quotes.
 */
function send(response: Response, file: ReportExportFile): string {
  response.setHeader('content-type', 'text/csv; charset=utf-8');
  response.setHeader('content-disposition', `attachment; filename="${file.filename}"`);
  response.setHeader('x-content-type-options', 'nosniff');

  return file.csv;
}
