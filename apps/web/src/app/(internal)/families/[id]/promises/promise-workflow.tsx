import Link from 'next/link';
import type {
  Payment,
  PaymentPromise,
  PromiseListQuery,
  PromiseListResponse,
  PromiseStatus,
} from '@clinic/contracts';
import { JalaliDateField } from '@/app/(internal)/tariffs/jalali-date-field';
import { Badge, ButtonLink, EmptyState, Panel, SubmitButton } from '@/components/ui';
import { CONTROL_CLASS, FOCUS_RING } from '@/components/styles';
import {
  PAYMENT_METHOD_PRESENTATION,
  PAYMENT_STATUS_PRESENTATION,
  PROMISE_STATUS_PRESENTATION,
  formatMoneyDate,
} from '@/payments/presentation';
import type { JalaliParts } from '@/server/jalali';
import { COPY } from '@/server/copy-fa';
import { formatToman, toPersianDigits } from '@/server/numerals-fa';

const STATUS_GLYPH: Record<PromiseStatus, string> = {
  OPEN: '○',
  MISSED: '!',
  FULFILLED: '✓',
  RESCHEDULED: '↪',
  CANCELLED: '—',
};

const PERSIAN_INSTANT = new Intl.DateTimeFormat('fa-IR-u-ca-persian-nu-arabext', {
  calendar: 'persian',
  timeZone: 'Asia/Tehran',
  dateStyle: 'medium',
  timeStyle: 'short',
  hourCycle: 'h23',
});

export function eligibleFulfillmentPayments(
  promise: PaymentPromise,
  payments: Payment[],
): Payment[] {
  const promised = BigInt(promise.amountToman);
  return payments.filter(
    (payment) => payment.status === 'CONFIRMED' && BigInt(payment.amountToman) >= promised,
  );
}

export function buildPromisesHref(familyId: string, query: PromiseListQuery, page: number): string {
  const search = new URLSearchParams({ page: String(page), pageSize: String(query.pageSize) });
  if (query.status !== undefined) search.set('status', query.status);
  return `/families/${encodeURIComponent(familyId)}/promises?${search.toString()}`;
}

export function PromiseWorkflow({
  familyId,
  result,
  query,
  payments,
  csrfToken,
  canResolve,
  clinicTodayJalali,
}: {
  familyId: string;
  result: PromiseListResponse;
  query: PromiseListQuery;
  payments: Payment[];
  csrfToken: string;
  canResolve: boolean;
  clinicTodayJalali: JalaliParts;
}) {
  return (
    <>
      <Panel title={COPY.promiseFiltersTitle}>
        <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex min-w-64 flex-col gap-1.5 text-sm font-semibold text-slate-900">
            وضعیت قول
            <select name="status" defaultValue={query.status ?? ''} className={CONTROL_CLASS}>
              <option value="">همهٔ وضعیت‌ها</option>
              {(Object.keys(PROMISE_STATUS_PRESENTATION) as PromiseStatus[]).map((status) => (
                <option key={status} value={status}>
                  {PROMISE_STATUS_PRESENTATION[status].label}
                </option>
              ))}
            </select>
          </label>
          <input type="hidden" name="pageSize" value={query.pageSize} />
          <div className="flex flex-wrap gap-2">
            <SubmitButton>اعمال فیلتر</SubmitButton>
            <ButtonLink href={`/families/${familyId}/promises`} tone="secondary">
              پاک کردن فیلتر
            </ButtonLink>
          </div>
        </form>
      </Panel>

      <section aria-labelledby="promise-history-list" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="promise-history-list" className="text-lg font-bold text-slate-950">
            {COPY.promiseHistoryTitle}
          </h2>
          <p className="text-sm text-slate-600">
            صفحه {toPersianDigits(String(result.page.page))} ·{' '}
            {toPersianDigits(String(result.page.total))} ردیف
          </p>
        </div>
        {result.promises.length === 0 ? (
          <EmptyState message={COPY.promiseHistoryEmpty} />
        ) : (
          <ol className="flex list-none flex-col gap-4 p-0">
            {result.promises.map((promise) => (
              <PromiseCard
                key={promise.id}
                promise={promise}
                familyId={familyId}
                payments={payments}
                csrfToken={csrfToken}
                canResolve={canResolve}
                clinicTodayJalali={clinicTodayJalali}
              />
            ))}
          </ol>
        )}
        <nav
          aria-label="صفحه‌بندی قول‌های پرداخت"
          className="flex items-center justify-between gap-3"
        >
          {result.page.page > 1 ? (
            <PageLink href={buildPromisesHref(familyId, query, result.page.page - 1)}>
              صفحهٔ قبل
            </PageLink>
          ) : (
            <span />
          )}
          {result.page.hasMore ? (
            <PageLink href={buildPromisesHref(familyId, query, result.page.page + 1)}>
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

function PromiseCard({
  promise,
  familyId,
  payments,
  csrfToken,
  canResolve,
  clinicTodayJalali,
}: {
  promise: PaymentPromise;
  familyId: string;
  payments: Payment[];
  csrfToken: string;
  canResolve: boolean;
  clinicTodayJalali: JalaliParts;
}) {
  const status = PROMISE_STATUS_PRESENTATION[promise.status];
  const actionable = promise.status === 'OPEN' || promise.status === 'MISSED';
  const candidates = eligibleFulfillmentPayments(promise, payments);
  const missed = promise.status === 'MISSED';

  return (
    <li
      id={`promise-${promise.id}`}
      className={`scroll-mt-4 overflow-hidden rounded-xl border shadow-sm ${
        missed ? 'border-amber-400 bg-amber-50/40' : 'border-slate-200 bg-white'
      }`}
    >
      <article>
        <header className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-black tabular-nums text-slate-950">
                <bdi>{formatToman(promise.amountToman)}</bdi>
              </h3>
              <Badge tone={status.tone}>
                <span aria-hidden="true">{STATUS_GLYPH[promise.status]} </span>
                {status.label}
              </Badge>
            </div>
            <p
              className={`mt-1 text-sm font-semibold ${missed ? 'text-amber-950' : 'text-slate-700'}`}
            >
              سررسید: {formatMoneyDate(promise.dueOn)}
            </p>
          </div>
          <p className="text-xs text-slate-600">ثبت: {formatInstant(promise.createdAt)}</p>
        </header>

        {missed ? (
          <p className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
            <span aria-hidden="true">! </span>
            این قول از موعد گذشته و هنوز برای پیگیری باز است.
          </p>
        ) : null}

        <div className="flex flex-col gap-3 p-4 text-sm text-slate-700">
          {promise.note !== null ? (
            <p>
              <span className="font-semibold">یادداشت:</span> {promise.note}
            </p>
          ) : null}
          <p>
            شناسهٔ ثبت‌کننده: <bdi>{promise.createdByUserId}</bdi>
          </p>
          {promise.resolutionReason !== null ? (
            <p>
              <span className="font-semibold">دلیل تعیین‌تکلیف:</span> {promise.resolutionReason}
            </p>
          ) : null}
          {promise.resolvedAt !== null ? (
            <p>
              تعیین‌تکلیف: {formatInstant(promise.resolvedAt)} · شناسهٔ کاربر:{' '}
              <bdi>{promise.resolvedByUserId}</bdi>
            </p>
          ) : null}
          <HistoryLinks promise={promise} />
          {promise.fulfillingPayment !== null ? (
            <FulfillingPayment payment={promise.fulfillingPayment} />
          ) : null}
        </div>

        {canResolve && actionable ? (
          <div className="grid gap-3 border-t border-slate-200 bg-slate-50 p-4 lg:grid-cols-3">
            <FulfillDetails
              familyId={familyId}
              promise={promise}
              candidates={candidates}
              csrfToken={csrfToken}
            />
            <RescheduleDetails
              familyId={familyId}
              promiseId={promise.id}
              csrfToken={csrfToken}
              clinicTodayJalali={clinicTodayJalali}
            />
            <CancelDetails familyId={familyId} promiseId={promise.id} csrfToken={csrfToken} />
          </div>
        ) : null}
      </article>
    </li>
  );
}

function HistoryLinks({ promise }: { promise: PaymentPromise }) {
  return promise.rescheduledFromPromiseId !== null || promise.rescheduledToPromiseId !== null ? (
    <p className="flex flex-wrap gap-2">
      {promise.rescheduledFromPromiseId !== null ? (
        <a
          className={`font-semibold text-brand-800 underline ${FOCUS_RING}`}
          href={`#promise-${promise.rescheduledFromPromiseId}`}
        >
          جایگزین قول قبلی
        </a>
      ) : null}
      {promise.rescheduledToPromiseId !== null ? (
        <a
          className={`font-semibold text-brand-800 underline ${FOCUS_RING}`}
          href={`#promise-${promise.rescheduledToPromiseId}`}
        >
          مشاهدهٔ قول جایگزین
        </a>
      ) : null}
    </p>
  ) : null;
}

function FulfillingPayment({
  payment,
}: {
  payment: NonNullable<PaymentPromise['fulfillingPayment']>;
}) {
  const presentation = PAYMENT_STATUS_PRESENTATION[payment.status];
  const voided = payment.status === 'VOIDED';
  return (
    <div
      className={`rounded-lg border p-3 ${voided ? 'border-red-300 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}
    >
      <p className="font-bold text-slate-950">
        پرداخت پیوندخورده: <bdi>{formatToman(payment.amountToman)}</bdi>{' '}
        <Badge tone={presentation.tone}>
          {voided ? '⊘ ' : '✓ '}
          {presentation.label}
        </Badge>
      </p>
      <p className="mt-1">
        {PAYMENT_METHOD_PRESENTATION[payment.method].label} · {formatMoneyDate(payment.receivedOn)}
      </p>
      {voided ? (
        <p className="mt-2 font-semibold text-red-950">
          این پرداخت بعداً باطل شده است؛ سابقهٔ قول همچنان انجام‌شده باقی مانده است.
        </p>
      ) : null}
    </div>
  );
}

function ActionDetails({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="rounded-lg border border-slate-300 bg-white p-3">
      <summary className={`cursor-pointer font-bold text-slate-900 ${FOCUS_RING}`}>{title}</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function HiddenFields({
  familyId,
  promiseId,
  csrfToken,
}: {
  familyId: string;
  promiseId: string;
  csrfToken: string;
}) {
  return (
    <>
      <input type="hidden" name="familyId" value={familyId} />
      <input type="hidden" name="promiseId" value={promiseId} />
      <input type="hidden" name="csrfToken" value={csrfToken} />
    </>
  );
}

function FulfillDetails({
  familyId,
  promise,
  candidates,
  csrfToken,
}: {
  familyId: string;
  promise: PaymentPromise;
  candidates: Payment[];
  csrfToken: string;
}) {
  return (
    <ActionDetails title={COPY.promiseFulfillTitle}>
      <p className="text-xs leading-6 text-slate-600">{COPY.promiseFulfillHelp}</p>
      {candidates.length === 0 ? (
        <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-950">
          {COPY.promiseNoCandidatePayment}
        </p>
      ) : (
        <form action="/api/promises/fulfill" method="post" className="mt-3 flex flex-col gap-3">
          <HiddenFields familyId={familyId} promiseId={promise.id} csrfToken={csrfToken} />
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-slate-900">
            {COPY.promiseFulfillPayment}
            <select name="paymentId" required className={CONTROL_CLASS} defaultValue="">
              <option value="" disabled>
                انتخاب پرداخت
              </option>
              {candidates.map((payment) => (
                <option key={payment.id} value={payment.id}>
                  {formatToman(payment.amountToman)} · {formatMoneyDate(payment.receivedOn)} ·{' '}
                  {PAYMENT_METHOD_PRESENTATION[payment.method].label}
                </option>
              ))}
            </select>
          </label>
          <SubmitButton>{COPY.promiseFulfillAction}</SubmitButton>
        </form>
      )}
    </ActionDetails>
  );
}

function RescheduleDetails({
  familyId,
  promiseId,
  csrfToken,
  clinicTodayJalali,
}: {
  familyId: string;
  promiseId: string;
  csrfToken: string;
  clinicTodayJalali: JalaliParts;
}) {
  return (
    <ActionDetails title={COPY.promiseRescheduleTitle}>
      <p className="text-xs leading-6 text-slate-600">{COPY.promiseRescheduleHelp}</p>
      <form action="/api/promises/reschedule" method="post" className="mt-3 flex flex-col gap-3">
        <HiddenFields familyId={familyId} promiseId={promiseId} csrfToken={csrfToken} />
        <JalaliDateField
          legend={COPY.promiseNewDueOn}
          help="تاریخ جدید باید امروز یا بعد از آن باشد."
          namePrefix="dueOn"
          value={clinicTodayJalali}
          required
        />
        <ReasonField />
        <SubmitButton>{COPY.promiseRescheduleAction}</SubmitButton>
      </form>
    </ActionDetails>
  );
}

function CancelDetails({
  familyId,
  promiseId,
  csrfToken,
}: {
  familyId: string;
  promiseId: string;
  csrfToken: string;
}) {
  return (
    <ActionDetails title={COPY.promiseCancelTitle}>
      <p className="text-xs leading-6 text-slate-600">{COPY.promiseCancelHelp}</p>
      <form action="/api/promises/cancel" method="post" className="mt-3 flex flex-col gap-3">
        <HiddenFields familyId={familyId} promiseId={promiseId} csrfToken={csrfToken} />
        <ReasonField />
        <SubmitButton tone="secondary">{COPY.promiseCancelAction}</SubmitButton>
      </form>
    </ActionDetails>
  );
}

function ReasonField() {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-semibold text-slate-900">
      {COPY.promiseReason}
      <textarea name="reason" required maxLength={500} rows={2} className={CONTROL_CLASS} />
    </label>
  );
}

function PageLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-brand-800 ${FOCUS_RING}`}
    >
      {children}
    </Link>
  );
}

function formatInstant(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : PERSIAN_INSTANT.format(date);
}
