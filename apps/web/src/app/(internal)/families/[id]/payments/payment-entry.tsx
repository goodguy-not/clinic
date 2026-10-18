import type { Payment } from '@clinic/contracts';
import { ButtonLink, ChoiceGroup, ChoiceOption, Field, Panel, SubmitButton } from '@/components/ui';
import { JalaliDateField } from '@/app/(internal)/tariffs/jalali-date-field';
import { PAYMENT_METHOD_PRESENTATION, formatMoneyDate } from '@/payments/presentation';
import type { JalaliParts } from '@/server/jalali';
import { COPY } from '@/server/copy-fa';
import { formatToman } from '@/server/numerals-fa';

export function PaymentEntryPanel({
  familyId,
  csrfToken,
  clinicToday,
  clinicTodayJalali,
  recentPayments,
}: {
  familyId: string;
  csrfToken: string;
  clinicToday: string;
  clinicTodayJalali: JalaliParts;
  recentPayments: Payment[];
}) {
  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
      <Panel title={COPY.paymentEntryTitle}>
        <p className="text-sm leading-6 text-slate-600">{COPY.paymentEntryHelp}</p>
        <form action="/api/payments/create" method="post" className="flex flex-col gap-4">
          <input type="hidden" name="familyId" value={familyId} />
          <input type="hidden" name="csrfToken" value={csrfToken} />

          <Field
            id="payment-amount"
            label={COPY.paymentAmount}
            help={COPY.paymentAmountHelp}
            required
          >
            {({ id, className, describedBy }) => (
              <input
                id={id}
                name="amountToman"
                type="text"
                inputMode="numeric"
                required
                maxLength={18}
                aria-describedby={describedBy}
                className={`${className} text-lg font-bold tabular-nums`}
              />
            )}
          </Field>

          <ChoiceGroup legend={COPY.paymentMethod}>
            <div className="grid gap-2 sm:grid-cols-3">
              {(['CASH', 'CARD', 'TRANSFER'] as const).map((method, index) => (
                <ChoiceOption
                  key={method}
                  id={`payment-method-${method.toLowerCase()}`}
                  name="method"
                  value={method}
                  label={`${PAYMENT_METHOD_PRESENTATION[method].glyph} ${PAYMENT_METHOD_PRESENTATION[method].label}`}
                  defaultChecked={index === 0}
                />
              ))}
            </div>
          </ChoiceGroup>

          <JalaliDateField
            legend={COPY.paymentReceivedOn}
            help={COPY.paymentReceivedOnHelp}
            namePrefix="receivedOn"
            value={clinicTodayJalali}
            required
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="payment-reference"
              label={COPY.paymentReference}
              help={COPY.paymentReferenceHelp}
            >
              {({ id, className, describedBy }) => (
                <input
                  id={id}
                  name="reference"
                  type="text"
                  maxLength={40}
                  aria-describedby={describedBy}
                  className={className}
                />
              )}
            </Field>
            <Field id="payment-note" label={COPY.paymentNote} help={COPY.paymentNoteHelp}>
              {({ id, className, describedBy }) => (
                <textarea
                  id={id}
                  name="note"
                  rows={2}
                  maxLength={2000}
                  aria-describedby={describedBy}
                  className={className}
                />
              )}
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton>{COPY.paymentCreateAction}</SubmitButton>
            <ButtonLink href={`/families/${familyId}/payments`} tone="secondary">
              مشاهدهٔ تاریخچهٔ کامل
            </ButtonLink>
          </div>
        </form>
      </Panel>

      <Panel title={COPY.paymentRecentTitle}>
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-950">
          <span aria-hidden="true">⚠ </span>
          {COPY.paymentRecentHelp}
        </p>
        {recentPayments.length === 0 ? (
          <p className="text-sm text-slate-600">{COPY.paymentNoRecent}</p>
        ) : (
          <ol className="flex list-none flex-col gap-2 p-0">
            {recentPayments.map((payment) => (
              <li
                key={payment.id}
                className={`rounded-lg border p-3 ${payment.status === 'VOIDED' ? 'border-red-200 bg-slate-50' : 'border-slate-200 bg-white'}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-slate-950">
                    <bdi>{formatToman(payment.amountToman)}</bdi>
                  </span>
                  <span className="text-xs font-semibold text-slate-700">
                    {payment.receivedOn === clinicToday ? `${COPY.paymentToday} · ` : ''}
                    {formatMoneyDate(payment.receivedOn)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  {PAYMENT_METHOD_PRESENTATION[payment.method].glyph}{' '}
                  {PAYMENT_METHOD_PRESENTATION[payment.method].label}
                  {payment.status === 'VOIDED' ? ' · باطل‌شده' : ' · تأییدشده'}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </section>
  );
}
