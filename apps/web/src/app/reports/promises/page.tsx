import Link from 'next/link';
import { PROMISE_STATUSES, promiseReportQuerySchema } from '@clinic/contracts';
import { AppHeader } from '@/components/app-header';
import { Alert, Badge, EmptyState, PageHeader, PageShell } from '@/components/ui';
import { PROMISE_STATUS_PRESENTATION } from '@/payments/presentation';
import { api } from '@/server/api-client';
import {
  callerContext,
  readCsrfCookie,
  readSessionToken,
  requireSession,
} from '@/server/auth-session';
import { persianMessage } from '@/server/errors-fa';
import { formatToman } from '@/server/numerals-fa';
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
  MetricGrid,
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

export default async function PromisesReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireSession({ requirePermission: 'promise.read' });
  const params = await searchParams;
  const range = defaultRange(params);
  const familyId = uuidParam(params, 'familyId');
  const status = PROMISE_STATUSES.includes(one(params, 'status') as never)
    ? one(params, 'status')
    : undefined;
  const query = promiseReportQuerySchema.parse({
    from: range.from,
    to: range.to,
    page: intParam(params, 'page', 1),
    pageSize: 25,
    ...(familyId ? { familyId } : {}),
    ...(status ? { status } : {}),
  });
  const token = await readSessionToken();
  const result = await api.promiseReport(query, await callerContext(token ?? undefined));
  const csrfToken = (await readCsrfCookie()) ?? '';
  return (
    <>
      <AppHeader />
      <PageShell wide>
        <PageHeader
          title="گزارش قول‌های پرداخت"
          description={`پیگیری عملیاتی بر پایهٔ تاریخ سررسید · ${dateLabel(range.from)} تا ${dateLabel(range.to)} · قول پرداخت، پرداخت یا ماندهٔ خانواده نیست.`}
          action={
            <ReportActions
              exportRequest={
                user.permissions.includes('report.export')
                  ? { kind: 'promises', filters: exportFilters(query), csrfToken }
                  : undefined
              }
              scopeLabel={`${dateLabel(range.from)} تا ${dateLabel(range.to)}`}
            />
          }
        />
        <ReportPrintContext
          items={[
            `بازهٔ سررسید: ${dateLabel(range.from)} تا ${dateLabel(range.to)}`,
            familyId ? 'خانواده: انتخاب‌شده' : 'خانواده: همه',
            `وضعیت: ${query.status ? PROMISE_STATUS_PRESENTATION[query.status].label : 'همه'}`,
          ]}
        />
        <ReportNavigation
          active="/reports/promises"
          showFinancial={user.permissions.includes('report.read_financial')}
        />
        <ReportFilters
          kind="promises"
          from={range.fromJalali}
          to={range.toJalali}
          csrfToken={csrfToken}
          active={status !== undefined || familyId !== undefined}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SelectField label="وضعیت اعلام‌شده توسط سرور" name="status" value={query.status}>
              <option value="">همهٔ وضعیت‌ها</option>
              {PROMISE_STATUSES.map((x) => (
                <option key={x} value={x}>
                  {PROMISE_STATUS_PRESENTATION[x].label}
                </option>
              ))}
            </SelectField>
          </div>
        </ReportFilters>
        {!result.ok ? (
          <>
            <Alert>{persianMessage(result.code)}</Alert>
            <EmptyState message="گزارش قول‌ها بارگیری نشد. دوباره تلاش کنید." />
          </>
        ) : (
          <>
            <MetricGrid
              items={[
                ['کل قول‌ها', result.data.summary.total],
                ['باز و در موعد', result.data.summary.open],
                ['سررسید گذشته', result.data.summary.missed],
                ['انجام‌شده', result.data.summary.fulfilled],
                ['موکول‌شده', result.data.summary.rescheduled],
                ['لغوشده', result.data.summary.cancelled],
              ]}
            />
            {result.data.promises.length === 0 ? (
              <EmptyState message="در این بازه و با فیلترهای انتخاب‌شده قولی وجود ندارد." />
            ) : (
              <ReportTable label="ردیف‌های گزارش قول‌های پرداخت">
                <thead>
                  <tr>
                    <th className={TH}>خانواده</th>
                    <th className={TH}>مبلغ همان قول</th>
                    <th className={TH}>سررسید</th>
                    <th className={TH}>وضعیت</th>
                    <th className={TH}>زمان ثبت / تعیین‌تکلیف</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.promises.map((row) => {
                    const p = PROMISE_STATUS_PRESENTATION[row.status];
                    return (
                      <tr key={row.id} className="hover:bg-slate-50">
                        <td className={TD}>
                          <Link
                            className="font-semibold text-brand-800 hover:underline"
                            href={`/families/${row.family.id}/promises#promise-${row.id}`}
                          >
                            {row.family.familyName}
                          </Link>
                        </td>
                        <td className={TD}>
                          <bdi>{formatToman(row.amountToman)}</bdi>
                          <div className="mt-1 text-xs text-slate-500">
                            فقط مبلغ ثبت‌شدهٔ این قول
                          </div>
                        </td>
                        <td className={TD}>{dateLabel(row.dueOn)}</td>
                        <td className={TD}>
                          <Badge tone={p.tone}>{p.label}</Badge>
                        </td>
                        <td className={TD}>
                          <div>ثبت: {instantLabel(row.createdAt)}</div>
                          {row.resolvedAt ? (
                            <div>تعیین‌تکلیف: {instantLabel(row.resolvedAt)}</div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </ReportTable>
            )}
            <Pagination page={result.data.page} basePath="/reports/promises" query={query} />
          </>
        )}
      </PageShell>
    </>
  );
}
