import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  ResolvedAvailability,
  Therapist,
  TherapistAvailability,
  TherapistAvailabilityException,
} from '@clinic/contracts';
import { AvailabilityDetail } from './availability/availability-detail';
import { AvailabilityList } from './availability/availability-list';

const THERAPIST: Therapist = {
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a60',
  fullName: 'درمانگر نمونه',
  specialty: 'گفتاردرمانی',
  status: 'ACTIVE',
  deactivatedAt: null,
  supportedServiceIds: [],
  createdAt: '2026-08-01T00:00:00.000Z',
};

const WINDOWS: TherapistAvailability[] = [
  {
    id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a61',
    therapistId: THERAPIST.id,
    weekday: 0,
    startTime: '09:00',
    endTime: '13:00',
    createdAt: '2026-08-01T00:00:00.000Z',
  },
];

const EXCEPTIONS: TherapistAvailabilityException[] = [
  {
    id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a62',
    therapistId: THERAPIST.id,
    exceptionDate: '2026-08-15',
    isAvailable: false,
    startTime: null,
    endTime: null,
    reason: 'مرخصی',
    createdAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a63',
    therapistId: THERAPIST.id,
    exceptionDate: '2026-08-15',
    isAvailable: true,
    startTime: '15:00',
    endTime: '18:00',
    reason: 'جلسهٔ جبرانی',
    createdAt: '2026-08-01T00:00:00.000Z',
  },
];

const RESOLVED: ResolvedAvailability = {
  therapistId: THERAPIST.id,
  date: '2026-08-15',
  weekday: 2,
  isClosed: true,
  closedReason: 'مرخصی',
  closedRanges: [],
  windows: [{ startTime: '15:00', endTime: '18:00' }],
};

function detail(canManage: boolean, therapist: Therapist = THERAPIST): string {
  return renderToStaticMarkup(
    createElement(AvailabilityDetail, {
      therapist,
      windows: WINDOWS,
      exceptions: EXCEPTIONS,
      resolved: RESOLVED,
      selectedDate: RESOLVED.date,
      today: '2026-08-13',
      canManage,
      csrfToken: 'synthetic-csrf',
      errorMessage: null,
      success: null,
    }),
  );
}

describe('availability therapist selection', () => {
  it('keeps inactive therapists readable and links by opaque id', () => {
    const markup = renderToStaticMarkup(
      createElement(AvailabilityList, {
        therapists: [{ ...THERAPIST, status: 'INACTIVE' }],
        errorMessage: null,
      }),
    );
    expect(markup).toContain(THERAPIST.fullName);
    expect(markup).toContain('غیرفعال');
    expect(markup).toContain(`/therapists/${THERAPIST.id}/availability`);
  });

  it('announces loading failures and has a useful empty state', () => {
    const failed = renderToStaticMarkup(
      createElement(AvailabilityList, { therapists: [], errorMessage: 'خطای نمونه' }),
    );
    expect(failed).toContain('role="alert"');
    expect(failed).toContain('هنوز درمانگری');
  });
});

describe('availability detail', () => {
  it('shows the whole Saturday-first week and the recurring hours', () => {
    const markup = detail(false);
    expect(markup.indexOf('شنبه')).toBeLessThan(markup.indexOf('جمعه'));
    expect(markup).toContain('۰۹:۰۰');
    expect(markup).toContain('۱۳:۰۰');
  });

  it('explains a closure while preserving an explicit extra window in the resolved result', () => {
    const markup = detail(false);
    expect(markup).toContain('روز بسته');
    expect(markup).toContain('حضور اضافه');
    expect(markup).toContain('ساعت معمول این روز بسته است');
    expect(markup).toContain('۱۵:۰۰');
    expect(markup).toContain('۱۸:۰۰');
  });

  it('gives a receptionist a useful view without mutation actions', () => {
    const markup = detail(false);
    expect(markup).toContain('فقط برای مشاهده');
    expect(markup).not.toContain(`/api/availability/${THERAPIST.id}/windows`);
    expect(markup).not.toContain(`/api/availability/${THERAPIST.id}/exceptions`);
    expect(markup).not.toContain('ذخیرهٔ برنامهٔ هفتگی');
    expect(markup).not.toContain('ثبت روز بسته');
  });

  it('gives a manager all three accepted mutation workflows', () => {
    const markup = detail(true);
    expect(markup).toContain(`/api/availability/${THERAPIST.id}/windows`);
    expect(markup).toContain(`/api/availability/${THERAPIST.id}/exceptions`);
    expect(markup).toContain(`/api/availability/${THERAPIST.id}/exceptions/remove`);
    expect(markup).toContain('ذخیرهٔ برنامهٔ هفتگی');
    expect(markup).toContain('ثبت روز بسته');
    expect(markup).toContain('ثبت حضور اضافه');
  });

  it('keeps an inactive therapist read-only even for a manager', () => {
    const markup = detail(true, {
      ...THERAPIST,
      status: 'INACTIVE',
      deactivatedAt: '2026-08-12T00:00:00.000Z',
    });
    expect(markup).toContain('درمانگر غیرفعال است');
    expect(markup).not.toContain(`/api/availability/${THERAPIST.id}/windows`);
    expect(markup).not.toContain(`/api/availability/${THERAPIST.id}/exceptions`);
  });

  it('announces errors and successful writes', () => {
    const markup = renderToStaticMarkup(
      createElement(AvailabilityDetail, {
        therapist: THERAPIST,
        windows: [],
        exceptions: [],
        resolved: null,
        selectedDate: '2026-08-13',
        today: '2026-08-13',
        canManage: true,
        csrfToken: 'synthetic-csrf',
        errorMessage: 'بازه‌ها هم‌پوشانی دارند',
        success: 'windows',
      }),
    );
    expect(markup.match(/role="alert"/g)).toHaveLength(2);
    expect(markup).toContain('برنامهٔ هفتگی با موفقیت');
    expect(markup).toContain('هنوز تعطیلی یا حضور اضافه‌ای ثبت نشده است');
  });
});
