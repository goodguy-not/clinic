import Link from 'next/link';
import type { Payment, PaymentListQuery, PaymentListResponse } from '@clinic/contracts';
import { Badge, ButtonLink, EmptyState, Panel, SubmitButton } from '@/components/ui';
import { FamilyMoneyNavigation } from '@/components/family-money-navigation';
import { CONTROL_CLASS, FOCUS_RING } from '@/components/styles';
import {
  PAYMENT_METHOD_PRESENTATION,
  PAYMENT_STATUS_PRESENTATION,
  formatMoneyDate,
} from '@/payments/presentation';
import { COPY } from '@/server/copy-fa';
import { formatToman, toPersianDigits } from '@/server/numerals-fa';

const PERSIAN_INSTANT = new Intl.DateTimeFormat('fa-IR-u-ca-persian-nu-arabext', {
  calendar: 'persian',
  timeZone: 'Asia/Tehran',
  dateStyle: 'medium',
  timeStyle: 'short',
  hourCycle: 'h23',
});

export function buildPaymentsHref(familyId: string, query: PaymentListQuery, page: number): string {
  const search = new URLSearchParams({
    page: String(page),
    pageSize: String(query.pageSize),
    includeVoided: String(query.includeVoided),
  });
  if (query.from !== undefined) search.set('from', query.from);
  if (query.to !== undefined) search.set('to', query.to);
  return `/families/${encodeURIComponent(familyId)}/payments?${search.toString()}`;
}

export function PaymentHistory({
  familyId,
  result,
  query,
  csrfToken,
  canVoid,
}: {
  familyId: string;
  result: PaymentListResponse;
  query: PaymentListQuery;
  csrfToken: string;
  canVoid: boolean;
}) {
  return (
    <>
      <FamilyMoneyNavigation familyId={familyId} active="payments" />

      <Panel title={COPY.paymentFiltersTitle}>
        <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex min-w-64 flex-col gap-1.5 text-sm font-semibold text-slate-900">
            نمایش موارد باطل‌شده
            <select
              name="includeVoided"
              defaultValue={String(query.includeVoided)}
              className={CONTROL_CLASS}
            >
              <option value="true">نمایش کامل تاریخچه</option>
              <option value="false">فقط پرداخت‌های تأییدشده</option>
            </select>
          </label>
          <input type="hidden" name="pageSize" value={query.pageSize} />
          <div className="flex flex-wrap gap-2">
            <SubmitButton>اعمال فیلتر</SubmitButton>
            <ButtonLink href={`/families/${familyId}/payments`} tone="secondary">
              پاک کردن فیلترها
            </ButtonLink>
          </div>
        </form>
      </Panel>

      <section aria-labelledby="payment-history-list" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="payment-history-list" className="text-lg font-bold text-slate-950">
            {COPY.paymentHistoryTitle}
          </h2>
          <p className="text-sm text-slate-600">
            صفحه {toPersianDigits(String(result.page.page))} ·{' '}
            {toPersianDigits(String(result.page.total))} ردیف
          </p>
        </div>

        {result.payments.length === 0 ? (
          <EmptyState message={COPY.paymentHistoryEmpty} />
        ) : (
          <ol className="flex list-none flex-col gap-4 p-0">
            {result.payments.map((payment) => (
              <PaymentCard
                key={payment.id}
                payment={payment}
                familyId={familyId}
                csrfToken={csrfToken}
                canVoid={canVoid}
              />
            ))}
          </ol>
        )}

        <nav aria-label="صفحه‌بندی پرداخت‌ها" className="flex items-center justify-between gap-3">
          {result.page.page > 1 ? (
            <PageLink href={buildPaymentsHref(familyId, query, result.page.page - 1)}>
              صفحهٔ قبل
            </PageLink>
          ) : (
            <span />
          )}
          {result.page.hasMore ? (
            <PageLink href={buildPaymentsHref(familyId, query, result.page.page + 1)}>
              صفحهٔ بعد
            </PageLink>
          ) : (
            <span />
          )}
        </nav>
      </section>
    </>
  );
}

function PaymentCard({
  payment,
  familyId,
  csrfToken,
  canVoid,
}: {
  payment: Payment;
  familyId: string;
  csrfToken: string;
  canVoid: boolean;
}) {
  const status = PAYMENT_STATUS_PRESENTATION[payment.status];
  const method = PAYMENT_METHOD_PRESENTATION[payment.method];
  const voided = payment.status === 'VOIDED';

  return (
    <li
      className={`overflow-hidden rounded-xl border shadow-sm ${voided ? 'border-red-300 bg-slate-50' : 'border-slate-200 bg-white'}`}
    >
      <article>
        <header className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3
                className={`text-xl font-black tabular-nums ${voided ? 'line-through decoration-2' : ''}`}
              >
                <bdi>{formatToman(payment.amountToman)}</bdi>
              </h3>
              <Badge tone={status.tone}>
                {voided ? '⊘ ' : '✓ '}
                {status.label}
              </Badge>
            </div>
            <p className="mt-1 text-sm font-semibold text-slate-700">
              <span aria-hidden="true">{method.glyph} </span>
              {method.label}
              <span aria-hidden="true"> · </span>
              تاریخ دریافت: {formatMoneyDate(payment.receivedOn)}
            </p>
          </div>
          {payment.reference !== null ? (
            <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
              {COPY.paymentReference}: <bdi className="font-semibold">{payment.reference}</bdi>
            </p>
          ) : null}
        </header>

        {voided ? (
          <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-950">
            <p className="font-bold">
              <span aria-hidden="true">⊘ </span>
              {COPY.paymentVoidedNoEffect}
            </p>
            <p>
              {COPY.paymentVoidReason}: {payment.voidReason}
            </p>
            <p>
              {COPY.paymentVoidedAt}: {formatInstant(payment.voidedAt!)}
            </p>
            <p>
              {COPY.paymentVoidedBy}: <bdi>{payment.voidedByUserId}</bdi>
            </p>
          </div>
        ) : null}

        <div className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="flex flex-col gap-2 text-sm text-slate-700">
            {payment.note !== null ? (
              <p>
                <span className="font-semibold">{COPY.paymentNote}:</span> {payment.note}
              </p>
            ) : null}
            <p>
              {COPY.paymentRecordedAt}: {formatInstant(payment.createdAt)}
              <span aria-hidden="true"> · </span>
              {COPY.paymentRecordedBy}: <bdi>{payment.createdByUserId}</bdi>
            </p>
          </div>

          {canVoid && !voided ? (
            <details className="rounded-lg border border-red-200 bg-white p-3 md:max-w-sm">
              <summary className={`cursor-pointer text-sm font-bold text-red-800 ${FOCUS_RING}`}>
                {COPY.paymentVoidTitle}
              </summary>
              <p className="mt-3 text-xs leading-6 text-slate-600">{COPY.paymentVoidHelp}</p>
              <form action="/api/payments/void" method="post" className="mt-3 flex flex-col gap-3">
                <input type="hidden" name="familyId" value={familyId} />
                <input type="hidden" name="paymentId" value={payment.id} />
                <input type="hidden" name="csrfToken" value={csrfToken} />
                <label className="flex flex-col gap-1.5 text-sm font-semibold text-slate-900">
                  {COPY.paymentVoidReason}
                  <span className="sr-only"> برای {formatToman(payment.amountToman)}</span>
                  <textarea
                    name="reason"
                    required
                    maxLength={500}
                    rows={2}
                    className={CONTROL_CLASS}
                  />
                </label>
                <SubmitButton tone="danger">{COPY.paymentVoidAction}</SubmitButton>
              </form>
            </details>
          ) : null}
        </div>
      </article>
    </li>
  );
}

function PageLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className={`rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-brand-800 ${FOCUS_RING}`}
    >
      {children}
    </Link>
  );
}

function formatInstant(value: string): string {
  return PERSIAN_INSTANT.format(new Date(value));
}
