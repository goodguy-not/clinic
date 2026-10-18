import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  AppointmentDayResponse,
  AppointmentView,
  Room,
  Service,
  SessionChargeDetail,
  Therapist,
} from '@clinic/contracts';
import type { ParticipantChargeLookup } from '@/ledger/appointment-charge';
import { COPY } from '@/server/copy-fa';
import { AppointmentDay } from './appointments/appointment-day';
import { AppointmentDetail } from './appointments/appointment-detail';
import { AppointmentMoveForm } from './appointments/appointment-move-form';

const APPOINTMENT_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a70';
const PARTICIPANT_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a71';
const THERAPIST_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a72';
const ROOM_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a73';
const SERVICE_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a74';

const VIEW: AppointmentView = {
  appointment: {
    id: APPOINTMENT_ID,
    serviceId: SERVICE_ID,
    durationMinutes: 45,
    therapistId: THERAPIST_ID,
    roomId: ROOM_ID,
    startsAt: '2026-08-13T05:30:00.000Z',
    endsAt: '2026-08-13T06:15:00.000Z',
    status: 'SCHEDULED',
    seriesId: null,
    note: 'یادداشت غیرپزشکی نمونه',
    completedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    availabilityOverrideReason: null,
    createdAt: '2026-08-12T10:00:00.000Z',
  },
  participants: [
    {
      participant: {
        id: PARTICIPANT_ID,
        appointmentId: APPOINTMENT_ID,
        childId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a75',
        attendance: 'PENDING',
        attendanceRecordedAt: null,
      },
      child: {
        id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a75',
        familyId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a76',
        firstName: 'کودک',
        lastName: 'نمونه',
        fileNumber: '14050001',
      },
      noShowDecision: null,
    },
  ],
  service: { id: SERVICE_ID, name: 'گفتاردرمانی' },
  therapist: { id: THERAPIST_ID, fullName: 'درمانگر نمونه' },
  room: { id: ROOM_ID, name: 'اتاق یک' },
  tariffSuggestion: { status: 'MISSING' },
  outcomeUnresolved: true,
  individualOutcome: 'PENDING',
  outcomeOpensAt: '2026-08-13T05:30:00.000Z',
};

const THERAPIST: Therapist = {
  id: THERAPIST_ID,
  fullName: 'درمانگر نمونه',
  specialty: 'گفتاردرمانی',
  status: 'ACTIVE',
  deactivatedAt: null,
  supportedServiceIds: [SERVICE_ID],
  createdAt: '2026-08-01T00:00:00.000Z',
};
const ROOM: Room = {
  id: ROOM_ID,
  name: 'اتاق یک',
  status: 'ACTIVE',
  deactivatedAt: null,
  allowedServiceIds: [],
  createdAt: '2026-08-01T00:00:00.000Z',
};
const SERVICE: Service = {
  id: SERVICE_ID,
  name: 'گفتاردرمانی',
  publicDescription: null,
  publicSlug: null,
  publicFirstPublishedAt: null,
  isPublic: false,
  status: 'ACTIVE',
  deactivatedAt: null,
  allowedDurationsMinutes: [30, 45, 60],
  createdAt: '2026-08-01T00:00:00.000Z',
};

function detail(
  view = VIEW,
  canReopen = false,
  charges: ParticipantChargeLookup = { [PARTICIPANT_ID]: null },
  canPostCharge = true,
): string {
  return renderToStaticMarkup(
    createElement(AppointmentDetail, {
      view,
      csrfToken: 'synthetic-csrf',
      errorMessage: null,
      successMessage: null,
      canUpdate: true,
      canCancel: true,
      canComplete: true,
      canReopen,
      charges,
      canReadCharges: true,
      canPostCharge,
    }),
  );
}

function completedAttended(
  tariffSuggestion: AppointmentView['tariffSuggestion'] = { status: 'MISSING' },
  attendance: AppointmentView['participants'][number]['participant']['attendance'] = 'ATTENDED',
): AppointmentView {
  return {
    ...VIEW,
    appointment: {
      ...VIEW.appointment,
      status: 'COMPLETED',
      completedAt: '2026-08-13T06:20:00.000Z',
    },
    participants: [
      {
        ...VIEW.participants[0]!,
        participant: {
          ...VIEW.participants[0]!.participant,
          attendance,
          attendanceRecordedAt: '2026-08-13T06:18:00.000Z',
        },
      },
    ],
    tariffSuggestion,
    outcomeUnresolved: false,
  };
}

function sessionCharge(overrides: Partial<SessionChargeDetail> = {}): SessionChargeDetail {
  return {
    id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b01',
    familyId: VIEW.participants[0]!.child.familyId,
    childId: VIEW.participants[0]!.child.id,
    appointmentId: APPOINTMENT_ID,
    appointmentParticipantId: PARTICIPANT_ID,
    serviceId: SERVICE_ID,
    therapistId: THERAPIST_ID,
    durationMinutes: 45,
    serviceDate: '2026-08-13',
    tariffId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b02',
    priceMode: 'PAID',
    amountToman: '1500000',
    kind: 'SESSION',
    penaltyPercent: null,
    sessionPriceToman: null,
    noShowDecisionId: null,
    createdAt: '2026-08-13T06:20:00.000Z',
    createdByUserId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b03',
    voidedAt: null,
    voidedByUserId: null,
    voidReason: null,
    adjustments: [],
    activeAdjustmentTotalToman: '500000',
    effectiveAmountToman: '1000000',
    ...overrides,
  };
}

describe('clinic day workflow', () => {
  const day: AppointmentDayResponse = {
    date: '2026-08-13',
    summary: {
      total: 1,
      scheduled: 1,
      completed: 0,
      cancelled: 0,
      unresolvedOutcomes: 1,
      noShows: 0,
    },
    appointments: [VIEW],
  };
  const markup = renderToStaticMarkup(
    createElement(AppointmentDay, {
      day,
      selectedDateLabel: 'پنجشنبه ۲۲ مرداد ۱۴۰۵',
      dayOptions: [
        {
          isoDate: day.date,
          href: '/appointments?date=2026-08-13',
          weekday: 'پنجشنبه',
          day: '۲۲',
          selected: true,
          accessibleLabel: 'پنجشنبه ۲۲ مرداد، انتخاب‌شده',
        },
      ],
      periodLabel: '۱۷ تا ۲۳ مرداد ۱۴۰۵',
      previousHref: '/appointments?date=2026-08-06',
      nextHref: '/appointments?date=2026-08-20',
      todayHref: '/appointments?date=2026-08-13',
      therapists: [THERAPIST],
      rooms: [ROOM],
      clearHref: '/appointments?date=2026-08-13',
      errorMessage: null,
      charges: { [PARTICIPANT_ID]: null },
    }),
  );

  it('surfaces unresolved outcomes without mislabeling a scheduled tariff miss as unpriced', () => {
    expect(markup).toContain('نتیجهٔ معوق');
    expect(markup).not.toContain(COPY.appointmentDayUnpriced);
    expect(markup).toContain(`/appointments/${APPOINTMENT_ID}`);
  });

  it('uses only approved opaque/date filter values in navigation URLs', () => {
    expect(markup).toContain('name="therapistId"');
    expect(markup).toContain('name="roomId"');
    expect(markup).not.toContain('کودک+نمونه');
    expect(markup).not.toContain(encodeURIComponent('کودک نمونه'));
  });
});

describe('appointment charge visibility and recovery', () => {
  const resolved = completedAttended({
    status: 'RESOLVED',
    tariffId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b02',
    priceMode: 'PAID',
    priceToman: '1500000',
  });

  it('renders a posted PAID charge from server-supplied original and effective amounts in toman', () => {
    const markup = detail(resolved, false, { [PARTICIPANT_ID]: sessionCharge() });
    expect(markup).toContain(COPY.appointmentChargePosted);
    expect(markup).toContain('۱٬۵۰۰٬۰۰۰ تومان');
    expect(markup).toContain('۱٬۰۰۰٬۰۰۰ تومان');
  });

  it('keeps a posted FREE charge distinct from an unpriced session', () => {
    const free = sessionCharge({
      priceMode: 'FREE',
      amountToman: '0',
      activeAdjustmentTotalToman: '0',
      effectiveAmountToman: '0',
    });
    const markup = detail(resolved, false, { [PARTICIPANT_ID]: free });
    expect(markup).toContain(COPY.appointmentChargeFree);
    expect(markup).toContain('۰ تومان');
    expect(markup).not.toContain(COPY.appointmentChargeUnpricedHelp);
  });

  it('labels a PAID charge adjusted to effective zero without calling it originally free', () => {
    const adjusted = sessionCharge({
      activeAdjustmentTotalToman: '1500000',
      effectiveAmountToman: '0',
    });
    const markup = detail(resolved, false, { [PARTICIPANT_ID]: adjusted });
    expect(markup).toContain(COPY.appointmentChargeFullyAdjusted);
    expect(markup).not.toContain(COPY.appointmentChargeFree);
  });

  it('warns for an unpriced completed attended participant and gates re-post by charge.post', () => {
    const unpriced = completedAttended();
    const allowed = detail(unpriced, false, { [PARTICIPANT_ID]: null }, true);
    expect(allowed).toContain(COPY.appointmentChargeUnpriced);
    expect(allowed).toContain('هیچ مبلغی حدس زده');
    expect(allowed).toContain('/api/ledger/session-charges/post');
    expect(allowed).toContain(`name="participantId" value="${PARTICIPANT_ID}"`);
    expect(allowed).not.toContain('/session-charges/participants/');

    const denied = detail(unpriced, false, { [PARTICIPANT_ID]: null }, false);
    expect(denied).toContain(COPY.appointmentChargeUnpriced);
    expect(denied).not.toContain('/api/ledger/session-charges/post');
  });

  it.each([
    ['NO_SHOW', completedAttended({ status: 'MISSING' }, 'NO_SHOW')],
    [
      'cancelled',
      {
        ...completedAttended(),
        appointment: {
          ...completedAttended().appointment,
          status: 'CANCELLED_BY_FAMILY' as const,
          completedAt: null,
          cancelledAt: '2026-08-13T05:00:00.000Z',
          cancellationReason: 'درخواست خانواده',
        },
      },
    ],
    ['not-yet-eligible', VIEW],
  ])('does not label %s as unpriced', (_label, view) => {
    const markup = detail(view, false, { [PARTICIPANT_ID]: null });
    expect(markup).toContain(COPY.appointmentChargeNotChargeable);
    expect(markup).not.toContain(COPY.appointmentChargeUnpricedHelp);
    expect(markup).not.toContain('/api/ledger/session-charges/post');
  });

  it('shows a voided charge as historical and offers a fresh server post when eligible', () => {
    const voided = sessionCharge({
      voidedAt: '2026-08-13T07:00:00.000Z',
      voidedByUserId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b04',
      voidReason: 'تعرفهٔ نادرست',
    });
    const markup = detail(resolved, false, { [PARTICIPANT_ID]: voided });
    expect(markup).toContain(COPY.appointmentChargeVoidedHistory);
    expect(markup).toContain(COPY.appointmentChargeReady);
    expect(markup).toContain('/api/ledger/session-charges/post');
  });

  it('adds only compact charged/unpriced signals to the operational day card', () => {
    const renderSignal = (view: AppointmentView, charge: SessionChargeDetail | null) =>
      renderToStaticMarkup(
        createElement(AppointmentDay, {
          day: {
            date: '2026-08-13',
            summary: {
              total: 1,
              scheduled: 0,
              completed: 1,
              cancelled: 0,
              unresolvedOutcomes: 0,
              noShows: 0,
            },
            appointments: [view],
          },
          selectedDateLabel: 'پنجشنبه ۲۲ مرداد ۱۴۰۵',
          dayOptions: [],
          periodLabel: '۲۲ مرداد ۱۴۰۵',
          previousHref: '/appointments',
          nextHref: '/appointments',
          todayHref: '/appointments',
          therapists: [],
          rooms: [],
          clearHref: '/appointments',
          errorMessage: null,
          charges: { [PARTICIPANT_ID]: charge },
        }),
      );

    expect(renderSignal(resolved, sessionCharge())).toContain(COPY.appointmentDayCharged);
    expect(renderSignal(completedAttended(), null)).toContain(COPY.appointmentDayUnpriced);
  });

  it('keeps the B2 appointment surfaces server-rendered', () => {
    for (const file of [
      'appointments/appointment-detail.tsx',
      'appointments/appointment-day.tsx',
      '../../ledger/appointment-charge.ts',
    ]) {
      expect(readFileSync(new URL(file, import.meta.url), 'utf8')).not.toMatch(
        /^['"]use client['"]/m,
      );
    }
  });
});

describe('appointment lifecycle detail', () => {
  it('offers every receptionist lifecycle operation except reopening', () => {
    const markup = detail();
    expect(markup).toContain('/api/appointments/attendance');
    expect(markup).toContain('/api/appointments/complete');
    expect(markup).toContain('/api/appointments/cancel');
    expect(markup).toContain(`/appointments/${APPOINTMENT_ID}/edit`);
    expect(markup).not.toContain('/api/appointments/reopen');
  });

  it('shows missing tariff clearly without suppressing lifecycle forms', () => {
    const markup = detail();
    expect(markup).toContain('نوبت معتبر است');
    expect(markup).toContain('/api/appointments/complete');
  });

  it('renders manager reopening only for a completed appointment and requires a reason', () => {
    const completed: AppointmentView = {
      ...VIEW,
      appointment: {
        ...VIEW.appointment,
        status: 'COMPLETED',
        completedAt: '2026-08-13T06:20:00.000Z',
      },
      outcomeUnresolved: false,
    };
    const markup = detail(completed, true);
    expect(markup).toContain('/api/appointments/reopen');
    expect(markup).toContain('name="reason"');
    expect(markup).toContain('required=""');
  });
});

describe('frozen move workflow', () => {
  it('submits a full placement while keeping child and service immutable', () => {
    const markup = renderToStaticMarkup(
      createElement(AppointmentMoveForm, {
        view: VIEW,
        service: SERVICE,
        therapists: [THERAPIST],
        rooms: [ROOM],
        csrfToken: 'synthetic-csrf',
        errorMessage: null,
        canOverrideAvailability: true,
      }),
    );
    for (const field of [
      'durationMinutes',
      'therapistId',
      'roomId',
      'startTime',
      'note',
      'availabilityOverrideReason',
    ]) {
      expect(markup).toContain(`name="${field}"`);
    }
    expect(markup).not.toContain('name="childId"');
    expect(markup).not.toContain('name="serviceId"');
  });
});
