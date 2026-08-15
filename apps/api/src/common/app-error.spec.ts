import { ERROR_CODES, type ErrorCode } from '@clinic/contracts';
import { AppError, ERROR_STATUS, KNOWN_ERROR_CODES } from './app-error';

/**
 * The error vocabulary, checked at runtime as well as at compile time.
 *
 * `Record<ErrorCode, …>` already makes a missing status or message a type
 * error. This states the same thing against the contract's own list, so a code
 * added upstream cannot reach a client through a stale build — and it pins the
 * statuses the Milestone 5 codes were given, which are a decision rather than a
 * detail.
 */
describe('error vocabulary', () => {
  it('gives every contract code a status and a default message', () => {
    expect(KNOWN_ERROR_CODES).toEqual(ERROR_CODES);

    for (const code of ERROR_CODES) {
      expect(ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
      expect(new AppError(code).message.length).toBeGreaterThan(0);
    }
  });

  it('uses only the statuses this API has agreed to return', () => {
    for (const code of ERROR_CODES) {
      expect([400, 401, 403, 404, 409, 422, 500]).toContain(ERROR_STATUS[code]);
    }
  });

  it('carries exactly the eight approved ledger codes', () => {
    // Stated as an exact list: a ninth ledger code is a rule invented outside
    // the approved milestone, and it must fail here rather than appear in a
    // response.
    const ledgerCodes = ERROR_CODES.filter(
      (code) => code.startsWith('CHARGE_') || code.startsWith('ADJUSTMENT_'),
    );

    expect([...ledgerCodes].sort()).toEqual(
      [
        'ADJUSTMENT_ALREADY_VOIDED',
        'ADJUSTMENT_EXCEEDS_CHARGE',
        'ADJUSTMENT_NOT_FOUND',
        'CHARGE_ALREADY_VOIDED',
        'CHARGE_EXISTS_FOR_PARTICIPANT',
        'CHARGE_NOT_ELIGIBLE',
        'CHARGE_NOT_FOUND',
        'CHARGE_VOIDED',
      ].sort(),
    );
  });

  it('never adds a split-validation code, because a split cannot be submitted', () => {
    // The Milestone 5 adjustment request carries no therapist portion
    // (DECISION_LOG, 2026-08-14), so there is nothing for such a code to report.
    expect(ERROR_CODES).not.toContain('ADJUSTMENT_SPLIT_INVALID' as ErrorCode);
  });

  it('reuses the existing missing-tariff code rather than a charge-shaped copy', () => {
    expect(ERROR_CODES).toContain('TARIFF_MISSING');
    expect(ERROR_CODES).not.toContain('CHARGE_TARIFF_MISSING' as ErrorCode);
  });

  it('pins the status of each ledger code', () => {
    expect(ERROR_STATUS.CHARGE_NOT_FOUND).toBe(404);
    expect(ERROR_STATUS.ADJUSTMENT_NOT_FOUND).toBe(404);
    // The record is not in the state the act needs — a refreshed screen explains
    // all three.
    expect(ERROR_STATUS.CHARGE_ALREADY_VOIDED).toBe(409);
    expect(ERROR_STATUS.CHARGE_VOIDED).toBe(409);
    expect(ERROR_STATUS.ADJUSTMENT_ALREADY_VOIDED).toBe(409);
    expect(ERROR_STATUS.CHARGE_EXISTS_FOR_PARTICIPANT).toBe(409);
    // Nothing conflicts and nothing is missing: the referenced data does not
    // permit what was asked.
    expect(ERROR_STATUS.CHARGE_NOT_ELIGIBLE).toBe(422);
    expect(ERROR_STATUS.ADJUSTMENT_EXCEEDS_CHARGE).toBe(422);
  });

  it('carries exactly the ten approved money-in codes', () => {
    // Stated as an exact list, as the ledger's is: an eleventh code is a rule
    // invented outside the approved milestone.
    const paymentCodes = ERROR_CODES.filter(
      (code) => code.startsWith('PAYMENT_') || code.startsWith('PROMISE_'),
    );

    expect([...paymentCodes].sort()).toEqual(
      [
        'PAYMENT_ALREADY_FULFILS_PROMISE',
        'PAYMENT_ALREADY_VOIDED',
        'PROMISE_PAYMENT_TOO_SMALL',
        'PAYMENT_DATE_IN_FUTURE',
        'PAYMENT_FAMILY_MISMATCH',
        'PAYMENT_NOT_FOUND',
        'PAYMENT_VOIDED',
        'PROMISE_DUE_DATE_IN_PAST',
        'PROMISE_NOT_FOUND',
        'PROMISE_NOT_OPEN',
      ].sort(),
    );
  });

  it('names no code for a derived value or a schema-refused amount', () => {
    // Credit is derived from rows and never recorded, so there is no operation
    // on it to refuse. A non-positive or oversized amount is refused by the
    // request schema as VALIDATION_FAILED, exactly as every other bounded amount
    // in this package is.
    for (const absent of [
      'PAYMENT_AMOUNT_INVALID',
      'PROMISE_AMOUNT_INVALID',
      'PROMISE_MISSED',
      'FAMILY_CREDIT_INSUFFICIENT',
      'PAYMENT_ALLOCATION_INVALID',
    ] as const) {
      expect(ERROR_CODES).not.toContain(absent as ErrorCode);
    }
  });

  it('pins the status of each money-in code', () => {
    expect(ERROR_STATUS.PAYMENT_NOT_FOUND).toBe(404);
    expect(ERROR_STATUS.PROMISE_NOT_FOUND).toBe(404);
    // The record is not in the state the act needs; a refreshed screen explains
    // it.
    expect(ERROR_STATUS.PAYMENT_ALREADY_VOIDED).toBe(409);
    expect(ERROR_STATUS.PAYMENT_VOIDED).toBe(409);
    expect(ERROR_STATUS.PAYMENT_ALREADY_FULFILS_PROMISE).toBe(409);
    expect(ERROR_STATUS.PROMISE_NOT_OPEN).toBe(409);
    // Properties of the values rather than races: the same request fails the
    // same way on every retry.
    expect(ERROR_STATUS.PAYMENT_DATE_IN_FUTURE).toBe(422);
    expect(ERROR_STATUS.PAYMENT_FAMILY_MISMATCH).toBe(422);
    expect(ERROR_STATUS.PROMISE_PAYMENT_TOO_SMALL).toBe(422);
    expect(ERROR_STATUS.PROMISE_DUE_DATE_IN_PAST).toBe(422);
  });

  it('keeps default messages in developer English, never Persian', () => {
    // Persian belongs to Next (CLAUDE.md, Architecture boundary).
    for (const code of ERROR_CODES) {
      expect(new AppError(code).message).not.toMatch(/[؀-ۿ]/);
    }
  });
});
