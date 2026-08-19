import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from './audit-actions';

/**
 * The audit vocabulary, pinned where it is declared.
 *
 * The integration suites assert that every action and entity type satisfies the
 * `audit_log` format CHECKs against a real database. This is the half that does
 * not need one: the shape of the names, and the exact Milestone 5 additions.
 */
describe('audit vocabulary', () => {
  it('names every action in the form the audit_log CHECK requires', () => {
    for (const action of AUDIT_ACTIONS) {
      expect(action).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);
    }
  });

  it('names every ledger action after its table and a past-tense verb', () => {
    // Two segments exactly, unlike the three-segment auth actions: the ledger
    // names a table and what happened to a row in it.
    for (const action of AUDIT_ACTIONS.filter(
      (one) => one.startsWith('session_charge.') || one.startsWith('charge_adjustment.'),
    )) {
      expect(action).toMatch(/^(session_charge|charge_adjustment)\.[a-z_]+ed$/);
    }
  });

  // Whether each one is a real table is a question about the database, and is
  // asserted in `catalog-schema.int-spec.ts` — including the single non-row
  // subject, `report`. Here the check is the one the CHECK constraint makes.
  it('gives every entity type the identifier shape the entity_type CHECK demands', () => {
    for (const entityType of AUDIT_ENTITY_TYPES) {
      expect(entityType).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('adds exactly the four approved ledger actions', () => {
    const ledgerActions = AUDIT_ACTIONS.filter(
      (action) => action.startsWith('session_charge.') || action.startsWith('charge_adjustment.'),
    );

    expect([...ledgerActions].sort()).toEqual(
      [
        'charge_adjustment.created',
        'charge_adjustment.voided',
        'session_charge.posted',
        'session_charge.voided',
      ].sort(),
    );
  });

  it('records a concession against the adjustment, not as a change to the charge', () => {
    // A discount is a row in `charge_adjustment`; the charge itself is never
    // rewritten (DECISION_LOG, 2026-08-14), so no action claims it was.
    expect(AUDIT_ACTIONS).not.toContain('session_charge.adjusted' as never);
    expect(AUDIT_ACTIONS).not.toContain('session_charge.updated' as never);
    expect(AUDIT_ACTIONS).not.toContain('session_charge.status_changed' as never);
  });

  it('does not name a re-post as its own action', () => {
    // A re-post is a post. The void that preceded it is already its own fact.
    expect(AUDIT_ACTIONS).not.toContain('session_charge.reposted' as never);
  });

  it('names both ledger tables as entity types', () => {
    expect(AUDIT_ENTITY_TYPES).toContain('session_charge');
    expect(AUDIT_ENTITY_TYPES).toContain('charge_adjustment');
  });

  it('names no entity type this milestone does not have a table for', () => {
    // Credit is derived from rows rather than stored, and payment allocation is
    // not part of this product at all. An entity type is a table name, and
    // neither table exists.
    for (const absent of ['family_credit', 'payment_allocation', 'therapist_settlement']) {
      expect(AUDIT_ENTITY_TYPES).not.toContain(absent as never);
    }
  });

  describe('therapist settlement', () => {
    const settlementActions = AUDIT_ACTIONS.filter((action) =>
      /^(?:therapist_share_rule|session_settlement|settlement_period)\./.test(action),
    );

    it('adds exactly the five approved actions', () => {
      expect([...settlementActions].sort()).toEqual(
        [
          'therapist_share_rule.created',
          'therapist_share_rule.voided',
          'session_settlement.rated',
          'session_settlement.voided',
          'settlement_period.closed',
        ].sort(),
      );
    });

    it('names every one of them after its table and a past-tense verb', () => {
      for (const action of settlementActions) {
        expect(action).toMatch(
          /^(?:therapist_share_rule|session_settlement|settlement_period)\.[a-z_]+ed$/,
        );
      }
    });

    it('records a share correction as two facts, not as an edit', () => {
      // A share rule is never rewritten: a correction voids the row and writes a
      // replacement, so the percentage that stopped applying and the one that
      // replaced it are both readable. The tariff decision, applied to the other
      // side of the money.
      for (const absent of [
        'therapist_share_rule.updated',
        'therapist_share_rule.status_changed',
      ]) {
        expect(AUDIT_ACTIONS).not.toContain(absent as never);
      }
    });

    it('describes an atomic rating correction with the two actions it performs', () => {
      // A correction withdraws a rating and writes its replacement in one
      // transaction, and writes BOTH actions there. A third name would describe
      // one act as three, and the request id already ties the pair together.
      expect(AUDIT_ACTIONS).not.toContain('session_settlement.corrected' as never);
      expect(AUDIT_ACTIONS).not.toContain('session_settlement.updated' as never);
    });

    it('names no act the product refuses to have', () => {
      // A closed period is immutable and is never reopened, so there is no
      // action for it — vocabulary for a capability that does not exist reads as
      // a capability that does. And Milestone 8 records no therapist payout of
      // any kind, so nothing here names money leaving the clinic.
      for (const absent of [
        'settlement_period.reopened',
        'settlement_period.updated',
        'settlement.paid',
        'therapist_payment.recorded',
      ]) {
        expect(AUDIT_ACTIONS).not.toContain(absent as never);
      }
    });

    it('names an entity type only once its table exists', () => {
      // THE TRIPWIRE, AND IT POINTS BOTH WAYS. `AUDIT_ENTITY_TYPES` is asserted
      // against the real schema in `catalog-schema.int-spec.ts` — every entry is
      // a table, except the declared non-row subjects, which must NOT be
      // (DECISION_LOG, 2026-08-18). Naming one before its table exists fails
      // that assertion for as long as the table is missing; forgetting it in the
      // checkpoint that creates the table would leave the writes with nothing to
      // name. This test fails in the second case, so the pairing has to be done
      // deliberately in the checkpoint that owns it.
      //
      // Checkpoint C2 created `therapist_share_rule` and paired it here.
      expect(AUDIT_ENTITY_TYPES).toContain('therapist_share_rule');

      // The other two tables do not exist yet, so their entity types must not.
      for (const pending of ['session_settlement', 'settlement_period']) {
        expect(AUDIT_ENTITY_TYPES).not.toContain(pending as never);
      }

      // Every settlement record still has at least one action naming it,
      // whether or not its table is here yet.
      for (const subject of ['therapist_share_rule', 'session_settlement', 'settlement_period']) {
        expect(AUDIT_ACTIONS.some((action) => action.startsWith(`${subject}.`))).toBe(true);
      }
    });
  });

  describe('money in', () => {
    const moneyInActions = AUDIT_ACTIONS.filter(
      (action) => action.startsWith('payment.') || action.startsWith('payment_promise.'),
    );

    it('adds exactly the six approved actions', () => {
      expect([...moneyInActions].sort()).toEqual(
        [
          'payment.recorded',
          'payment.voided',
          'payment_promise.created',
          'payment_promise.fulfilled',
          'payment_promise.rescheduled',
          'payment_promise.cancelled',
        ].sort(),
      );
    });

    it('names every one of them after its table and a past-tense verb', () => {
      for (const action of moneyInActions) {
        expect(action).toMatch(/^(payment|payment_promise)\.[a-z_]+ed$/);
      }
    });

    it('records the three promise resolutions as three facts, not one diff', () => {
      // They share ONE permission, because none of them moves money; they are
      // three audit actions, because "how often does a family reschedule rather
      // than pay?" is a question you have to be able to count the answer to.
      for (const absent of [
        'payment_promise.resolved',
        'payment_promise.status_changed',
        'payment_promise.updated',
      ]) {
        expect(AUDIT_ACTIONS).not.toContain(absent as never);
      }
    });

    it('never records the passage of time or a rewrite that cannot happen', () => {
      // `MISSED` is derived from the clock and nobody performs it; nothing about
      // a payment is ever rewritten, and a read writes no row at all.
      for (const absent of [
        'payment_promise.missed',
        'payment.updated',
        'payment.read',
        'family_account.read',
      ]) {
        expect(AUDIT_ACTIONS).not.toContain(absent as never);
      }
    });

    it('names both Milestone 6 tables as entity types', () => {
      expect(AUDIT_ENTITY_TYPES).toContain('payment');
      expect(AUDIT_ENTITY_TYPES).toContain('payment_promise');
    });
  });

  it('keeps every name unique', () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
    expect(new Set(AUDIT_ENTITY_TYPES).size).toBe(AUDIT_ENTITY_TYPES.length);
  });
});
