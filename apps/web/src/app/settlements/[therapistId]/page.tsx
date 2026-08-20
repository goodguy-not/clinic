import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import {
  settlementStatementQuerySchema,
  type SettlementPeriod,
  type SettlementStatementResponse,
  type ShareRule,
} from '@clinic/contracts';
import { AppHeader } from '@/components/app-header';
import {
  Alert,
  Badge,
  ButtonLink,
  EmptyState,
  PageHeader,
  PageShell,
  Panel,
  SubmitButton,
} from '@/components/ui';
import { JalaliDateField } from '@/app/tariffs/jalali-date-field';
import { ReportActions } from '@/app/reports/report-actions';
import { ReportPrintContext, ReportTable, TD, TH } from '@/app/reports/report-ui';
import { api } from '@/server/api-client';
import {
  callerContext,
  readCsrfCookie,
  readSessionToken,
  requireSession,
} from '@/server/auth-session';
import { dateLabel, instantLabel } from '@/app/reports/report-server';
import { isKnownErrorCode } from '@/server/handler-support';
import { persianMessage } from '@/server/errors-fa';
import { toPersianDigits } from '@/server/numerals-fa';
import {
  formatSettlementMoney,
  formatShareBasisPoints,
  signedTone,
  statementLineState,
} from '@/settlement/presentation';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'صورت‌تسویهٔ درمانگر',
  robots: { index: false, follow: false },
};

export default async function TherapistSettlementPage({
  params,
  searchParams,
}: {
  params: Promise<{ therapistId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSession({ requirePermission: 'settlement.read' });
  const [{ therapistId }, raw, token, csrfToken] = await Promise.all([
    params,
    searchParams,
    readSessionToken(),
    readCsrfCookie(),
  ]);
  const parsed = settlementStatementQuerySchema.safeParse({
    therapistId,
    from: one(raw, 'from'),
    to: one(raw, 'to'),
  });
  if (!parsed.success) notFound();
  const context = await callerContext(token ?? undefined);
  const [statement, rules, periods] = await Promise.all([
    api.settlementStatement(parsed.data, context),
    api.listShareRules({ therapistId, includeVoided: true }, context),
    api.listSettlementPeriods({ therapistId }, context),
  ]);
  const name = statement.ok
    ? statement.data.therapist.fullName
    : periods.ok
      ? periods.data.therapist.fullName
      : 'درمانگر';
  const error = one(raw, 'error');
  const success = one(raw, 'success');
  const selectedPeriod = one(raw, 'periodId');
  const successes: Record<string, string> = {
    'share-rule-created': 'قاعدهٔ سهم ثبت شد؛ جلسه‌های قبلاً ثبت‌شده تغییر نکردند.',
    'share-rule-voided': 'قاعدهٔ سهم ابطال شد و در تاریخچه باقی ماند.',
    'period-closed': 'دوره با موفقیت بسته و نهایی شد.',
    'period-already-closed': 'این دوره پیش‌تر با همین بازه بسته شده بود.',
  };
  return (
    <>
      <AppHeader />
      <PageShell wide>
        <PageHeader
          title={`صورت‌تسویهٔ ${name}`}
          description={`بر پایهٔ تاریخ جلسه · ${dateLabel(parsed.data.from)} تا ${dateLabel(parsed.data.to)}`}
          backHref="/settlements"
          backLabel="انتخاب درمانگر و بازه"
          action={
            <ReportActions
              exportRequest={
                user.permissions.includes('report.export')
                  ? {
                      kind: 'settlement',
                      filters: parsed.data,
                      csrfToken: csrfToken ?? '',
                    }
                  : undefined
              }
              scopeLabel={`${dateLabel(parsed.data.from)} تا ${dateLabel(parsed.data.to)}`}
            />
          }
        />
        <ReportPrintContext
          items={[
            `درمانگر: ${name}`,
            `بازهٔ تاریخ جلسه: ${dateLabel(parsed.data.from)} تا ${dateLabel(parsed.data.to)}`,
            'این برگه ثبت پرداخت یا سند حقوقی نیست.',
          ]}
        />
        {error && isKnownErrorCode(error) ? <Alert>{persianMessage(error)}</Alert> : null}
        {success && successes[success] ? <Alert tone="info">{successes[success]}</Alert> : null}
        {!statement.ok ? (
          <>
            <Alert>{persianMessage(statement.code)}</Alert>
            <EmptyState message="صورت‌تسویه بارگیری نشد. ارقام حدس زده یا بازسازی نمی‌شوند؛ دوباره تلاش کنید." />
          </>
        ) : (
          <Statement
            statement={statement.data}
            canClose={user.permissions.includes('settlement.close')}
            csrfToken={csrfToken ?? ''}
          />
        )}
        <ShareRules
          rules={rules.ok ? rules.data.shareRules : null}
          therapistId={therapistId}
          from={parsed.data.from}
          to={parsed.data.to}
          csrfToken={csrfToken ?? ''}
          canCreate={user.permissions.includes('therapist_share.create')}
          canVoid={user.permissions.includes('therapist_share.void')}
          error={rules.ok ? null : persianMessage(rules.code)}
        />
        <ClosedPeriods
          periods={periods.ok ? periods.data.periods : null}
          selectedId={selectedPeriod}
          error={periods.ok ? null : persianMessage(periods.code)}
        />
      </PageShell>
    </>
  );
}

function Statement({
  statement,
  canClose,
  csrfToken,
}: {
  statement: SettlementStatementResponse;
  canClose: boolean;
  csrfToken: string;
}) {
  const t = statement.totals;
  const e = statement.exceptions;
  const metrics = [
    ['خالص تسویهٔ بازه', t.netSettlementToman],
    ['کسب‌شده و بسته‌نشده', t.earnedUnsettledToman],
    ['بسته‌شده', t.settledToman],
    ['اصلاح تسویهٔ معلق', t.pendingCorrectionToman],
  ] as const;
  return (
    <>
      <dl aria-label="خلاصهٔ تسویه" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <dt className="text-xs text-slate-600">{label}</dt>
            <dd className={`mt-1 text-xl font-black tabular-nums ${signedTone(value)}`}>
              <bdi>{formatSettlementMoney(value)}</bdi>
            </dd>
          </div>
        ))}
      </dl>
      <section aria-label="استثناهای بازه" className="grid gap-3 sm:grid-cols-3">
        <Exception tone="warning" title="بدون ثبت سهم" count={e.unratedSessionCount}>
          صفر محسوب نشده‌اند و در تسویه وارد نشده‌اند؛ ابتدا قاعدهٔ تاریخی را ثبت و سپس جلسه را با
          دلیل ثبت سهم کنید.
        </Exception>
        <Exception tone="info" title="جلسهٔ رایگان" count={e.freeSessionCount}>
          جلسهٔ رایگان ثبت سهم شده و به‌درستی ارزش صفر دارد؛ با جلسهٔ بدون ثبت سهم متفاوت است.
        </Exception>
        <Exception
          tone="neutral"
          title="انجام‌شدهٔ بدون هزینه"
          count={e.unchargedCompletedSessionCount}
        >
          مبنای هزینه ندارد و قابل تسویه نیست؛ رفع آن از مسیر ثبت هزینهٔ جلسه انجام می‌شود.
        </Exception>
      </section>
      {statement.lines.length === 0 ? (
        <EmptyState message="در این بازه ردیف ثبت‌شده‌ای برای صورت‌تسویه وجود ندارد. استثناهای بالا همچنان ممکن است وجود داشته باشند." />
      ) : (
        <ReportTable label="ردیف‌های صورت‌تسویه؛ یک ردیف برای هر جلسه">
          <thead>
            <tr>
              <th className={TH}>جلسه</th>
              <th className={TH}>وضعیت</th>
              <th className={TH}>قاعدهٔ اعمال‌شده</th>
              <th className={TH}>مبلغ مبنا</th>
              <th className={TH}>سهم ناخالص درمانگر</th>
              <th className={TH}>تخفیف درمانگر</th>
              <th className={TH}>خالص فعلی درمانگر</th>
              <th className={TH}>قبلاً بسته‌شده</th>
              <th className={TH}>خالص کلینیک</th>
            </tr>
          </thead>
          <tbody>
            {statement.lines.map((line) => {
              const state = statementLineState(line);
              return (
                <tr
                  key={line.sessionChargeId}
                  className={state === 'PENDING_CORRECTION' ? 'bg-amber-50' : ''}
                >
                  <td className={TD}>
                    <strong>{line.serviceName}</strong>
                    {line.priceMode === 'FREE' ? (
                      <span className="ms-2 inline-flex rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-900">
                        رایگان از ابتدا
                      </span>
                    ) : null}
                    <br />
                    <span className="text-xs">
                      {dateLabel(line.serviceDate)} ·{' '}
                      {toPersianDigits(String(line.durationMinutes))} دقیقه
                    </span>
                  </td>
                  <td className={TD}>
                    {state === 'SETTLED' ? (
                      <Badge tone="neutral">بسته‌شده</Badge>
                    ) : state === 'PENDING_CORRECTION' ? (
                      <Badge tone="warning">اصلاح تسویهٔ معلق</Badge>
                    ) : (
                      <Badge tone="success">کسب‌شده و بسته‌نشده</Badge>
                    )}
                  </td>
                  <td className={TD}>
                    {formatShareBasisPoints(line.appliedShareBasisPoints)}
                    <br />
                    <span className="text-xs text-slate-500">
                      {line.ratedVia === 'AUTOMATIC' ? 'همراه ثبت هزینه' : 'ثبت صریح تاریخی'}
                    </span>
                  </td>
                  {[
                    line.baseAmountToman,
                    line.therapistGrossToman,
                    line.therapistDiscountToman,
                    line.therapistNetToman,
                    line.settledToman,
                    line.clinicNetToman,
                  ].map((v, i) => (
                    <td key={i} className={`${TD} tabular-nums ${signedTone(v)}`}>
                      <bdi>{formatSettlementMoney(v)}</bdi>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </ReportTable>
      )}
      <Panel title="مرور و بستن دوره">
        <p className="text-sm text-slate-700">
          بستن دوره برگشت‌پذیر نیست. همهٔ ارقام بالا از سرور آمده‌اند و دورهٔ بسته‌شده بعداً ویرایش
          یا باز نمی‌شود.
        </p>
        {e.unratedSessionCount > 0 ? (
          <div
            role="note"
            className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
          >
            <strong>
              {toPersianDigits(String(e.unratedSessionCount))} جلسهٔ بدون ثبت سهم کنار گذاشته
              می‌شود.
            </strong>
            <p>
              این جلسه‌ها صفر نیستند، بسته نمی‌شوند و این اقدام آن‌ها را حل نمی‌کند. اگر بعداً با
              قاعدهٔ تاریخی ثبت سهم شوند، ممکن است به‌صورت ورودی تاریخی در دوره‌ای بعدی ظاهر شوند.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
            در حال حاضر جلسهٔ بدون ثبت سهمی در این بازه گزارش نشده است.
          </div>
        )}
        {canClose ? (
          <form action="/api/settlement/close" method="post" className="flex flex-col gap-3">
            <input type="hidden" name="csrfToken" value={csrfToken} />
            <input type="hidden" name="therapistId" value={statement.therapist.id} />
            <input type="hidden" name="from" value={statement.range.from} />
            <input type="hidden" name="to" value={statement.range.to} />
            <label className="flex items-start gap-2 rounded-lg border border-slate-300 p-3 text-sm font-semibold">
              <input
                className="mt-1 size-4 accent-brand-700"
                type="checkbox"
                name="confirm"
                value="yes"
                required
              />
              صورت‌تسویه، اصلاح‌های معلق و جلسه‌های کنارگذاشته‌شده را بررسی کردم و می‌دانم بستن دوره
              به معنی ثبت پرداخت نیست.
            </label>
            <div>
              <SubmitButton>بستن و نهایی‌کردن دوره</SubmitButton>
            </div>
          </form>
        ) : null}
      </Panel>
    </>
  );
}

function Exception({
  tone,
  title,
  count,
  children,
}: {
  tone: 'warning' | 'info' | 'neutral';
  title: string;
  count: number;
  children: ReactNode;
}) {
  const style = {
    warning: 'border-amber-300 bg-amber-50',
    info: 'border-brand-200 bg-brand-50',
    neutral: 'border-slate-200 bg-white',
  }[tone];
  return (
    <article className={`rounded-xl border p-4 ${style}`}>
      <div className="flex items-center justify-between">
        <h2 className="font-bold">{title}</h2>
        <span className="text-2xl font-black tabular-nums">{toPersianDigits(String(count))}</span>
      </div>
      <p className="mt-2 text-xs text-slate-700">{children}</p>
    </article>
  );
}

function ShareRules({
  rules,
  therapistId,
  from,
  to,
  csrfToken,
  canCreate,
  canVoid,
  error,
}: {
  rules: ShareRule[] | null;
  therapistId: string;
  from: string;
  to: string;
  csrfToken: string;
  canCreate: boolean;
  canVoid: boolean;
  error: string | null;
}) {
  return (
    <Panel title="قواعد تاریخ‌دار سهم درمانگر">
      <p className="text-sm text-slate-700">
        قاعده بر پایهٔ تاریخ انجام جلسه انتخاب می‌شود. ثبت، اصلاح یا ابطال قاعده، درصد جلسه‌هایی را
        که قبلاً ثبت سهم شده‌اند بازنویسی نمی‌کند.
      </p>
      {error ? (
        <Alert>{error}</Alert>
      ) : rules?.length === 0 ? (
        <EmptyState message="برای این درمانگر قاعدهٔ سهمی ثبت نشده است." />
      ) : (
        <ul className="flex list-none flex-col gap-3 p-0">
          {rules?.map((rule) => (
            <li
              key={rule.id}
              className={`rounded-lg border p-4 ${rule.voidedAt ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-brand-200 bg-white'}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-lg">{formatShareBasisPoints(rule.shareBasisPoints)}</strong>
                <Badge tone={rule.voidedAt ? 'neutral' : 'success'}>
                  {rule.voidedAt ? 'باطل‌شده' : 'معتبر'}
                </Badge>
              </div>
              <p className="text-sm">
                {dateLabel(rule.effectiveStart)} تا{' '}
                {rule.effectiveEnd ? dateLabel(rule.effectiveEnd) : 'بدون تاریخ پایان'}
              </p>
              {rule.supersedesShareRuleId ? (
                <p className="text-xs">جایگزین یک قاعدهٔ قبلی</p>
              ) : null}
              {rule.voidReason ? <p className="text-xs">دلیل ابطال: {rule.voidReason}</p> : null}
              {!rule.voidedAt && canVoid ? (
                <details className="print-hide mt-2">
                  <summary className="cursor-pointer text-sm font-semibold text-brand-800">
                    ابطال یا اصلاح این قاعده
                  </summary>
                  <div className="mt-3 grid gap-4 lg:grid-cols-2">
                    <RuleForm
                      therapistId={therapistId}
                      from={from}
                      to={to}
                      csrfToken={csrfToken}
                      supersedes={rule}
                    />
                    <form
                      action="/api/settlement/share-rules/void"
                      method="post"
                      className="flex flex-col gap-3 rounded-lg border border-red-200 p-3"
                    >
                      <input type="hidden" name="csrfToken" value={csrfToken} />
                      <input type="hidden" name="therapistId" value={therapistId} />
                      <input type="hidden" name="shareRuleId" value={rule.id} />
                      <input type="hidden" name="returnFrom" value={from} />
                      <input type="hidden" name="returnTo" value={to} />
                      <label className="text-sm font-semibold">
                        دلیل ابطال
                        <textarea
                          name="reason"
                          required
                          maxLength={500}
                          className="mt-1 w-full rounded-lg border border-slate-300 p-2"
                        />
                      </label>
                      <div>
                        <SubmitButton tone="danger">ابطال بدون جایگزین</SubmitButton>
                      </div>
                    </form>
                  </div>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canCreate ? (
        <details className="print-hide">
          <summary className="cursor-pointer font-semibold text-brand-800">ثبت قاعدهٔ جدید</summary>
          <div className="mt-3">
            <RuleForm therapistId={therapistId} from={from} to={to} csrfToken={csrfToken} />
          </div>
        </details>
      ) : null}
    </Panel>
  );
}

function RuleForm({
  therapistId,
  from,
  to,
  csrfToken,
  supersedes,
}: {
  therapistId: string;
  from: string;
  to: string;
  csrfToken: string;
  supersedes?: ShareRule;
}) {
  return (
    <form
      action="/api/settlement/share-rules/create"
      method="post"
      className="flex flex-col gap-4 rounded-lg border border-slate-200 p-3"
    >
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <input type="hidden" name="therapistId" value={therapistId} />
      <input type="hidden" name="returnFrom" value={from} />
      <input type="hidden" name="returnTo" value={to} />
      {supersedes ? (
        <input type="hidden" name="supersedesShareRuleId" value={supersedes.id} />
      ) : null}
      <label className="text-sm font-semibold">
        درصد سهم
        <input
          name="sharePercent"
          required
          inputMode="decimal"
          placeholder="مثلاً ۴۲٫۵"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        />
      </label>
      {supersedes ? (
        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <input type="hidden" name="fixedStart" value={supersedes.effectiveStart} />
          <input type="hidden" name="fixedEnd" value={supersedes.effectiveEnd ?? ''} />
          دامنهٔ اصلاح ثابت می‌ماند: {dateLabel(supersedes.effectiveStart)} تا{' '}
          {supersedes.effectiveEnd ? dateLabel(supersedes.effectiveEnd) : 'بدون تاریخ پایان'}
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <JalaliDateField legend="شروع اعتبار" namePrefix="start" required />
            <JalaliDateField legend="پایان اعتبار" namePrefix="end" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="openEnded" value="true" />
            بدون تاریخ پایان
          </label>
        </>
      )}
      {supersedes ? (
        <label className="text-sm font-semibold">
          دلیل اصلاح
          <textarea
            name="reason"
            required
            maxLength={500}
            className="mt-1 w-full rounded-lg border border-slate-300 p-2"
          />
        </label>
      ) : null}
      <div>
        <SubmitButton>{supersedes ? 'ابطال و ثبت جایگزین' : 'ثبت قاعده'}</SubmitButton>
      </div>
    </form>
  );
}

function ClosedPeriods({
  periods,
  selectedId,
  error,
}: {
  periods: SettlementPeriod[] | null;
  selectedId?: string;
  error: string | null;
}) {
  return (
    <Panel title="دوره‌های بسته‌شده">
      <p className="text-sm text-slate-700">
        دوره‌های بسته‌شده تغییرناپذیرند. «ورودی تاریخی» اصلاح تسویهٔ جلسه‌ای از دوره‌ای پیشین است،
        نه یک جلسهٔ بالینی دوم.
      </p>
      {error ? (
        <Alert>{error}</Alert>
      ) : periods?.length === 0 ? (
        <EmptyState message="هنوز دوره‌ای برای این درمانگر بسته نشده است." />
      ) : (
        <ul className="flex list-none flex-col gap-3 p-0">
          {periods?.map((p) => (
            <li
              id={`period-${p.id}`}
              key={p.id}
              className={`rounded-xl border p-4 ${selectedId === p.id ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-white'}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-bold">
                    {dateLabel(p.from)} تا {dateLabel(p.to)}
                  </h3>
                  <p className="text-xs text-slate-600">بسته‌شده در {instantLabel(p.closedAt)}</p>
                </div>
                <Badge tone="neutral">بسته و نهایی</Badge>
              </div>
              <dl className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {(
                  [
                    ['جلسه‌های همین دوره', String(p.settledSessionCount)],
                    ['ورودی تاریخی اصلاح', String(p.carriedInCorrectionCount)],
                    ['جلسهٔ بدون ثبت سهمِ کنارگذاشته‌شده', String(p.excludedUnratedSessionCount)],
                    ['مبلغ ورودی تاریخی', p.carriedInCorrectionToman],
                    ['خالص تسویهٔ بسته‌شده', p.settledToman],
                  ] as Array<[string, string]>
                ).map(([l, v], i) => (
                  <div key={l} className="rounded-lg bg-slate-50 p-3">
                    <dt className="text-xs text-slate-600">{l}</dt>
                    <dd className={`font-black tabular-nums ${i > 2 ? signedTone(v) : ''}`}>
                      <bdi>{i > 2 ? formatSettlementMoney(v) : toPersianDigits(v)}</bdi>
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="print-hide mt-3">
                <ButtonLink href={`/settlements/periods/${p.id}`} tone="secondary">
                  مشاهدهٔ ردیف‌های قطعی دوره
                </ButtonLink>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function one(raw: Record<string, string | string[] | undefined>, key: string): string | undefined {
  return typeof raw[key] === 'string' ? raw[key] : undefined;
}
