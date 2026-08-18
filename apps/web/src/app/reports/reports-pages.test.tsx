import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Loading from './loading';
import { MetricGrid, ReportNavigation, ReportTable } from './report-ui';

const ROOT = join(process.cwd(), 'src', 'app', 'reports');
const source = (path: string) => readFileSync(join(ROOT, path), 'utf8');

describe('operational report surfaces', () => {
  it('uses the approved existing authorities for both roles and keeps server components', () => {
    expect(source(join('sessions', 'page.tsx'))).toContain("requirePermission: 'appointment.read'");
    expect(source(join('therapist-activity', 'page.tsx'))).toContain(
      "requirePermission: 'appointment.read'",
    );
    expect(source(join('promises', 'page.tsx'))).toContain("requirePermission: 'promise.read'");
    for (const page of ['sessions', 'promises', 'therapist-activity'])
      expect(source(join(page, 'page.tsx'))).not.toContain("'use client'");
  });

  it('does not derive promise state, session totals, money, or settlement facts', () => {
    const promises = source(join('promises', 'page.tsx'));
    const sessions = source(join('sessions', 'page.tsx'));
    const activity = source(join('therapist-activity', 'page.tsx'));
    expect(promises).toContain('result.data.summary.missed');
    expect(promises).not.toMatch(/dueOn\s*[<>]/);
    expect(sessions).toContain('result.data.summary.totalDurationMinutes');
    expect(activity).not.toMatch(/تومان|درآمد|سهم|settlement|revenue/i);
  });

  it('renders Persian numerals, coherent navigation, keyboard overflow, and loading status', () => {
    const markup = renderToStaticMarkup(
      createElement(
        'div',
        null,
        createElement(ReportNavigation, { active: '/reports/sessions' }),
        createElement(MetricGrid, { items: [['کل', 12]] }),
        createElement(ReportTable, { label: 'ردیف‌ها', children: createElement('tbody') }),
        createElement(Loading),
      ),
    );
    expect(markup).toContain('۱۲');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('role="status"');
  });

  it('posts Jalali filters through the named handler and keeps personal free text out of URLs', () => {
    const handler = source(join('..', 'api', 'reports', 'filter', 'route.ts'));
    expect(handler).toContain('jalaliToIsoDate');
    expect(handler).toContain('sessionReportQuerySchema.safeParse');
    expect(handler).not.toMatch(/guardian|phone|mobile|familyName|childName/i);
  });
});

describe('manager financial report surfaces', () => {
  it('gates both pages on the frozen manager-only authority and keeps them server-rendered', () => {
    const payments = source(join('payments', 'page.tsx'));
    const accounts = source(join('family-accounts', 'page.tsx'));
    expect(payments).toContain('requirePermission: PAYMENT_REPORT_READ_PERMISSIONS');
    expect(accounts).toContain('requirePermission: FAMILY_ACCOUNT_REPORT_READ_PERMISSIONS');
    expect(payments).not.toContain("'use client'");
    expect(accounts).not.toContain("'use client'");
  });

  it('keeps financial navigation hidden unless the resolved user has financial authority', () => {
    const sessions = source(join('sessions', 'page.tsx'));
    const navigation = source('report-ui.tsx');
    expect(sessions).toContain("user.permissions.includes('report.read_financial')");
    expect(navigation).toContain('showFinancial = false');
  });

  it('states payment receipt-date semantics and consumes server totals without adding rows', () => {
    const payments = source(join('payments', 'page.tsx'));
    expect(payments).toContain('تاریخ دریافت وجه (receivedOn)');
    expect(payments).toContain('result.data.totals.confirmedTotalToman');
    expect(payments).not.toMatch(/reduce\(|amountToman\s*[+-]/);
    expect(payments).not.toMatch(/reference|bankReference|allocation|fulfil/i);
  });

  it('keeps whole-family position, due, credit, and promises semantically separate', () => {
    const accounts = source(join('family-accounts', 'page.tsx'));
    expect(accounts).toContain('position.amountDueToman');
    expect(accounts).toContain('position.creditToman');
    expect(accounts).toContain('COPY.familyFinancialPositionHistoricalWarning');
    expect(accounts).toContain('شمارش قول‌ها مبلغ قابل پرداخت را کم نمی‌کند');
    expect(accounts).not.toMatch(/reduce\(|netBalance|clinicBalance/);
  });

  it('uses POST family lookup and puts only the selected opaque id into report URLs', () => {
    const familyFilter = source('family-report-filter.tsx');
    expect(familyFilter).toContain('searchFamiliesAction');
    expect(familyFilter).toContain("search.set('familyId', familyId)");
    expect(familyFilter).not.toMatch(/search\.set\(['"](?:q|name|phone|mobile)/);
  });
});
