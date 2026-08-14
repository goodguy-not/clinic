import type { ChargeAdjustment, FamilyAccountTotals, SessionChargeDetail } from '@clinic/contracts';
import { formatToman } from '@/server/numerals-fa';

/**
 * Display-only ledger formatting.
 *
 * Every input is a decimal string or total already stated by NestJS. These
 * helpers group and localise those strings; they never derive an effective
 * amount, adjustment sum, family total, balance or share in the Web tier.
 */

export type ChargeMoneyPresentation = {
  charged: string;
  activeAdjustments: string;
  effective: string;
};

export function formatChargeMoney(
  charge: Pick<
    SessionChargeDetail,
    'amountToman' | 'activeAdjustmentTotalToman' | 'effectiveAmountToman'
  >,
): ChargeMoneyPresentation {
  return {
    charged: formatToman(charge.amountToman),
    activeAdjustments: formatToman(charge.activeAdjustmentTotalToman),
    effective: formatToman(charge.effectiveAmountToman),
  };
}

export type AdjustmentMoneyPresentation = {
  amount: string;
  clinicFunded: string;
  therapistFunded: string;
};

export function formatAdjustmentMoney(
  adjustment: Pick<
    ChargeAdjustment,
    'amountToman' | 'clinicDiscountToman' | 'therapistDiscountToman'
  >,
): AdjustmentMoneyPresentation {
  return {
    amount: formatToman(adjustment.amountToman),
    clinicFunded: formatToman(adjustment.clinicDiscountToman),
    therapistFunded: formatToman(adjustment.therapistDiscountToman),
  };
}

export type FamilyAccountMoneyPresentation = {
  charged: string;
  adjustments: string;
  netCharged: string;
};

export function formatFamilyAccountMoney(
  totals: Pick<
    FamilyAccountTotals,
    'chargedTotalToman' | 'adjustmentTotalToman' | 'netChargedTotalToman'
  >,
): FamilyAccountMoneyPresentation {
  return {
    charged: formatToman(totals.chargedTotalToman),
    adjustments: formatToman(totals.adjustmentTotalToman),
    netCharged: formatToman(totals.netChargedTotalToman),
  };
}
