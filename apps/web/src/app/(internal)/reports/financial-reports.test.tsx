import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const FAMILY = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4e01';
const PAYMENT = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4e02';
const USER = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4e03';

const apiMock = vi.hoisted(() => ({
  paymentReport: vi.fn(),
  familyAccountReport: vi.fn(),
  listUsers: vi.fn(),
}));

vi.mock('@/server/api-client', () => ({ api: apiMock }));
vi.mock('@/server/auth-session', () => ({
  requireSession: vi.fn(async () => ({ permissions: ['report.read_financial'] })),
  readSessionToken: vi.fn(async () => 'token'),
  readCsrfCookie: vi.fn(async () => 'csrf'),
  callerContext: vi.fn(async () => ({ sessionToken: 'token' })),
}));
vi.mock('@/components/app-header', () => ({ AppHeader: vi.fn(() => null) }));
vi.mock('./family-report-filter', () => ({ FamilyReportFilter: vi.fn(() => null) }));

import AccountsPage from './family-accounts/page';
import PaymentsPage from './payments/page';

const page = { page: 1, pageSize: 25, total: 1, hasMore: false };
const position = {
  netChargedTotalToman: '2000000',
  confirmedPaymentTotalToman: '750000',
  creditToman: '0',
  amountDueToman: '1250000',
  paymentCount: 1,
  voidedPaymentCount: 0,
  lastPayment: {
    id: PAYMENT,
    amountToman: '750000',
    method: 'CARD' as const,
    receivedOn: '2026-08-12',
    status: 'CONFIRMED' as const,
  },
  openPromiseCount: 1,
  missedPromiseCount: 2,
};

beforeEach(() => {
  apiMock.listUsers.mockResolvedValue({ ok: true, data: { users: [] } });
});

describe('financial report presentation', () => {
  it('shows receipt date beside a distinct recording instant and server-stated period totals', async () => {
    apiMock.paymentReport.mockResolvedValue({
      ok: true,
      data: {
        range: {
          from: '2026-08-01',
          to: '2026-08-18',
          dateBasis: 'PAYMENT_RECEIVED_ON',
        },
        totals: {
          confirmedCount: 1,
          confirmedTotalToman: '750000',
          voidedCount: 0,
          byMethod: [
            { method: 'CASH', confirmedCount: 0, confirmedTotalToman: '0' },
            { method: 'CARD', confirmedCount: 1, confirmedTotalToman: '750000' },
            { method: 'TRANSFER', confirmedCount: 0, confirmedTotalToman: '0' },
          ],
          byUser: [
            {
              user: { id: USER, displayName: 'مدیر نمونه' },
              confirmedCount: 1,
              confirmedTotalToman: '750000',
              voidedCount: 0,
            },
          ],
        },
        payments: [
          {
            id: PAYMENT,
            family: { id: FAMILY, familyName: 'خانوادهٔ نمونه' },
            amountToman: '750000',
            method: 'CARD',
            receivedOn: '2026-08-12',
            status: 'CONFIRMED',
            recordedAt: '2026-08-18T08:30:00.000Z',
            recordedBy: { id: USER, displayName: 'مدیر نمونه' },
          },
        ],
        page,
      },
    });

    const markup = renderToStaticMarkup(
      await PaymentsPage({
        searchParams: Promise.resolve({ from: '2026-08-01', to: '2026-08-18' }),
      }),
    );
    expect(markup).toContain('تاریخ دریافت وجه (receivedOn)');
    expect(markup).toContain('زمان ثبت هر ردیف جداگانه');
    expect(markup).toContain('۷۵۰٬۰۰۰ تومان');
    expect(markup).toContain('مدیر نمونه');
    expect(markup).toContain(`/families/${FAMILY}/account`);
    expect(markup).not.toContain('reference');
  });

  it('shows due and credit as separate labeled facts with the system-only disclosure', async () => {
    apiMock.familyAccountReport.mockResolvedValue({
      ok: true,
      data: {
        totals: {
          familyCount: 2,
          owingFamilyCount: 1,
          inCreditFamilyCount: 1,
          totalAmountDueToman: '1250000',
          totalCreditToman: '300000',
        },
        families: [
          { family: { id: FAMILY, familyName: 'خانوادهٔ بدهکار', status: 'INACTIVE' }, position },
          {
            family: {
              id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4e04',
              familyName: 'خانوادهٔ دارای اعتبار',
              status: 'ACTIVE',
            },
            position: {
              ...position,
              confirmedPaymentTotalToman: '2300000',
              amountDueToman: '0',
              creditToman: '300000',
            },
          },
        ],
        page: { ...page, total: 2 },
      },
    });

    const markup = renderToStaticMarkup(await AccountsPage({ searchParams: Promise.resolve({}) }));
    expect(markup).toContain('بدهکار — مبلغ قابل پرداخت');
    expect(markup).toContain('دارای اعتبار — طلب خانواده');
    expect(markup).toContain('سوابق ثبت‌شده در این سامانه');
    expect(markup).toContain('شمارش قول‌ها مبلغ قابل پرداخت را کم نمی‌کند');
    expect(markup).toContain(`/families/${FAMILY}/account`);
    expect(markup).toContain('غیرفعال');
    expect(markup).toContain(
      'غیرفعال‌ها: بدهی و اعتبارشان با فیلتر جایگاهِ انتخاب‌شده نمایش داده می‌شود',
    );
  });

  it('renders successful empty states for both report families', async () => {
    apiMock.paymentReport.mockResolvedValue({
      ok: true,
      data: {
        range: {
          from: '2026-08-01',
          to: '2026-08-18',
          dateBasis: 'PAYMENT_RECEIVED_ON',
        },
        totals: {
          confirmedCount: 0,
          confirmedTotalToman: '0',
          voidedCount: 0,
          byMethod: [],
          byUser: [],
        },
        payments: [],
        page: { ...page, total: 0 },
      },
    });
    apiMock.familyAccountReport.mockResolvedValue({
      ok: true,
      data: {
        totals: {
          familyCount: 0,
          owingFamilyCount: 0,
          inCreditFamilyCount: 0,
          totalAmountDueToman: '0',
          totalCreditToman: '0',
        },
        families: [],
        page: { ...page, total: 0 },
      },
    });

    const payments = renderToStaticMarkup(
      await PaymentsPage({
        searchParams: Promise.resolve({ from: '2026-08-01', to: '2026-08-18' }),
      }),
    );
    const accounts = renderToStaticMarkup(
      await AccountsPage({ searchParams: Promise.resolve({ standing: 'SETTLED' }) }),
    );
    expect(payments).toContain('پرداختی وجود ندارد');
    expect(accounts).toContain('خانواده‌ای با جایگاه انتخاب‌شده');
  });
});
