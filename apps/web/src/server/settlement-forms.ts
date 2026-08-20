import { toWesternDigits } from './numerals-fa';

/** Parses a manager-facing percentage into the contract's integer basis points. */
export function percentageToBasisPoints(value: string): number | null {
  const normalized = toWesternDigits(value).trim().replace('٫', '.');
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(normalized);
  if (match === null) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const basisPoints = whole * 100 + fraction;
  return basisPoints <= 10_000 ? basisPoints : null;
}

export function settlementReturnPath(
  therapistId: string,
  from?: string,
  to?: string,
): `/${string}` {
  const search = new URLSearchParams();
  if (from !== undefined) search.set('from', from);
  if (to !== undefined) search.set('to', to);
  const suffix = search.size > 0 ? `?${search.toString()}` : '';
  return `/settlements/${encodeURIComponent(therapistId)}${suffix}`;
}
