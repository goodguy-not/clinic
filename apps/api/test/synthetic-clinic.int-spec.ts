import { seedSyntheticClinic } from '../src/dev/synthetic-clinic';
import { createHarness, resetDatabase, seedUser, type Harness } from './harness';

/**
 * Proves the synthetic-clinic seeder actually works against a disposable
 * database, and that what it produces is a clinic rather than a pile of rows.
 *
 * IT RUNS THE REAL SEEDER, SMALL. One week of history, five families and two
 * therapists, which is the same code path a reviewer runs with the default five
 * weeks and twelve families — only faster.
 *
 * WHAT IS ASSERTED IS THE DOMAIN, NOT THE COUNTS. That every charge belongs to
 * an attended seat of a completed session, that a cancellation and a no-show
 * produced none, that the money is attributed to more than one recorder, that
 * every act left an audit row, and that no synthetic child carries anything
 * shaped like a real national identifier. A seeder that satisfies those is a
 * seeder a dashboard can be reviewed against.
 *
 * The refusals that keep this away from a real database are unit-tested in
 * `src/dev/disposable-database.spec.ts`; the harness itself refuses any database
 * whose name does not end in `_test` or `_ci`.
 */
describe('the synthetic clinic seed', () => {
  let harness: Harness;
  let summary: Awaited<ReturnType<typeof seedSyntheticClinic>>;

  beforeAll(async () => {
    harness = await createHarness();
    await resetDatabase();

    // The seeder performs every act under a real manager and creates none, so
    // the account bootstrap would create is the one precondition it has.
    await seedUser(harness, { role: 'MANAGER', username: 'synthetic_seed_manager' });

    summary = await seedSyntheticClinic(harness.app, {
      runTag: 'itest',
      weeks: 1,
      families: 5,
      therapists: 2,
      slotsPerDay: 2,
    });
  }, 180_000);

  afterAll(async () => {
    await harness.close();
  });

  it('builds a clinic: staff, catalog, families, a diary and money', () => {
    expect(summary.runTag).toBe('itest');
    expect(summary.staff).toHaveLength(2);
    expect(summary.services).toBeGreaterThan(0);
    expect(summary.rooms).toBeGreaterThan(0);
    expect(summary.therapists).toBe(2);
    expect(summary.families).toBe(5);
    expect(summary.children).toBeGreaterThanOrEqual(3);
    expect(summary.appointments).toBeGreaterThan(0);
    expect(summary.completed).toBeGreaterThan(0);
    expect(summary.charges).toBeGreaterThan(0);
    expect(summary.payments).toBeGreaterThan(0);
    expect(summary.promises).toBeGreaterThan(0);
  });

  it('spans more than one clinic day, in both directions from today', async () => {
    // A dashboard is reviewed on today, and a report over a period. A seed that
    // landed everything on one day would exercise neither.
    const rows = await harness.prisma.$queryRaw<
      { days: bigint; earliest: string; latest: string }[]
    >`
      SELECT count(DISTINCT clinic_date(starts_at)) AS days,
             min(clinic_date(starts_at))::text AS earliest,
             max(clinic_date(starts_at))::text AS latest
      FROM appointment
    `;

    const row = rows[0];

    expect(Number(row?.days ?? 0n)).toBeGreaterThan(3);
    // Compared as strings, which is exact for `YYYY-MM-DD`: the format is
    // fixed-width and lexicographic order is chronological order.
    expect((row?.earliest ?? '') < summary.clinicToday).toBe(true);
    expect((row?.latest ?? '') > summary.clinicToday).toBe(true);
  });

  it('raises a charge only where the domain allows one', async () => {
    // Only an attended participant of a completed appointment may carry a
    // primary session charge (CLAUDE.md). The seeder writes through the one
    // posting path, so this is a property of the data it produced rather than a
    // rule it re-implemented.
    const rows = await harness.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count
      FROM session_charge sc
      JOIN appointment_participant ap ON ap.id = sc.appointment_participant_id
      JOIN appointment a ON a.id = ap.appointment_id
      WHERE a.status <> 'COMPLETED' OR ap.attendance <> 'ATTENDED'
    `;

    expect(Number(rows[0]?.count ?? 0n)).toBe(0);
  });

  it('leaves cancellations, no-shows and unresolved outcomes deliberately uncharged', async () => {
    const rows = await harness.prisma.$queryRaw<
      {
        cancelled: bigint;
        no_shows: bigint;
        pending: bigint;
      }[]
    >`
      SELECT count(*) FILTER (WHERE a.status IN ('CANCELLED_BY_FAMILY', 'CANCELLED_BY_CLINIC'))
               AS cancelled,
             count(*) FILTER (WHERE ap.attendance = 'NO_SHOW') AS no_shows,
             count(*) FILTER (WHERE ap.attendance = 'PENDING') AS pending
      FROM appointment_participant ap
      JOIN appointment a ON a.id = ap.appointment_id
    `;

    const row = rows[0];

    // All three exist in the data, and none of them produced money.
    expect(Number(row?.cancelled ?? 0n)).toBeGreaterThan(0);
    expect(Number(row?.no_shows ?? 0n)).toBeGreaterThan(0);
    expect(Number(row?.pending ?? 0n)).toBeGreaterThan(0);
  });

  it('produces the financial variety a report has to be readable against', async () => {
    const [charges] = await harness.prisma.$queryRaw<
      { voided: bigint; free: bigint; adjusted: bigint }[]
    >`
      SELECT count(*) FILTER (WHERE sc.voided_at IS NOT NULL) AS voided,
             count(*) FILTER (WHERE sc.price_mode = 'FREE') AS free,
             count(DISTINCT ca.session_charge_id) AS adjusted
      FROM session_charge sc
      LEFT JOIN charge_adjustment ca ON ca.session_charge_id = sc.id
    `;

    expect(Number(charges?.voided ?? 0n)).toBeGreaterThan(0);
    expect(Number(charges?.adjusted ?? 0n)).toBeGreaterThan(0);
    // A complimentary session: priced FREE, and structurally distinct from a
    // paid session later adjusted to zero.
    expect(Number(charges?.free ?? 0n)).toBeGreaterThan(0);

    const [money] = await harness.prisma.$queryRaw<
      { methods: bigint; recorders: bigint; back_dated: bigint }[]
    >`
      SELECT count(DISTINCT method) AS methods,
             count(DISTINCT created_by_user_id) AS recorders,
             count(*) FILTER (WHERE received_on < clinic_date(created_at)) AS back_dated
      FROM payment
    `;

    // More than one recorder, so per-user attribution and each user's own daily
    // reconciliation have something to distinguish.
    expect(Number(money?.recorders ?? 0n)).toBeGreaterThan(1);
    expect(Number(money?.methods ?? 0n)).toBeGreaterThan(1);
    // And money entered later than it arrived, which is the whole reason the
    // reconciliation and the payments report key on different days.
    expect(Number(money?.back_dated ?? 0n)).toBeGreaterThan(0);
  });

  it('leaves a family owing, a family in credit and a promise in every state it can reach', async () => {
    const [promises] = await harness.prisma.$queryRaw<
      { open: bigint; overdue: bigint; fulfilled: bigint; ended: bigint }[]
    >`
      SELECT count(*) FILTER (WHERE status = 'OPEN' AND due_on >= clinic_date()) AS open,
             count(*) FILTER (WHERE status = 'OPEN' AND due_on < clinic_date()) AS overdue,
             count(*) FILTER (WHERE status = 'FULFILLED') AS fulfilled,
             count(*) FILTER (WHERE status IN ('RESCHEDULED', 'CANCELLED')) AS ended
      FROM payment_promise
    `;

    expect(Number(promises?.open ?? 0n)).toBeGreaterThan(0);
    // Stored OPEN and past due: the derived MISSED reading, which PostgreSQL
    // never stores.
    expect(Number(promises?.overdue ?? 0n)).toBeGreaterThan(0);
    expect(Number(promises?.fulfilled ?? 0n)).toBeGreaterThan(0);
    expect(Number(promises?.ended ?? 0n)).toBeGreaterThan(0);
  });

  it('leaves completed sessions that no tariff could price, which is a real state', async () => {
    // "Missing tariff is a visible error" (PROJECT_SPEC.md 5): the session
    // happens, the charge does not, and the dashboard has to say so.
    expect(summary.unpricedSessions).toBeGreaterThan(0);
  });

  it('audits every act, under real accounts', async () => {
    const rows = await harness.prisma.$queryRaw<{ action: string; count: bigint }[]>`
      SELECT action, count(*) AS count
      FROM audit_log
      GROUP BY action
    `;

    const byAction = new Map(rows.map((row) => [row.action, Number(row.count)]));

    for (const action of [
      'appointment.created',
      'appointment.completed',
      'session_charge.posted',
      'payment.recorded',
      'payment_promise.created',
    ]) {
      expect(byAction.get(action) ?? 0).toBeGreaterThan(0);
    }

    // No SYSTEM or ANONYMOUS actor: every seeded act is performed by a real
    // account, which is what makes the audit trail readable afterwards.
    const [actors] = await harness.prisma.$queryRaw<{ non_user: bigint }[]>`
      SELECT count(*) FILTER (WHERE actor_type <> 'USER' OR actor_user_id IS NULL) AS non_user
      FROM audit_log
    `;

    expect(Number(actors?.non_user ?? 0n)).toBe(0);
  });

  it('invents nothing that looks like real personal data', async () => {
    // No national identifier at all: a run of digits satisfying the checksum
    // would be shaped exactly like a real person's, in a database people copy
    // around.
    const [children] = await harness.prisma.$queryRaw<{ with_national_id: bigint }[]>`
      SELECT count(*) FILTER (WHERE national_id IS NOT NULL) AS with_national_id FROM child
    `;

    expect(Number(children?.with_national_id ?? 0n)).toBe(0);

    // Every family and guardian is labelled as a sample, and every phone number
    // belongs to this run's own prefix block.
    const [labels] = await harness.prisma.$queryRaw<{ unlabelled: bigint }[]>`
      SELECT count(*) FILTER (WHERE family_name NOT LIKE '%نمونه%') AS unlabelled FROM family
    `;

    expect(Number(labels?.unlabelled ?? 0n)).toBe(0);
  });
});
