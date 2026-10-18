import Link from 'next/link';
import {
  PAYMENT_METHODS,
  PAYMENT_REPORT_READ_PERMISSIONS,
  paymentReportQuerySchema,
} from '@clinic/contracts';
import { AppHeader } from '@/components/app-header';
import { Alert, Badge, EmptyState, PageHeader, PageShell } from '@/components/ui';
import { PAYMENT_METHOD_PRESENTATION, PAYMENT_STATUS_PRESENTATION } from '@/payments/presentation';
import { api } from '@/server/api-client';
import {
  callerContext,
  readCsrfCookie,
  readSessionToken,
  requireSession,
} from '@/server/auth-session';
import { persianMessage } from '@/server/errors-fa';
import { formatToman, toPersianDigits } from '@/server/numerals-fa';
import { FamilyReportFilter } from '../family-report-filter';
import {
  dateLabel,
  defaultRange,
  exportFilters,
  instantLabel,
  intParam,
  one,
  type SearchParams,
  uuidParam,
} from '../report-server';
import { ReportActions } from '../report-actions';
import {
  FinancialMetricGrid,
  Pagination,
  ReportFilters,
  ReportNavigation,
  ReportPrintContext,
  ReportTable,
  SelectField,
  TD,
  TH,
} from '../report-ui';

export const dynamic = 'force-dynamic';

export default async function PaymentsReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireSession({ requirePermission: PAYMENT_REPORT_READ_PERMISSIONS });
  const params = await searchParams;
  const range = defaultRange(params);
  const familyId = uuidParam(params, 'familyId');
  const recordedByUserId = uuidParam(params, 'recordedByUserId');
  const method = PAYMENT_METHODS.includes(one(params, 'method') as never)
    ? one(params, 'method')
    : undefined;
  const includeVoided = one(params, 'includeVoided');
  const query = paymentReportQuerySchema.parse({
    from: range.from,
    to: range.to,
    page: intParam(params, 'page', 1),
    pageSize: 25,
    ...(familyId ? { familyId } : {}),
    ...(recordedByUserId ? { recordedByUserId } : {}),
    ...(method ? { method } : {}),
    ...(includeVoided === 'false' ? { includeVoided } : {}),
  });
  const token = await readSessionToken();
  const context = await callerContext(token ?? undefined);
  const [result, users] = await Promise.all([
    api.paymentReport(query, context),
    api.listUsers(context),
  ]);
  const csrfToken = (await readCsrfCookie()) ?? '';
  const reportedRange = result.ok ? result.data.range : { ...range, dateBasis: null };

  return (
    <>
      <AppHeader />
      <PageShell wide>
        <PageHeader
          title="گزارش پرداخت‌ها"
          description={`وجوه دریافتی بر پایهٔ تاریخ دریافت وجه (receivedOn) · ${dateLabel(reportedRange.from)} تا ${dateLabel(reportedRange.to)}`}
          action={
            <ReportActions
              exportRequest={
                user.permissions.includes('report.export')
                  ? { kind: 'payments', filters: exportFilters(query), csrfToken }
                  : undefined
              }
              scopeLabel={`${dateLabel(reportedRange.from)} تا ${dateLabel(reportedRange.to)}`}
            />
          }
        />
        <ReportPrintContext
          items={[
            `بازهٔ دریافت وجه: ${dateLabel(reportedRange.from)} تا ${dateLabel(reportedRange.to)}`,
            query.familyId ? 'خانواده: انتخاب‌شده' : 'خانواده: همه',
            `روش: ${query.method ? PAYMENT_METHOD_PRESENTATION[query.method].label : 'همه'}`,
            `ثبت‌کننده: ${query.recordedByUserId ? ((users.ok ? users.data.users.find((x) => x.id === query.recordedByUserId)?.displayName : undefined) ?? 'انتخاب‌شده') : 'همه'}`,
            `پرداخت‌های باطل‌شده: ${query.includeVoided ? 'نمایش داده می‌شوند' : 'نمایش داده نمی‌شوند'}`,
          ]}
        />
        <ReportNavigation active="/reports/payments" showFinancial />
        <Alert tone="info">
          این بازه با «تاریخ دریافت وجه» سنجیده می‌شود، نه زمان ثبت پرداخت در سامانه. زمان ثبت هر
          ردیف جداگانه نمایش داده شده است.
        </Alert>
        <ReportFilters
          kind="payments"
          from={range.fromJalali}
          to={range.toJalali}
          csrfToken={csrfToken}
          active={Object.keys(params).some(
            (key) => !['from', 'to', 'page', 'pageSize'].includes(key),
          )}
        >
          {familyId ? <input type="hidden" name="familyId" value={familyId} /> : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SelectField label="روش دریافت" name="method" value={query.method}>
              <option value="">همهٔ روش‌ها</option>
              {PAYMENT_METHODS.map((value) => (
                <option key={value} value={value}>
                  {PAYMENT_METHOD_PRESENTATION[value].label}
                </option>
              ))}
            </SelectField>
            <SelectField label="ثبت‌کننده" name="recordedByUserId" value={query.recordedByUserId}>
              <option value="">همهٔ کاربران</option>
              {(users.ok ? users.data.users : []).map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="سوابق باطل‌شده"
              name="includeVoided"
              value={String(query.includeVoided)}
            >
              <option value="true">نمایش داده شود</option>
              <option value="false">پنهان شود</option>
            </SelectField>
          </div>
        </ReportFilters>
        <FamilyReportFilter
          basePath="/reports/payments"
          query={query}
          selectedFamilyId={query.familyId}
        />
        {!result.ok ? (
          <>
            <Alert>{persianMessage(result.code)}</Alert>
            <EmptyState message="گزارش پرداخت‌ها بارگیری نشد. فیلترها را بازبینی کنید و دوباره تلاش کنید." />
          </>
        ) : (
          <>
            <section aria-labelledby="payment-period-totals" className="flex flex-col gap-3">
              <div>
                <h2 id="payment-period-totals" className="font-bold text-slate-950">
                  جمع همین بازه و همین فیلتر
                </h2>
                <p className="mt-1 text-xs text-slate-600">
                  این ارقام برای کل نتیجهٔ فیلترشده‌اند، نه فقط ردیف‌های این صفحه. مبلغ باطل‌شده در
                  جمع دریافتی منظور نشده است.
                </p>
              </div>
              <FinancialMetricGrid
                label="خلاصهٔ پرداخت‌های فیلترشده"
                items={[
                  ['جمع پرداخت تأییدشده', formatToman(result.data.totals.confirmedTotalToman)],
                  [
                    'تعداد پرداخت تأییدشده',
                    toPersianDigits(String(result.data.totals.confirmedCount)),
                  ],
                  [
                    'تعداد پرداخت باطل‌شده',
                    toPersianDigits(String(result.data.totals.voidedCount)),
                    'text-red-900',
                  ],
                ]}
              />
            </section>
            <div className="grid gap-4 lg:grid-cols-2">
              <BreakdownTable
                title="تفکیک روش دریافت"
                rows={result.data.totals.byMethod.map((row) => ({
                  key: row.method,
                  label: PAYMENT_METHOD_PRESENTATION[row.method].label,
                  count: row.confirmedCount,
                  amount: row.confirmedTotalToman,
                }))}
              />
              <BreakdownTable
                title="تفکیک ثبت‌کننده"
                rows={result.data.totals.byUser.map((row) => ({
                  key: row.user.id,
                  label: row.user.displayName,
                  count: row.confirmedCount,
                  amount: row.confirmedTotalToman,
                  voidedCount: row.voidedCount,
                }))}
              />
            </div>
            {result.data.payments.length === 0 ? (
              <EmptyState message="در این بازه و با فیلترهای انتخاب‌شده پرداختی وجود ندارد." />
            ) : (
              <ReportTable label="ردیف‌های گزارش پرداخت‌ها">
                <thead>
                  <tr>
                    <th className={TH}>تاریخ دریافت وجه</th>
                    <th className={TH}>خانواده</th>
                    <th className={TH}>مبلغ و روش</th>
                    <th className={TH}>ثبت در سامانه</th>
                    <th className={TH}>وضعیت</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.payments.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className={TD}>
                        <span className="font-bold text-slate-950">
                          {dateLabel(row.receivedOn)}
                        </span>
                        <span className="block text-xs text-slate-500">مبنای گزارش</span>
                      </td>
                      <td className={TD}>
                        <Link
                          href={`/families/${row.family.id}/account`}
                          className="font-semibold text-brand-800 underline-offset-4 hover:underline"
                        >
                          {row.family.familyName}
                        </Link>
                        <Link
                          href={`/families/${row.family.id}/payments`}
                          className="mt-1 block text-xs text-brand-800 hover:underline"
                        >
                          گردش پرداخت خانواده
                        </Link>
                      </td>
                      <td className={TD}>
                        <bdi className="font-bold text-slate-950">
                          {formatToman(row.amountToman)}
                        </bdi>
                        <span className="block">
                          {PAYMENT_METHOD_PRESENTATION[row.method].label}
                        </span>
                      </td>
                      <td className={TD}>
                        <span className="font-semibold text-slate-900">
                          {row.recordedBy.displayName}
                        </span>
                        <span className="block text-xs text-slate-500">
                          {instantLabel(row.recordedAt)}
                        </span>
                      </td>
                      <td className={TD}>
                        <Badge tone={PAYMENT_STATUS_PRESENTATION[row.status].tone}>
                          {PAYMENT_STATUS_PRESENTATION[row.status].label}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </ReportTable>
            )}
            <Pagination page={result.data.page} basePath="/reports/payments" query={query} />
          </>
        )}
      </PageShell>
    </>
  );
}

function BreakdownTable({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; label: string; count: number; amount: string; voidedCount?: number }[];
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-bold text-slate-900">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-600">ردیفی برای این تفکیک وجود ندارد.</p>
      ) : (
        <dl className="divide-y divide-slate-100">
          {rows.map((row) => (
            <div key={row.key} className="flex items-start justify-between gap-3 py-2 text-sm">
              <dt className="font-semibold text-slate-800">
                {row.label}
                <span className="block text-xs font-normal text-slate-500">
                  {toPersianDigits(String(row.count))} تأییدشده
                  {row.voidedCount === undefined
                    ? ''
                    : ` · ${toPersianDigits(String(row.voidedCount))} باطل‌شده`}
                </span>
              </dt>
              <dd className="font-bold text-slate-950">
                <bdi>{formatToman(row.amount)}</bdi>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
