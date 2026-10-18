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
      // Checkpoint C2 created `therapist_share_rule`, C3 created
      // `session_settlement` and C6 created `settlement_period`; each was paired
      // here by the checkpoint that created its table.
      expect(AUDIT_ENTITY_TYPES).toContain('therapist_share_rule');
      expect(AUDIT_ENTITY_TYPES).toContain('session_settlement');
      expect(AUDIT_ENTITY_TYPES).toContain('settlement_period');

      // `settlement_line` is a table and is deliberately NOT an entity type: a
      // line is materialised by a close rather than decided on its own, is never
      // edited or withdrawn, and no audit row ever names one. The close is
      // recorded once, against the period.
      expect(AUDIT_ENTITY_TYPES).not.toContain('settlement_line' as never);

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

  describe('the public website', () => {
    const websiteActions = AUDIT_ACTIONS.filter((action) =>
      /^(?:public_article|public_testimonial|clinic_public_profile)\.|^therapist\.public_/.test(
        action,
      ),
    );

    it('adds exactly the fourteen approved checkpoint A2 actions, plus A6 drafting and M10 A3 withdrawal', () => {
      expect([...websiteActions].sort()).toEqual(
        [
          'public_article.created',
          'public_article.updated',
          'public_article.published',
          'public_article.unpublished',
          'public_testimonial.created',
          'public_testimonial.updated',
          'public_testimonial.approved',
          'public_testimonial.approval_revoked',
          'public_testimonial.published',
          'public_testimonial.unpublished',
          'therapist.public_profile_updated',
          'therapist.public_profile_published',
          'therapist.public_profile_unpublished',
          'clinic_public_profile.updated',
          // Milestone 9.5, checkpoint A6. Preparing a colleague's public copy
          // under the drafting authority, which is a different act by a
          // different role from the manager's `.updated`, and publishes nobody.
          'therapist.public_profile_drafted',
          // Milestone 10, checkpoint A3. A family withdrawing consent (the
          // manager's record) and the erasure that follows (the nightly job's).
          'public_testimonial.consent_withdrawn',
          'public_testimonial.content_erased',
        ].sort(),
      );
    });

    it('names the A6 service editorial acts, and only those two', () => {
      // The service side of the same split. `service.updated` is unchanged and
      // still records the operational form including the slug and the
      // visibility flag; these two are the copy being prepared and the copy
      // being promoted onto the live page, which A2 could not have separated
      // because there was nothing to promote.
      expect(AUDIT_ACTIONS.filter((action) => action.startsWith('service.'))).toEqual([
        'service.created',
        'service.updated',
        'service.status_changed',
        'service.public_copy_drafted',
        'service.public_copy_published',
      ]);
    });

    it('does not name a separate publication for a therapist copy', () => {
      // Publishing a colleague's prepared words IS the opt-in: the same
      // statement copies the draft across and sets the flag, so a second name
      // would describe one act twice.
      expect(AUDIT_ACTIONS).not.toContain('therapist.public_copy_published' as never);
      expect(AUDIT_ACTIONS).not.toContain('service.public_copy_withdrawn' as never);
    });

    it('keeps publishing separate from editing, in both directions', () => {
      // "When did this go on the website, and when did it come off again?" is
      // the question asked after somebody complains about a page, and an answer
      // buried in a diff of a boolean is not something you can count.
      for (const subject of ['public_article', 'public_testimonial'] as const) {
        expect(AUDIT_ACTIONS).toContain(`${subject}.published`);
        expect(AUDIT_ACTIONS).toContain(`${subject}.unpublished`);
        expect(AUDIT_ACTIONS).toContain(`${subject}.updated`);
      }
    });

    it('names approval and publication as different testimonial facts', () => {
      // Approval is the privacy review PROJECT_SPEC.md 11 requires; publication
      // is placement on a page. A single action would make withdrawing a
      // quotation indistinguishable from declaring its review wrong.
      expect(AUDIT_ACTIONS).toContain('public_testimonial.approved');
      expect(AUDIT_ACTIONS).toContain('public_testimonial.approval_revoked');
      expect(AUDIT_ACTIONS).toContain('public_testimonial.published');
    });

    it('adds no second action for publishing a service', () => {
      // A service public description, slug and visibility are columns on the
      // catalog row written by the same form under the same authority, so
      // `service.updated` already records it with both sides in its payload. A
      // second name would describe one write as two facts.
      for (const absent of ['service.published', 'service.unpublished', 'service.public_updated']) {
        expect(AUDIT_ACTIONS).not.toContain(absent as never);
      }
    });

    it('names no act the public reads perform', () => {
      // Reading a published page is not an audited act. Copying every visit
      // into an append-only permanent table would build a second, undeletable
      // record of who looked at what.
      for (const absent of [
        'public_article.viewed',
        'public_article.read',
        'website.visited',
        'sitemap.generated',
      ]) {
        expect(AUDIT_ACTIONS).not.toContain(absent as never);
      }
    });

    it('names the three Milestone 9 tables as entity types', () => {
      for (const entityType of [
        'clinic_public_profile',
        'public_article',
        'public_testimonial',
      ] as const) {
        expect(AUDIT_ENTITY_TYPES).toContain(entityType);
      }
    });
  });

  describe('Milestone 10, checkpoint A3', () => {
    it('adds exactly the erasure and job actions, and one entity type', () => {
      expect(AUDIT_ACTIONS.filter((action) => /bytes_erased|scheduled_job\./.test(action))).toEqual(
        ['media.bytes_erased', 'scheduled_job.succeeded'],
      );
      expect(AUDIT_ENTITY_TYPES).toContain('scheduled_job');
    });
  });
});
