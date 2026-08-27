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
    // 429 joined the list in Milestone 9, checkpoint A3, and it is deliberately
    // narrow: `PUBLIC_REQUEST_THROTTLED` is the only code that carries it, on
    // the only route in the product an anonymous stranger can write to.
    for (const code of ERROR_CODES) {
      expect([400, 401, 403, 404, 409, 422, 429, 500]).toContain(ERROR_STATUS[code]);
    }
  });

  it('gives 429 to exactly one code', () => {
    const throttling = ERROR_CODES.filter((code) => ERROR_STATUS[code] === 429);

    expect(throttling).toEqual(['PUBLIC_REQUEST_THROTTLED']);
  });

  it('carries exactly the nine approved ledger codes', () => {
    // Stated as an exact list: a tenth ledger code is a rule invented outside
    // the approved milestone, and it must fail here rather than appear in a
    // response. It was eight through Milestones 5 to 7; Milestone 8 adds the
    // split code below, and nothing else.
    const ledgerCodes = ERROR_CODES.filter(
      (code) => code.startsWith('CHARGE_') || code.startsWith('ADJUSTMENT_'),
    );

    expect([...ledgerCodes].sort()).toEqual(
      [
        'ADJUSTMENT_ALREADY_VOIDED',
        'ADJUSTMENT_EXCEEDS_CHARGE',
        'ADJUSTMENT_NOT_FOUND',
        'ADJUSTMENT_SPLIT_INVALID',
        'CHARGE_ALREADY_VOIDED',
        'CHARGE_EXISTS_FOR_PARTICIPANT',
        'CHARGE_NOT_ELIGIBLE',
        'CHARGE_NOT_FOUND',
        'CHARGE_VOIDED',
      ].sort(),
    );
  });

  it('adds a split-validation code only now that a split can be submitted', () => {
    // Through Milestone 5 there was deliberately no such code: the adjustment
    // request carried no therapist portion, so an invalid split was not
    // expressible (DECISION_LOG, 2026-08-14). Milestone 8 approves the portion,
    // so the code arrives with it — and it reports what only the server can
    // know, since a portion larger than the concession is still refused by the
    // request schema as VALIDATION_FAILED.
    expect(ERROR_CODES).toContain('ADJUSTMENT_SPLIT_INVALID');
  });

  it('carries exactly the approved settlement codes, plus what addressability needs', () => {
    // The same exact-list discipline the ledger gets: a code the approved plan
    // does not contain is a rule invented outside it, and CLAUDE.md forbids
    // inferring a settlement rule.
    //
    // `SHARE_RULE_NOT_FOUND` IS THE ONE ADDITION SINCE C1, AND IT IS AN
    // ADDRESSABILITY CODE RATHER THAN A DOMAIN RULE. C1 froze the four
    // share-rule codes alongside a lifecycle whose read and void routes are
    // addressed BY ID, and left an unknown id with no answer. It could not be
    // `SHARE_RULE_MISSING`: that is 422 and means "no rule covers this SERVICE
    // DATE", the state that must never be read as a zero, and answering a
    // mistyped id with it would report the frozen missing-rule condition for a
    // request that named nothing. Every other addressable record in this
    // package carries its own `*_NOT_FOUND` (DECISION_LOG, 2026-08-19).
    //
    // `SETTLEMENT_PERIOD_NOT_FOUND` IS THE SECOND, AND THE SAME RULE PRODUCED
    // IT. A closed period became addressable by id the moment its materialised
    // lines could be read back one period at a time; an unknown id needed an
    // answer, and it could not be `SETTLEMENT_PERIOD_OVERLAP`, which is 409 and
    // is about a range rather than an identity.
    const settlementCodes = ERROR_CODES.filter((code) =>
      /^(?:SHARE_RULE_|SESSION_(?:ALREADY_RATED|NOT_RATED)|RATING_|SETTLEMENT_)/.test(code),
    );

    expect([...settlementCodes].sort()).toEqual(
      [
        'SHARE_RULE_NOT_FOUND',
        'SHARE_RULE_MISSING',
        'SHARE_RULE_OVERLAP',
        'SHARE_RULE_SCOPE_MISMATCH',
        'SHARE_RULE_ALREADY_VOIDED',
        'SESSION_ALREADY_RATED',
        'SESSION_NOT_RATED',
        'RATING_ALREADY_VOIDED',
        'RATING_HAS_THERAPIST_ALLOCATIONS',
        'SETTLEMENT_PERIOD_OVERLAP',
        'SETTLEMENT_PERIOD_NOT_FOUND',
        'RATING_REPLACEMENT_REQUIRED',
        'RATING_SCOPE_MISMATCH',
      ].sort(),
    );

    // And one more lives with the ledger, because what makes a split invalid is
    // a settlement fact but the record it is refused against is a concession.
    expect(ERROR_CODES).toContain('ADJUSTMENT_SPLIT_INVALID');
  });

  it('names no settlement failure the approved plan does not contain', () => {
    for (const absent of [
      // A close succeeds with unrated sessions and records how many it left out.
      'SETTLEMENT_PERIOD_HAS_UNRATED_SESSIONS',
      'SETTLEMENT_UNRATED_SESSIONS',
      // A closed period is never reopened, so there is no operation to refuse.
      'SETTLEMENT_PERIOD_CLOSED',
      'SETTLEMENT_PERIOD_NOT_CLOSED',
      // Milestone 8 records no therapist payout at all.
      'SETTLEMENT_ALREADY_PAID',
      'THERAPIST_PAYMENT_NOT_FOUND',
    ] as const) {
      expect(ERROR_CODES).not.toContain(absent as unknown as ErrorCode);
    }
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
