import { z } from 'zod';
import {
  adjustmentPortionsDetailsSchema,
  appointmentOutcomeAlreadyRecordedDetailsSchema,
  appointmentViewSchema,
  createChargeAdjustmentRequestSchema,
  ERROR_CODES,
  type ErrorCode,
  INDIVIDUAL_OUTCOMES,
  NO_SHOW_DECISION_PENDING_READ_PERMISSIONS,
  NO_SHOW_DECISION_WITHDRAW_PERMISSIONS,
  noShowDecisionExistsDetailsSchema,
  noShowDecisionSchema,
  noShowDecisionStateSchema,
  noShowNotDecidableDetailsSchema,
  noShowPendingQuerySchema,
  noShowPendingResponseSchema,
  penaltyVoidThroughDecisionDetailsSchema,
  previewNoShowPenaltyRequestSchema,
  previewNoShowPenaltyResponseSchema,
  recordAppointmentOutcomeRequestSchema,
  recordAppointmentOutcomeResponseSchema,
  recordNoShowDecisionRequestSchema,
  recordNoShowDecisionResponseSchema,
  SESSION_CHARGE_KINDS,
  sessionChargeDetailSchema,
  withdrawNoShowDecisionRequestSchema,
} from '@clinic/contracts';
import { ERROR_STATUS } from './app-error';

/**
 * M10.5 phase 1, checkpoint P1.0: the frozen contracts for one-click outcomes
 * (T-028), no-show decisions and penalties (T-022) and the both-portions
 * discount (D10), pinned before anything implements them. Every value is
 * synthetic.
 */

const A = '01923c9e-4c1a-7000-8000-00000000000a';
const B = '01923c9e-4c1a-7000-8000-00000000000b';
const C = '01923c9e-4c1a-7000-8000-00000000000c';
const AT = '2026-10-27T07:30:00.000Z';

const sessionCharge = {
  id: A,
  familyId: B,
  childId: C,
  appointmentId: A,
  appointmentParticipantId: B,
  serviceId: C,
  therapistId: A,
  durationMinutes: 45,
  serviceDate: '2026-10-27',
  tariffId: B,
  priceMode: 'PAID' as const,
  amountToman: '1200000',
  kind: 'SESSION' as const,
  penaltyPercent: null,
  sessionPriceToman: null,
  noShowDecisionId: null,
  createdAt: AT,
  createdByUserId: C,
  voidedAt: null,
  voidedByUserId: null,
  voidReason: null,
  adjustments: [],
  activeAdjustmentTotalToman: '0',
  effectiveAmountToman: '1200000',
};

// Worked example (a): 60% of 1,200,000 = 720,000.
const penaltyCharge = {
  ...sessionCharge,
  amountToman: '720000',
  effectiveAmountToman: '720000',
  kind: 'NO_SHOW_PENALTY' as const,
  penaltyPercent: 60,
  sessionPriceToman: '1200000',
  noShowDecisionId: C,
};

const decision = {
  id: C,
  appointmentId: A,
  appointmentParticipantId: B,
  outcome: 'PENALTY' as const,
  penaltyPercent: 60,
  sessionChargeId: A,
  reason: 'غیبت سوم این ماه',
  createdAt: AT,
  createdByUserId: C,
  voidedAt: null,
  voidedByUserId: null,
  voidReason: null,
};

describe('the charge kind', () => {
  it('names exactly two kinds', () => {
    expect(SESSION_CHARGE_KINDS).toEqual(['SESSION', 'NO_SHOW_PENALTY']);
  });

  it('keeps a session charge free of penalty fields and a penalty complete and PAID', () => {
    expect(sessionChargeDetailSchema.safeParse(sessionCharge).success).toBe(true);
    expect(sessionChargeDetailSchema.safeParse(penaltyCharge).success).toBe(true);

    expect(
      sessionChargeDetailSchema.safeParse({ ...sessionCharge, penaltyPercent: 60 }).success,
    ).toBe(false);
    for (const missing of ['penaltyPercent', 'sessionPriceToman', 'noShowDecisionId'] as const) {
      expect(
        sessionChargeDetailSchema.safeParse({ ...penaltyCharge, [missing]: null }).success,
      ).toBe(false);
    }
    expect(
      sessionChargeDetailSchema.safeParse({ ...penaltyCharge, priceMode: 'FREE' }).success,
    ).toBe(false);
  });

  it('takes the percentage as a whole number from 1 to 100', () => {
    for (const percent of [1, 60, 100]) {
      expect(
        sessionChargeDetailSchema.safeParse({ ...penaltyCharge, penaltyPercent: percent }).success,
      ).toBe(true);
    }
    for (const percent of [0, 101, 60.5, -1]) {
      expect(
        sessionChargeDetailSchema.safeParse({ ...penaltyCharge, penaltyPercent: percent }).success,
      ).toBe(false);
    }
  });
});

describe('the both-portions discount (D10)', () => {
  it('requires both portions and leaves the add-up rule to the explained refusal', () => {
    const body = { amountToman: '200000', reason: 'برنامه خواهر و برادر' };
    expect(createChargeAdjustmentRequestSchema.safeParse(body).success).toBe(false);
    expect(
      createChargeAdjustmentRequestSchema.safeParse({
        ...body,
        therapistDiscountToman: '80000',
        clinicDiscountToman: '120000',
      }).success,
    ).toBe(true);
    expect(
      adjustmentPortionsDetailsSchema.safeParse({
        amountToman: '200000',
        therapistDiscountToman: '80000',
        clinicDiscountToman: '100000',
      }).success,
    ).toBe(true);
  });
});

describe('no-show decisions', () => {
  it('asks a reason of both answers and a percentage only of a penalty', () => {
    expect(
      recordNoShowDecisionRequestSchema.safeParse({ outcome: 'NO_PENALTY', reason: 'غیبت اول' })
        .success,
    ).toBe(true);
    expect(recordNoShowDecisionRequestSchema.safeParse({ outcome: 'NO_PENALTY' }).success).toBe(
      false,
    );
    expect(
      recordNoShowDecisionRequestSchema.safeParse({
        outcome: 'NO_PENALTY',
        reason: 'x',
        penaltyPercent: 50,
      }).success,
    ).toBe(false);
    expect(
      recordNoShowDecisionRequestSchema.safeParse({
        outcome: 'PENALTY',
        penaltyPercent: 60,
        reason: 'غیبت سوم',
      }).success,
    ).toBe(true);
    for (const penaltyPercent of [0, 101, 12.5, '60']) {
      expect(
        recordNoShowDecisionRequestSchema.safeParse({
          outcome: 'PENALTY',
          penaltyPercent,
          reason: 'x',
        }).success,
      ).toBe(false);
    }
    expect(
      recordNoShowDecisionRequestSchema.safeParse({ outcome: 'PENALTY', reason: 'x' }).success,
    ).toBe(false);
  });

  it('keeps a decision row consistent with its outcome', () => {
    expect(noShowDecisionSchema.safeParse(decision).success).toBe(true);
    expect(
      noShowDecisionSchema.safeParse({
        ...decision,
        outcome: 'NO_PENALTY',
        penaltyPercent: null,
        sessionChargeId: null,
      }).success,
    ).toBe(true);
    expect(noShowDecisionSchema.safeParse({ ...decision, sessionChargeId: null }).success).toBe(
      false,
    );
    expect(noShowDecisionSchema.safeParse({ ...decision, outcome: 'NO_PENALTY' }).success).toBe(
      false,
    );
  });

  it('answers a decision with the decision and its penalty charge', () => {
    expect(
      recordNoShowDecisionResponseSchema.safeParse({
        outcome: 'RECORDED',
        decision,
        charge: penaltyCharge,
      }).success,
    ).toBe(true);
    expect(
      recordNoShowDecisionResponseSchema.safeParse({
        outcome: 'ALREADY_RECORDED',
        decision: {
          ...decision,
          outcome: 'NO_PENALTY',
          penaltyPercent: null,
          sessionChargeId: null,
        },
        charge: null,
      }).success,
    ).toBe(true);
    expect(withdrawNoShowDecisionRequestSchema.safeParse({}).success).toBe(false);
  });

  it('previews an amount the Web never multiplies', () => {
    expect(previewNoShowPenaltyRequestSchema.safeParse({ penaltyPercent: 60 }).success).toBe(true);
    expect(previewNoShowPenaltyRequestSchema.safeParse({ penaltyPercent: 0 }).success).toBe(false);
    expect(
      previewNoShowPenaltyResponseSchema.safeParse({
        penaltyPercent: 60,
        serviceDate: '2026-10-27',
        tariffId: B,
        sessionPriceToman: '1200000',
        penaltyAmountToman: '720000',
      }).success,
    ).toBe(true);
  });

  it('lists waiting absences with the price on the session date, paged', () => {
    expect(noShowPendingQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 });
    expect(
      noShowPendingQuerySchema.safeParse({ from: '2026-11-01', to: '2026-10-01' }).success,
    ).toBe(false);
    expect(
      noShowPendingResponseSchema.safeParse({
        items: [
          {
            appointmentId: A,
            participantId: B,
            startsAt: AT,
            serviceDate: '2026-10-27',
            durationMinutes: 45,
            family: { id: C, familyName: 'خانواده نمونه' },
            child: { id: C, firstName: 'سارا', lastName: 'نمونه', fileNumber: '10001' },
            service: { id: A, name: 'کاردرمانی' },
            therapist: { id: B, fullName: 'درمانگر نمونه' },
            sessionPrice: {
              status: 'RESOLVED',
              tariffId: B,
              priceMode: 'PAID',
              priceToman: '1200000',
            },
            absenceRecordedAt: AT,
            daysWaiting: 2,
          },
        ],
        page: { page: 1, pageSize: 25, total: 1, hasMore: false },
      }).success,
    ).toBe(true);
  });

  it('states where an absent seat stands, and nothing for any other seat', () => {
    expect(noShowDecisionStateSchema.safeParse({ state: 'AWAITING' }).success).toBe(true);
    expect(
      noShowDecisionStateSchema.safeParse({
        state: 'PENALTY',
        noShowDecisionId: C,
        decidedAt: AT,
        penaltyPercent: 60,
        sessionChargeId: A,
      }).success,
    ).toBe(true);
    expect(
      noShowDecisionStateSchema.safeParse({ state: 'NO_PENALTY', noShowDecisionId: C }).success,
    ).toBe(false);
  });

  it('is read by both roles and withdrawn only with both financial authorities', () => {
    expect([...NO_SHOW_DECISION_PENDING_READ_PERMISSIONS]).toEqual([
      'appointment.read',
      'charge.read',
    ]);
    expect([...NO_SHOW_DECISION_WITHDRAW_PERMISSIONS]).toEqual(['charge.adjust', 'charge.void']);
  });
});

describe('the one-click outcome (T-028)', () => {
  it('takes one of four answers, and a reason exactly for the two cancellations', () => {
    expect(INDIVIDUAL_OUTCOMES).toEqual([
      'PENDING',
      'ATTENDED',
      'NO_SHOW',
      'CANCELLED_BY_FAMILY',
      'CANCELLED_BY_CLINIC',
    ]);
    expect(recordAppointmentOutcomeRequestSchema.safeParse({ outcome: 'ATTENDED' }).success).toBe(
      true,
    );
    expect(recordAppointmentOutcomeRequestSchema.safeParse({ outcome: 'NO_SHOW' }).success).toBe(
      true,
    );
    expect(
      recordAppointmentOutcomeRequestSchema.safeParse({ outcome: 'ATTENDED', reason: 'x' }).success,
    ).toBe(false);
    expect(recordAppointmentOutcomeRequestSchema.safeParse({ outcome: 'PENDING' }).success).toBe(
      false,
    );
    for (const outcome of ['CANCELLED_BY_FAMILY', 'CANCELLED_BY_CLINIC']) {
      expect(recordAppointmentOutcomeRequestSchema.safeParse({ outcome }).success).toBe(false);
      expect(
        recordAppointmentOutcomeRequestSchema.safeParse({ outcome, reason: '  ' }).success,
      ).toBe(false);
      expect(
        recordAppointmentOutcomeRequestSchema.safeParse({ outcome, reason: 'بیماری کودک' }).success,
      ).toBe(true);
    }
  });

  it('answers with the session as it now reads, and whether anything changed', () => {
    const view = {
      appointment: {
        id: A,
        serviceId: B,
        durationMinutes: 45,
        therapistId: C,
        roomId: A,
        startsAt: AT,
        endsAt: '2026-10-27T08:15:00.000Z',
        status: 'COMPLETED' as const,
        seriesId: null,
        note: null,
        completedAt: AT,
        cancelledAt: null,
        cancellationReason: null,
        availabilityOverrideReason: null,
        createdAt: AT,
      },
      participants: [
        {
          participant: {
            id: B,
            appointmentId: A,
            childId: C,
            attendance: 'NO_SHOW' as const,
            attendanceRecordedAt: AT,
          },
          child: { id: C, familyId: A, firstName: 'سارا', lastName: 'نمونه', fileNumber: '10001' },
          noShowDecision: { state: 'AWAITING' as const },
        },
      ],
      service: { id: B, name: 'کاردرمانی' },
      therapist: { id: C, fullName: 'درمانگر نمونه' },
      room: { id: A, name: 'اتاق ۱' },
      tariffSuggestion: { status: 'MISSING' as const },
      outcomeUnresolved: false,
      individualOutcome: 'NO_SHOW' as const,
      outcomeOpensAt: AT,
    };

    expect(appointmentViewSchema.safeParse(view).success).toBe(true);
    expect(
      recordAppointmentOutcomeResponseSchema.safeParse({ result: 'UNCHANGED', appointment: view })
        .success,
    ).toBe(true);

    const { outcomeOpensAt: _omitted, ...withoutOpening } = view;
    expect(appointmentViewSchema.safeParse(withoutOpening).success).toBe(false);
  });
});

describe('the phase-1 error codes', () => {
  /**
   * Every new code, its status, and the schema of its details — `null` where
   * the code carries none, stated rather than forgotten.
   */
  const NEW_CODES: Record<string, { status: number; details: z.ZodType | null }> = {
    APPOINTMENT_OUTCOME_ALREADY_RECORDED: {
      status: 409,
      details: appointmentOutcomeAlreadyRecordedDetailsSchema,
    },
    ADJUSTMENT_PORTIONS_DO_NOT_ADD_UP: { status: 422, details: adjustmentPortionsDetailsSchema },
    NO_SHOW_DECISION_NOT_FOUND: { status: 404, details: null },
    NO_SHOW_DECISION_EXISTS: { status: 409, details: noShowDecisionExistsDetailsSchema },
    NO_SHOW_DECISION_ALREADY_WITHDRAWN: { status: 409, details: null },
    NO_SHOW_NOT_DECIDABLE: { status: 422, details: noShowNotDecidableDetailsSchema },
    NO_SHOW_PENALTY_ON_FREE_SESSION: { status: 422, details: null },
    NO_SHOW_PENALTY_VOID_THROUGH_DECISION: {
      status: 409,
      details: penaltyVoidThroughDecisionDetailsSchema,
    },
  };

  it('adds exactly these codes, each with a status and a stated details shape', () => {
    for (const [code, expected] of Object.entries(NEW_CODES)) {
      expect(ERROR_CODES).toContain(code);
      expect(ERROR_STATUS[code as ErrorCode]).toBe(expected.status);
    }

    const phaseOne = ERROR_CODES.filter(
      (code) =>
        code.startsWith('NO_SHOW_') ||
        code === 'APPOINTMENT_OUTCOME_ALREADY_RECORDED' ||
        code === 'ADJUSTMENT_PORTIONS_DO_NOT_ADD_UP',
    );
    expect([...phaseOne].sort()).toEqual(Object.keys(NEW_CODES).sort());
  });

  it('parses the details each code is documented to carry', () => {
    expect(
      NEW_CODES.APPOINTMENT_OUTCOME_ALREADY_RECORDED?.details?.safeParse({ current: 'ATTENDED' })
        .success,
    ).toBe(true);
    expect(
      NEW_CODES.NO_SHOW_DECISION_EXISTS?.details?.safeParse({
        noShowDecisionId: C,
        outcome: 'NO_PENALTY',
        penaltyPercent: null,
      }).success,
    ).toBe(true);
    expect(
      NEW_CODES.NO_SHOW_NOT_DECIDABLE?.details?.safeParse({
        appointmentStatus: 'SCHEDULED',
        attendance: 'PENDING',
      }).success,
    ).toBe(true);
    expect(
      NEW_CODES.NO_SHOW_PENALTY_VOID_THROUGH_DECISION?.details?.safeParse({ noShowDecisionId: C })
        .success,
    ).toBe(true);
  });
});
