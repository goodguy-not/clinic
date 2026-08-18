import Link from 'next/link';
import type { ReactNode } from 'react';
import { JalaliDateField } from '@/app/tariffs/jalali-date-field';
import { FOCUS_RING } from '@/components/ui';
import type { JalaliParts } from '@/server/jalali';
import { toPersianDigits } from '@/server/numerals-fa';

export const OPERATIONAL_REPORT_LINKS = [
  ['/reports/sessions', 'جلسه‌ها'],
  ['/reports/promises', 'قول‌های پرداخت'],
  ['/reports/therapist-activity', 'فعالیت درمانگران'],
] as const;

export const FINANCIAL_REPORT_LINKS = [
  ['/reports/payments', 'پرداخت‌ها'],
  ['/reports/family-accounts', 'حساب خانواده‌ها'],
] as const;

export function ReportPrintContext({ items }: { items: readonly string[] }) {
  return (
    <section aria-label="محدودهٔ گزارش" className="print-only border-y border-slate-300 py-2">
      <h2 className="text-sm font-bold">محدودهٔ گزارش</h2>
      <p className="text-xs text-slate-700">{items.join(' · ')}</p>
    </section>
  );
}

export function ReportNavigation({
  active,
  showFinancial = false,
}: {
  active: string;
  showFinancial?: boolean;
}) {
  const links = showFinancial
    ? [...OPERATIONAL_REPORT_LINKS, ...FINANCIAL_REPORT_LINKS]
    : OPERATIONAL_REPORT_LINKS;
  return (
    <nav aria-label="گزارش‌های کلینیک" className="print-hide overflow-x-auto pb-1">
      <div className="flex min-w-max gap-2">
        {links.map(([href, label]) => (
          <Link
            key={href}
            href={href}
            aria-current={href === active ? 'page' : undefined}
            className={`rounded-lg border px-4 py-2 text-sm font-semibold ${FOCUS_RING} ${
              href === active
                ? 'border-brand-700 bg-brand-700 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

export function ReportFilters({
  kind,
  from,
  to,
  csrfToken,
  children,
  active,
}: {
  kind: 'sessions' | 'promises' | 'therapist-activity' | 'payments';
  from: JalaliParts;
  to: JalaliParts;
  csrfToken: string;
  children?: ReactNode;
  active: boolean;
}) {
  return (
    <section
      aria-labelledby="report-filters"
      className="print-hide rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 id="report-filters" className="text-sm font-bold text-slate-900">
          فیلتر گزارش
        </h2>
        {active ? (
          <span className="rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold text-brand-900">
            فیلتر فعال است
          </span>
        ) : null}
      </div>
      <form method="post" action="/api/reports/filter" className="flex flex-col gap-5">
        <input type="hidden" name="csrfToken" value={csrfToken} />
        <input type="hidden" name="kind" value={kind} />
        <div className="grid gap-4 lg:grid-cols-2">
          <JalaliDateField legend="از تاریخ" namePrefix="from" value={from} required />
          <JalaliDateField legend="تا تاریخ" namePrefix="to" value={to} required />
        </div>
        {children}
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            className={`min-h-11 rounded-lg bg-brand-700 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-800 ${FOCUS_RING}`}
          >
            نمایش گزارش
          </button>
          <Link
            href={`/reports/${kind}`}
            className={`inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 ${FOCUS_RING}`}
          >
            بازنشانی
          </Link>
        </div>
      </form>
    </section>
  );
}

export function SelectField({
  label,
  name,
  value,
  children,
}: {
  label: string;
  name: string;
  value?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-semibold text-slate-800">
      {label}
      <select
        name={name}
        defaultValue={value ?? ''}
        className={`min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-base ${FOCUS_RING}`}
      >
        {children}
      </select>
    </label>
  );
}

export function MetricGrid({ items }: { items: readonly (readonly [string, number, string?])[] }) {
  return (
    <dl
      aria-label="خلاصهٔ فیلترشده"
      className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8"
    >
      {items.map(([label, value, tone]) => (
        <div
          key={label}
          className="rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-xs"
        >
          <dt className="text-xs leading-5 text-slate-600">{label}</dt>
          <dd className={`mt-1 text-2xl font-black tabular-nums ${tone ?? 'text-slate-950'}`}>
            {toPersianDigits(String(value))}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function FinancialMetricGrid({
  label,
  items,
}: {
  label: string;
  items: readonly (readonly [string, string, string?])[];
}) {
  return (
    <dl aria-label={label} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {items.map(([itemLabel, value, tone]) => (
        <div
          key={itemLabel}
          className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xs"
        >
          <dt className="text-xs leading-5 text-slate-600">{itemLabel}</dt>
          <dd className={`mt-1 text-xl font-black tabular-nums ${tone ?? 'text-slate-950'}`}>
            <bdi>{value}</bdi>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ReportTable({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={`report-table overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm ${FOCUS_RING}`}
    >
      <table className="w-full min-w-[760px] border-collapse text-start text-sm">{children}</table>
    </div>
  );
}

export const TH =
  'border-b border-slate-200 bg-slate-50 px-3 py-3 text-start text-xs font-bold text-slate-700';
export const TD = 'border-b border-slate-100 px-3 py-3 align-top text-slate-700';

export function Pagination({
  page,
  basePath,
  query,
}: {
  page: { page: number; pageSize: number; total: number; hasMore: boolean };
  basePath: string;
  query: Record<string, string | number | boolean | undefined>;
}) {
  const href = (next: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...query, page: next, pageSize: page.pageSize }))
      if (value !== undefined) search.set(key, String(value));
    return `${basePath}?${search.toString()}`;
  };
  return (
    <nav
      aria-label="صفحه‌بندی گزارش"
      className="print-hide flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600"
    >
      <span>
        صفحه {toPersianDigits(String(page.page))} · {toPersianDigits(String(page.total))} ردیف در
        این فیلتر
      </span>
      <span className="flex gap-2">
        {page.page > 1 ? (
          <Link
            className={`rounded-lg border border-slate-300 bg-white px-3 py-2 font-semibold ${FOCUS_RING}`}
            href={href(page.page - 1)}
          >
            صفحهٔ قبل
          </Link>
        ) : null}
        {page.hasMore ? (
          <Link
            className={`rounded-lg border border-slate-300 bg-white px-3 py-2 font-semibold ${FOCUS_RING}`}
            href={href(page.page + 1)}
          >
            صفحهٔ بعد
          </Link>
        ) : null}
      </span>
    </nav>
  );
}
