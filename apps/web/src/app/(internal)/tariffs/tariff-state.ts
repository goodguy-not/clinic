import type { Tariff } from '@clinic/contracts';

/**
 * Which of the four states a tariff is in, on a given day.
 *
 * The day is passed in rather than read here, and the caller gets it from the
 * server. Reading a browser clock would make the answer depend on the device: a
 * receptionist whose laptop is a day out would see a tariff described as
 * current when it is not, which is exactly the kind of quiet wrongness that
 * ends in the wrong price.
 *
 * Comparison is string-on-string over `YYYY-MM-DD`, which is fixed-width, so
 * lexicographic order is chronological order and no date arithmetic — and no
 * timezone — is involved.
 */
export type TariffState = 'voided' | 'current' | 'future' | 'expired';

export function tariffState(tariff: Tariff, today: string): TariffState {
  if (tariff.voidedAt !== null) return 'voided';
  if (tariff.effectiveStart > today) return 'future';
  if (tariff.effectiveEnd !== null && tariff.effectiveEnd < today) return 'expired';

  return 'current';
}
