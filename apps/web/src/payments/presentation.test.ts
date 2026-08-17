import { describe, expect, it } from 'vitest';
import {
  PAYMENT_METHOD_PRESENTATION,
  PAYMENT_STATUS_PRESENTATION,
  PROMISE_STATUS_PRESENTATION,
  formatMoneyDate,
  presentFinancialPosition,
} from './presentation';

const base = {
  netChargedTotalToman: '1500000',
  confirmedPaymentTotalToman: '500000',
  creditToman: '0',
  amountDueToman: '1000000',
  paymentCount: 1,
  voidedPaymentCount: 0,
  lastPayment: null,
  openPromiseCount: 2,
  missedPromiseCount: 1,
};

describe('payment and promise presentation', () => {
  it('maps the entire frozen vocabulary to Persian text and non-colour semantics', () => {
    expect(Object.values(PAYMENT_METHOD_PRESENTATION).map((item) => item.label)).toEqual([
      'نقدی',
      'کارت‌خوان',
      'انتقال بانکی',
    ]);
    expect(PAYMENT_STATUS_PRESENTATION.VOIDED).toEqual({ label: 'باطل‌شده', tone: 'danger' });
    expect(PROMISE_STATUS_PRESENTATION.MISSED).toEqual({
      label: 'از موعد گذشته',
      tone: 'danger',
    });
    expect(Object.keys(PROMISE_STATUS_PRESENTATION)).toHaveLength(5);
  });

  it('formats payment dates as Jalali with Persian numerals', () => {
    expect(formatMoneyDate('2026-08-15')).toMatch(/۱۴۰۵/);
    expect(formatMoneyDate('not-a-date')).toBe('not-a-date');
  });

  it.each([
    [base, 'due', 'مبلغ قابل پرداخت', '۱٬۰۰۰٬۰۰۰ تومان'],
    [
      { ...base, amountDueToman: '0', creditToman: '250000' },
      'credit',
      'اعتبار خانواده',
      '۲۵۰٬۰۰۰ تومان',
    ],
    [{ ...base, amountDueToman: '0' }, 'settled', 'تسویه؛ بدون مانده', '۰ تومان'],
  ] as const)(
    'presents the server-stated %s position without a signed balance',
    (position, state, label, amount) => {
      expect(presentFinancialPosition(position)).toMatchObject({
        state,
        headlineLabel: label,
        headlineAmount: amount,
        netChargedTotal: '۱٬۵۰۰٬۰۰۰ تومان',
        confirmedPaymentTotal: '۵۰۰٬۰۰۰ تومان',
      });
    },
  );
});
