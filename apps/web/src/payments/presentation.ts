import type {
  FamilyFinancialPosition,
  PaymentMethod,
  PaymentStatus,
  PromiseStatus,
} from '@clinic/contracts';
import { formatScheduleDate } from '@/scheduling/presentation';
import { formatToman } from '@/server/numerals-fa';

export type StatusTone = 'success' | 'neutral' | 'warning' | 'danger' | 'info';

export const PAYMENT_METHOD_PRESENTATION: Record<PaymentMethod, { label: string; glyph: string }> =
  {
    CASH: { label: 'نقدی', glyph: '●' },
    CARD: { label: 'کارت‌خوان', glyph: '▣' },
    TRANSFER: { label: 'انتقال بانکی', glyph: '↔' },
  };

export const PAYMENT_STATUS_PRESENTATION: Record<
  PaymentStatus,
  { label: string; tone: StatusTone }
> = {
  CONFIRMED: { label: 'تأییدشده', tone: 'success' },
  VOIDED: { label: 'باطل‌شده', tone: 'danger' },
};

export const PROMISE_STATUS_PRESENTATION: Record<
  PromiseStatus,
  { label: string; tone: StatusTone }
> = {
  OPEN: { label: 'باز و در موعد', tone: 'warning' },
  MISSED: { label: 'از موعد گذشته', tone: 'danger' },
  FULFILLED: { label: 'انجام‌شده', tone: 'success' },
  RESCHEDULED: { label: 'زمان‌بندی مجدد', tone: 'info' },
  CANCELLED: { label: 'لغوشده', tone: 'neutral' },
};

export function formatMoneyDate(isoDate: string): string {
  return formatScheduleDate(isoDate)?.full ?? isoDate;
}

export type FinancialPositionPresentation = {
  state: 'due' | 'credit' | 'settled';
  headlineLabel: string;
  headlineAmount: string;
  netChargedTotal: string;
  confirmedPaymentTotal: string;
};

/** Selects meaning from server-stated fields; it performs no financial arithmetic. */
export function presentFinancialPosition(
  position: FamilyFinancialPosition,
): FinancialPositionPresentation {
  const shared = {
    netChargedTotal: formatToman(position.netChargedTotalToman),
    confirmedPaymentTotal: formatToman(position.confirmedPaymentTotalToman),
  };

  if (position.amountDueToman !== '0') {
    return {
      ...shared,
      state: 'due',
      headlineLabel: 'مبلغ قابل پرداخت',
      headlineAmount: formatToman(position.amountDueToman),
    };
  }
  if (position.creditToman !== '0') {
    return {
      ...shared,
      state: 'credit',
      headlineLabel: 'اعتبار خانواده',
      headlineAmount: formatToman(position.creditToman),
    };
  }

  return {
    ...shared,
    state: 'settled',
    headlineLabel: 'تسویه؛ بدون مانده',
    headlineAmount: formatToman('0'),
  };
}
