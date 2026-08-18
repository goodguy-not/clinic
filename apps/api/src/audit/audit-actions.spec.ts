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
    // Settlement is Milestone 8, and credit is derived from rows rather than
    // stored. An entity type is a table name, and neither table exists.
    for (const absent of ['family_credit', 'therapist_settlement', 'payment_allocation']) {
      expect(AUDIT_ENTITY_TYPES).not.toContain(absent as never);
    }
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
