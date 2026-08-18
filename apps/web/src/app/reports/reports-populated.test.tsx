import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b01';
const ID2 = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b02';
const ID3 = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b03';
const ID4 = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b04';

const apiMock = vi.hoisted(() => ({
  sessionReport: vi.fn(),
  promiseReport: vi.fn(),
  therapistActivityReport: vi.fn(),
  listTherapists: vi.fn(),
  listServices: vi.fn(),
  listRooms: vi.fn(),
}));

vi.mock('@/server/api-client', () => ({ api: apiMock }));
vi.mock('@/server/auth-session', () => ({
  requireSession: vi.fn(async () => ({ permissions: ['appointment.read', 'promise.read'] })),
  readSessionToken: vi.fn(async () => 'token'),
  readCsrfCookie: vi.fn(async () => 'csrf'),
  callerContext: vi.fn(async () => ({ sessionToken: 'token' })),
}));
vi.mock('@/components/app-header', () => ({ AppHeader: vi.fn(() => null) }));

import PromisesPage from './promises/page';
import SessionsPage from './sessions/page';
import ActivityPage from './therapist-activity/page';

const range = { from: '2026-08-01', to: '2026-08-18', dateBasis: 'SESSION_DATE' as const };
const page = { page: 1, pageSize: 25, total: 1, hasMore: false };

beforeEach(() => {
  apiMock.listTherapists.mockResolvedValue({
    ok: true,
    data: {
      therapists: [
        { id: ID3, fullName: 'درمانگر نمونه', status: 'ACTIVE', supportedServiceIds: [] },
      ],
    },
  });
  apiMock.listServices.mockResolvedValue({
    ok: true,
    data: {
      services: [{ id: ID4, name: 'گفتاردرمانی', status: 'ACTIVE', allowedDurationsMinutes: [45] }],
    },
  });
  apiMock.listRooms.mockResolvedValue({
    ok: true,
    data: { rooms: [{ id: ID4, name: 'اتاق یک', status: 'ACTIVE', supportedServiceIds: null }] },
  });
});

describe('representative populated operational reports', () => {
  it('renders a seat-level session row with Persian/Jalali presentation and drill-through', async () => {
    apiMock.sessionReport.mockResolvedValue({
      ok: true,
      data: {
        range,
        summary: {
          total: 1,
          scheduled: 0,
          completed: 1,
          cancelled: 0,
          attended: 1,
          noShows: 0,
          unresolvedOutcomes: 0,
          totalDurationMinutes: 45,
        },
        page,
        sessions: [
          {
            appointmentId: ID,
            participantId: ID2,
            date: '2026-08-18',
            startsAt: '2026-08-18T06:30:00.000Z',
            durationMinutes: 45,
            status: 'COMPLETED',
            attendance: 'ATTENDED',
            family: { id: ID2, familyName: 'خانوادهٔ نمونه' },
            child: { id: ID2, firstName: 'آوا', lastName: 'نمونه', fileNumber: '1001' },
            therapist: { id: ID3, fullName: 'درمانگر نمونه' },
            service: { id: ID4, name: 'گفتاردرمانی' },
            room: { id: ID4, name: 'اتاق یک' },
          },
        ],
      },
    });
    const markup = renderToStaticMarkup(
      await SessionsPage({ searchParams: Promise.resolve({ from: range.from, to: range.to }) }),
    );
    expect(markup).toContain('آوا نمونه');
    expect(markup).toContain(`/appointments/${ID}`);
    expect(markup).toContain('۴۵');
    expect(markup).toContain('۱۴۰۵');
  });

  it('renders server-stated MISSED without inventing a promised total', async () => {
    apiMock.promiseReport.mockResolvedValue({
      ok: true,
      data: {
        range: { ...range, dateBasis: 'PROMISE_DUE_ON' },
        summary: { total: 1, open: 0, missed: 1, fulfilled: 0, rescheduled: 0, cancelled: 0 },
        page,
        promises: [
          {
            id: ID,
            family: { id: ID2, familyName: 'خانوادهٔ نمونه' },
            amountToman: '700000',
            dueOn: '2026-08-10',
            status: 'MISSED',
            createdAt: '2026-08-01T08:00:00.000Z',
            resolvedAt: null,
          },
        ],
      },
    });
    const markup = renderToStaticMarkup(
      await PromisesPage({ searchParams: Promise.resolve({ from: range.from, to: range.to }) }),
    );
    expect(markup).toContain('از موعد گذشته');
    expect(markup).toContain('فقط مبلغ ثبت‌شدهٔ این قول');
    expect(markup).not.toContain('جمع مبلغ قول');
  });

  it('renders counts and attended duration with explicit non-financial framing', async () => {
    apiMock.therapistActivityReport.mockResolvedValue({
      ok: true,
      data: {
        range,
        totals: {
          therapistCount: 1,
          scheduledCount: 1,
          completedCount: 1,
          cancelledCount: 0,
          attendedCount: 1,
          noShowCount: 0,
          unresolvedOutcomeCount: 0,
          attendedDurationMinutes: 45,
        },
        therapists: [
          {
            therapist: { id: ID3, fullName: 'درمانگر نمونه' },
            scheduledCount: 1,
            completedCount: 1,
            cancelledCount: 0,
            attendedCount: 1,
            noShowCount: 0,
            unresolvedOutcomeCount: 0,
            attendedDurationMinutes: 45,
          },
        ],
      },
    });
    const markup = renderToStaticMarkup(
      await ActivityPage({ searchParams: Promise.resolve({ from: range.from, to: range.to }) }),
    );
    expect(markup).toContain('این گزارش مالی یا تسویه نیست');
    expect(markup).toContain('۴۵ دقیقه');
    expect(markup).not.toContain('تومان');
  });
});
