import { describe, expect, it } from 'vitest';
import { percentageToBasisPoints, settlementReturnPath } from './settlement-forms';

describe('settlement form shaping', () => {
  it('accepts Persian and western percent input without floating-point arithmetic', () => {
    expect(percentageToBasisPoints('۴۲٫۵')).toBe(4250);
    expect(percentageToBasisPoints('42.50')).toBe(4250);
    expect(percentageToBasisPoints('100')).toBe(10000);
  });

  it('refuses over-precision and out-of-range values', () => {
    expect(percentageToBasisPoints('42.555')).toBeNull();
    expect(percentageToBasisPoints('100.01')).toBeNull();
    expect(percentageToBasisPoints('-1')).toBeNull();
  });

  it('builds a privacy-safe identifier-and-date return path', () => {
    expect(settlementReturnPath('abc', '2026-08-01', '2026-08-31')).toBe(
      '/settlements/abc?from=2026-08-01&to=2026-08-31',
    );
  });
});
