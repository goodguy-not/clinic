import { describe, expect, it } from 'vitest';
import { formatAdjustmentMoney, formatChargeMoney, formatFamilyAccountMoney } from './presentation';

describe('ledger money presentation', () => {
  it('formats every server-stated charge amount through the approved toman formatter', () => {
    expect(
      formatChargeMoney({
        amountToman: '9007199254740993',
        activeAdjustmentTotalToman: '250000',
        effectiveAmountToman: '9007199254490993',
      }),
    ).toEqual({
      charged: '۹٬۰۰۷٬۱۹۹٬۲۵۴٬۷۴۰٬۹۹۳ تومان',
      activeAdjustments: '۲۵۰٬۰۰۰ تومان',
      effective: '۹٬۰۰۷٬۱۹۹٬۲۵۴٬۴۹۰٬۹۹۳ تومان',
    });
  });

  it('renders the allocation returned by NestJS without deriving a split', () => {
    expect(
      formatAdjustmentMoney({
        amountToman: '120000',
        clinicDiscountToman: '120000',
        therapistDiscountToman: '0',
      }),
    ).toEqual({
      amount: '۱۲۰٬۰۰۰ تومان',
      clinicFunded: '۱۲۰٬۰۰۰ تومان',
      therapistFunded: '۰ تومان',
    });
  });

  it('renders all family totals exactly as the account response states them', () => {
    expect(
      formatFamilyAccountMoney({
        chargedTotalToman: '1500000',
        adjustmentTotalToman: '300000',
        netChargedTotalToman: '1200000',
      }),
    ).toEqual({
      charged: '۱٬۵۰۰٬۰۰۰ تومان',
      adjustments: '۳۰۰٬۰۰۰ تومان',
      netCharged: '۱٬۲۰۰٬۰۰۰ تومان',
    });
  });
});
