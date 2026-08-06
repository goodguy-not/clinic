import { CATALOG_STATUSES, TARIFF_PRICE_MODES } from '@clinic/contracts';
import { AUDIT_ENTITY_TYPES } from '../src/audit/audit-actions';
import { createHarness, type Harness } from './harness';

/**
 * Pins the hand-written half of the Milestone 2 migration.
 *
 * `prisma migrate diff` compares the datamodel with the database and sees
 * tables, columns, indexes and foreign keys. It does not see CHECK constraints,
 * exclusion constraints, functions or triggers — so the objects doing most of
 * the work in this schema are exactly the ones drift detection would let
 * disappear silently. This asserts each one exists by name.
 *
 * Behaviour is proved separately in `catalog-constraints.int-spec.ts`; this is
 * the inventory, and it fails loudly when something is dropped rather than when
 * a rule quietly stops being enforced.
 */
describe('catalog schema objects', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  // No resetDatabase: nothing here writes rows, and the catalogue is unaffected
  // by table contents.

  async function constraintNames(): Promise<string[]> {
    const rows = await harness.prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE contype IN ('c', 'x')
        AND conrelid::regclass::text IN ('therapist', 'service', 'service_duration', 'room', 'tariff')
    `;
    return rows.map((row) => row.conname);
  }

  async function triggerNames(): Promise<string[]> {
    const rows = await harness.prisma.$queryRaw<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgrelid::regclass::text IN ('therapist', 'service', 'room', 'tariff')
    `;
    return rows.map((row) => row.tgname);
  }

  it('holds every hand-written CHECK and exclusion constraint', async () => {
    const names = await constraintNames();

    expect(names).toEqual(
      expect.arrayContaining([
        'therapist_full_name_chk',
        'therapist_specialty_chk',
        'therapist_deactivated_consistency_chk',
        'service_name_chk',
        'service_public_description_chk',
        'service_deactivated_consistency_chk',
        'room_name_chk',
        'room_deactivated_consistency_chk',
        'service_duration_positive_chk',
        'tariff_price_bounds_chk',
        'tariff_price_mode_chk',
        'tariff_free_reason_chk',
        'tariff_effective_range_chk',
        'tariff_void_consistency_chk',
        'tariff_void_reason_chk',
        'tariff_no_overlap_therapist_excl',
        'tariff_no_overlap_general_excl',
      ]),
    );
  });

  it('holds a no-delete and no-truncate trigger on every permanent catalog table', async () => {
    const names = await triggerNames();

    for (const table of ['therapist', 'service', 'room', 'tariff']) {
      expect(names).toContain(`${table}_no_delete`);
      expect(names).toContain(`${table}_no_truncate`);
    }
  });

  it('holds the tariff immutability trigger and its function', async () => {
    expect(await triggerNames()).toContain('tariff_enforce_immutability');

    const [fn] = await harness.prisma.$queryRaw<{ proname: string }[]>`
      SELECT proname FROM pg_proc WHERE proname = 'enforce_tariff_immutability'
    `;
    expect(fn?.proname).toBe('enforce_tariff_immutability');
  });

  it('has btree_gist installed, without which the overlap constraints cannot exist', async () => {
    const [extension] = await harness.prisma.$queryRaw<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = 'btree_gist'
    `;
    expect(extension?.extname).toBe('btree_gist');
  });

  it('enforces the composite key that ties a tariff to a duration its service offers', async () => {
    const [fk] = await harness.prisma.$queryRaw<{ conname: string; definition: string }[]>`
      SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conname = 'tariff_service_id_duration_minutes_fkey'
    `;

    expect(fk?.conname).toBe('tariff_service_id_duration_minutes_fkey');
    // RESTRICT is the half of the rule that protects history: a duration that
    // was ever priced cannot be withdrawn.
    expect(fk?.definition).toMatch(/ON DELETE RESTRICT/);
  });

  it('requires a creator on every catalog table', async () => {
    const rows = await harness.prisma.$queryRaw<{ table_name: string; is_nullable: string }[]>`
      SELECT table_name, is_nullable
      FROM information_schema.columns
      WHERE column_name = 'created_by_user_id'
        AND table_name IN ('therapist', 'service', 'room', 'tariff')
    `;

    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.is_nullable).toBe('NO');
    }
  });

  it('stores effective dates as DATE and money as BIGINT', async () => {
    const rows = await harness.prisma.$queryRaw<{ column_name: string; data_type: string }[]>`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'tariff'
        AND column_name IN ('effective_start', 'effective_end', 'price_toman')
    `;

    const types = Object.fromEntries(rows.map((row) => [row.column_name, row.data_type]));

    // A timestamp here would reintroduce the offset a calendar day must not have.
    expect(types['effective_start']).toBe('date');
    expect(types['effective_end']).toBe('date');
    // Integer toman, never a floating-point or numeric type.
    expect(types['price_toman']).toBe('bigint');
  });

  describe('enum values match the shared contracts', () => {
    async function enumLabels(typeName: string): Promise<string[]> {
      const rows = await harness.prisma.$queryRaw<{ label: string }[]>`
        SELECT e.enumlabel AS label
        FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = ${typeName}
        ORDER BY e.enumsortorder
      `;
      return rows.map((row) => row.label);
    }

    it('catalog_status', async () => {
      expect(await enumLabels('catalog_status')).toEqual([...CATALOG_STATUSES]);
    });

    it('tariff_price_mode', async () => {
      // Drift here would let the API accept a mode the database rejects, or
      // read one it cannot name.
      expect(await enumLabels('tariff_price_mode')).toEqual([...TARIFF_PRICE_MODES]);
    });
  });

  it('names every audited entity type as a real table', async () => {
    const rows = await harness.prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
    `;
    const tables = rows.map((row) => row.table_name);

    for (const entityType of AUDIT_ENTITY_TYPES) {
      expect(tables).toContain(entityType);
    }
  });

  it('adds no table beyond the approved scope', async () => {
    const rows = await harness.prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `;
    const tables = rows.map((row) => row.table_name).sort();

    // Availability, appointments, ledger, payments and the public site are
    // later milestones. Listing the whole set here makes an out-of-scope table
    // fail a test rather than arrive unnoticed — which is exactly what it did
    // when Milestone 3 added its four, so this list grew deliberately.
    expect(tables).toEqual(
      [
        '_prisma_migrations',
        'app_user',
        'audit_log',
        'room',
        'room_service',
        'service',
        'service_duration',
        'tariff',
        'therapist',
        'therapist_service',
        'user_session',
        // Milestone 3.
        'family',
        'guardian',
        'child',
        'registration_draft',
      ].sort(),
    );
  });
});
