import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SettlementPeriodLine } from '@clinic/contracts';
import { PeriodLines } from './settlements/periods/[id]/page';

const primaryId = '11111111-1111-4111-8111-111111111111';
const base = (values: Partial<SettlementPeriodLine>): SettlementPeriodLine => ({
  id: '22222222-2222-4222-8222-222222222222',
  settlementPeriodId: '33333333-3333-4333-8333-333333333333',
  lineType: 'PRIMARY',
  correctsSettlementLineId: null,
  sessionChargeId: '44444444-4444-4444-8444-444444444444',
  sessionSettlementId: '55555555-5555-4555-8555-555555555555',
  appointmentParticipantId: '66666666-6666-4666-8666-666666666666',
  therapistId: '77777777-7777-4777-8777-777777777777',
  serviceDate: '2026-08-01',
  chargeKind: 'SESSION',
  penaltyPercent: null,
  carriedIn: false,
  serviceId: '88888888-8888-4888-8888-888888888888',
  serviceName: 'کاردرمانی',
  durationMinutes: 45,
  priceMode: 'PAID',
  appliedShareBasisPoints: 4000,
  ratedVia: 'AUTOMATIC',
  baseAmountToman: '250000',
  therapistGrossToman: '100000',
  therapistDiscountToman: '0',
  therapistNetToman: '100000',
  clinicGrossToman: '150000',
  clinicDiscountToman: '0',
  clinicNetToman: '150000',
  createdAt: '2026-08-31T10:00:00.000Z',
  ...values,
});

describe('closed settlement period detail', () => {
  const markup = renderToStaticMarkup(
    <PeriodLines
      lines={[
        base({ id: primaryId }),
        base({
          id: '99999999-9999-4999-8999-999999999999',
          lineType: 'CORRECTION',
          correctsSettlementLineId: primaryId,
          carriedIn: true,
          baseAmountToman: '-250000',
          therapistGrossToman: '-100000',
          therapistNetToman: '-100000',
          clinicGrossToman: '-150000',
          clinicNetToman: '-150000',
        }),
        base({
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          sessionChargeId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          priceMode: 'FREE',
          baseAmountToman: '0',
          therapistGrossToman: '0',
          therapistNetToman: '0',
          clinicGrossToman: '0',
          clinicNetToman: '0',
        }),
        base({
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          sessionChargeId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          priceMode: 'PAID',
          baseAmountToman: '0',
          therapistGrossToman: '0',
          therapistNetToman: '0',
          clinicGrossToman: '0',
          clinicNetToman: '0',
        }),
      ]}
    />,
  );

  it('labels authoritative PRIMARY and CORRECTION facts and traces the correction', () => {
    expect(markup).toContain('ردیف اصلی');
    expect(markup).toContain('اصلاح تاریخی');
    expect(markup).toContain('جلسهٔ بالینی دوم نیست');
    expect(markup).toContain(primaryId);
  });

  it('distinguishes carried-in history from work inside the period', () => {
    expect(markup).toContain('ورودی تاریخی');
    expect(markup).toContain('کار همین دوره');
  });

  it('keeps negative signed corrections visible', () => {
    expect(markup).toContain('−۱۰۰٬۰۰۰ تومان');
    expect(markup).toContain('text-rose-800');
  });

  it('labels FREE from priceMode while a zero-valued PAID row stays unlabelled', () => {
    expect(markup.match(/رایگان از ابتدا/g)).toHaveLength(1);
    expect(markup).toContain('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  });
});
