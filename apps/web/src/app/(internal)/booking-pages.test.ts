import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  AppointmentSeriesDetail,
  FamilySummary,
  Room,
  Service,
  Therapist,
} from '@clinic/contracts';
import { BookingPanel } from './appointments/new/booking-panel';
import { SeriesDetail } from './appointment-series/series-detail';

const ID = (last: string) => `0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a${last}`;
const service: Service = {
  id: ID('1'),
  name: 'گفتاردرمانی',
  publicDescription: null,
  publicSlug: null,
  publicFirstPublishedAt: null,
  isPublic: false,
  status: 'ACTIVE',
  deactivatedAt: null,
  allowedDurationsMinutes: [45],
  createdAt: '2026-08-01T00:00:00.000Z',
};
const therapist: Therapist = {
  id: ID('2'),
  fullName: 'درمانگر نمونه',
  specialty: 'گفتاردرمانی',
  status: 'ACTIVE',
  deactivatedAt: null,
  supportedServiceIds: [service.id],
  createdAt: '2026-08-01T00:00:00.000Z',
};
const room: Room = {
  id: ID('3'),
  name: 'اتاق یک',
  status: 'ACTIVE',
  deactivatedAt: null,
  allowedServiceIds: [],
  createdAt: '2026-08-01T00:00:00.000Z',
};
const family: FamilySummary = {
  id: ID('4'),
  familyName: 'خانواده نمونه',
  status: 'ACTIVE',
  deactivatedAt: null,
  primaryGuardian: {
    fullName: 'سرپرست نمونه',
    relationship: 'MOTHER',
    mobile: '09120000000',
    landline: null,
  },
  guardianCount: 1,
  children: [
    {
      id: ID('5'),
      firstName: 'کودک',
      lastName: 'نمونه',
      fileNumber: '14050001',
      birthDate: '2020-01-01',
      status: 'ACTIVE',
    },
  ],
  childCount: 1,
  awaitingFirstChild: false,
  createdAt: '2026-08-01T00:00:00.000Z',
};

describe('B3 booking workflow', () => {
  it('keeps private search in a POST form and exposes only the approved availability override', () => {
    const markup = renderToStaticMarkup(
      createElement(BookingPanel, {
        state: {
          intent: {},
          families: [family],
          searchTruncated: false,
          searchPerformed: true,
          preview: null,
          errorMessage: null,
          finalCreateConflict: false,
        },
        services: [service],
        therapists: [therapist],
        rooms: [room],
        canOverrideAvailability: true,
        pending: false,
      }),
    );
    expect(markup).toContain('name="familySearch"');
    expect(markup).toContain('name="childId"');
    expect(markup).toContain('name="availabilityOverrideReason"');
    expect(markup).not.toContain('skipConflicting');
    expect(markup).not.toContain('price');
    expect(markup).not.toContain('payment');
  });

  it('distinguishes clean, availability, and hard-conflict preview occurrences', () => {
    const preview = {
      pattern: {
        weekday: 4,
        startTime: '09:00',
        endTime: '09:45',
        durationMinutes: 45,
        intervalWeeks: 1,
        endMode: 'OCCURRENCE_COUNT' as const,
        occurrenceCount: 3,
        endsOn: null,
      },
      occurrences: [
        {
          index: 0,
          date: '2026-08-13',
          startsAt: '2026-08-13T05:30:00.000Z',
          endsAt: '2026-08-13T06:15:00.000Z',
          outsideAvailability: false,
          outsideAvailabilityReason: null,
          conflicts: [],
          blockedBy: null,
        },
        {
          index: 1,
          date: '2026-08-20',
          startsAt: '2026-08-20T05:30:00.000Z',
          endsAt: '2026-08-20T06:15:00.000Z',
          outsideAvailability: true,
          outsideAvailabilityReason: 'OUTSIDE_WORKING_HOURS' as const,
          conflicts: [],
          blockedBy: null,
        },
        {
          index: 2,
          date: '2026-08-27',
          startsAt: '2026-08-27T05:30:00.000Z',
          endsAt: '2026-08-27T06:15:00.000Z',
          outsideAvailability: false,
          outsideAvailabilityReason: null,
          conflicts: [
            {
              resource: 'ROOM' as const,
              resourceId: ID('3'),
              appointmentId: ID('9'),
              startsAt: '2026-08-27T05:30:00.000Z',
              endsAt: '2026-08-27T06:15:00.000Z',
            },
          ],
          blockedBy: 'APPOINTMENT_ROOM_CONFLICT' as const,
        },
      ],
      blockedCount: 1,
      bookable: false,
    };
    const markup = renderToStaticMarkup(
      createElement(BookingPanel, {
        state: {
          intent: { bookingMode: 'recurring' },
          families: [family],
          searchTruncated: false,
          searchPerformed: true,
          preview,
          errorMessage: null,
          finalCreateConflict: false,
        },
        services: [service],
        therapists: [therapist],
        rooms: [room],
        canOverrideAvailability: true,
        pending: false,
      }),
    );
    expect(markup).toContain('آمادهٔ ثبت');
    expect(markup).toContain('خارج از برنامهٔ حضور؛ با دلیل مجاز');
    expect(markup).toContain('این اتاق در این بازهٔ زمانی رزرو شده است');
    expect(markup).not.toContain('value="create-series"');
  });
});

describe('series tail operations', () => {
  it('offers update/cancel-from while linking occurrences to the accepted lifecycle', () => {
    const detail: AppointmentSeriesDetail = {
      series: {
        id: ID('6'),
        intervalWeeks: 1,
        startsOn: '2026-08-13',
        endMode: 'OCCURRENCE_COUNT',
        occurrenceCount: 1,
        endsOn: null,
        createdAt: '2026-08-01T00:00:00.000Z',
      },
      occurrences: [
        {
          appointment: {
            id: ID('7'),
            serviceId: service.id,
            durationMinutes: 45,
            therapistId: therapist.id,
            roomId: room.id,
            startsAt: '2026-08-13T05:30:00.000Z',
            endsAt: '2026-08-13T06:15:00.000Z',
            status: 'SCHEDULED',
            seriesId: ID('6'),
            note: null,
            completedAt: null,
            cancelledAt: null,
            cancellationReason: null,
            availabilityOverrideReason: null,
            createdAt: '2026-08-01T00:00:00.000Z',
          },
          participants: [
            {
              id: ID('8'),
              appointmentId: ID('7'),
              childId: family.children[0]!.id,
              attendance: 'PENDING',
              attendanceRecordedAt: null,
            },
          ],
        },
      ],
    };
    const markup = renderToStaticMarkup(
      createElement(SeriesDetail, {
        detail,
        children: new Map(),
        services: [service],
        therapists: [therapist],
        rooms: [room],
        csrfToken: 'csrf',
        canUpdate: true,
        canCancel: true,
        canOverride: true,
        errorMessage: null,
        successMessage: null,
      }),
    );
    expect(markup).toContain('/api/appointment-series/update-from');
    expect(markup).toContain('/api/appointment-series/cancel-from');
    expect(markup).toContain(`/appointments/${ID('7')}`);
  });
});
