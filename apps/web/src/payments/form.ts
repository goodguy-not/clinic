import 'server-only';
import { jalaliToIsoDate } from '@/server/jalali';
import { toWesternDigits } from '@/server/numerals-fa';
import type { SubmittedBody } from '@/server/handler-support';

/** Builds only the five operator-entered fields from an ordinary HTML form. */
export function paymentFormCandidate(body: SubmittedBody): Record<string, unknown> {
  const reference = body['reference']?.trim() ?? '';
  const note = body['note']?.trim() ?? '';
  const receivedOn = jalaliToIsoDate({
    year: Number(toWesternDigits(body['receivedOn-year'] ?? '')),
    month: Number(toWesternDigits(body['receivedOn-month'] ?? '')),
    day: Number(toWesternDigits(body['receivedOn-day'] ?? '')),
  });

  return {
    amountToman: toWesternDigits(body['amountToman'] ?? '').replace(/[,٬]/g, ''),
    method: body['method'],
    receivedOn: receivedOn ?? '',
    ...(reference === '' ? {} : { reference }),
    ...(note === '' ? {} : { note }),
  };
}
