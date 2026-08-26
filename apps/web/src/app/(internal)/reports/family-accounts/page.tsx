import Link from 'next/link';
import {
  FAMILY_ACCOUNT_STANDINGS,
  FAMILY_ACCOUNT_REPORT_READ_PERMISSIONS,
  familyAccountReportQuerySchema,
  type FamilyAccountStanding,
  type FamilyFinancialPosition,
} from '@clinic/contracts';
import { AppHeader } from '@/components/app-header';
import { Alert, Badge, EmptyState, PageHeader, PageShell } from '@/components/ui';
import { PAYMENT_METHOD_PRESENTATION, formatMoneyDate } from '@/payments/presentation';
import { api } from '@/server/api-client';
import {
  callerContext,
  readCsrfCookie,
  readSessionToken,
  requireSession,
} from '@/server/auth-session';
import { COPY } from '@/server/copy-fa';
import { persianMessage } from '@/server/errors-fa';
import { formatToman, toPersianDigits } from '@/server/numerals-fa';
import { exportFilters, intParam, one, type SearchParams } from '../report-server';
import { ReportActions } from '../report-actions';
import {
  FinancialMetricGrid,
  Pagination,
  ReportNavigation,
  ReportPrintContext,
  ReportTable,
  SelectField,
  TD,
  TH,
} from '../report-ui';

export const dynamic = 'force-dynamic';

const STANDING_LABELS: Record<FamilyAccountStanding, string> = {
  OWING: 'بدهکار',
  IN_CREDIT: 'دارای اعتبار',
  SETTLED: 'بدون مانده',
};

export default async function FamilyAccountsReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireSession({ requirePermission: FAMILY_ACCOUNT_REPORT_READ_PERMISSIONS });
  const params = await searchParams;
  const standing = FAMILY_ACCOUNT_STANDINGS.includes(one(params, 'standing') as never)
    ? one(params, 'standing')
    : undefined;
  const query = familyAccountReportQuerySchema.parse({
    page: intParam(params, 'page', 1),
    pageSize: 25,
    ...(standing ? { standing } : {}),
    ...(one(params, 'includeInactive') === 'true' ? { includeInactive: 'true' } : {}),
  });
  const token = await readSessionToken();
  const result = await api.familyAccountReport(query, await callerContext(token ?? undefined));
  const csrfToken = (await readCsrfCookie()) ?? '';

  return (
    <>
      <AppHeader />
      <PageShell wide>
        <PageHeader
          title="گزارش حساب خانواده‌ها"
          description="جایگاه مالی کل خانواده‌ها؛ بدون بازهٔ زمانی و بدون خالص‌کردن بدهی یک خانواده با اعتبار خانواده‌ای دیگر"
          action={
            <ReportActions
              exportRequest={
                user.permissions.includes('report.export')
                  ? { kind: 'family-accounts', filters: exportFilters(query), csrfToken }
                  : undefined
              }
              scopeLabel="جایگاه فعلی در همهٔ سوابق سامانه"
            />
          }
        />
        <ReportPrintContext
          items={[
            `جایگاه: ${query.standing ? STANDING_LABELS[query.standing] : 'همه'}`,
            `خانواده‌های غیرفعال: ${query.includeInactive ? 'نمایش داده می‌شوند' : 'نمایش داده نمی‌شوند'}`,
            'ارقام جایگاه: همهٔ سوابق نگهداری‌شده در این سامانه',
          ]}
        />
        <ReportNavigation active="/reports/family-accounts" showFinancial />
        <Alert tone="info">
          هر ردیف جایگاه کل خانواده در همهٔ سوابق سامانه است. فیلتر این صفحه فقط خانواده‌ها را
          انتخاب می‌کند و ارقام جایگاه را به یک دوره محدود نمی‌کند.
        </Alert>
        <section
          aria-labelledby="family-account-filters"
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <h2 id="family-account-filters" className="mb-4 text-sm font-bold text-slate-900">
            فیلتر گزارش
          </h2>
          <form method="post" action="/api/reports/filter" className="flex flex-col gap-4">
            <input type="hidden" name="csrfToken" value={csrfToken} />
            <input type="hidden" name="kind" value="family-accounts" />
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField label="جایگاه خانواده" name="standing" value={query.standing}>
                <option value="">همهٔ جایگاه‌ها</option>
                {FAMILY_ACCOUNT_STANDINGS.map((value) => (
                  <option key={value} value={value}>
                    {STANDING_LABELS[value]}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="خانواده‌های غیرفعال"
                name="includeInactive"
                value={String(query.includeInactive)}
              >
                <option value="false">نمایش داده نشود</option>
                <option value="true">نمایش داده شود</option>
              </SelectField>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                className="min-h-11 rounded-lg bg-brand-700 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
              >
                نمایش گزارش
              </button>
              <Link
                href="/reports/family-accounts"
                className="inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
              >
                بازنشانی
              </Link>
            </div>
          </form>
        </section>
        {!result.ok ? (
          <>
            <Alert>{persianMessage(result.code)}</Alert>
            <EmptyState message="گزارش حساب خانواده‌ها بارگیری نشد. دوباره تلاش کنید." />
          </>
        ) : (
          <>
            <section aria-labelledby="family-filtered-totals" className="flex flex-col gap-3">
              <div>
                <h2 id="family-filtered-totals" className="font-bold text-slate-950">
                  خلاصهٔ خانواده‌های همین فیلتر
                </h2>
                <p className="mt-1 text-xs text-slate-600">
                  جمع بدهی و جمع اعتبار عمداً جدا هستند و به یک «ماندهٔ کلینیک» تبدیل نشده‌اند.
                  ارقام برای کل نتیجه‌اند، نه فقط این صفحه.
                </p>
              </div>
              <FinancialMetricGrid
                label="خلاصهٔ حساب خانواده‌های فیلترشده"
                items={[
                  ['تعداد خانواده', toPersianDigits(String(result.data.totals.familyCount))],
                  [
                    'خانوادهٔ بدهکار',
                    toPersianDigits(String(result.data.totals.owingFamilyCount)),
                    'text-amber-950',
                  ],
                  [
                    'جمع مبلغ قابل پرداخت',
                    formatToman(result.data.totals.totalAmountDueToman),
                    'text-amber-950',
                  ],
                  [
                    'جمع اعتبار خانواده‌ها',
                    formatToman(result.data.totals.totalCreditToman),
                    'text-emerald-900',
                  ],
                ]}
              />
              <p className="text-xs text-slate-600">
                {toPersianDigits(String(result.data.totals.inCreditFamilyCount))} خانواده دارای
                اعتبار است.
              </p>
            </section>
            <p className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-sm leading-7 text-slate-800">
              <span aria-hidden="true">ⓘ </span>
              {COPY.familyFinancialPositionHistoricalWarning}
            </p>
            {result.data.families.length === 0 ? (
              <EmptyState message="خانواده‌ای با جایگاه انتخاب‌شده در این گزارش وجود ندارد." />
            ) : (
              <ReportTable label="ردیف‌های گزارش حساب خانواده‌ها">
                <thead>
                  <tr>
                    <th className={TH}>خانواده</th>
                    <th className={TH}>جایگاه کل خانواده</th>
                    <th className={TH}>مبلغ مؤثر / پرداخت</th>
                    <th className={TH}>آخرین پرداخت</th>
                    <th className={TH}>قول‌ها (بدون اثر مالی)</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.families.map((row) => (
                    <tr key={row.family.id} className="hover:bg-slate-50">
                      <td className={TD}>
                        <Link
                          href={`/families/${row.family.id}/account`}
                          className="font-bold text-brand-800 underline-offset-4 hover:underline"
                        >
                          {row.family.familyName}
                        </Link>
                        <span className="mt-1 block text-xs text-slate-500">
                          مشاهدهٔ حساب خانواده
                        </span>
                      </td>
                      <td className={TD}>{positionCell(row.position)}</td>
                      <td className={TD}>
                        <span className="block">
                          مبلغ مؤثر: <bdi>{formatToman(row.position.netChargedTotalToman)}</bdi>
                        </span>
                        <span className="block">
                          پرداخت تأییدشده:{' '}
                          <bdi>{formatToman(row.position.confirmedPaymentTotalToman)}</bdi>
                        </span>
                        <span className="text-xs text-slate-500">
                          {toPersianDigits(String(row.position.paymentCount))} پرداخت ·{' '}
                          {toPersianDigits(String(row.position.voidedPaymentCount))} باطل‌شده
                        </span>
                      </td>
                      <td className={TD}>
                        {row.position.lastPayment === null ? (
                          'پرداختی ثبت نشده است'
                        ) : (
                          <>
                            <bdi className="font-semibold text-slate-900">
                              {formatToman(row.position.lastPayment.amountToman)}
                            </bdi>
                            <span className="block">
                              {PAYMENT_METHOD_PRESENTATION[row.position.lastPayment.method].label}
                            </span>
                            <span className="text-xs text-slate-500">
                              {formatMoneyDate(row.position.lastPayment.receivedOn)}
                            </span>
                          </>
                        )}
                      </td>
                      <td className={TD}>
                        <span className="block">
                          باز و در موعد: {toPersianDigits(String(row.position.openPromiseCount))}
                        </span>
                        <span className="block font-semibold text-red-900">
                          از موعد گذشته: {toPersianDigits(String(row.position.missedPromiseCount))}
                        </span>
                        <span className="text-xs text-slate-500">
                          شمارش قول‌ها مبلغ قابل پرداخت را کم نمی‌کند.
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </ReportTable>
            )}
            <Pagination page={result.data.page} basePath="/reports/family-accounts" query={query} />
          </>
        )}
      </PageShell>
    </>
  );
}

function positionCell(position: FamilyFinancialPosition) {
  if (position.amountDueToman !== '0') {
    return (
      <div className="flex flex-col items-start gap-1">
        <Badge tone="warning">بدهکار — مبلغ قابل پرداخت</Badge>
        <bdi className="font-black text-amber-950">{formatToman(position.amountDueToman)}</bdi>
        <span className="text-xs text-slate-500">اعتبار: {formatToman(position.creditToman)}</span>
      </div>
    );
  }
  if (position.creditToman !== '0') {
    return (
      <div className="flex flex-col items-start gap-1">
        <Badge tone="success">دارای اعتبار — طلب خانواده</Badge>
        <bdi className="font-black text-emerald-900">{formatToman(position.creditToman)}</bdi>
        <span className="text-xs text-slate-500">
          مبلغ قابل پرداخت: {formatToman(position.amountDueToman)}
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <Badge tone="info">بدون مانده</Badge>
      <bdi className="font-black text-slate-900">{formatToman(position.amountDueToman)}</bdi>
      <span className="text-xs text-slate-500">نه بدهی، نه اعتبار</span>
    </div>
  );
}
