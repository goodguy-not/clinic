import Link from 'next/link';
import { therapistActivityQuerySchema } from '@clinic/contracts';
import { AppHeader } from '@/components/app-header';
import { Alert, EmptyState, PageHeader, PageShell } from '@/components/ui';
import { api } from '@/server/api-client';
import {
  callerContext,
  readCsrfCookie,
  readSessionToken,
  requireSession,
} from '@/server/auth-session';
import { persianMessage } from '@/server/errors-fa';
import { toPersianDigits } from '@/server/numerals-fa';
import {
  dateLabel,
  defaultRange,
  exportFilters,
  one,
  type SearchParams,
  uuidParam,
} from '../report-server';
import { ReportActions } from '../report-actions';
import {
  MetricGrid,
  ReportFilters,
  ReportNavigation,
  ReportPrintContext,
  ReportTable,
  SelectField,
  TD,
  TH,
} from '../report-ui';

export const dynamic = 'force-dynamic';

export default async function TherapistActivityPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireSession({ requirePermission: 'appointment.read' });
  const params = await searchParams;
  const range = defaultRange(params);
  const therapistId = uuidParam(params, 'therapistId');
  const serviceId = uuidParam(params, 'serviceId');
  const includeInactive = one(params, 'includeInactive') === 'true';
  const query = therapistActivityQuerySchema.parse({
    from: range.from,
    to: range.to,
    ...(therapistId ? { therapistId } : {}),
    ...(serviceId ? { serviceId } : {}),
    includeInactive: String(includeInactive),
  });
  const token = await readSessionToken();
  const context = await callerContext(token ?? undefined);
  const [result, therapists, services] = await Promise.all([
    api.therapistActivityReport(query, context),
    api.listTherapists(context),
    api.listServices(context),
  ]);
  const csrfToken = (await readCsrfCookie()) ?? '';
  return (
    <>
      <AppHeader />
      <PageShell wide>
        <PageHeader
          title="گزارش فعالیت درمانگران"
          description={`شمارش و مدت فعالیت عملیاتی بر پایهٔ تاریخ جلسه · ${dateLabel(range.from)} تا ${dateLabel(range.to)} · این گزارش مالی یا تسویه نیست.`}
          action={
            <ReportActions
              exportRequest={
                user.permissions.includes('report.export')
                  ? { kind: 'therapist-activity', filters: exportFilters(query), csrfToken }
                  : undefined
              }
              scopeLabel={`${dateLabel(range.from)} تا ${dateLabel(range.to)}`}
            />
          }
        />
        <ReportPrintContext
          items={[
            `بازه: ${dateLabel(range.from)} تا ${dateLabel(range.to)}`,
            `درمانگر: ${query.therapistId ? ((therapists.ok ? therapists.data.therapists.find((x) => x.id === query.therapistId)?.fullName : undefined) ?? 'انتخاب‌شده') : 'همه'}`,
            `خدمت: ${query.serviceId ? ((services.ok ? services.data.services.find((x) => x.id === query.serviceId)?.name : undefined) ?? 'انتخاب‌شده') : 'همه'}`,
            `درمانگران غیرفعال بدون فعالیت: ${query.includeInactive ? 'نمایش داده می‌شوند' : 'نمایش داده نمی‌شوند'}`,
          ]}
        />
        <ReportNavigation
          active="/reports/therapist-activity"
          showFinancial={user.permissions.includes('report.read_financial')}
        />
        <ReportFilters
          kind="therapist-activity"
          from={range.fromJalali}
          to={range.toJalali}
          csrfToken={csrfToken}
          active={therapistId !== undefined || serviceId !== undefined || includeInactive}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SelectField label="درمانگر" name="therapistId" value={query.therapistId}>
              <option value="">همهٔ درمانگران</option>
              {(therapists.ok ? therapists.data.therapists : []).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.fullName}
                </option>
              ))}
            </SelectField>
            <SelectField label="خدمت" name="serviceId" value={query.serviceId}>
              <option value="">همهٔ خدمات</option>
              {(services.ok ? services.data.services : []).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </SelectField>
            <label className="flex min-h-11 items-center gap-2 self-end rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">
              <input
                type="checkbox"
                name="includeInactive"
                value="true"
                defaultChecked={includeInactive}
                className="size-4 accent-brand-700"
              />
              نمایش درمانگران غیرفعال بدون فعالیت
            </label>
          </div>
        </ReportFilters>
        {!result.ok ? (
          <>
            <Alert>{persianMessage(result.code)}</Alert>
            <EmptyState message="گزارش فعالیت درمانگران بارگیری نشد. دوباره تلاش کنید." />
          </>
        ) : (
          <>
            <MetricGrid
              items={[
                ['درمانگر', result.data.totals.therapistCount],
                ['برنامه‌ریزی‌شده', result.data.totals.scheduledCount],
                ['انجام‌شده', result.data.totals.completedCount],
                ['لغوشده', result.data.totals.cancelledCount],
                ['حاضر', result.data.totals.attendedCount],
                ['عدم حضور', result.data.totals.noShowCount],
                ['نتیجهٔ معوق', result.data.totals.unresolvedOutcomeCount],
                ['دقایق حضور', result.data.totals.attendedDurationMinutes],
              ]}
            />
            {result.data.therapists.length === 0 ? (
              <EmptyState message="در این بازه و با فیلترهای انتخاب‌شده فعالیتی برای نمایش وجود ندارد." />
            ) : (
              <ReportTable label="ردیف‌های فعالیت درمانگران">
                <thead>
                  <tr>
                    <th className={TH}>درمانگر</th>
                    <th className={TH}>برنامه‌ریزی‌شده</th>
                    <th className={TH}>انجام‌شده</th>
                    <th className={TH}>لغوشده</th>
                    <th className={TH}>حاضر</th>
                    <th className={TH}>عدم حضور</th>
                    <th className={TH}>نتیجهٔ معوق</th>
                    <th className={TH}>مدت حضور</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.therapists.map((row) => (
                    <tr key={row.therapist.id} className="hover:bg-slate-50">
                      <td className={TD}>
                        <Link
                          className="font-semibold text-brand-800 hover:underline"
                          href={`/therapists/${row.therapist.id}/edit`}
                        >
                          {row.therapist.fullName}
                        </Link>
                      </td>
                      {[
                        row.scheduledCount,
                        row.completedCount,
                        row.cancelledCount,
                        row.attendedCount,
                        row.noShowCount,
                        row.unresolvedOutcomeCount,
                      ].map((value, index) => (
                        <td key={index} className={`${TD} tabular-nums`}>
                          {toPersianDigits(String(value))}
                        </td>
                      ))}
                      <td className={`${TD} tabular-nums`}>
                        {toPersianDigits(String(row.attendedDurationMinutes))} دقیقه
                      </td>
                    </tr>
                  ))}
                </tbody>
              </ReportTable>
            )}
          </>
        )}
      </PageShell>
    </>
  );
}
