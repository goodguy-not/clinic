import {
  CHILD_SEXES,
  DRAFT_PURPOSES,
  GUARDIAN_RELATIONSHIPS,
  RECORD_STATUSES,
} from '@clinic/contracts';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../src/audit/audit-actions';
import { createHarness, type Harness } from './harness';

/**
 * Pins the hand-written half of the Milestone 3 migration.
 *
 * `prisma migrate diff` compares the datamodel with the database and sees
 * tables, columns, indexes and foreign keys. It does not see CHECK constraints,
 * partial indexes, sequences, functions or triggers — so the objects doing most
 * of the work in this schema are exactly the ones drift detection would let
 * disappear silently. This asserts each one exists by name.
 *
 * Behaviour is proved separately in `families-constraints.int-spec.ts`; this is
 * the inventory, and it fails loudly when something is dropped rather than when
 * a rule quietly stops being enforced.
 */
describe('families schema objects', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  // No resetDatabase: nothing here writes rows, and the catalogue is unaffected
  // by table contents.

  const M3_TABLES = ['family', 'guardian', 'child', 'registration_draft'];

  async function checkConstraintNames(): Promise<string[]> {
    const rows = await harness.prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE contype = 'c'
        AND conrelid::regclass::text IN ('family', 'guardian', 'child', 'registration_draft', 'audit_log')
    `;
    return rows.map((row) => row.conname);
  }

  it('holds every hand-written CHECK constraint', async () => {
    const names = await checkConstraintNames();

    expect(names).toEqual(
      expect.arrayContaining([
        'family_name_chk',
        'family_search_name_chk',
        'family_address_chk',
        'family_note_chk',
        'family_deactivated_consistency_chk',
        'guardian_full_name_chk',
        'guardian_search_name_chk',
        'guardian_relationship_note_chk',
        'guardian_mobile_chk',
        'guardian_landline_chk',
        'guardian_primary_needs_contact_chk',
        'child_first_name_chk',
        'child_last_name_chk',
        'child_search_first_name_chk',
        'child_search_last_name_chk',
        'child_birth_date_chk',
        'child_file_number_chk',
        'child_national_id_chk',
        'child_legacy_file_number_chk',
        'child_referral_source_chk',
        'child_note_chk',
        'child_deactivated_consistency_chk',
        'registration_draft_token_hash_length_chk',
        'registration_draft_expiry_chk',
        'registration_draft_target_chk',
        // Added to a Milestone 1 table. The only statement in this migration
        // that is not a CREATE.
        'audit_log_masked_identifiers_chk',
      ]),
    );
  });

  it('holds the three partial unique indexes', async () => {
    // Partial because each is conditional, which is precisely what Prisma
    // cannot express and what `migrate diff` cannot see.
    const rows = await harness.prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN ('guardian', 'child')
        AND indexdef LIKE '%WHERE%'
    `;

    const byName = new Map(rows.map((row) => [row.indexname, row.indexdef]));

    expect(byName.get('guardian_one_primary_per_family_uq')).toMatch(/UNIQUE.*is_primary_contact/s);
    expect(byName.get('child_national_id_uq')).toMatch(/UNIQUE.*national_id IS NOT NULL/s);
    expect(byName.get('child_legacy_paper_file_number_uq')).toMatch(
      /UNIQUE.*legacy_paper_file_number IS NOT NULL/s,
    );
  });

  it('holds the four support functions, each in the public schema', async () => {
    // Scoped to `public` on purpose. `pg_catalog` ships functions of its own,
    // and an unqualified existence test would pass on one of those even if ours
    // had been dropped — which is why `search_like_escape` carries a prefix
    // rather than colliding with `pg_catalog.like_escape`.
    const rows = await harness.prisma.$queryRaw<{ proname: string; volatility: string }[]>`
      SELECT p.proname, p.provolatile::text AS volatility
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('fa_normalize', 'search_like_escape', 'clinic_date',
                          'audit_identifiers_masked', 'enforce_child_identity_immutability')
    `;

    const byName = new Map(rows.map((row) => [row.proname, row.volatility]));

    expect([...byName.keys()].sort()).toEqual([
      'audit_identifiers_masked',
      'clinic_date',
      'enforce_child_identity_immutability',
      'fa_normalize',
      'search_like_escape',
    ]);

    // `i` is immutable, `s` is stable. The three used inside CHECK constraints
    // must be immutable or PostgreSQL would have refused the constraint;
    // `clinic_date` is stable because a timezone definition can change, which
    // is exactly why the future-birth-date rule lives in the service.
    expect(byName.get('fa_normalize')).toBe('i');
    expect(byName.get('search_like_escape')).toBe('i');
    expect(byName.get('audit_identifiers_masked')).toBe('i');
    expect(byName.get('clinic_date')).toBe('s');
  });

  it('does not leave a public function colliding with a pg_catalog builtin', async () => {
    const rows = await harness.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'like_escape'
    `;

    expect(Number(rows[0]?.count ?? 0)).toBe(0);
  });

  it('holds the file-number sequence, starting at the approved value', async () => {
    const rows = await harness.prisma.$queryRaw<
      { start_value: bigint; increment_by: bigint; cycle: boolean }[]
    >`
      SELECT start_value, increment_by, cycle FROM pg_sequences
      WHERE schemaname = 'public' AND sequencename = 'child_file_number_seq'
    `;

    expect(Number(rows[0]?.start_value)).toBe(10001);
    expect(Number(rows[0]?.increment_by)).toBe(1);
    expect(rows[0]?.cycle).toBe(false);
  });

  it('does not attach the sequence as a column default', async () => {
    // Attaching it would be visible to Prisma, so the datamodel would have to
    // describe it or drift detection would fail on every run. The service calls
    // `nextval()` explicitly instead.
    const rows = await harness.prisma.$queryRaw<{ column_default: string | null }[]>`
      SELECT column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'child' AND column_name = 'file_number'
    `;

    expect(rows[0]?.column_default).toBeNull();
  });

  it('protects family and child from deletion, and leaves the other two alone', async () => {
    const rows = await harness.prisma.$queryRaw<{ tgname: string; table_name: string }[]>`
      SELECT tgname, tgrelid::regclass::text AS table_name FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgrelid::regclass::text IN ('family', 'guardian', 'child', 'registration_draft')
    `;

    const names = rows.map((row) => row.tgname).sort();

    expect(names).toEqual([
      'child_enforce_identity_immutability',
      'child_no_delete',
      'child_no_truncate',
      'family_no_delete',
      'family_no_truncate',
    ]);

    // Guardians are current configuration, replaced wholesale with their
    // family. Drafts are transient workflow state that is meant to be consumed
    // and physically removed. Neither is history, so neither is protected.
    for (const table of ['guardian', 'registration_draft']) {
      expect(rows.filter((row) => row.table_name === table)).toHaveLength(0);
    }
  });

  it('creates exactly the four approved tables', async () => {
    const rows = await harness.prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('family', 'guardian', 'child', 'registration_draft')
    `;

    expect(rows.map((row) => row.table_name).sort()).toEqual([...M3_TABLES].sort());
  });

  describe('the contract enums match the PostgreSQL enums exactly', () => {
    async function enumValues(name: string): Promise<string[]> {
      const rows = await harness.prisma.$queryRaw<{ label: string }[]>`
        SELECT e.enumlabel AS label
        FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = ${name}
        ORDER BY e.enumsortorder
      `;
      return rows.map((row) => row.label);
    }

    it('record_status', async () => {
      expect(await enumValues('record_status')).toEqual([...RECORD_STATUSES]);
    });

    it('guardian_relationship', async () => {
      expect(await enumValues('guardian_relationship')).toEqual([...GUARDIAN_RELATIONSHIPS]);
    });

    it('child_sex', async () => {
      expect(await enumValues('child_sex')).toEqual([...CHILD_SEXES]);
    });

    it('draft_purpose', async () => {
      expect(await enumValues('draft_purpose')).toEqual([...DRAFT_PURPOSES]);
    });
  });

  describe('audit vocabulary', () => {
    it('names family and child as entity types', () => {
      expect(AUDIT_ENTITY_TYPES).toContain('family');
      expect(AUDIT_ENTITY_TYPES).toContain('child');
    });

    it('introduces no draft entity type and no draft action', () => {
      // A draft is transient workflow state, not a historical fact. Auditing one
      // would create a permanent record of a submission that was never made.
      expect(AUDIT_ENTITY_TYPES).not.toContain('registration_draft');
      expect(AUDIT_ENTITY_TYPES).not.toContain('guardian');

      for (const action of AUDIT_ACTIONS) {
        expect(action).not.toMatch(/draft/i);
      }
    });

    it('every action still satisfies the audit_log format CHECK', async () => {
      const rows = await harness.prisma.$queryRaw<{ ok: boolean }[]>`
        SELECT bool_and(a ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$') AS ok
        FROM unnest(${[...AUDIT_ACTIONS]}::text[]) AS a
      `;

      expect(rows[0]?.ok).toBe(true);
    });
  });
});
