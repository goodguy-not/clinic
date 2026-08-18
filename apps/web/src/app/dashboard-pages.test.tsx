import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  dashboardResponseSchema,
  type ClinicWideDashboardResponse,
  type OwnScopedDashboardResponse,
} from '@clinic/contracts';
import { COPY } from '@/server/copy-fa';
import { DashboardView } from './dashboard-view';
import Loading from './loading';

const PAYMENT_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4e01';
const FAMILY_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4e02';
const USER_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4e03';

const methods = [
  { method: 'CASH' as const, count: 0, totalToman: '0' },
  { method: 'CARD' as const, count: 1, totalToman: '700000' },
  { method: 'TRANSFER' as const, count: 0, totalToman: '0' },
];

const own: OwnScopedDashboardResponse = {
  financialScope: 'OWN_ENTRIES_ONLY',
  date: '2026-08-18',
  availabilityOverrideCount: 1,
  appointments: {
    total: 4,
    scheduled: 2,
    completed: 1,
    cancelled: 1,
    unresolvedOutcomes: 2,
    noShows: 1,
  },
  promises: { dueTodayCount: 1, missedCount: 3 },
  dataIssues: { missingTariffCount: 2, unchargedCompletedSessionCount: 1 },
  reconciliation: {
    scope: 'RECORDED_BY_ME',
    dateBasis: 'PAYMENT_RECORDED_AT',
    confirmedCount: 1,
    confirmedTotalToman: '700000',
    voidedCount: 0,
    byMethod: methods,
    entries: [
      {
        payment: {
          id: PAYMENT_ID,
          amountToman: '700000',
          method: 'CARD',
          receivedOn: '2026-08-16',
          status: 'CONFIRMED',
        },
        family: { id: FAMILY_ID, familyName: 'خانوادهٔ آزمایشی' },
      },
    ],
  },
};

const clinicWide: ClinicWideDashboardResponse = {
  ...own,
  financialScope: 'CLINIC_WIDE',
  clinicFinancial: {
    payments: {
      dateBasis: 'PAYMENT_RECORDED_AT',
      confirmedCount: 2,
      confirmedTotalToman: '1700000',
      voidedCount: 1,
      byMethod: [
        { method: 'CASH', count: 1, totalToman: '1000000' },
        { method: 'CARD', count: 1, totalToman: '700000' },
        { method: 'TRANSFER', count: 0, totalToman: '0' },
      ],
      byUser: [
        {
          user: { id: USER_ID, displayName: 'مدیر آزمایشی' },
          confirmedCount: 2,
          confirmedTotalToman: '1700000',
          voidedCount: 1,
        },
      ],
    },
    charges: {
      dateBasis: 'SESSION_DATE',
      chargeCount: 3,
      netChargedTotalToman: '2400000',
      voidedChargeCount: 1,
    },
  },
};

const render = (dashboard: OwnScopedDashboardResponse | ClinicWideDashboardResponse): string =>
  renderToStaticMarkup(createElement(DashboardView, { dashboard }));

describe('daily dashboard authority variants', () => {
  it('renders the own-scoped response without a clinic-wide financial path', () => {
    const markup = render(own);

    expect(markup).toContain(COPY.dashboardMyReconciliation);
    expect(markup).toContain('۷۰۰٬۰۰۰ تومان');
    expect(markup).toContain(COPY.dashboardReceivedOn);
    expect(markup).not.toContain(COPY.dashboardClinicFinancial);
    expect(markup).not.toContain('۱٬۷۰۰٬۰۰۰ تومان');
  });

  it('branches on CLINIC_WIDE and keeps payments separate from session-date charges', () => {
    const markup = render(clinicWide);

    expect(markup).toContain(COPY.dashboardClinicFinancial);
    expect(markup).toContain('۱٬۷۰۰٬۰۰۰ تومان');
    expect(markup).toContain('۲٬۴۰۰٬۰۰۰ تومان');
    expect(markup).toContain(COPY.dashboardClinicPayments);
    expect(markup).toContain(COPY.dashboardClinicCharges);
  });

  it('strictly refuses clinic financial data on an own-scoped wire response', () => {
    expect(
      dashboardResponseSchema.safeParse({ ...own, clinicFinancial: clinicWide.clinicFinancial })
        .success,
    ).toBe(false);
  });
});

describe('daily dashboard operational states', () => {
  it('shows the two overlapping data issues as separate counts and never invents a total', () => {
    const markup = render(own);

    expect(markup).toContain(COPY.dashboardMissingTariff);
    expect(markup).toContain(COPY.dashboardUnchargedSession);
    expect(markup).toContain(COPY.dashboardIssuesOverlap);
    expect(markup).not.toContain('مجموع خطا');
  });

  it('renders recorded availability overrides as an operational fact, not a data issue', () => {
    const markup = render({
      ...own,
      appointments: { ...own.appointments, unresolvedOutcomes: 0 },
      availabilityOverrideCount: 1,
      promises: { dueTodayCount: 0, missedCount: 0 },
      dataIssues: { missingTariffCount: 0, unchargedCompletedSessionCount: 0 },
    });

    expect(markup).toContain(COPY.dashboardAvailabilityOverrides);
    expect(markup).toContain(COPY.dashboardAvailabilityOverridesHelp);
    expect(markup).toContain(COPY.dashboardAttentionClear);
    expect(markup).toContain('/appointments?date=2026-08-18');
    expect(markup.indexOf(COPY.dashboardAvailabilityOverrides)).toBeLessThan(
      markup.indexOf(COPY.dashboardAttention),
    );
  });

  it('provides useful quiet-day, no-payment and loading states', () => {
    const quiet = render({
      ...own,
      appointments: {
        total: 0,
        scheduled: 0,
        completed: 0,
        cancelled: 0,
        unresolvedOutcomes: 0,
        noShows: 0,
      },
      promises: { dueTodayCount: 0, missedCount: 0 },
      availabilityOverrideCount: 0,
      dataIssues: { missingTariffCount: 0, unchargedCompletedSessionCount: 0 },
      reconciliation: {
        ...own.reconciliation,
        confirmedCount: 0,
        confirmedTotalToman: '0',
        entries: [],
      },
    });
    const loading = renderToStaticMarkup(createElement(Loading));

    expect(quiet).toContain(COPY.dashboardNoAppointments);
    expect(quiet).toContain(COPY.dashboardAttentionClear);
    expect(quiet).toContain(COPY.dashboardAvailabilityOverrides);
    expect(quiet).toContain(COPY.dashboardNoPayments);
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain(COPY.dashboardLoading);
  });

  it('keeps the dashboard server rendered and its failure state actionable', () => {
    const viewSource = readFileSync(new URL('dashboard-view.tsx', import.meta.url), 'utf8');
    const pageSource = readFileSync(new URL('page.tsx', import.meta.url), 'utf8');

    expect(viewSource).not.toMatch(/^['"]use client['"]/m);
    expect(viewSource).toContain("dashboard.financialScope === 'CLINIC_WIDE'");
    expect(pageSource).toContain('requirePermission: DASHBOARD_READ_PERMISSIONS');
    expect(pageSource).toContain('COPY.dashboardLoadFailure');
    expect(pageSource).toContain('COPY.dashboardRetry');
  });
});

describe('header responsive boundary', () => {
  it('uses the compact native disclosure through 1280px and a bounded mobile menu', () => {
    const source = readFileSync(new URL('../components/app-header.tsx', import.meta.url), 'utf8');

    expect(source).toContain('max-w-7xl');
    expect(source).toContain('const primaryLinks = links.slice(0, 3)');
    expect(source).toContain('const managementLinks = links.slice(3)');
    expect(source).toContain('lg:hidden');
    expect(source).toContain('lg:flex');
    expect(source).toContain('max-w-[calc(100vw-2rem)]');
    expect(source).toContain('max-h-[calc(100dvh-5rem)]');
  });
});
