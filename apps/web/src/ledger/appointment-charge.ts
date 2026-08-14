import type { AppointmentView, SessionChargeDetail } from '@clinic/contracts';

export type ParticipantChargeLookup = Readonly<
  Record<string, SessionChargeDetail | null | undefined>
>;

export type AppointmentChargeState =
  | { kind: 'CHARGED'; charge: SessionChargeDetail }
  | { kind: 'UNPRICED'; historicalCharge?: SessionChargeDetail }
  | { kind: 'READY_TO_POST'; historicalCharge?: SessionChargeDetail }
  | { kind: 'NOT_CHARGEABLE'; historicalCharge?: SessionChargeDetail }
  | { kind: 'UNAVAILABLE' };

/**
 * Combines frozen appointment facts with the participant-scoped charge read.
 * No financial value is derived here: eligibility is workflow state, and every
 * amount shown by callers remains a server-supplied charge-detail field.
 */
export function appointmentChargeState(
  view: AppointmentView,
  participantId: string,
  charge: SessionChargeDetail | null | undefined,
): AppointmentChargeState {
  if (charge === undefined) return { kind: 'UNAVAILABLE' };
  if (charge !== null && charge.voidedAt === null) return { kind: 'CHARGED', charge };

  const participant = view.participants.find((seat) => seat.participant.id === participantId);
  const historicalCharge = charge ?? undefined;
  const eligible =
    view.appointment.status === 'COMPLETED' && participant?.participant.attendance === 'ATTENDED';

  if (!eligible) {
    return historicalCharge === undefined
      ? { kind: 'NOT_CHARGEABLE' }
      : { kind: 'NOT_CHARGEABLE', historicalCharge };
  }

  if (view.tariffSuggestion.status === 'MISSING') {
    return historicalCharge === undefined
      ? { kind: 'UNPRICED' }
      : { kind: 'UNPRICED', historicalCharge };
  }

  return historicalCharge === undefined
    ? { kind: 'READY_TO_POST' }
    : { kind: 'READY_TO_POST', historicalCharge };
}
