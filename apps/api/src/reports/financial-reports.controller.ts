import { Controller, Get, Query } from '@nestjs/common';
import {
  familyAccountReportQuerySchema,
  paymentReportQuerySchema,
  type FamilyAccountReportQuery,
  type FamilyAccountReportResponse,
  type PaymentReportQuery,
  type PaymentReportResponse,
} from '@clinic/contracts';
import { RequirePermissions } from '../auth/decorators/endpoint-access';
import {
  FAMILY_ACCOUNT_REPORT_READ_PERMISSIONS,
  PAYMENT_REPORT_READ_PERMISSIONS,
} from '../auth/permissions';
import { ZodBodyPipe } from '../common/zod-validation.pipe';
import { FamilyAccountReportService } from './family-account-report.service';
import { PaymentReportService } from './payment-report.service';

/**
 * The two FINANCIAL reports of Milestone 7 (frozen C1, implemented in C4):
 *
 *   GET /reports/payments
 *   GET /reports/family-accounts
 *
 * MANAGER-ONLY, AND THAT IS WHY THEY ARE A CONTROLLER OF THEIR OWN. The three
 * C3 reports share the `/reports` prefix and are read by both roles because they
 * carry no money at all; these two are clinic-wide financial reporting and
 * per-user financial attribution, which the accepted Milestone 7 decision keeps
 * with the manager. Splitting them is not cosmetic: it means the financial
 * authority is stated beside the only routes that need it, and a later
 * operational report added to the other file cannot inherit it by sitting in the
 * same class.
 *
 * THE REFUSAL IS THE GUARD'S, IN NESTJS, ON THE ROUTE. A receptionist calling
 * either of these directly is refused by `PermissionsGuard` before any service
 * runs — not by a hidden menu item, not by a page-level check in Next, and not
 * by a variant of the response with the money left out. That last one is the
 * dashboard's design and is deliberately NOT copied here: the dashboard is a
 * shared screen whose financial BLOCK is manager-only, while these two routes are
 * financial in their entirety, so there is no useful response to give somebody
 * who may not read them.
 *
 * NO EXISTING PERMISSION IS WIDENED AND NO NEW ONE IS INTRODUCED.
 * `report.read_financial` is the Milestone 7 name the receptionist has never
 * held, and `PAYMENT_REPORT_READ_PERMISSIONS` /
 * `FAMILY_ACCOUNT_REPORT_READ_PERMISSIONS` name it alongside the ordinary read
 * authorities each report's facts already require — `payment.read` for payments,
 * and `charge.read`, `payment.read` and `promise.read` for a position, which is
 * made of all three. Requiring them ALL, rather than the financial name alone,
 * keeps the permission model an accurate description of what the route reads:
 * revoking `payment.read` from somebody has to take their access to payment
 * REPORTS with it.
 *
 * THE LISTS ARE THE CONTRACT'S, re-exported through `auth/permissions`, because
 * the web tier gates the page that renders each response and has to demand
 * exactly what the route demands. One list is the only way the two cannot drift.
 *
 * NOTHING IS AUDITED AND NOTHING IS CACHED. `audit_log` is append-only and
 * permanent, and copying a financial READ into it would build a second,
 * undeletable store of who owes what, growing with every refresh; audit records
 * financial ACTS, and these routes perform none. The global `NoStoreInterceptor`
 * keeps responses — which carry family names, balances and colleagues' names —
 * out of every cache.
 *
 * THEY WRITE NOTHING AND CREATE NO FINANCIAL FACT. No row, no aggregate, no
 * reporting table, no materialised view and no stored balance: both are reads
 * over Milestone 5 and 6 facts, derived on the request that asks for them.
 */
@Controller('reports')
export class FinancialReportsController {
  constructor(
    private readonly payments: PaymentReportService,
    private readonly familyAccounts: FamilyAccountReportService,
  ) {}

  /**
   * Payments by date, method and recording user (PROJECT_SPEC.md 10).
   *
   * `ZodBodyPipe` on the query string, as every other read in this system uses:
   * one validation system, and a strict schema means an unknown parameter is
   * REFUSED rather than silently ignored — which is what makes
   * `recordedByUsername` a rejected request rather than a filter somebody adds
   * later without noticing it reaches every access log.
   *
   * THE MANDATORY, INCLUSIVE RANGE AND THE "MAY NOT END BEFORE IT STARTS" RULE
   * ARE THE SCHEMA'S, so a malformed period is `VALIDATION_FAILED` before any
   * statement runs. No maximum span is enforced anywhere: a clinic asking for a
   * whole year is asking a real question.
   */
  @Get('payments')
  @RequirePermissions(...PAYMENT_REPORT_READ_PERMISSIONS)
  async paymentReport(
    @Query(new ZodBodyPipe(paymentReportQuerySchema)) query: PaymentReportQuery,
  ): Promise<PaymentReportResponse> {
    return this.payments.report(query);
  }

  /**
   * Family accounts: charges, payments, balance, last payment and promise counts,
   * for every family at once (PROJECT_SPEC.md 10).
   *
   * IT TAKES NO DATE RANGE AND THE STRICT SCHEMA REFUSES ONE. A position is not a
   * period, and "the balance as at last month" is a different concept nobody has
   * approved.
   *
   * NO FREE-TEXT FILTER. A family is found by search, which is a POST for exactly
   * the reason a name may not travel in a query string.
   */
  @Get('family-accounts')
  @RequirePermissions(...FAMILY_ACCOUNT_REPORT_READ_PERMISSIONS)
  async familyAccountReport(
    @Query(new ZodBodyPipe(familyAccountReportQuerySchema)) query: FamilyAccountReportQuery,
  ): Promise<FamilyAccountReportResponse> {
    return this.familyAccounts.report(query);
  }
}
