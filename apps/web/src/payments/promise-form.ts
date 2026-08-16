import 'server-only';
import { jalaliToIsoDate } from '@/server/jalali';
import { toWesternDigits } from '@/server/numerals-fa';
import type { SubmittedBody } from '@/server/handler-support';

function dateFrom(body: SubmittedBody, prefix: string): string {
  return (
    jalaliToIsoDate({
      year: Number(toWesternDigits(body[`${prefix}-year`] ?? '')),
      month: Number(toWesternDigits(body[`${prefix}-month`] ?? '')),
      day: Number(toWesternDigits(body[`${prefix}-day`] ?? '')),
    }) ?? ''
  );
}

export function createPromiseFormCandidate(body: SubmittedBody): Record<string, unknown> {
  const note = body['note']?.trim() ?? '';
  return {
    amountToman: toWesternDigits(body['amountToman'] ?? '').replace(/[,٬]/g, ''),
    dueOn: dateFrom(body, 'dueOn'),
    ...(note === '' ? {} : { note }),
  };
}

export function reschedulePromiseFormCandidate(body: SubmittedBody): Record<string, unknown> {
  return { dueOn: dateFrom(body, 'dueOn'), reason: body['reason']?.trim() ?? '' };
}
