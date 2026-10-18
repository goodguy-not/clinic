import type { Metadata } from 'next';
import { AppHeader } from '@/components/app-header';
import { Alert, EmptyState, PageHeader, PageShell, Panel, SubmitButton } from '@/components/ui';
import { JalaliDateField } from '@/app/(internal)/tariffs/jalali-date-field';
import { api } from '@/server/api-client';
import {
  callerContext,
  readCsrfCookie,
  readSessionToken,
  requireSession,
} from '@/server/auth-session';
import { clinicToday } from '@/server/clinic-time';
import { isoDateToJalali } from '@/server/jalali';
import { isKnownErrorCode } from '@/server/handler-support';
import { persianMessage } from '@/server/errors-fa';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'تسویهٔ سهم درمانگران',
  robots: { index: false, follow: false },
};

export default async function SettlementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession({ requirePermission: 'settlement.read' });
  const [token, params] = await Promise.all([readSessionToken(), searchParams]);
  const result = await api.listTherapists(await callerContext(token ?? undefined));
  const today = clinicToday();
  const date = isoDateToJalali(today)!;
  const error =
    typeof params['error'] === 'string' && isKnownErrorCode(params['error'])
      ? params['error']
      : null;
  return (
    <>
      <AppHeader />
      <PageShell>
        <PageHeader
          title="تسویهٔ سهم درمانگران"
          description="صورت‌تسویه، قواعد سهم و دوره‌های بسته‌شده فقط برای مدیر قابل مشاهده‌اند. تسویه در این بخش به معنی نهایی‌کردن دوره است و ثبت پرداخت نیست."
        />
        {error ? <Alert>{persianMessage(error)}</Alert> : null}
        <Panel title="انتخاب درمانگر و بازه">
          {!result.ok ? (
            <>
              <Alert>{persianMessage(result.code)}</Alert>
              <EmptyState message="فهرست درمانگران بارگیری نشد. دوباره تلاش کنید." />
            </>
          ) : result.data.therapists.length === 0 ? (
            <EmptyState message="هنوز درمانگری ثبت نشده است." />
          ) : (
            <form method="post" action="/api/settlement/view" className="flex flex-col gap-5">
              <input type="hidden" name="csrfToken" value={(await readCsrfCookie()) ?? ''} />
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-slate-900">
                درمانگر
                <select
                  name="therapistId"
                  required
                  className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-base"
                >
                  <option value="">انتخاب کنید</option>
                  {result.data.therapists.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.fullName}
                      {x.status === 'INACTIVE' ? ' · غیرفعال' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <JalaliDateField
                  legend="از تاریخ جلسه"
                  namePrefix="from"
                  value={{ ...date, day: 1 }}
                  required
                />
                <JalaliDateField legend="تا تاریخ جلسه" namePrefix="to" value={date} required />
              </div>
              <div>
                <SubmitButton>نمایش صورت‌تسویه</SubmitButton>
              </div>
            </form>
          )}
        </Panel>
      </PageShell>
    </>
  );
}
