import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FamilyAccountQuery, FamilyAccountResponse } from '@clinic/contracts';
import { COPY } from '@/server/copy-fa';
import { FamilyAccountView, buildAccountHref } from './families/[id]/account/account-view';
import { FamilyDetailActions } from './families/[id]/family-detail-actions';

const FAMILY_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b01';
const CHILD_ONE = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b02';
const CHILD_TWO = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b12';
const UUIDS = {
  appointment: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b03',
  participant: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b04',
  service: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b07',
  therapist: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b08',
  tariff: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b09',
  user: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b10',
};

const children = [
  {
    id: CHILD_ONE,
    firstName: 'آرین',
    lastName: 'احمدی',
    fileNumber: '1405000001',
    birthDate: '2018-01-01',
    status: 'ACTIVE' as const,
  },
  {
    id: CHILD_TWO,
    firstName: 'بهار',
    lastName: 'احمدی',
    fileNumber: '1405000002',
    birthDate: '2019-01-01',
    status: 'ACTIVE' as const,
  },
];

const adjustment = {
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b21',
  sessionChargeId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b31',
  amountToman: '500000',
  therapistDiscountToman: '0',
  clinicDiscountToman: '500000',
  reason: 'همراهی خانواده',
  createdAt: '2026-08-14T08:00:00.000Z',
  createdByUserId: UUIDS.user,
  voidedAt: null,
  voidedByUserId: null,
  voidReason: null,
};

function chargeView({
  id,
  childId,
  amount,
  effective,
  priceMode = 'PAID',
  adjustments = [],
  adjustmentTotal = '0',
  voided = false,
}: {
  id: string;
  childId: string;
  amount: string;
  effective: string;
  priceMode?: 'PAID' | 'FREE';
  adjustments?: FamilyAccountResponse['charges'][number]['charge']['adjustments'];
  adjustmentTotal?: string;
  voided?: boolean;
}): FamilyAccountResponse['charges'][number] {
  const child = children.find((one) => one.id === childId)!;
  return {
    charge: {
      id,
      familyId: FAMILY_ID,
      childId,
      appointmentId: UUIDS.appointment,
      appointmentParticipantId: UUIDS.participant,
      serviceId: UUIDS.service,
      therapistId: UUIDS.therapist,
      durationMinutes: 45,
      serviceDate: '2026-08-14',
      tariffId: UUIDS.tariff,
      priceMode,
      amountToman: amount,
      createdAt: '2026-08-14T08:00:00.000Z',
      createdByUserId: UUIDS.user,
      voidedAt: voided ? '2026-08-15T08:00:00.000Z' : null,
      voidedByUserId: voided ? UUIDS.user : null,
      voidReason: voided ? 'ثبت تکراری' : null,
      adjustments,
      activeAdjustmentTotalToman: adjustmentTotal,
      effectiveAmountToman: effective,
    },
    child,
    service: { id: UUIDS.service, name: 'گفتاردرمانی' },
    therapist: { id: UUIDS.therapist, fullName: 'دکتر نوری' },
  };
}

const voidedAdjustment = {
  ...adjustment,
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b22',
  amountToman: '100000',
  clinicDiscountToman: '100000',
  reason: 'تخفیف موقت',
  voidedAt: '2026-08-15T07:00:00.000Z',
  voidedByUserId: UUIDS.user,
  voidReason: 'اصلاح دلیل',
};

// The whole-family position, which never moves with the charge filter above it.
const position: FamilyAccountResponse['position'] = {
  netChargedTotalToman: '1500000',
  confirmedPaymentTotalToman: '500000',
  creditToman: '0',
  amountDueToman: '1000000',
  paymentCount: 1,
  voidedPaymentCount: 1,
  lastPayment: {
    id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b41',
    amountToman: '500000',
    method: 'CASH',
    receivedOn: '2026-08-15',
    status: 'CONFIRMED',
  },
  openPromiseCount: 1,
  missedPromiseCount: 2,
};

const populated: FamilyAccountResponse = {
  familyId: FAMILY_ID,
  totals: {
    chargedTotalToman: '3500000',
    adjustmentTotalToman: '2000000',
    netChargedTotalToman: '1500000',
    chargeCount: 3,
    voidedChargeCount: 1,
  },
  position,
  charges: [
    chargeView({
      id: adjustment.sessionChargeId,
      childId: CHILD_ONE,
      amount: '1500000',
      effective: '1000000',
      adjustments: [adjustment, voidedAdjustment],
      adjustmentTotal: '500000',
    }),
    chargeView({
      id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b32',
      childId: CHILD_TWO,
      amount: '1500000',
      effective: '0',
      adjustments: [
        {
          ...adjustment,
          id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b23',
          sessionChargeId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b32',
          amountToman: '1500000',
          clinicDiscountToman: '1500000',
        },
      ],
      adjustmentTotal: '1500000',
    }),
    chargeView({
      id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b33',
      childId: CHILD_TWO,
      amount: '0',
      effective: '0',
      priceMode: 'FREE',
    }),
    chargeView({
      id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b34',
      childId: CHILD_ONE,
      amount: '800000',
      effective: '800000',
      voided: true,
    }),
  ],
  page: { page: 2, pageSize: 25, total: 52, hasMore: true },
};

const query: FamilyAccountQuery = { page: 2, pageSize: 25, includeVoided: true };

describe('/families/[id]/account presentation', () => {
  const markup = renderToStaticMarkup(
    createElement(FamilyAccountView, {
      familyId: FAMILY_ID,
      children,
      account: populated,
      query,
      csrfToken: 'synthetic-csrf',
      canAdjustCharge: false,
      canVoidCharge: false,
      canCreatePayment: false,
      recentPayments: [],
      clinicToday: '2026-08-16',
      clinicTodayJalali: { year: 1405, month: 5, day: 25 },
    }),
  );

  it('shows family totals exactly as supplied with Persian toman formatting', () => {
    expect(markup).toContain(COPY.familyAccountTotalsTitle);
    expect(markup).toContain('۳٬۵۰۰٬۰۰۰ تومان');
    expect(markup).toContain('۱٬۵۰۰٬۰۰۰ تومان');
  });

  it('keeps every participant charge traceable to either child', () => {
    expect(markup).toContain('آرین احمدی');
    expect(markup).toContain('بهار احمدی');
    expect(markup).toContain('1405000001');
    expect(markup).toContain('1405000002');
  });

  it('shows original, adjustment and server-supplied effective amounts', () => {
    expect(markup).toContain(COPY.familyAccountOriginalAmount);
    expect(markup).toContain(COPY.familyAccountActiveAdjustments);
    expect(markup).toContain(COPY.familyAccountEffectiveAmount);
    expect(markup).toContain('۱٬۰۰۰٬۰۰۰ تومان');
  });

  it('identifies active discounts as clinic-funded without implying a therapist share', () => {
    expect(markup).toContain(COPY.familyAccountClinicFunded);
    expect(markup).toContain('همراهی خانواده');
    expect(markup).not.toContain('therapistDiscountToman');
    expect(markup).not.toContain('سهم درمانگر');
  });

  it('distinguishes a fully adjusted paid charge from an originally free charge', () => {
    expect(markup).toContain(COPY.familyAccountFullyAdjusted);
    expect(markup).toContain(COPY.familyAccountFree);
  });

  it('keeps voided charges and adjustments visible, marked and explained', () => {
    expect(markup).toContain(COPY.familyAccountVoidedNoEffect);
    expect(markup).toContain('ثبت تکراری');
    expect(markup).toContain(COPY.familyAccountVoidedAdjustmentNoEffect);
    expect(markup).toContain('اصلاح دلیل');
  });

  it('states the whole-family position beside, and apart from, the filtered totals', () => {
    // `position` is the family's; `totals` describes the filtered charge view.
    // Both are the server's own numbers — nothing here adds anything up.
    expect(markup).toContain(COPY.familyFinancialPositionTitle);
    expect(markup).toContain(COPY.familyFinancialPositionScope);
    expect(markup).toContain('مبلغ قابل پرداخت');
    expect(markup).toContain('۱٬۰۰۰٬۰۰۰ تومان');
    expect(markup).toContain(COPY.familyFinancialPositionHistoricalWarning);
    expect(markup.indexOf(COPY.familyFinancialPositionTitle)).toBeLessThan(
      markup.indexOf(COPY.familyAccountTotalsTitle),
    );
  });

  it('renders Jalali dates, history filtering, child filtering and pagination', () => {
    expect(markup).toContain('مرداد');
    expect(markup).not.toContain('2026-08-14');
    expect(markup).toContain('name="childId"');
    expect(markup).toContain('name="includeVoided"');
    expect(markup).toContain('includeVoided=true');
    expect(markup).toContain('page=1');
    expect(markup).toContain('page=3');
  });
});

describe('family account empty state and navigation', () => {
  it('integrates quick family-level payment entry for an authorised operator', () => {
    const markup = renderToStaticMarkup(
      createElement(FamilyAccountView, {
        familyId: FAMILY_ID,
        children,
        account: populated,
        query,
        csrfToken: 'synthetic-csrf',
        canAdjustCharge: false,
        canVoidCharge: false,
        canCreatePayment: true,
        recentPayments: [],
        clinicToday: '2026-08-16',
        clinicTodayJalali: { year: 1405, month: 5, day: 25 },
      }),
    );

    expect(markup).toContain('action="/api/payments/create"');
    expect(markup).toContain(COPY.paymentEntryTitle);
    expect(markup.indexOf(COPY.paymentEntryTitle)).toBeLessThan(
      markup.indexOf(COPY.familyAccountTotalsTitle),
    );
  });

  it('shows a useful empty state while retaining filters', () => {
    const markup = renderToStaticMarkup(
      createElement(FamilyAccountView, {
        familyId: FAMILY_ID,
        children,
        query: { page: 1, pageSize: 25, includeVoided: false, childId: CHILD_ONE },
        account: {
          familyId: FAMILY_ID,
          totals: {
            chargedTotalToman: '0',
            adjustmentTotalToman: '0',
            netChargedTotalToman: '0',
            chargeCount: 0,
            voidedChargeCount: 0,
          },
          position: {
            netChargedTotalToman: '0',
            confirmedPaymentTotalToman: '0',
            creditToman: '0',
            amountDueToman: '0',
            paymentCount: 0,
            voidedPaymentCount: 0,
            lastPayment: null,
            openPromiseCount: 0,
            missedPromiseCount: 0,
          },
          charges: [],
          page: { page: 1, pageSize: 25, total: 0, hasMore: false },
        },
        csrfToken: 'synthetic-csrf',
        canAdjustCharge: false,
        canVoidCharge: false,
        canCreatePayment: false,
        recentPayments: [],
        clinicToday: '2026-08-16',
        clinicTodayJalali: { year: 1405, month: 5, day: 25 },
      }),
    );
    expect(markup).toContain(COPY.familyAccountEmpty);
    expect(markup).toContain('value="false" selected=""');
    expect(markup).toContain(CHILD_ONE);
  });

  it('adds a clear family-detail entry only for account readers', () => {
    const markup = renderToStaticMarkup(
      createElement(FamilyDetailActions, {
        familyId: FAMILY_ID,
        canEdit: true,
        canReadAccount: true,
      }),
    );
    expect(markup).toContain(`/families/${FAMILY_ID}/account`);
    expect(markup).toContain(COPY.familyAccountAction);
  });

  it('preserves server filters in page links', () => {
    expect(buildAccountHref(FAMILY_ID, { ...query, childId: CHILD_TWO }, 3)).toContain(
      `childId=${CHILD_TWO}`,
    );
  });
});

describe('manager financial corrections', () => {
  function corrections(canAdjustCharge: boolean, canVoidCharge: boolean): string {
    return renderToStaticMarkup(
      createElement(FamilyAccountView, {
        familyId: FAMILY_ID,
        children,
        account: populated,
        query,
        csrfToken: 'synthetic-csrf',
        canAdjustCharge,
        canVoidCharge,
        canCreatePayment: false,
        recentPayments: [],
        clinicToday: '2026-08-16',
        clinicTodayJalali: { year: 1405, month: 5, day: 25 },
      }),
    );
  }

  it('shows deliberate charge void controls only with charge.void and requires a reason', () => {
    const manager = corrections(true, true);
    const receptionist = corrections(false, false);

    expect(manager).toContain('/api/ledger/session-charges/void');
    expect(manager).toContain(COPY.familyAccountChargeVoidHelp);
    expect(manager).toMatch(/name="reason"[^>]*required=""/);
    expect(manager).not.toContain('/session-charges/0199');
    expect(receptionist).not.toContain('/api/ledger/session-charges/void');
    expect(receptionist).not.toContain(COPY.familyAccountManagerCorrection);
  });

  it('offers adjustment creation with amount and reason as its only business inputs', () => {
    const markup = corrections(true, true);
    const start = markup.indexOf('action="/api/ledger/adjustments/create"');
    const end = markup.indexOf('</form>', start);
    const form = markup.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(form).toContain('name="amountToman"');
    expect(form).toContain('name="reason"');
    expect(form.match(/<input[^>]*name="amountToman"[^>]*\/>/)?.[0]).toContain('required=""');
    expect(form).toMatch(/name="reason"[^>]*required=""/);
    expect(form).not.toMatch(/therapist|share|split/i);
    expect(markup).toContain(COPY.familyAccountAdjustmentClinicOnly);
    expect(corrections(false, true)).not.toContain('/api/ledger/adjustments/create');
  });

  it('offers adjustment void only with charge.adjust and preserves both historical reasons', () => {
    const manager = corrections(true, false);
    const receptionist = corrections(false, false);

    expect(manager).toContain('/api/ledger/adjustments/void');
    expect(manager).toContain(`name="chargeId" value="${adjustment.sessionChargeId}"`);
    expect(manager).toContain(`name="adjustmentId" value="${adjustment.id}"`);
    expect(manager).toContain(adjustment.reason);
    expect(manager).toContain(voidedAdjustment.reason);
    expect(manager).toContain(voidedAdjustment.voidReason);
    expect(manager).toContain(COPY.familyAccountAdjustmentVoidHelp);
    expect(receptionist).not.toContain('/api/ledger/adjustments/void');
  });

  it('keeps voided history rendered and a fully discounted PAID charge distinct from FREE', () => {
    const markup = corrections(true, true);

    expect(markup).toContain(COPY.familyAccountVoidedNoEffect);
    expect(markup).toContain(COPY.familyAccountVoidedAdjustmentNoEffect);
    expect(markup).toContain(COPY.familyAccountFullyAdjusted);
    expect(markup).toContain(COPY.familyAccountFree);
    expect(markup).toContain('۱٬۵۰۰٬۰۰۰ تومان');
  });

  it('adds no Client Component for B3', () => {
    for (const file of [
      'families/[id]/account/account-view.tsx',
      'families/[id]/account/page.tsx',
    ]) {
      expect(readFileSync(new URL(file, import.meta.url), 'utf8')).not.toMatch(
        /^['"]use client['"]/m,
      );
    }
  });
});
