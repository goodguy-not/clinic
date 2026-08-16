import type { FamilyFinancialPosition } from '@clinic/contracts';
import {
  PAYMENT_METHOD_PRESENTATION,
  formatMoneyDate,
  presentFinancialPosition,
} from '@/payments/presentation';
import { COPY } from '@/server/copy-fa';
import { formatToman, toPersianDigits } from '@/server/numerals-fa';

export function FamilyFinancialPositionPanel({ position }: { position: FamilyFinancialPosition }) {
  const presented = presentFinancialPosition(position);
  const headlineTone = {
    due: 'border-amber-300 bg-amber-50 text-amber-950',
    credit: 'border-emerald-300 bg-emerald-50 text-emerald-950',
    settled: 'border-brand-300 bg-brand-50 text-brand-950',
  }[presented.state];

  return (
    <section
      aria-labelledby="family-financial-position-title"
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
    >
      <div className="flex flex-col gap-4">
        <div>
          <h2 id="family-financial-position-title" className="font-bold text-slate-950">
            {COPY.familyFinancialPositionTitle}
          </h2>
          <p className="mt-1 text-sm text-slate-600">{COPY.familyFinancialPositionScope}</p>
        </div>

        <div className={`rounded-xl border p-4 ${headlineTone}`}>
          <p className="text-sm font-semibold">{presented.headlineLabel}</p>
          <p className="mt-1 text-2xl font-black tabular-nums sm:text-3xl">
            <bdi>{presented.headlineAmount}</bdi>
          </p>
        </div>

        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <PositionFact label="جمع مبلغ مؤثر" value={presented.netChargedTotal} />
          <PositionFact label="جمع پرداخت تأییدشده" value={presented.confirmedPaymentTotal} />
          <PositionFact label="تعداد پرداخت" value={count(position.paymentCount)} />
          <PositionFact label="پرداخت باطل‌شده" value={count(position.voidedPaymentCount)} />
          <PositionFact label="قول باز و در موعد" value={count(position.openPromiseCount)} />
          <PositionFact
            label="قول از موعد گذشته"
            value={count(position.missedPromiseCount)}
            alert={position.missedPromiseCount > 0}
          />
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
            <dt className="text-xs font-medium text-slate-600">آخرین پرداخت تأییدشده</dt>
            <dd className="mt-1 font-semibold text-slate-950">
              {position.lastPayment === null ? (
                'پرداختی ثبت نشده است'
              ) : (
                <>
                  <bdi>{formatToman(position.lastPayment.amountToman)}</bdi>
                  <span aria-hidden="true"> · </span>
                  {PAYMENT_METHOD_PRESENTATION[position.lastPayment.method].label}
                  <span aria-hidden="true"> · </span>
                  {formatMoneyDate(position.lastPayment.receivedOn)}
                </>
              )}
            </dd>
          </div>
        </dl>

        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-6 text-slate-700">
          <span aria-hidden="true">ⓘ </span>
          {COPY.familyFinancialPositionHistoricalWarning}
        </p>
      </div>
    </section>
  );
}

function PositionFact({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${alert ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-slate-50'}`}
    >
      <dt className="text-xs font-medium text-slate-600">{label}</dt>
      <dd className={`mt-1 font-bold tabular-nums ${alert ? 'text-red-900' : 'text-slate-950'}`}>
        <bdi>{value}</bdi>
      </dd>
    </div>
  );
}

function count(value: number): string {
  return toPersianDigits(String(value));
}
