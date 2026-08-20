import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { SettlementPeriod, SettlementPeriodLine } from '@clinic/contracts';
import { AppHeader } from '@/components/app-header';
import { Alert, Badge, EmptyState, PageHeader, PageShell } from '@/components/ui';
import { ReportActions } from '@/app/reports/report-actions';
import { ReportPrintContext, ReportTable, TD, TH } from '@/app/reports/report-ui';
import { dateLabel, instantLabel } from '@/app/reports/report-server';
import { api } from '@/server/api-client';
import { callerContext, readSessionToken, requireSession } from '@/server/auth-session';
import { persianMessage } from '@/server/errors-fa';
import { toPersianDigits } from '@/server/numerals-fa';
import {
  formatSettlementMoney,
  formatShareBasisPoints,
  signedTone,
} from '@/settlement/presentation';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'جزئیات دورهٔ بسته‌شده',
  robots: { index: false, follow: false },
};

export default async function SettlementPeriodDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession({ requirePermission: 'settlement.read' });
  const [{ id }, token] = await Promise.all([params, readSessionToken()]);
  const result = await api.settlementPeriodDetail(id, await callerContext(token ?? undefined));
  if (!result.ok && result.code === 'SETTLEMENT_PERIOD_NOT_FOUND') notFound();

  if (!result.ok) {
    return (
      <>
        <AppHeader />
        <PageShell wide>
          <PageHeader
            title="جزئیات دورهٔ بسته‌شده"
            backHref="/settlements"
            backLabel="تسویهٔ درمانگران"
          />
          <Alert>{persianMessage(result.code)}</Alert>
          <EmptyState message="ردیف‌های قطعی این دوره بارگیری نشدند. هیچ مبلغی در وب بازسازی نمی‌شود؛ دوباره تلاش کنید." />
        </PageShell>
      </>
    );
  }

  const { therapist, period, lines } = result.data;
  const statementHref = `/settlements/${therapist.id}?from=${period.from}&to=${period.to}`;
  return (
    <>
      <AppHeader />
      <PageShell wide>
        <PageHeader
          title={`دورهٔ بسته‌شدهٔ ${therapist.fullName}`}
          description={`${dateLabel(period.from)} تا ${dateLabel(period.to)} · بسته‌شده در ${instantLabel(period.closedAt)}`}
          backHref={statementHref}
          backLabel="بازگشت به صورت‌تسویه"
          action={<ReportActions />}
        />
        <ReportPrintContext
          items={[
            `درمانگر: ${therapist.fullName}`,
            `دوره: ${dateLabel(period.from)} تا ${dateLabel(period.to)}`,
            `زمان بستن: ${instantLabel(period.closedAt)}`,
            'دوره بسته و تغییرناپذیر است؛ این برگه ثبت پرداخت نیست.',
          ]}
        />
        <PeriodSummary period={period} />
        <section className="rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm text-brand-950">
          <h2 className="font-bold">راهنمای خواندن تاریخچه</h2>
          <p>
            «ردیف اصلی» یک جلسه را در نخستین دوره‌ای که بسته شده نشان می‌دهد. «اصلاح تاریخی» فقط
            حرکت قطعی علیه یک ردیف بسته‌شدهٔ پیشین است و جلسهٔ بالینی دیگری محسوب نمی‌شود. نشان
            «ورودی تاریخی» نیز یعنی تاریخ انجام جلسه بیرون از این دوره بوده است.
          </p>
        </section>
        {lines.length === 0 ? (
          <EmptyState message="این دوره پس از مرور بدون هیچ ردیف قطعی بسته شده است." />
        ) : (
          <PeriodLines lines={lines} />
        )}
      </PageShell>
    </>
  );
}

function PeriodSummary({ period }: { period: SettlementPeriod }) {
  const facts = [
    ['جلسه‌های همین دوره', toPersianDigits(String(period.settledSessionCount)), null],
    ['ورودی تاریخی اصلاح', toPersianDigits(String(period.carriedInCorrectionCount)), null],
    [
      'بدون ثبت سهمِ کنارگذاشته‌شده',
      toPersianDigits(String(period.excludedUnratedSessionCount)),
      null,
    ],
    [
      'مبلغ اصلاح‌های ورودی',
      formatSettlementMoney(period.carriedInCorrectionToman),
      period.carriedInCorrectionToman,
    ],
    ['خالص تسویهٔ بسته‌شده', formatSettlementMoney(period.settledToman), period.settledToman],
  ] as const;
  return (
    <dl aria-label="خلاصهٔ قطعی دوره" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
      {facts.map(([label, value, signedValue]) => (
        <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <dt className="text-xs text-slate-600">{label}</dt>
          <dd
            className={`mt-1 text-lg font-black tabular-nums ${signedValue === null ? 'text-slate-950' : signedTone(signedValue)}`}
          >
            <bdi>{value}</bdi>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function PeriodLines({ lines }: { lines: SettlementPeriodLine[] }) {
  return (
    <ReportTable label="ردیف‌های قطعی دوره">
      <thead>
        <tr>
          <th className={TH}>نوع واقعیت</th>
          <th className={TH}>جلسه و منشأ</th>
          <th className={TH}>قاعدهٔ اعمال‌شده</th>
          <th className={TH}>مبلغ مبنا</th>
          <th className={TH}>ناخالص درمانگر</th>
          <th className={TH}>تخفیف درمانگر</th>
          <th className={TH}>خالص درمانگر</th>
          <th className={TH}>خالص کلینیک</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <tr
            key={line.id}
            className={line.lineType === 'CORRECTION' ? 'bg-amber-50' : 'hover:bg-slate-50'}
          >
            <td className={TD}>
              <div className="flex flex-col items-start gap-1.5">
                <Badge tone={line.lineType === 'CORRECTION' ? 'warning' : 'success'}>
                  {line.lineType === 'CORRECTION' ? 'اصلاح تاریخی' : 'ردیف اصلی'}
                </Badge>
                <Badge tone={line.carriedIn ? 'info' : 'neutral'}>
                  {line.carriedIn ? 'ورودی تاریخی' : 'کار همین دوره'}
                </Badge>
                {line.lineType === 'CORRECTION' ? (
                  <span className="text-xs text-amber-900">جلسهٔ بالینی دوم نیست</span>
                ) : null}
              </div>
            </td>
            <td className={TD}>
              <strong>{line.serviceName}</strong>
              {line.priceMode === 'FREE' ? (
                <span className="ms-2 inline-flex rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-900">
                  رایگان از ابتدا
                </span>
              ) : null}
              <br />
              <span className="text-xs text-slate-600">
                {dateLabel(line.serviceDate)} · {toPersianDigits(String(line.durationMinutes))}{' '}
                دقیقه
              </span>
              {line.lineType === 'CORRECTION' ? (
                <p className="mt-2 text-xs text-amber-900">
                  اصلاح ردیف بسته‌شدهٔ پیشین:{' '}
                  <bdi className="break-all font-mono">{line.correctsSettlementLineId}</bdi>
                </p>
              ) : null}
              <details className="print-hide mt-2 text-xs text-slate-600">
                <summary className="cursor-pointer font-semibold text-brand-800">
                  شناسه‌های رهگیری
                </summary>
                <dl className="mt-1 break-all">
                  <dt>ردیف قطعی</dt>
                  <dd>
                    <bdi>{line.id}</bdi>
                  </dd>
                  <dt>هزینهٔ جلسه</dt>
                  <dd>
                    <bdi>{line.sessionChargeId}</bdi>
                  </dd>
                  <dt>ثبت سهم</dt>
                  <dd>
                    <bdi>{line.sessionSettlementId}</bdi>
                  </dd>
                </dl>
              </details>
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
              line.clinicNetToman,
            ].map((value, index) => (
              <td key={index} className={`${TD} tabular-nums ${signedTone(value)}`}>
                <bdi>{formatSettlementMoney(value)}</bdi>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </ReportTable>
  );
}
