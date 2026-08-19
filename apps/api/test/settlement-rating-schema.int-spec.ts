import { Prisma } from '@prisma/client';
import { uuidv7 } from '../src/common/uuid';
import { createHarness, resetDatabase, type Harness } from './harness';
import { seedChargedSession, shareRuleId, type SettlementFixture } from './settlement-support';

/**
 * What PostgreSQL itself refuses about an applied share snapshot.
 *
 * THESE TESTS DO NOT GO THROUGH THE SERVICE, AND THAT IS THE POINT. The service
 * is one writer; a migration script, a repair job and a psql prompt are others,
 * and what a therapist earned must be exactly as unrewritable for them. Every
 * insert below is raw SQL against a charge the application really produced.
 *
 * Every value is synthetic.
 */
describe('session settlement schema (real PostgreSQL)', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
  });

  /** An unrated charged session, so every row below is this suite's own. */
  async function unrated(): Promise<SettlementFixture> {
    return seedChargedSession(harness, { shareBasisPoints: null });
  }

  /**
   * The rule a raw insert names as provenance.
   *
   * `applied_share_rule_id` is NOT NULL, so every well-formed row below needs
   * one — which is itself the point: there is no rating without an agreement
   * behind it, and a fixture cannot pretend otherwise.
   *
   * It reuses the therapist's live rule when there is one, because
   * `therapist_share_rule_no_overlap_excl` allows only one to cover a day and
   * several tests insert more than one rating for the same fixture.
   */
  async function ruleFor(fixture: SettlementFixture): Promise<string> {
    const existing = await harness.prisma.therapistShareRule.findFirst({
      where: { therapistId: fixture.therapistId, voidedAt: null },
    });

    return existing?.id ?? shareRuleId(harness, fixture.managerToken, fixture.therapistId);
  }

  type RatingOverrides = {
    id?: string;
    chargeId?: string;
    participantId?: string;
    therapistId?: string;
    serviceDate?: string;
    basisPoints?: number;
    ruleId?: string | null;
    ratedVia?: 'AUTOMATIC' | 'EXPLICIT';
    base?: string;
    therapistGross?: string;
    clinicGross?: string;
    reason?: string | null;
    supersedes?: string | null;
  };

  async function insertRating(fixture: SettlementFixture, overrides: RatingOverrides = {}) {
    const basisPoints = overrides.basisPoints ?? 4000;
    const base = overrides.base ?? fixture.amountToman;
    const therapistGross =
      overrides.therapistGross ??
      ((BigInt(base) * BigInt(basisPoints) + 5000n) / 10000n).toString();
    const clinicGross = overrides.clinicGross ?? (BigInt(base) - BigInt(therapistGross)).toString();
    // Undefined means "whatever this therapist's agreement is"; an explicit
    // null is a test deliberately writing a rating with no provenance.
    const ruleId = overrides.ruleId === undefined ? await ruleFor(fixture) : overrides.ruleId;

    return harness.prisma.$executeRaw`
      INSERT INTO session_settlement (
        id, session_charge_id, appointment_participant_id, therapist_id, service_date,
        applied_share_basis_points, applied_share_rule_id, rated_via,
        base_amount_toman, therapist_gross_toman, clinic_gross_toman,
        reason, supersedes_session_settlement_id, created_at, created_by_user_id
      ) VALUES (
        ${overrides.id ?? uuidv7()}::uuid,
        ${overrides.chargeId ?? fixture.chargeId}::uuid,
        ${overrides.participantId ?? fixture.participantId}::uuid,
        ${overrides.therapistId ?? fixture.therapistId}::uuid,
        ${overrides.serviceDate ?? fixture.serviceDate}::date,
        ${basisPoints},
        ${ruleId}::uuid,
        ${overrides.ratedVia ?? 'EXPLICIT'}::session_rated_via,
        ${base}::bigint,
        ${therapistGross}::bigint,
        ${clinicGross}::bigint,
        ${overrides.reason === undefined ? 'دلیل آزمایشی' : overrides.reason},
        ${overrides.supersedes ?? null}::uuid,
        transaction_timestamp(),
        ${fixture.managerId}::uuid
      )
    `;
  }

  // -------------------------------------------------------------------------
  // The hand-written objects exist
  // -------------------------------------------------------------------------

  it('carries every hand-written constraint, index and trigger by name', async () => {
    const constraints = await harness.prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint WHERE conrelid = 'session_settlement'::regclass
    `;
    const names = constraints.map((row) => row.conname).sort();

    expect(names).toEqual(
      [
        'session_settlement_pkey',
        'session_settlement_charge_snapshot_fkey',
        'session_settlement_applied_share_rule_id_fkey',
        'session_settlement_supersedes_session_settlement_id_fkey',
        'session_settlement_created_by_user_id_fkey',
        'session_settlement_voided_by_user_id_fkey',
        'session_settlement_basis_points_chk',
        'session_settlement_split_chk',
        'session_settlement_provenance_chk',
        'session_settlement_reason_chk',
        'session_settlement_void_reason_chk',
        'session_settlement_void_consistency_chk',
        'session_settlement_self_supersede_chk',
      ].sort(),
    );

    const indexes = await harness.prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'session_settlement'
    `;
    expect(indexes.map((row) => row.indexname)).toContain(
      'session_settlement_one_valid_per_charge_uq',
    );

    const triggers = await harness.prisma.$queryRaw<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'session_settlement'::regclass AND NOT tgisinternal
    `;
    expect(triggers.map((row) => row.tgname).sort()).toEqual([
      // Added by checkpoint C4, and a separate trigger from the immutability one
      // because it is a different rule: immutability is about what a statement
      // may CHANGE, and this is about what a permitted change would leave
      // BEHIND — a therapist-borne concession apportioned to a share that no
      // longer stands.
      'session_settlement_enforce_allocation_guard',
      'session_settlement_enforce_immutability',
      'session_settlement_no_delete',
      'session_settlement_no_truncate',
    ]);

    // The target the composite key needs, on the ledger side.
    const chargeIndexes = await harness.prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'session_charge'
    `;
    expect(chargeIndexes.map((row) => row.indexname)).toContain(
      'session_charge_settlement_snapshot_uq',
    );
  });

  // -------------------------------------------------------------------------
  // The rating cannot disagree with the charge it settles
  // -------------------------------------------------------------------------

  describe('the composite key back into the charge', () => {
    it('refuses a base amount that is not the charge amount', async () => {
      const fixture = await unrated();

      await expect(insertRating(fixture, { base: '1' })).rejects.toThrow(
        /session_settlement_charge_snapshot_fkey/,
      );
    });

    it('refuses a therapist who did not deliver the session', async () => {
      const fixture = await unrated();
      const other = await unrated();

      await expect(insertRating(fixture, { therapistId: other.therapistId })).rejects.toThrow(
        /session_settlement_charge_snapshot_fkey/,
      );
    });

    it('refuses a service date that is not the charge day', async () => {
      const fixture = await unrated();

      await expect(insertRating(fixture, { serviceDate: '2026-09-06' })).rejects.toThrow(
        /session_settlement_charge_snapshot_fkey/,
      );
    });
  });

  // -------------------------------------------------------------------------
  // The split identity
  // -------------------------------------------------------------------------

  describe('the split identity', () => {
    it('refuses a therapist gross that is not the frozen half-up rounding', async () => {
      const fixture = await unrated();

      // 250000 * 40% is 100000. Off by one in either direction is refused.
      await expect(
        insertRating(fixture, {
          basisPoints: 4000,
          therapistGross: '100001',
          clinicGross: '149999',
        }),
      ).rejects.toThrow(/session_settlement_split_chk/);
    });

    it('refuses halves that do not sum to the base', async () => {
      const fixture = await unrated();

      await expect(
        insertRating(fixture, {
          basisPoints: 4000,
          therapistGross: '100000',
          clinicGross: '150001',
        }),
      ).rejects.toThrow(/session_settlement_split_chk/);
    });

    it('refuses a negative half', async () => {
      const fixture = await unrated();

      await expect(
        insertRating(fixture, { basisPoints: 4000, therapistGross: '-1', clinicGross: '250001' }),
      ).rejects.toThrow(/session_settlement_split_chk/);
    });

    it('refuses a share outside the basis-point bounds', async () => {
      const fixture = await unrated();

      await expect(
        insertRating(fixture, { basisPoints: 10001, therapistGross: '250025', clinicGross: '-25' }),
      ).rejects.toThrow(/session_settlement_(basis_points|split)_chk/);
    });

    it('accepts the exact half-up answer the service computes', async () => {
      const fixture = await unrated();

      // 250000 * 33.33% = 83325 exactly; the residual is the clinic's.
      await expect(insertRating(fixture, { basisPoints: 3333 })).resolves.toBe(1);

      const row = await harness.prisma.sessionSettlement.findFirstOrThrow({
        where: { sessionChargeId: fixture.chargeId },
      });
      expect(row.therapistGrossToman).toBe(83325n);
      expect(row.clinicGrossToman).toBe(166675n);
    });
  });

  // -------------------------------------------------------------------------
  // Provenance
  // -------------------------------------------------------------------------

  describe('provenance', () => {
    /**
     * THE COLUMN IS NOT NULL, ON BOTH KINDS OF RATING. A share rule is the only
     * source of settlement policy in this product: `rated_via` records whether
     * the server rated the session while charging it or a manager rated it
     * afterwards, and says nothing about where the percentage came from. A
     * rating with no rule behind it is not merely refused, it is unwritable.
     */
    it.each([['AUTOMATIC'], ['EXPLICIT']] as const)(
      'refuses a %s rating with no share rule behind it',
      async (ratedVia) => {
        const fixture = await unrated();

        await expect(
          insertRating(fixture, {
            ratedVia,
            ruleId: null,
            reason: ratedVia === 'EXPLICIT' ? 'دلیل آزمایشی' : null,
          }),
          // 23502, not a CHECK: the column is NOT NULL, so the row is refused
          // before any constraint gets to have an opinion about it.
        ).rejects.toThrow(/23502/);
      },
    );

    it('refuses an AUTOMATIC rating that carries a reason', async () => {
      const fixture = await unrated();
      const ruleId = await shareRuleId(harness, fixture.managerToken, fixture.therapistId);

      await expect(
        insertRating(fixture, { ratedVia: 'AUTOMATIC', ruleId, reason: 'دلیل آزمایشی' }),
      ).rejects.toThrow(/session_settlement_provenance_chk/);
    });

    it('refuses an EXPLICIT rating with no reason', async () => {
      const fixture = await unrated();
      const ruleId = await shareRuleId(harness, fixture.managerToken, fixture.therapistId);

      await expect(
        insertRating(fixture, { ratedVia: 'EXPLICIT', ruleId, reason: null }),
      ).rejects.toThrow(/session_settlement_provenance_chk/);
    });

    it('accepts both members when each carries what it should', async () => {
      const automatic = await unrated();
      const automaticRule = await shareRuleId(
        harness,
        automatic.managerToken,
        automatic.therapistId,
      );
      await expect(
        insertRating(automatic, { ratedVia: 'AUTOMATIC', ruleId: automaticRule, reason: null }),
      ).resolves.toBe(1);

      const explicit = await unrated();
      const explicitRule = await shareRuleId(harness, explicit.managerToken, explicit.therapistId);
      await expect(
        insertRating(explicit, {
          ratedVia: 'EXPLICIT',
          ruleId: explicitRule,
          reason: 'دلیل آزمایشی',
        }),
      ).resolves.toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Exactly one standing rating
  // -------------------------------------------------------------------------

  describe('exactly one standing rating per session', () => {
    it('refuses a second standing rating', async () => {
      const fixture = await unrated();
      await insertRating(fixture);

      // Prisma reports the partial unique index by its key rather than by its
      // name; `23505` and the charge id are what identify it.
      await expect(insertRating(fixture)).rejects.toThrow(/Key \(session_charge_id\)/);
    });

    it('lets a withdrawn rating be replaced, which is what a correction needs', async () => {
      const fixture = await unrated();
      const first = uuidv7();
      await insertRating(fixture, { id: first });

      await harness.prisma.$executeRaw`
        UPDATE session_settlement
           SET voided_at = transaction_timestamp(),
               voided_by_user_id = ${fixture.managerId}::uuid,
               void_reason = 'اصلاح'
         WHERE id = ${first}::uuid
      `;

      await expect(insertRating(fixture, { supersedes: first })).resolves.toBe(1);
      expect(
        await harness.prisma.sessionSettlement.count({
          where: { sessionChargeId: fixture.chargeId },
        }),
      ).toBe(2);
    });

    it('refuses a rating that supersedes itself', async () => {
      const fixture = await unrated();
      const id = uuidv7();

      await expect(insertRating(fixture, { id, supersedes: id })).rejects.toThrow(
        /session_settlement_self_supersede_chk/,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Immutability, no delete, no truncate
  // -------------------------------------------------------------------------

  describe('permanence', () => {
    async function seedRow(): Promise<{ fixture: SettlementFixture; id: string }> {
      const fixture = await unrated();
      const id = uuidv7();
      await insertRating(fixture, { id });
      return { fixture, id };
    }

    it.each([
      ['the applied percentage', Prisma.sql`applied_share_basis_points = 9000`],
      ['the base amount', Prisma.sql`base_amount_toman = 1`],
      ['the therapist gross', Prisma.sql`therapist_gross_toman = 1`],
      ['the provenance', Prisma.sql`rated_via = 'AUTOMATIC'`],
      ['the session it settles', Prisma.sql`service_date = '2026-09-06'`],
      ['the actor', Prisma.sql`created_by_user_id = gen_random_uuid()`],
    ])('refuses an edit to %s', async (_label, assignment) => {
      const { id } = await seedRow();

      await expect(
        harness.prisma.$executeRaw`
          UPDATE session_settlement SET ${assignment} WHERE id = ${id}::uuid
        `,
      ).rejects.toThrow(/immutable/);
    });

    it('permits the one transition, and refuses to change it afterwards', async () => {
      const { fixture, id } = await seedRow();

      await harness.prisma.$executeRaw`
        UPDATE session_settlement
           SET voided_at = transaction_timestamp(),
               voided_by_user_id = ${fixture.managerId}::uuid,
               void_reason = 'ابطال'
         WHERE id = ${id}::uuid
      `;

      // No unvoiding, and no revising the stated reason after the fact.
      await expect(
        harness.prisma.$executeRaw`
          UPDATE session_settlement SET voided_at = NULL, voided_by_user_id = NULL,
                 void_reason = NULL WHERE id = ${id}::uuid
        `,
      ).rejects.toThrow(/already voided/);

      await expect(
        harness.prisma.$executeRaw`
          UPDATE session_settlement SET void_reason = 'دلیل دیگر' WHERE id = ${id}::uuid
        `,
      ).rejects.toThrow(/already voided/);
    });

    it('refuses a half-stated withdrawal', async () => {
      const { id } = await seedRow();

      await expect(
        harness.prisma.$executeRaw`
          UPDATE session_settlement SET voided_at = transaction_timestamp()
           WHERE id = ${id}::uuid
        `,
      ).rejects.toThrow(/session_settlement_void_consistency_chk/);
    });

    it('refuses a delete and a truncate', async () => {
      const { id } = await seedRow();

      await expect(
        harness.prisma.$executeRaw`DELETE FROM session_settlement WHERE id = ${id}::uuid`,
      ).rejects.toThrow();

      await expect(
        harness.prisma.$executeRawUnsafe('TRUNCATE session_settlement'),
      ).rejects.toThrow();

      expect(await harness.prisma.sessionSettlement.count()).toBe(1);
    });

    it('refuses to delete the share rule a rating names', async () => {
      const fixture = await unrated();
      const ruleId = await shareRuleId(harness, fixture.managerToken, fixture.therapistId);
      await insertRating(fixture, { ratedVia: 'AUTOMATIC', ruleId, reason: null });

      // The rule's own no-delete trigger answers first; either way, provenance
      // is history and history keeps its references.
      await expect(
        harness.prisma.$executeRaw`DELETE FROM therapist_share_rule WHERE id = ${ruleId}::uuid`,
      ).rejects.toThrow();
    });
  });
});
