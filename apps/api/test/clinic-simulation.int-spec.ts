import { simulateClinic, jalali, type SimulationBook } from '../src/dev/clinic-simulation';
import { reconcileClinic, type ReconciliationReport } from '../src/dev/clinic-reconciliation';
import { addDays, managerActor } from '../src/dev/synthetic-clinic';
import { createHarness, ownerPrisma, resetDatabase, seedUser, type Harness } from './harness';

/**
 * TWO MONTHS OF A SYNTHETIC CLINIC, RECONCILED TO THE TOMAN (Milestone 10,
 * checkpoint A5).
 *
 * EVERYTHING HERE IS SYNTHETIC: `src/dev/clinic-simulation.ts` invents every
 * person, number and enquiry, and states how.
 *
 * WHAT THIS PROVES THAT THE ISOLATED SUITES DO NOT. Each domain suite proves one
 * act right in a clean database. This runs several hundred acts in the order a
 * clinic produces them — registrations and duplicates, weekly series and a
 * conflict, cancellations, outcomes corrected, charges retried and posted
 * concurrently, concessions split three ways, payments partial, exact, over and
 * voided, promises kept, moved, cancelled and missed, a share rule corrected and
 * another changed, a month closed and then corrected — and then reconciles every
 * family balance, every clinic day and month, every settlement line and every
 * audit entry against an independent model. A defect that only appears when
 * acts interleave appears here.
 *
 * ZERO DISCREPANCIES IS THE ASSERTION. Each one is printed, so a failure says
 * which family, day, line or entity disagreed and by how much.
 */
describe('a synthetic clinic, simulated and reconciled', () => {
  let harness: Harness;
  let book: SimulationBook;
  let report: ReconciliationReport;

  beforeAll(async () => {
    harness = await createHarness();
    await resetDatabase();
    // The one precondition: an active manager, as `bootstrap-manager` creates.
    await seedUser(harness, {
      role: 'MANAGER',
      username: 'practice_manager',
      displayName: 'مدیر نمونه',
    });

    ({ book } = await simulateClinic(harness.app));
    report = await reconcileClinic(harness.app, book, await managerActor(harness.prisma));
  }, 1_200_000);

  afterAll(async () => {
    await harness.close();
  });

  it('reconciles with zero discrepancies', () => {
    const failures = report.checks.flatMap((one) =>
      one.discrepancies.slice(0, 20).map((line) => `${one.name}: ${line}`),
    );
    expect(failures).toEqual([]);
    expect(report.discrepancyCount).toBe(0);
    // And every check compared something: a reconciliation over nothing passes.
    for (const one of report.checks) expect(one.compared).toBeGreaterThan(0);
  });

  it('covers about two months, one whole Jalali month closed, and a month end crossed', () => {
    const { calendar } = book;
    const days =
      (Date.parse(calendar.lastHistoryDay) - Date.parse(calendar.windowStart)) / 86_400_000 + 1;
    expect(days).toBeGreaterThanOrEqual(50);
    expect(calendar.months.length).toBeGreaterThanOrEqual(2);
    expect(jalali(calendar.closedMonth.from).day).toBe(1);
    expect(jalali(addDays(calendar.closedMonth.to, 1)).day).toBe(1);
    expect(book.periods).toHaveLength(book.therapists.length);
  });

  it('exercises every scenario the checkpoint names', () => {
    const missing: string[] = [];
    for (const scenario of [
      'family duplicate discarded',
      'family duplicate acknowledged',
      'child duplicate discarded',
      'family registered with a notice',
      'weekly series booked',
      'recurring conflict previewed and avoided',
      'series cancelled from a date',
      'cancelled by family',
      'cancelled by clinic',
      'no-show',
      'attendance corrected',
      'completed with outcome pending',
      'charge posted after late attendance',
      'concurrent charge post',
      'charge post retried',
      'unpriced session charged after pricing',
      'completion reopened and corrected',
      'tariff price rise',
      'concession clinic-borne',
      'concession split',
      'concession therapist-borne',
      'full waiver',
      'concession withdrawn',
      'charge voided',
      'payment exact',
      'payment partial',
      'payment over',
      'prepayment',
      'payment voided',
      'promise fulfilled',
      'promise rescheduled',
      'promise cancelled',
      'promise left overdue',
      'rating corrected',
      'session rated explicitly',
      'share rule changed over time',
      'close repeated idempotently',
      'charge voided after close',
      'concession after close',
      'rated after close',
      'website request converted to a new family',
      'website request linked to an existing family',
      'repeated enquiry absorbed',
    ].filter((one) => (book.scenario[one] ?? 0) === 0)) {
      missing.push(scenario);
    }
    expect(missing).toEqual([]);
  });

  it('runs the front desk as the receptionist and corrections as the manager', () => {
    // Every act was checked against the route × role matrix as it happened;
    // this states the division of labour that produced.
    const desk = book.acts.RECEPTIONIST;
    const office = book.acts.MANAGER;
    const missing: string[] = [];
    for (const route of [
      'POST /families',
      'POST /appointment-series',
      'PUT /appointments/:id/participants/:participantId/attendance',
      'POST /appointments/:id/complete',
      'POST /families/:id/payments',
      'POST /families/:id/promises',
      'POST /website-requests/:id/link',
    ]) {
      if ((desk[route] ?? 0) === 0) missing.push(route);
    }
    expect(missing).toEqual([]);
    for (const route of [
      'POST /session-charges/:id/void',
      'POST /session-charges/:chargeId/adjustments',
      'POST /payments/:id/void',
      'POST /appointments/:id/reopen',
      'POST /settlement/periods',
    ]) {
      expect(desk[route]).toBeUndefined();
      expect(office[route] ?? 0).toBeGreaterThan(0);
    }
    expect(book.acts.VISITOR['POST /public/requests'] ?? 0).toBeGreaterThan(0);
  });

  it('keeps the closed period immutable even to the database owner', async () => {
    const owner = ownerPrisma();
    for (const statement of [
      'UPDATE settlement_line SET therapist_net_toman = therapist_net_toman + 1',
      'DELETE FROM settlement_line',
      'UPDATE settlement_period SET settled_toman = settled_toman + 1',
      'DELETE FROM settlement_period',
      'DELETE FROM session_charge',
      'DELETE FROM payment',
    ]) {
      await expect(owner.$executeRawUnsafe(statement)).rejects.toThrow();
    }
  });

  it('is obviously synthetic', async () => {
    const families = await harness.prisma.$queryRaw<{ name: string }[]>`
      SELECT family_name AS name FROM family
    `;
    for (const family of families) expect(family.name).toContain('نمونه');

    const mobiles = await harness.prisma.$queryRaw<{ mobile: string | null }[]>`
      SELECT mobile FROM guardian UNION ALL SELECT contact_mobile FROM website_request
    `;
    for (const { mobile } of mobiles) if (mobile !== null) expect(mobile).toMatch(/^0900000\d{4}$/);

    const identified = await harness.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM child WHERE national_id IS NOT NULL
    `;
    expect(identified[0]?.count).toBe(0n);
  });
});
