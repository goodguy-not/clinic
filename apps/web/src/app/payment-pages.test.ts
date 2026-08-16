import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Payment, PaymentListResponse } from '@clinic/contracts';
import { PaymentEntryPanel } from './families/[id]/payments/payment-entry';
import { PaymentHistory, buildPaymentsHref } from './families/[id]/payments/payment-history';

const FAMILY_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4c01';
const USER_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4c05';

const confirmed: Payment = {
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4c02',
  familyId: FAMILY_ID,
  amountToman: '700000',
  method: 'CARD',
  receivedOn: '2026-08-16',
  reference: 'REF-1405',
  note: 'پرداخت در پذیرش',
  status: 'CONFIRMED',
  createdAt: '2026-08-16T08:00:00.000Z',
  createdByUserId: USER_ID,
  voidedAt: null,
  voidedByUserId: null,
  voidReason: null,
};

const voided: Payment = {
  ...confirmed,
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4c03',
  amountToman: '300000',
  method: 'TRANSFER',
  receivedOn: '2026-08-15',
  reference: null,
  note: null,
  status: 'VOIDED',
  voidedAt: '2026-08-16T09:00:00.000Z',
  voidedByUserId: USER_ID,
  voidReason: 'ثبت دوباره',
};

const result: PaymentListResponse = {
  familyId: FAMILY_ID,
  payments: [confirmed, voided],
  page: { page: 2, pageSize: 25, total: 28, hasMore: true },
};

describe('family quick payment entry', () => {
  const markup = renderToStaticMarkup(
    createElement(PaymentEntryPanel, {
      familyId: FAMILY_ID,
      csrfToken: 'synthetic-csrf',
      clinicToday: '2026-08-16',
      clinicTodayJalali: { year: 1405, month: 5, day: 25 },
      recentPayments: [confirmed, voided],
    }),
  );

  it('posts exactly the family-level payment fields with all three allowed methods', () => {
    expect(markup).toContain('action="/api/payments/create"');
    for (const field of ['amountToman', 'method', 'receivedOn-year', 'reference', 'note']) {
      expect(markup).toContain(`name="${field}"`);
    }
    for (const method of ['CASH', 'CARD', 'TRANSFER'])
      expect(markup).toContain(`value="${method}"`);
    for (const forbidden of ['PENDING', 'CHEQUE', 'OTHER', 'childId', 'sessionId']) {
      expect(markup).not.toContain(forbidden);
    }
  });

  it('defaults the Jalali clinic day and places recent/today payments beside entry', () => {
    expect(markup).toContain('value="1405" selected=""');
    expect(markup).toContain('امروز');
    expect(markup).toContain('۷۰۰٬۰۰۰ تومان');
    expect(markup).toContain('باطل‌شده');
  });

  it('remains a Server Component without client-state machinery', () => {
    const source = readFileSync(
      new URL('./families/[id]/payments/payment-entry.tsx', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/^['"]use client['"]/);
    expect(source).not.toMatch(/useState|useEffect/);
  });
});

describe('payment history and manager correction', () => {
  function history(canVoid: boolean): string {
    return renderToStaticMarkup(
      createElement(PaymentHistory, {
        familyId: FAMILY_ID,
        result,
        query: { page: 2, pageSize: 25, includeVoided: true },
        csrfToken: 'synthetic-csrf',
        canVoid,
      }),
    );
  }

  it('renders contract records, audit fields, references, notes, status and Jalali dates', () => {
    const markup = history(false);
    expect(markup).toContain('REF-1405');
    expect(markup).toContain('پرداخت در پذیرش');
    expect(markup).toContain(USER_ID);
    expect(markup).toContain('تأییدشده');
    expect(markup).toContain('مرداد');
    expect(markup).not.toContain('2026-08-16');
  });

  it('keeps voided payments visible and distinct with text, glyph and struck amount', () => {
    const markup = history(false);
    expect(markup).toContain('⊘');
    expect(markup).toContain('line-through');
    expect(markup).toContain('ثبت دوباره');
    expect(markup).toContain('در جایگاه مالی خانواده اثری ندارد');
  });

  it('shows a required reason correction only to a manager', () => {
    const manager = history(true);
    const receptionist = history(false);
    expect(manager).toContain('action="/api/payments/void"');
    expect(manager).toMatch(/name="reason"[^>]*required=""/);
    expect(manager).toContain(`name="paymentId" value="${confirmed.id}"`);
    expect(manager).not.toContain(`name="paymentId" value="${voided.id}"`);
    expect(receptionist).not.toContain('/api/payments/void');
  });

  it('preserves the independent payment pagination query', () => {
    const href = buildPaymentsHref(
      FAMILY_ID,
      { page: 2, pageSize: 25, includeVoided: false, from: '2026-08-01' },
      3,
    );
    expect(href).toContain('page=3');
    expect(href).toContain('includeVoided=false');
    expect(href).toContain('from=2026-08-01');
  });
});
