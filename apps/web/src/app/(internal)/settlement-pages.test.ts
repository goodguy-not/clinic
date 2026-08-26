import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const detail = readFileSync(join(__dirname, 'settlements', '[therapistId]', 'page.tsx'), 'utf8');
const index = readFileSync(join(__dirname, 'settlements', 'page.tsx'), 'utf8');
const familyAccount = readFileSync(
  join(__dirname, 'families', '[id]', 'account', 'page.tsx'),
  'utf8',
);
const periodDetail = readFileSync(
  join(__dirname, 'settlements', 'periods', '[id]', 'page.tsx'),
  'utf8',
);

describe('manager settlement surfaces', () => {
  it('gates both entry and detail pages on settlement.read', () => {
    expect(index).toContain("requirePermission: 'settlement.read'");
    expect(detail).toContain("requirePermission: 'settlement.read'");
    expect(periodDetail).toContain("requirePermission: 'settlement.read'");
  });

  it('offers the accepted CSV only under report.export on the settlement-read page', () => {
    expect(detail).toContain("user.permissions.includes('report.export')");
    expect(detail).toContain("kind: 'settlement'");
    expect(detail).toContain('filters: parsed.data');
  });

  it('keeps rating discovery out of the receptionist family-account response', () => {
    expect(familyAccount).toContain("user.permissions.includes('settlement.rate')");
    expect(familyAccount).toContain('api.readSessionRating');
    expect(familyAccount).toContain(': []');
  });

  it('renders one row per charge and does not render correction lines as sessions', () => {
    expect(detail).toContain('key={line.sessionChargeId}');
    expect(detail).toContain('اصلاح تسویهٔ معلق');
    expect(detail).not.toContain("line.lineType === 'CORRECTION'");
  });

  it('states FREE, unrated and uncharged as separate exceptions', () => {
    expect(detail).toContain('بدون ثبت سهم');
    expect(detail).toContain('جلسهٔ رایگان');
    expect(detail).toContain('انجام‌شدهٔ بدون هزینه');
  });

  it('labels a statement row FREE only from authoritative priceMode', () => {
    expect(detail).toContain("line.priceMode === 'FREE'");
    expect(detail).not.toMatch(/baseAmountToman\s*===\s*['"]0['"]/);
  });

  it('requires deliberate close confirmation and explains excluded unrated sessions', () => {
    expect(detail).toContain('name="confirm"');
    expect(detail).toContain('صفر نیستند، بسته نمی‌شوند');
    expect(detail).toContain('ورودی تاریخی');
  });

  it('uses the existing print surface and contains no payout or debt vocabulary', () => {
    expect(detail).toContain('<ReportActions');
    for (const forbidden of ['بدهکار', 'طلبکار', 'قابل پرداخت', 'مانده بدهی']) {
      expect(detail).not.toContain(forbidden);
    }
  });
});
