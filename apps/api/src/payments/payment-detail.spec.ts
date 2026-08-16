import { paymentSchema } from '@clinic/contracts';
import { paymentStatus, toPayment, type PaymentRow } from './payment-detail';

/**
 * The one derivation this module owns: a payment's status, which is not stored.
 *
 * The integration suite proves the mapping against real columns; this proves the
 * derivation itself, including the two shapes the frozen `paymentSchema` refuses
 * — a `CONFIRMED` carrying a void instant, and a `VOIDED` without one — which is
 * exactly what a second, drifting derivation would eventually produce.
 */

const CONFIRMED_ROW: PaymentRow = {
  id: '0199a000-0000-7000-8000-000000000001',
  family_id: '0199a000-0000-7000-8000-000000000002',
  amount_toman: 250_000n,
  method: 'CARD',
  received_on: '2026-08-16',
  reference: 'TRACE-000123',
  note: 'یادداشت آزمایشی',
  created_at: new Date('2026-08-16T09:30:00.000Z'),
  created_by_user_id: '0199a000-0000-7000-8000-000000000003',
  voided_at: null,
  voided_by_user_id: null,
  void_reason: null,
};

describe('payment detail mapping', () => {
  it('reads CONFIRMED off a null void instant', () => {
    expect(paymentStatus({ voided_at: null })).toBe('CONFIRMED');
  });

  it('reads VOIDED off a void instant', () => {
    expect(paymentStatus({ voided_at: new Date('2026-08-16T10:00:00.000Z') })).toBe('VOIDED');
  });

  it('maps every column onto the frozen payment shape', () => {
    const payment = paymentSchema.parse(toPayment(CONFIRMED_ROW));

    expect(payment).toEqual({
      id: CONFIRMED_ROW.id,
      familyId: CONFIRMED_ROW.family_id,
      // A string, never a number: an amount above 2^53 is storable in BIGINT and
      // is not representable as a JavaScript number.
      amountToman: '250000',
      method: 'CARD',
      // The digits as PostgreSQL spelled them — never a Date that a timezone
      // conversion could move by one day.
      receivedOn: '2026-08-16',
      reference: 'TRACE-000123',
      note: 'یادداشت آزمایشی',
      status: 'CONFIRMED',
      createdAt: '2026-08-16T09:30:00.000Z',
      createdByUserId: CONFIRMED_ROW.created_by_user_id,
      voidedAt: null,
      voidedByUserId: null,
      voidReason: null,
    });
  });

  it('carries the whole void triple and says VOIDED', () => {
    const payment = paymentSchema.parse(
      toPayment({
        ...CONFIRMED_ROW,
        reference: null,
        note: null,
        voided_at: new Date('2026-08-17T06:00:00.000Z'),
        voided_by_user_id: '0199a000-0000-7000-8000-000000000004',
        void_reason: 'ثبت اشتباه',
      }),
    );

    expect(payment.status).toBe('VOIDED');
    expect(payment.voidedAt).toBe('2026-08-17T06:00:00.000Z');
    expect(payment.voidReason).toBe('ثبت اشتباه');
    expect(payment.reference).toBeNull();
    expect(payment.note).toBeNull();
  });

  it('refuses a status that disagrees with the void instant', () => {
    const mapped = toPayment(CONFIRMED_ROW);

    expect(() => paymentSchema.parse({ ...mapped, status: 'VOIDED' })).toThrow();
    expect(() =>
      paymentSchema.parse({
        ...mapped,
        voidedAt: '2026-08-17T06:00:00.000Z',
        voidedByUserId: CONFIRMED_ROW.created_by_user_id,
        voidReason: 'ثبت اشتباه',
      }),
    ).toThrow();
  });
});
