import Link from 'next/link';
import {
  APPOINTMENT_STATUSES,
  ATTENDANCE_OUTCOMES,
  sessionReportQuerySchema,
} from '@clinic/contracts';
import { AppHeader } from '@/components/app-header';
import { Alert, Badge, EmptyState, PageHeader, PageShell } from '@/components/ui';
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
  APPOINTMENT_STATUS_PRESENTATION,
  ATTENDANCE_PRESENTATION,
  appointmentTimeLabel,
} from '@/scheduling/appointment-presentation';
import {
  dateLabel,
  defaultRange,
  intParam,
  one,
  type SearchParams,
  uuidParam,
} from '../report-server';
import {
  MetricGrid,
  Pagination,
  ReportFilters,
  ReportNavigation,
  ReportTable,
  SelectField,
  TD,
  TH,
} from '../report-ui';

export const dynamic = 'force-dynamic';

export default async function SessionsReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireSession({ requirePermission: 'appointment.read' });
  const params = await searchParams;
  const range = defaultRange(params);
  const candidate = {
    from: range.from,
    to: range.to,
    page: intParam(params, 'page', 1),
    pageSize: 25,
    ...ids(params, ['familyId', 'childId', 'therapistId', 'serviceId', 'roomId']),
    ...(APPOINTMENT_STATUSES.includes(one(params, 'status') as never)
      ? { status: one(params, 'status') }
      : {}),
    ...(ATTENDANCE_OUTCOMES.includes(one(params, 'attendance') as never)
      ? { attendance: one(params, 'attendance') }
      : {}),
  };
  const query = sessionReportQuerySchema.parse(candidate);
  const token = await readSessionToken();
  const context = await callerContext(token ?? undefined);
  const [result, therapists, services, rooms] = await Promise.all([
    api.sessionReport(query, context),
    api.listTherapists(context),
    api.listServices(context),
    api.listRooms(context),
  ]);
  const csrfToken = (await readCsrfCookie()) ?? '';

  return (
    <>
      <AppHeader />
      <PageShell wide>
        <PageHeader
          title="گزارش جلسه‌ها"
          description={`فعالیت عملیاتی بر پایهٔ تاریخ جلسه · ${dateLabel(range.from)} تا ${dateLabel(range.to)}`}
        />
        <ReportNavigation active="/reports/sessions" />
        <ReportFilters
          kind="sessions"
          from={range.fromJalali}
          to={range.toJalali}
          csrfToken={csrfToken}
          active={Object.keys(params).some(
            (key) => !['from', 'to', 'page', 'pageSize'].includes(key),
          )}
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
            <SelectField label="اتاق" name="roomId" value={query.roomId}>
              <option value="">همهٔ اتاق‌ها</option>
              {(rooms.ok ? rooms.data.rooms : []).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </SelectField>
            <SelectField label="وضعیت نوبت" name="status" value={query.status}>
              <option value="">همهٔ وضعیت‌ها</option>
              {APPOINTMENT_STATUSES.map((x) => (
                <option key={x} value={x}>
                  {APPOINTMENT_STATUS_PRESENTATION[x].label}
                </option>
              ))}
            </SelectField>
            <SelectField label="نتیجهٔ حضور" name="attendance" value={query.attendance}>
              <option value="">همهٔ نتایج</option>
              {ATTENDANCE_OUTCOMES.map((x) => (
                <option key={x} value={x}>
                  {ATTENDANCE_PRESENTATION[x].label}
                </option>
              ))}
            </SelectField>
          </div>
        </ReportFilters>
        {!result.ok ? (
          <>
            <Alert>{persianMessage(result.code)}</Alert>
            <EmptyState message="گزارش جلسه‌ها بارگیری نشد. فیلترها را بازبینی کنید و دوباره تلاش کنید." />
          </>
        ) : (
          <>
            <MetricGrid
              items={[
                ['کل ردیف‌ها', result.data.summary.total],
                ['برنامه‌ریزی‌شده', result.data.summary.scheduled],
                ['انجام‌شده', result.data.summary.completed],
                ['لغوشده', result.data.summary.cancelled],
                ['حاضر', result.data.summary.attended],
                ['عدم حضور', result.data.summary.noShows],
                ['نتیجهٔ معوق', result.data.summary.unresolvedOutcomes],
                ['دقایق ثبت‌شده', result.data.summary.totalDurationMinutes],
              ]}
            />
            {result.data.sessions.length === 0 ? (
              <EmptyState message="در این بازه و با فیلترهای انتخاب‌شده جلسه‌ای وجود ندارد." />
            ) : (
              <ReportTable label="ردیف‌های گزارش جلسه‌ها">
                <thead>
                  <tr>
                    <th className={TH}>تاریخ و ساعت</th>
                    <th className={TH}>کودک و خانواده</th>
                    <th className={TH}>خدمت</th>
                    <th className={TH}>درمانگر</th>
                    <th className={TH}>اتاق</th>
                    <th className={TH}>وضعیت</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.sessions.map((row) => (
                    <tr key={row.participantId} className="hover:bg-slate-50">
                      <td className={TD}>
                        <Link
                          className="font-semibold text-brand-800 underline-offset-4 hover:underline"
                          href={`/appointments/${row.appointmentId}`}
                        >
                          {dateLabel(row.date)} · {appointmentTimeLabel(row.startsAt)}
                        </Link>
                        <div>{toPersianDigits(String(row.durationMinutes))} دقیقه</div>
                      </td>
                      <td className={TD}>
                        <div className="font-semibold text-slate-900">
                          {row.child.firstName} {row.child.lastName}
                        </div>
                        <Link
                          className="text-brand-800 hover:underline"
                          href={`/families/${row.family.id}`}
                        >
                          {row.family.familyName}
                        </Link>
                      </td>
                      <td className={TD}>{row.service.name}</td>
                      <td className={TD}>{row.therapist.fullName}</td>
                      <td className={TD}>{row.room.name}</td>
                      <td className={TD}>
                        <span className="flex flex-col items-start gap-1">
                          <Badge tone={APPOINTMENT_STATUS_PRESENTATION[row.status].badgeTone}>
                            {APPOINTMENT_STATUS_PRESENTATION[row.status].label}
                          </Badge>
                          <Badge tone={ATTENDANCE_PRESENTATION[row.attendance].tone}>
                            {ATTENDANCE_PRESENTATION[row.attendance].label}
                          </Badge>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </ReportTable>
            )}
            <Pagination page={result.data.page} basePath="/reports/sessions" query={query} />
          </>
        )}
      </PageShell>
    </>
  );
}

function ids(params: SearchParams, keys: string[]): Record<string, string> {
  return Object.fromEntries(
    keys.flatMap((key) => {
      const value = uuidParam(params, key);
      return value ? [[key, value]] : [];
    }),
  );
}
