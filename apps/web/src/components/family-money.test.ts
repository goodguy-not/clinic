import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { COPY } from '@/server/copy-fa';
import { FamilyFinancialPositionPanel } from './family-financial-position';
import { FamilyMoneyNavigation } from './family-money-navigation';

const FAMILY_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d01';

describe('whole-family money infrastructure', () => {
  it('renders every server-stated position fact and the historical-debt limitation', () => {
    const markup = renderToStaticMarkup(
      createElement(FamilyFinancialPositionPanel, {
        position: {
          netChargedTotalToman: '1500000',
          confirmedPaymentTotalToman: '500000',
          creditToman: '0',
          amountDueToman: '1000000',
          paymentCount: 2,
          voidedPaymentCount: 1,
          lastPayment: {
            id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d02',
            amountToman: '500000',
            method: 'TRANSFER',
            receivedOn: '2026-08-15',
            status: 'CONFIRMED',
          },
          openPromiseCount: 3,
          missedPromiseCount: 1,
        },
      }),
    );

    expect(markup).toContain('مبلغ قابل پرداخت');
    expect(markup).toContain('۱٬۰۰۰٬۰۰۰ تومان');
    expect(markup).toContain('جمع مبلغ مؤثر');
    expect(markup).toContain('جمع پرداخت تأییدشده');
    expect(markup).toContain('پرداخت باطل‌شده');
    expect(markup).toContain('قول باز و در موعد');
    expect(markup).toContain('قول از موعد گذشته');
    expect(markup).toContain('انتقال بانکی');
    expect(markup).toContain('۱۴۰۵');
    expect(markup).toContain(COPY.familyFinancialPositionHistoricalWarning);
    expect(markup).not.toMatch(/balance/i);
  });

  it('provides a mobile-safe labelled nav whose active state is not colour-only', () => {
    const markup = renderToStaticMarkup(
      createElement(FamilyMoneyNavigation, { familyId: FAMILY_ID, active: 'payments' }),
    );

    expect(markup).toContain('aria-label="بخش‌های مالی خانواده"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('●');
    expect(markup).toContain('overflow-x-auto');
    expect(markup).toContain('min-w-max');
    expect(markup).toContain(`/families/${FAMILY_ID}/account`);
    expect(markup).toContain(`/families/${FAMILY_ID}/payments`);
    expect(markup).toContain(`/families/${FAMILY_ID}/promises`);
  });

  it('keeps the reusable B0 UI server-rendered and RTL-logical', () => {
    for (const file of ['family-financial-position.tsx', 'family-money-navigation.tsx']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source).not.toMatch(/^['"]use client['"]/m);
      expect(source).not.toMatch(/\b(?:left|right)-(?:\d+|auto)\b/);
    }
  });
});
