import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Payment, PaymentPromise, PromiseListResponse } from '@clinic/contracts';
import { PromiseEntryPanel } from './families/[id]/promises/promise-entry';
import {
  PromiseWorkflow,
  buildPromisesHref,
  eligibleFulfillmentPayments,
} from './families/[id]/promises/promise-workflow';

const FAMILY_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4c01';
const USER_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4c05';

const payment = (overrides: Partial<Payment> = {}): Payment => ({
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4c20',
  familyId: FAMILY_ID,
  amountToman: '700000',
  method: 'CARD',
  receivedOn: '2026-08-16',
  reference: null,
  note: null,
  status: 'CONFIRMED',
  createdAt: '2026-08-16T08:00:00.000Z',
  createdByUserId: USER_ID,
  voidedAt: null,
  voidedByUserId: null,
  voidReason: null,
  ...overrides,
});

const promise = (overrides: Partial<PaymentPromise> = {}): PaymentPromise => ({
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4c10',
  familyId: FAMILY_ID,
  amountToman: '500000',
  dueOn: '2026-08-16',
  note: 'تماس صبح',
  status: 'OPEN',
  createdAt: '2026-08-15T08:00:00.000Z',
  createdByUserId: USER_ID,
  resolvedAt: null,
  resolvedByUserId: null,
  resolutionReason: null,
  fulfillingPayment: null,
  rescheduledToPromiseId: null,
  rescheduledFromPromiseId: null,
  ...overrides,
});

const promises: PaymentPromise[] = [
  promise(),
  promise({ id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4c11', status: 'MISSED', dueOn: '2026-08-15' }),
  promise({
    id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4c12',
    status: 'FULFILLED',
    resolvedAt: '2026-08-16T09:00:00.000Z',
    resolvedByUserId: USER_ID,
    fulfillingPayment: payment({
      status: 'VOIDED',
      voidedAt: '2026-08-16T10:00:00.000Z',
      voidedByUserId: USER_ID,
      voidReason: 'اصلاح ثبت',
    }),
  }),
  promise({
    id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4c13',
    status: 'RESCHEDULED',
    resolvedAt: '2026-08-16T09:00:00.000Z',
    resolvedByUserId: USER_ID,
    resolutionReason: 'هماهنگی خانواده',
    rescheduledToPromiseId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4c14',
  }),
  promise({
    id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4c14',
    status: 'CANCELLED',
    resolvedAt: '2026-08-16T09:00:00.000Z',
    resolvedByUserId: USER_ID,
    resolutionReason: 'پایان پیگیری',
    rescheduledFromPromiseId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4c13',
  }),
];

const result: PromiseListResponse = {
  familyId: FAMILY_ID,
  promises,
  page: { page: 1, pageSize: 25, total: 5, hasMore: false },
};

describe('promise entry and history workflow', () => {
  const candidates = [
    payment(),
    payment({ id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4c21', amountToman: '100000' }),
    payment({
      id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4c22',
      status: 'VOIDED',
      voidedAt: '2026-08-16T10:00:00.000Z',
      voidedByUserId: USER_ID,
      voidReason: 'اصلاح',
    }),
  ];
  const markup = renderToStaticMarkup(
    createElement(PromiseWorkflow, {
      familyId: FAMILY_ID,
      result,
      query: { page: 1, pageSize: 25 },
      payments: candidates,
      csrfToken: 'synthetic-csrf',
      canResolve: true,
      clinicTodayJalali: { year: 1405, month: 5, day: 25 },
    }),
  );

  it('renders all five server-stated statuses with text and keeps terminal history', () => {
    for (const label of [
      'باز و در موعد',
      'از موعد گذشته',
      'انجام‌شده',
      'زمان‌بندی مجدد',
      'لغوشده',
    ]) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain('این قول از موعد گذشته و هنوز برای پیگیری باز است');
    expect(markup).toContain('هماهنگی خانواده');
    expect(markup).toContain('پایان پیگیری');
  });

  it('offers only confirmed and amount-sufficient payments without claiming unused status', () => {
    const eligible = eligibleFulfillmentPayments(promises[0]!, candidates);
    expect(eligible.map((item) => item.id)).toEqual([candidates[0]!.id]);
    expect(markup).toContain(`value="${candidates[0]!.id}"`);
    expect(markup).not.toContain(`value="${candidates[1]!.id}"`);
    expect(markup).not.toContain(`value="${candidates[2]!.id}"`);
    expect(markup).not.toContain('استفاده‌نشده');
    expect(markup).toContain('اتصال نهایی را سرور بررسی می‌کند');
  });

  it('shows a later-voided fulfilling payment truthfully and preserves reschedule links', () => {
    expect(markup).toContain('پرداخت بعداً باطل شده است');
    expect(markup).toContain('سابقهٔ قول همچنان انجام‌شده باقی مانده است');
    expect(markup).toContain(`#promise-${promises[3]!.rescheduledToPromiseId}`);
    expect(markup).toContain(`#promise-${promises[4]!.rescheduledFromPromiseId}`);
  });

  it('requires reschedule/cancel reasons and exposes actions to any permission holder', () => {
    expect(markup).toContain('action="/api/promises/fulfill"');
    expect(markup).toContain('action="/api/promises/reschedule"');
    expect(markup).toContain('action="/api/promises/cancel"');
    expect(markup.match(/name="reason" required=""/g)).toHaveLength(4);
    const readonly = renderToStaticMarkup(
      createElement(PromiseWorkflow, {
        familyId: FAMILY_ID,
        result,
        query: { page: 1, pageSize: 25 },
        payments: candidates,
        csrfToken: 'synthetic-csrf',
        canResolve: false,
        clinicTodayJalali: { year: 1405, month: 5, day: 25 },
      }),
    );
    expect(readonly).not.toContain('/api/promises/');
  });

  it('keeps promise pagination independent', () => {
    expect(buildPromisesHref(FAMILY_ID, { page: 2, pageSize: 25, status: 'MISSED' }, 3)).toContain(
      'page=3&pageSize=25&status=MISSED',
    );
  });
});

describe('promise creation', () => {
  const markup = renderToStaticMarkup(
    createElement(PromiseEntryPanel, {
      familyId: FAMILY_ID,
      csrfToken: 'synthetic-csrf',
      clinicTodayJalali: { year: 1405, month: 5, day: 25 },
    }),
  );

  it('posts only amount, Jalali due date and optional note with no follow-up field', () => {
    expect(markup).toContain('action="/api/promises/create"');
    for (const field of ['amountToman', 'dueOn-year', 'dueOn-month', 'dueOn-day', 'note']) {
      expect(markup).toContain(`name="${field}"`);
    }
    expect(markup).not.toContain('follow_up_date');
    expect(markup).not.toContain('followUpDate');
  });

  it('uses Server Components and leaves overdue derivation to the returned status', () => {
    for (const file of ['promise-entry.tsx', 'promise-workflow.tsx', 'page.tsx']) {
      const source = readFileSync(
        new URL(`./families/[id]/promises/${file}`, import.meta.url),
        'utf8',
      );
      expect(source).not.toMatch(/^['"]use client['"]/);
      expect(source).not.toMatch(/useState|useEffect/);
    }
    expect(
      readFileSync(new URL('./families/[id]/promises/page.tsx', import.meta.url), 'utf8'),
    ).toContain('FamilyFinancialPositionPanel');
  });
});
