import { familyAccountResponseSchema } from '@clinic/contracts';
import { describe, expect, it } from 'vitest';
import { hasFinalPosition, legacyFamilyAccountResponseSchema } from './family-account-legacy';

/**
 * The transitional account parser, pinned so it stays transitional.
 *
 * The frozen Milestone 6 contract requires `position`; the derivation lands
 * later in this milestone, and until it does the running API answers with the
 * Milestone 5 body. These tests state both halves of that: the final contract
 * refuses the old body, and the legacy parser accepts it without inventing a
 * position.
 *
 * Every value below is synthetic.
 */

const FAMILY_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a01';
const PAYMENT_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a02';

const legacyBody = {
  familyId: FAMILY_ID,
  totals: {
    chargedTotalToman: '1500000',
    adjustmentTotalToman: '0',
    netChargedTotalToman: '1500000',
    chargeCount: 1,
    voidedChargeCount: 0,
  },
  charges: [],
  page: { page: 1, pageSize: 25, total: 0, hasMore: false },
};

const position = {
  netChargedTotalToman: '1500000',
  confirmedPaymentTotalToman: '500000',
  creditToman: '0',
  amountDueToman: '1000000',
  paymentCount: 1,
  voidedPaymentCount: 0,
  lastPayment: {
    id: PAYMENT_ID,
    amountToman: '500000',
    method: 'CASH' as const,
    receivedOn: '2026-08-15',
    status: 'CONFIRMED' as const,
  },
  openPromiseCount: 0,
  missedPromiseCount: 0,
};

describe('the transitional family-account parser', () => {
  it('keeps the frozen contract strict about the position', () => {
    // This is the assertion that stops the transition from becoming permanent:
    // the final shape requires a position and always will.
    expect(familyAccountResponseSchema.safeParse(legacyBody).success).toBe(false);
    expect(familyAccountResponseSchema.safeParse({ ...legacyBody, position }).success).toBe(true);
  });

  it('accepts the body the API still returns', () => {
    expect(legacyFamilyAccountResponseSchema.safeParse(legacyBody).success).toBe(true);
  });

  it('invents no position when the server states none', () => {
    // Not a zero block and not a null: absent means "this API does not state the
    // family's position yet", and no screen may render a balance from it.
    const parsed = legacyFamilyAccountResponseSchema.parse(legacyBody);

    expect(parsed.position).toBeUndefined();
    expect(hasFinalPosition(parsed)).toBe(false);
  });

  it('is otherwise the frozen shape, position aside', () => {
    // A partial position is refused here exactly as it is by the contract: the
    // compatibility is "absent or complete", never "some of it".
    const { creditToman: _dropped, ...partial } = position;

    expect(
      legacyFamilyAccountResponseSchema.safeParse({ ...legacyBody, position: partial }).success,
    ).toBe(false);
    expect(
      legacyFamilyAccountResponseSchema.safeParse({ ...legacyBody, unexpected: true }).success,
    ).toBe(false);
  });

  it('hands back the final contract once the server states a position', () => {
    const parsed = legacyFamilyAccountResponseSchema.parse({ ...legacyBody, position });

    expect(hasFinalPosition(parsed)).toBe(true);
    if (hasFinalPosition(parsed)) {
      expect(parsed.position.amountDueToman).toBe('1000000');
    }
  });
});
