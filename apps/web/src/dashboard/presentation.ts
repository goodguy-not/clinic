import type { PaymentMethod } from '@clinic/contracts';
import { COPY } from '@/server/copy-fa';
import { formatScheduleDate } from '@/scheduling/presentation';

export function dashboardDateLabel(isoDate: string): string {
  return formatScheduleDate(isoDate)?.full ?? isoDate;
}

export function paymentMethodLabel(method: PaymentMethod): string {
  return {
    CASH: COPY.dashboardPaymentCash,
    CARD: COPY.dashboardPaymentCard,
    TRANSFER: COPY.dashboardPaymentTransfer,
  }[method];
}
