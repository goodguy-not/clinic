import { createHarness, type Harness } from './harness';

/**
 * Pins what Milestone 7 checkpoint C1 did — and did not — do to the database.
 *
 * It added three B-tree indexes for a new access pattern: clinic-wide reads
 * keyed on a DATE rather than on a family. It added no table, no column, no
 * constraint and no trigger, and the second half of this suite is the one that
 * matters: a stored balance, a reporting aggregate or a materialised view would
 * be a second source of financial truth, which is precisely what this milestone
 * must not create.
 */
describe('reporting schema objects', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  async function indexesOf(table: string): Promise<Map<string, string>> {
    const rows = await harness.prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = ${table}
    `;

    return new Map(rows.map((row) => [row.indexname, row.indexdef]));
  }

  it('indexes the whole clinic’s charges by the day of the session', async () => {
    // Every other index on this table leads with a family, a child or a seat, so
    // "what did the clinic charge between these two dates" could only be a
    // sequential scan without this one.
    const byName = await indexesOf('session_charge');

    expect(byName.get('session_charge_service_date_idx')).toMatch(/\(service_date\)/);
    // The family-scoped index is untouched: the new read is an addition, not a
    // replacement.
    expect(byName.get('session_charge_family_id_service_date_idx')).toMatch(
      /family_id, service_date/,
    );
  });

  it('indexes payments by BOTH business days, because they are two questions', async () => {
    // `received_on` is the day the money arrived — the payments report's basis.
    // `created_at` is the day it was entered — the daily reconciliation's. A
    // payment received on Thursday and entered on Saturday is in Saturday's
    // drawer and in Thursday's takings, and neither read may fall back to a
    // sequential scan.
    const byName = await indexesOf('payment');

    expect(byName.get('payment_received_on_idx')).toMatch(/\(received_on\)/);
    expect(byName.get('payment_created_at_idx')).toMatch(/\(created_at\)/);
    expect(byName.get('payment_family_id_received_on_idx')).toMatch(/family_id, received_on/);
  });

  it('adds nothing to the promise table, whose existing index already answers it', async () => {
    // `(status, due_on)` is exactly the overdue and due-soon predicate the
    // dashboard and the promise report use.
    const byName = await indexesOf('payment_promise');

    expect(byName.get('payment_promise_status_due_on_idx')).toMatch(/status, due_on/);
    expect([...byName.keys()].filter((name) => name === 'payment_promise_due_on_idx')).toEqual([]);
  });

  it('creates no reporting table of any kind', async () => {
    // A report is a question asked of the rows that already exist. A snapshot,
    // rollup, aggregate or materialised view would be state stored before its
    // refresh rules were approved — and a number nobody could reconcile with the
    // family account beside it.
    const rows = await harness.prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name ~ '(report|dashboard|aggregate|rollup|snapshot|summary|balance|export)'
    `;

    expect(rows).toEqual([]);
  });

  it('creates no materialised view anywhere in the schema', async () => {
    const rows = await harness.prisma.$queryRaw<{ matviewname: string }[]>`
      SELECT matviewname FROM pg_matviews WHERE schemaname = 'public'
    `;

    expect(rows).toEqual([]);
  });

  it('stores no balance, credit or reporting total on any financial table', async () => {
    // The family position is derived on every read and stored nowhere
    // (DECISION_LOG, 2026-08-15 — Credit is derived). Milestone 7 reads it more
    // often; it does not cache it.
    const rows = await harness.prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('family', 'session_charge', 'charge_adjustment', 'payment',
                           'payment_promise')
        AND column_name ~ '(balance|credit|outstanding|owed|aggregate|total)'
    `;

    expect(rows).toEqual([]);
  });

  it('adds no follow-up date, which Milestone 7 was free to add and did not', () => {
    // The follow-up workflow was explicitly out of scope for this checkpoint. A
    // date column with no workflow behind it is a field people fill in and
    // nobody reads (DECISION_LOG, 2026-08-15).
    return expect(
      harness.prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name ~ 'follow'
      `,
    ).resolves.toEqual([]);
  });

  it('keeps every share and settlement column on the share rule and nowhere else', async () => {
    // MILESTONE 7 ASSERTED THERE WERE NONE ANYWHERE, because the settlement
    // basis was unapproved and a share column would have recorded an unfunded
    // liability as a fact. Milestone 8 checkpoint C2 approved the first of them
    // and put them where they belong: on `therapist_share_rule`, which is
    // CONFIGURATION — the agreement, effective-dated and immutable.
    //
    // The assertion is narrowed rather than dropped, and the narrowing is the
    // point. A share column appearing on `session_charge`, `charge_adjustment`
    // or any Milestone 5-7 table would be a settlement FACT recorded outside
    // the checkpoint that owns it, and it still fails here.
    const rows = await harness.prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name ~ '(share|percent|settlement)'
      ORDER BY table_name, column_name
    `;

    expect(rows).toEqual([
      { table_name: 'therapist_share_rule', column_name: 'share_basis_points' },
      { table_name: 'therapist_share_rule', column_name: 'supersedes_share_rule_id' },
    ]);
  });
});
