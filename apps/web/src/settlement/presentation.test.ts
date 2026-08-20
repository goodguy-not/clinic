import { describe, expect, it } from 'vitest';
import type { SettlementStatementLine } from '@clinic/contracts';
import {
  formatSettlementMoney,
  formatShareBasisPoints,
  signedTone,
  statementLineState,
} from './presentation';

const line = (values: Partial<SettlementStatementLine> = {}): SettlementStatementLine => ({
  sessionSettlementId: '11111111-1111-4111-8111-111111111111',
  sessionChargeId: '22222222-2222-4222-8222-222222222222',
  serviceDate: '2026-08-01',
  serviceId: '33333333-3333-4333-8333-333333333333',
  serviceName: 'کاردرمانی',
  durationMinutes: 45,
  priceMode: 'PAID',
  lineType: 'PRIMARY',
  correctsSessionSettlementId: null,
  appliedShareBasisPoints: 4250,
  ratedVia: 'AUTOMATIC',
  baseAmountToman: '1000000',
  therapistGrossToman: '425000',
  therapistDiscountToman: '0',
  therapistNetToman: '425000',
  clinicGrossToman: '575000',
  clinicDiscountToman: '600000',
  clinicNetToman: '-25000',
  settledToman: '0',
  ...values,
});

describe('settlement presentation', () => {
  it('classifies one session without deriving a correction amount', () => {
    expect(statementLineState(line())).toBe('EARNED_UNSETTLED');
    expect(statementLineState(line({ settledToman: '425000' }))).toBe('SETTLED');
    expect(statementLineState(line({ settledToman: '450000' }))).toBe('PENDING_CORRECTION');
  });

  it('keeps negative authoritative values visible', () => {
    expect(signedTone('-25000')).toBe('text-rose-800');
    expect(formatSettlementMoney('-25000')).toBe('−۲۵٬۰۰۰ تومان');
    expect(signedTone('0')).toBe('text-slate-950');
  });

  it('formats basis points only for display', () => {
    expect(formatShareBasisPoints(4250)).toBe('۴۲٫۵٪');
    expect(formatShareBasisPoints(0)).toBe('۰٪');
    expect(formatShareBasisPoints(10000)).toBe('۱۰۰٪');
  });
});
