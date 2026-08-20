import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');
const read = (...parts: string[]) => readFileSync(join(SRC, ...parts), 'utf8');

describe('M7 print treatment', () => {
  it('removes app chrome and controls while keeping RTL multi-page tables readable', () => {
    const css = read('app', 'globals.css');
    expect(css).toContain('@media print');
    expect(css).toContain('.app-chrome');
    expect(css).toContain('.print-hide');
    expect(css).toContain('display: table-header-group');
    expect(css).toContain('break-inside: avoid');
    expect(css).toContain('min-width: 0 !important');
    expect(read('app', 'layout.tsx')).toContain('dir="rtl"');
  });

  it('offers print on dashboard, every approved report, and the family account', () => {
    const surfaces = [
      ['app', 'dashboard-view.tsx'],
      ['app', 'reports', 'sessions', 'page.tsx'],
      ['app', 'reports', 'promises', 'page.tsx'],
      ['app', 'reports', 'therapist-activity', 'page.tsx'],
      ['app', 'reports', 'payments', 'page.tsx'],
      ['app', 'reports', 'family-accounts', 'page.tsx'],
      ['app', 'families', '[id]', 'account', 'page.tsx'],
    ];
    for (const parts of surfaces) expect(read(...parts)).toContain('<ReportActions');
  });

  it('preserves the system-record scope disclosure and invents no receipt framing', () => {
    const copy = read('server', 'copy-fa.ts');
    const account = read('components', 'family-financial-position.tsx');
    expect(copy).toContain('همهٔ سوابق ثبت‌شدهٔ خانواده');
    expect(account).toContain('COPY.familyFinancialPositionScope');
    for (const source of [copy, account, read('app', 'reports', 'report-actions.tsx')]) {
      expect(source).not.toMatch(/رسید رسمی|صورتحساب رسمی|شماره رسید/);
    }
  });
});

describe('M7 export UX boundary', () => {
  it('shows export only from the report.export permission and retains current filters', () => {
    for (const page of [
      'sessions',
      'promises',
      'therapist-activity',
      'payments',
      'family-accounts',
    ]) {
      const source = read('app', 'reports', page, 'page.tsx');
      expect(source).toContain("user.permissions.includes('report.export')");
      expect(source).toContain('filters: exportFilters(query)');
    }
  });

  it('uses recoverable client states and never generates CSV content in Web', () => {
    const action = read('app', 'reports', 'report-actions.tsx');
    const client = read('server', 'api-client.ts');
    expect(action).toContain("'downloading'");
    expect(action).toContain("'failed'");
    expect(action).toContain("fetch('/api/reports/export'");
    expect(action).not.toContain('new Blob');
    expect(client).toContain('/reports/${kind}/export');
    expect(client).toContain('/settlement/statement/export');
    expect(client).not.toMatch(/\.join\(['"]\\r?\\n/);
  });
});
