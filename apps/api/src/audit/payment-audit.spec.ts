import { assertAuditPayloadSafe, AuditPayloadError } from './audit-payload';
import { assertPaymentAuditSafe } from './payment-audit';
import type {
  PaymentRecordedAudit,
  PaymentVoidedAfterAudit,
  PaymentVoidedBeforeAudit,
  PaymentVoidedMetadataAudit,
  PromiseCancelledAudit,
  PromiseCreatedAudit,
  PromiseFulfilledAudit,
  PromiseRescheduledAudit,
} from './payment-audit';

/**
 * The Milestone 6 audit payload shapes, pinned where they are declared.
 *
 * The types make an extra key a compile error at the call site; these tests
 * assert the other half — that a payload built to each shape satisfies the
 * runtime policy, and that the two facts the trail exists to preserve are
 * actually in it.
 *
 * Every value below is synthetic.
 */

const FAMILY = '01923c9e-4c1a-7000-8000-000000000001';
const PAYMENT = '01923c9e-4c1a-7000-8000-000000000002';
const PROMISE = '01923c9e-4c1a-7000-8000-000000000003';

describe('the money-in audit payloads', () => {
  it('records a payment with its note in full and its reference as a boolean', () => {
    const after: PaymentRecordedAudit = {
      familyId: FAMILY,
      amountToman: '500000',
      method: 'TRANSFER',
      receivedOn: '2026-08-15',
      hasReference: true,
      note: 'بابت دو جلسهٔ مرداد',
    };

    expect(() => assertAuditPayloadSafe({ after })).not.toThrow();
    expect(() => assertPaymentAuditSafe({ after })).not.toThrow();
    expect(after.note).toBe('بابت دو جلسهٔ مرداد');
    expect(Object.keys(after)).not.toContain('reference');
    expect(Object.values(after)).not.toContain('TRX-99182');
  });

  describe('the bank reference', () => {
    // The value lives on the payment row and never in `audit_log`, which is
    // append-only and permanent (DECISION_LOG, 2026-08-15). The guard is scoped
    // to money-in payloads rather than applied globally, so unrelated domains
    // keep the audit policy they were reviewed under.
    it.each(['reference', 'payment_reference', 'bankReference', 'referenceNumber'])(
      'refuses a payment payload carrying %s',
      (key) => {
        expect(() => assertPaymentAuditSafe({ after: { [key]: 'TRX-99182' } })).toThrow(
          AuditPayloadError,
        );
      },
    );

    it('refuses it however deeply it is nested', () => {
      expect(() =>
        assertPaymentAuditSafe({ metadata: { payment: { reference: 'TRX-99182' } } }),
      ).toThrow(AuditPayloadError);
    });

    it('permits hasReference only as a boolean', () => {
      expect(() => assertPaymentAuditSafe({ after: { hasReference: false } })).not.toThrow();
      expect(() => assertPaymentAuditSafe({ after: { hasReference: 'TRX-99182' } })).toThrow(
        AuditPayloadError,
      );
    });

    it('leaves the general audit policy alone', () => {
      // A key that merely contains the word is not a banking identifier, and
      // nothing outside this domain is newly refused.
      expect(() =>
        assertAuditPayloadSafe({ after: { referenceDate: '2026-08-15' } }),
      ).not.toThrow();
    });
  });

  it('states a void from both sides and names the promise it left pointing at voided money', () => {
    // Voiding does not touch the promise — it stays FULFILLED, because a human
    // judgement recorded at the time is not un-made by a later correction. The
    // consequence is traceable from the void itself or nowhere.
    const before: PaymentVoidedBeforeAudit = { voidedAt: null };
    const after: PaymentVoidedAfterAudit = {
      voidedAt: '2026-08-16T09:00:00.000Z',
      voidReason: 'مبلغ اشتباه وارد شده بود',
    };
    const metadata: PaymentVoidedMetadataAudit = {
      familyId: FAMILY,
      amountToman: '500000',
      method: 'TRANSFER',
      receivedOn: '2026-08-15',
      fulfilledPromiseId: PROMISE,
    };

    expect(() => assertAuditPayloadSafe({ before, after, metadata })).not.toThrow();
    expect(metadata.fulfilledPromiseId).toBe(PROMISE);

    const unlinked: PaymentVoidedMetadataAudit = { ...metadata, fulfilledPromiseId: null };
    expect(() => assertAuditPayloadSafe({ metadata: unlinked })).not.toThrow();
  });

  it('keeps a larger payment explainable against a smaller promise', () => {
    // A payment may exceed the promise it fulfils; the surplus becomes credit
    // and is allocated to nothing, so a trail carrying one number would leave a
    // reader unable to explain the pair.
    const after: PromiseFulfilledAudit = {
      familyId: FAMILY,
      promisedAmountToman: '500000',
      paymentId: PAYMENT,
      paymentAmountToman: '800000',
    };

    expect(() => assertAuditPayloadSafe({ after })).not.toThrow();
    expect(after.promisedAmountToman).not.toBe(after.paymentAmountToman);
  });

  it('records the reason on the two resolutions that are decisions', () => {
    const rescheduled: PromiseRescheduledAudit = {
      familyId: FAMILY,
      amountToman: '500000',
      previousDueOn: '2026-08-20',
      newDueOn: '2026-09-03',
      successorPromiseId: PROMISE,
      reason: 'خانواده تا هفتهٔ بعد مهلت خواست',
    };
    const cancelled: PromiseCancelledAudit = {
      familyId: FAMILY,
      amountToman: '500000',
      dueOn: '2026-08-20',
      reason: 'خانواده از ادامهٔ جلسه‌ها انصراف داد',
    };

    expect(() => assertAuditPayloadSafe({ after: rescheduled })).not.toThrow();
    expect(() => assertAuditPayloadSafe({ after: cancelled })).not.toThrow();
  });

  it('carries every amount as a canonical decimal string, never a number', () => {
    // `BigInt` does not serialise to JSON at all and a `number` loses precision
    // above 2^53 — in a table that is never rewritten.
    const created: PromiseCreatedAudit = {
      familyId: FAMILY,
      amountToman: '500000',
      dueOn: '2026-08-20',
      note: null,
    };

    for (const value of [created.amountToman]) {
      expect(typeof value).toBe('string');
      expect(value).toMatch(/^(?:0|[1-9]\d*)$/);
    }
  });
});
