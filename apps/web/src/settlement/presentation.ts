import type { SettlementStatementLine } from '@clinic/contracts';
import { formatToman, toPersianDigits } from '@/server/numerals-fa';

export function formatSettlementMoney(value: string): string {
  return value.startsWith('-') ? `−${formatToman(value.slice(1))}` : formatToman(value);
}

export function formatShareBasisPoints(value: number): string {
  const whole = Math.trunc(value / 100);
  const fraction = value % 100;
  return `${toPersianDigits(String(whole))}${fraction === 0 ? '' : `٫${toPersianDigits(String(fraction).padStart(2, '0').replace(/0$/, ''))}`}٪`;
}

export type StatementLineState = 'EARNED_UNSETTLED' | 'SETTLED' | 'PENDING_CORRECTION';

/** Classification only; all displayed amounts remain backend-provided fields. */
export function statementLineState(line: SettlementStatementLine): StatementLineState {
  if (line.settledToman === '0') return 'EARNED_UNSETTLED';
  return line.therapistNetToman === line.settledToman ? 'SETTLED' : 'PENDING_CORRECTION';
}

export function signedTone(value: string): string {
  return value.startsWith('-') ? 'text-rose-800' : 'text-slate-950';
}
