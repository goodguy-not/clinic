import type { PaymentMethod } from '@clinic/contracts';
import { AuditPayloadError } from './audit-payload';
import type { AuditJsonObject, AuditJsonValue } from './audit.types';

/**
 * The Milestone 6 audit payload shapes, frozen in checkpoint A2 before anything
 * writes one.
 *
 * TYPES, NOT BUILDERS. Each shape below is what the service that makes the state
 * change must hand `AuditService.record`, and the type is what makes an
 * accidental extra key — a bank reference, a guardian name, a balance — a
 * compile error at the call site rather than a row discovered in the trail
 * later. `assertAuditPayloadSafe` enforces the same policy at runtime for
 * anything that reaches it dynamically; these types are the half a reviewer can
 * see.
 *
 * THE BINDING POLICY (DECISION_LOG, 2026-08-15 — Payment and promise audit
 * carries no bank reference and no new identifiers; 2026-08-09 — Identifiers are
 * masked in audit, names are not):
 *
 *   * MONEY IS THE CANONICAL DECIMAL STRING, never a number and never a
 *     `BigInt`. `JSON.stringify` cannot serialise a `BigInt` at all, and a
 *     `number` loses precision above 2^53 — in a table that is never rewritten.
 *   * NOTES ARE WRITTEN IN FULL. A note IS the fact being recorded, so masking
 *     it would make the trail useless. This follows the existing note policy
 *     rather than inventing one for money.
 *   * THE BANK REFERENCE IS NEVER COPIED. Only `hasReference`, a boolean, and
 *     `assertPaymentAuditSafe` below refuses a money-in payload that names the
 *     value. The rule is scoped to this domain deliberately: a substring rule in
 *     `audit-payload.ts` would refuse `referenceDate` and every other unrelated
 *     key a later domain might legitimately name, which is a policy decision
 *     nobody has taken.
 *   * NO NAMES, NO PHONE NUMBERS, NO FILE NUMBERS, NO NATIONAL IDENTIFIERS.
 *     Not the family's, not a child's, not a guardian's. The ids below are the
 *     traceability the trail needs, and a reader who is entitled to a name reads
 *     it from the family record.
 *   * NO BALANCE, NO CREDIT, NO AMOUNT DUE. Those are derived from rows at read
 *     time; a copy frozen into an append-only table would be a second account of
 *     the family's position that can never be corrected and can disagree with
 *     the first.
 *   * READS WRITE NOTHING. There is no audit row for viewing an account, a
 *     payment history or a promise list.
 *
 * The actor, the instant, the request id and the entity id are columns of the
 * audit row itself and are never repeated into these payloads.
 */

/**
 * `payment.recorded` — money arrived and was entered.
 *
 * `receivedOn` AND THE ENTRY INSTANT ARE BOTH RECOVERABLE, which is what makes a
 * back-dated payment visible as a back-date: the business day is here, and the
 * moment somebody typed it is the audit row's own timestamp.
 */
export type PaymentRecordedAudit = {
  readonly familyId: string;
  readonly amountToman: string;
  readonly method: PaymentMethod;
  readonly receivedOn: string;
  readonly hasReference: boolean;
  readonly note: string | null;
};

/**
 * `payment.voided` — `before`/`after`, the transition stated from both sides,
 * exactly as `session_charge.voided` states it. "It is void" does not record
 * that it was not.
 */
export type PaymentVoidedBeforeAudit = {
  readonly voidedAt: null;
};

export type PaymentVoidedAfterAudit = {
  readonly voidedAt: string;
  readonly voidReason: string;
};

/**
 * `payment.voided` — the metadata: what money was withdrawn from whom, and the
 * consequence that is NOT written anywhere else.
 *
 * `fulfilledPromiseId` IS THE POINT OF THIS SHAPE. Voiding a payment that had
 * fulfilled a promise does not touch the promise — it stays `FULFILLED`, because
 * a human judgement recorded at the time is not un-made by a later correction,
 * and forcing a mutation would rewrite history to keep an invariant tidy. The
 * consequence therefore has to be traceable from the void itself, or "why does
 * this promise point at voided money?" is a question with no recorded answer.
 * It is `null` when the payment fulfilled nothing.
 */
export type PaymentVoidedMetadataAudit = {
  readonly familyId: string;
  readonly amountToman: string;
  readonly method: PaymentMethod;
  readonly receivedOn: string;
  readonly fulfilledPromiseId: string | null;
};

/** `payment_promise.created` — an intention was recorded. No money moved. */
export type PromiseCreatedAudit = {
  readonly familyId: string;
  readonly amountToman: string;
  readonly dueOn: string;
  readonly note: string | null;
};

/**
 * `payment_promise.fulfilled` — the promise was kept, and here is the evidence.
 *
 * BOTH AMOUNTS ARE RECORDED, and that is deliberate. A payment may be LARGER
 * than the promise it fulfils — the surplus becomes credit and is deliberately
 * not allocated anywhere (DECISION_LOG, 2026-08-15) — so a trail carrying only
 * one number would leave a reader unable to explain why a promise of 500,000 is
 * settled by a payment of 800,000 without opening two more tables.
 */
export type PromiseFulfilledAudit = {
  readonly familyId: string;
  readonly promisedAmountToman: string;
  readonly paymentId: string;
  readonly paymentAmountToman: string;
};

/**
 * `payment_promise.rescheduled` — a new date was agreed instead of the old one.
 *
 * Both dates and the successor's id, so the chain is followable forward from any
 * link without re-reading the table, and the reason, which is mandatory.
 */
export type PromiseRescheduledAudit = {
  readonly familyId: string;
  readonly amountToman: string;
  readonly previousDueOn: string;
  readonly newDueOn: string;
  readonly successorPromiseId: string;
  readonly reason: string;
};

/** `payment_promise.cancelled` — the intention was abandoned, with its reason. */
export type PromiseCancelledAudit = {
  readonly familyId: string;
  readonly amountToman: string;
  readonly dueOn: string;
  readonly reason: string;
};

/**
 * The one runtime guard this domain adds: a money-in audit payload may say
 * WHETHER a bank reference exists and may never say what it is.
 *
 * NARROW BY DESIGN, AND SCOPED TO THE PAYLOADS ABOVE. It refuses a key that
 * names the reference itself and permits `hasReference` when — and only when —
 * it is a boolean, which is what makes the exemption incapable of smuggling the
 * value. It is called by the payment and promise audit writes and by nothing
 * else, so the general policy in `audit-payload.ts` stays unchanged for domains
 * that have taken no such decision.
 *
 * IT IS A SECOND LINE, NOT THE FIRST. The payload types above already make a
 * `reference` key a compile error at the call site; this catches the value that
 * arrives through a dynamically built object, which is the case a type cannot
 * see. `assertAuditPayloadSafe` still runs inside `AuditService.record` and is
 * unaffected.
 */
export function assertPaymentAuditSafe(payload: {
  before?: AuditJsonObject | null;
  after?: AuditJsonObject | null;
  metadata?: AuditJsonObject | null;
}): void {
  for (const [section, value] of Object.entries(payload)) {
    if (value === undefined || value === null) continue;
    assertNoBankReference(value, section);
  }
}

/** The reference is a flat key on these payloads; the walk is still recursive. */
function assertNoBankReference(value: AuditJsonValue, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertNoBankReference(item, `${path}[${index}]`);
    });
    return;
  }

  if (value === null || typeof value !== 'object') return;

  for (const [key, nested] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    const keyPath = `${path}.${key}`;

    if (normalized === 'hasreference') {
      if (typeof nested !== 'boolean') {
        throw new AuditPayloadError(
          `Payment audit key "${key}" must be a boolean; the reference value itself is never recorded`,
          keyPath,
        );
      }
      continue;
    }

    if (normalized.includes('reference')) {
      throw new AuditPayloadError(
        `Payment audit key "${key}" would copy a bank reference into a permanent record; ` +
          'record only hasReference',
        keyPath,
      );
    }

    assertNoBankReference(nested, keyPath);
  }
}
