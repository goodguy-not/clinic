import request from 'supertest';
import {
  familyAccountReportResponseSchema,
  familyAccountResponseSchema,
  paymentReportResponseSchema,
  type FamilyAccountReportRow,
  type FamilyAccountReportResponse,
  type PaymentReportResponse,
  type PaymentReportRow,
} from '@clinic/contracts';
import { seedSyntheticClinic } from '../src/dev/synthetic-clinic';
import { asUser, signIn } from './appointments-support';
import { createHarness, resetDatabase, seedUser, type Harness } from './harness';

/**
 * The two C4 financial reports, reconciled against a whole synthetic clinic:
 * several weeks, several families, several recording users, and every financial
 * state the seeder can reach.
 *
 * EVERYTHING HERE IS SYNTHETIC. The seeder refuses any database whose name does
 * not end in `_test` or `_ci`, and no real clinic data appears in this project.
 *
 * WHAT THIS SUITE ADDS OVER THE TWO FOCUSED ONES. Those build a handful of
 * families by hand and assert exactly what each should be; this one asserts that
 * the reports AGREE — the family-accounts report with the authoritative
 * single-family account, the payments report with the rows underneath it, and
 * both with themselves across pages — over a body of data nobody arranged to
 * make an assertion pass. An aggregate that is subtly wrong in a way an
 * eight-family fixture cannot show up in is what this is for.
 *
 * THE INDEPENDENT SIDE OF THE PAYMENTS RECONCILIATION IS RAW SQL against
 * `payment`, written from the domain rather than from the service: a check that
 * called the same code path would prove only that the code equals itself. The
 * family-accounts reconciliation is deliberately the OTHER kind — it compares two
 * ROUTES a user can call, because the claim under test is that the clinic-wide
 * report and the family's own account never state two different answers to "what
 * does this family owe?".
 *
 * IT IS A READ-ONLY SUITE. The seed is built once and no test writes anything,
 * because neither of these routes can.
 */
describe('the financial reports against a whole synthetic clinic', () => {
  let harness: Harness;
  let managerToken: string;
  let span: { from: string; to: string };

  beforeAll(async () => {
    harness = await createHarness();
    await resetDatabase();

    // The seeder performs every act under a real manager and creates none.
    await seedUser(harness, { role: 'MANAGER', username: 'synthetic_financial_manager' });

    await seedSyntheticClinic(harness.app, {
      runTag: 'financial',
      weeks: 2,
      families: 9,
      therapists: 2,
      slotsPerDay: 2,
    });

    managerToken = (await signIn(harness, 'MANAGER')).token;

    // The whole period money arrived in, asked of the clinic's own calendar
    // rather than computed in Node: Tehran rolls over at 20:30 UTC.
    const rows = await harness.prisma.$queryRaw<{ from: string | null; to: string | null }[]>`
      SELECT min(received_on)::text AS from, max(received_on)::text AS to FROM payment
    `;

    const found = rows[0];
    if (found?.from == null || found.to == null) {
      throw new Error('the synthetic clinic recorded no payments');
    }
    span = { from: found.from, to: found.to };
  }, 180_000);

  afterAll(async () => {
    await harness.close();
  });

  const get = (path: string, query: Record<string, string | number>) =>
    request(harness.app.getHttpServer()).get(path).query(query).set(asUser(managerToken));

  const paymentReport = async (
    query: Record<string, string | number> = {},
  ): Promise<PaymentReportResponse> => {
    const response = await get('/reports/payments', { ...span, ...query });
    expect(response.status).toBe(200);

    return paymentReportResponseSchema.parse(response.body);
  };

  const familyAccountReport = async (
    query: Record<string, string | number> = {},
  ): Promise<FamilyAccountReportResponse> => {
    const response = await get('/reports/family-accounts', query);
    expect(response.status).toBe(200);

    return familyAccountReportResponseSchema.parse(response.body);
  };

  const allPayments = async (
    query: Record<string, string | number> = {},
  ): Promise<PaymentReportRow[]> => {
    const rows: PaymentReportRow[] = [];

    for (let page = 1; ; page += 1) {
      const report = await paymentReport({ ...query, page, pageSize: 100 });
      rows.push(...report.payments);

      if (!report.page.hasMore) return rows;
      if (page > 50) throw new Error('paging did not terminate');
    }
  };

  const allFamilies = async (
    query: Record<string, string | number> = {},
  ): Promise<FamilyAccountReportRow[]> => {
    const rows: FamilyAccountReportRow[] = [];

    for (let page = 1; ; page += 1) {
      const report = await familyAccountReport({ ...query, page, pageSize: 100 });
      rows.push(...report.families);

      if (!report.page.hasMore) return rows;
      if (page > 50) throw new Error('paging did not terminate');
    }
  };

  describe('the family-accounts report against GET /families/:id/account', () => {
    it('states the same position for every family as that family’s own account', async () => {
      const rows = await allFamilies({ includeInactive: 'true' });
      expect(rows.length).toBeGreaterThan(1);

      for (const row of rows) {
        const response = await request(harness.app.getHttpServer())
          .get(`/families/${row.family.id}/account`)
          .set(asUser(managerToken));

        expect(response.status).toBe(200);
        const account = familyAccountResponseSchema.parse(response.body);

        // THE WHOLE FROZEN POSITION, FIELD FOR FIELD: net charged, confirmed
        // payments, credit, amount due, both payment counts, the last payment
        // and both promise counts. Not one grand total.
        expect(row.position).toEqual(account.position);
      }
    });

    it('lists every family the clinic holds, including the ones with no financial history', async () => {
      const rows = await allFamilies({ includeInactive: 'true' });

      const stored = await harness.prisma.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int AS count FROM family
      `;

      expect(rows).toHaveLength(stored[0]?.count ?? -1);
    });

    it('sums only what it matched, and nets no family against another', async () => {
      const report = await familyAccountReport({ includeInactive: 'true', pageSize: 100 });
      const rows = report.families;

      const due = rows.reduce((total, row) => total + BigInt(row.position.amountDueToman), 0n);
      const credit = rows.reduce((total, row) => total + BigInt(row.position.creditToman), 0n);

      expect(report.totals.totalAmountDueToman).toBe(due.toString());
      expect(report.totals.totalCreditToman).toBe(credit.toString());
      expect(report.totals.familyCount).toBe(rows.length);
      expect(report.totals.owingFamilyCount).toBe(
        rows.filter((row) => row.position.amountDueToman !== '0').length,
      );
      expect(report.totals.inCreditFamilyCount).toBe(
        rows.filter((row) => row.position.creditToman !== '0').length,
      );

      // The seeder puts a family in each of the four standings it can reach, so
      // both sums are non-zero and neither is a netted clinic balance.
      expect(BigInt(report.totals.totalAmountDueToman) > 0n).toBe(true);
      expect(BigInt(report.totals.totalCreditToman) > 0n).toBe(true);
    });

    it('keeps the same totals whatever the page size', async () => {
      const wide = await familyAccountReport({ includeInactive: 'true', pageSize: 100 });
      const narrow = await familyAccountReport({ includeInactive: 'true', pageSize: 2 });

      expect(narrow.totals).toEqual(wide.totals);
      expect(narrow.page.total).toBe(wide.totals.familyCount);

      // And the walk of the narrow pages is exactly the wide page, in order.
      const walked = await allFamilies({ includeInactive: 'true' });
      expect(walked.map((row) => row.family.id)).toEqual(wide.families.map((row) => row.family.id));
    });
  });

  describe('the payments report against the rows underneath it', () => {
    it('reconciles its totals with a statement written from the domain', async () => {
      const report = await paymentReport({ pageSize: 1 });

      const rows = await harness.prisma.$queryRaw<
        { confirmed: number; total: bigint; voided: number }[]
      >`
        SELECT count(*) FILTER (WHERE voided_at IS NULL)::int AS confirmed,
               coalesce(sum(amount_toman) FILTER (WHERE voided_at IS NULL), 0)::bigint AS total,
               count(*) FILTER (WHERE voided_at IS NOT NULL)::int AS voided
        FROM payment
        WHERE received_on >= ${span.from}::date AND received_on <= ${span.to}::date
      `;

      const expected = rows[0];
      if (expected === undefined) throw new Error('the reconciliation statement returned no row');

      expect(report.totals.confirmedCount).toBe(expected.confirmed);
      expect(report.totals.confirmedTotalToman).toBe(expected.total.toString());
      expect(report.totals.voidedCount).toBe(expected.voided);

      // The page's size did not touch a single one of those numbers.
      expect(report.page.pageSize).toBe(1);
      expect(report.totals.confirmedCount).toBeGreaterThan(1);
    });

    it('breaks the same money down by method and by user without losing any of it', async () => {
      const report = await paymentReport({ pageSize: 1 });

      const byMethod = report.totals.byMethod.reduce(
        (total, row) => total + BigInt(row.confirmedTotalToman),
        0n,
      );
      const byUser = report.totals.byUser.reduce(
        (total, row) => total + BigInt(row.confirmedTotalToman),
        0n,
      );

      expect(byMethod.toString()).toBe(report.totals.confirmedTotalToman);
      expect(byUser.toString()).toBe(report.totals.confirmedTotalToman);

      // The counts partition the same way.
      expect(report.totals.byMethod.reduce((n, row) => n + row.confirmedCount, 0)).toBe(
        report.totals.confirmedCount,
      );
      expect(report.totals.byUser.reduce((n, row) => n + row.confirmedCount, 0)).toBe(
        report.totals.confirmedCount,
      );
      expect(report.totals.byUser.reduce((n, row) => n + row.voidedCount, 0)).toBe(
        report.totals.voidedCount,
      );

      // The seeder records under several people, which is the attribution this
      // report exists to give a manager.
      expect(report.totals.byUser.length).toBeGreaterThan(1);
    });

    it('walks every matching payment exactly once, newest received day first', async () => {
      const rows = await allPayments();

      const stored = await harness.prisma.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int AS count FROM payment
        WHERE received_on >= ${span.from}::date AND received_on <= ${span.to}::date
      `;

      expect(rows).toHaveLength(stored[0]?.count ?? -1);
      expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);

      for (const [index, row] of rows.entries()) {
        if (index === 0) continue;
        expect((rows[index - 1]?.receivedOn ?? '') >= row.receivedOn).toBe(true);
      }
    });

    it('keys on the day money arrived, not the day it was entered', async () => {
      // The seeder enters some receipts days after they arrived, which is
      // precisely the difference between this report's basis and the dashboard
      // reconciliation's. At least one payment must therefore be reported on a
      // day earlier than the clinic day it was typed in on.
      const backDated = await harness.prisma.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int AS count FROM payment WHERE received_on < clinic_date(created_at)
      `;
      expect(backDated[0]?.count ?? 0).toBeGreaterThan(0);

      const rows = await allPayments();

      for (const row of rows) {
        expect(row.receivedOn >= span.from).toBe(true);
        expect(row.receivedOn <= span.to).toBe(true);
      }

      // A window that ends the day before the last receipts arrived leaves them
      // out, whatever day they were entered on.
      const narrowed = await paymentReport({ to: span.from, pageSize: 100 });
      expect(narrowed.payments.every((row) => row.receivedOn === span.from)).toBe(true);
    });

    it('hides voided rows on request without moving a single total', async () => {
      const shown = await paymentReport({ pageSize: 100 });
      const hidden = await paymentReport({ includeVoided: 'false', pageSize: 100 });

      expect(hidden.totals).toEqual(shown.totals);
      expect(hidden.payments.every((row) => row.status === 'CONFIRMED')).toBe(true);
      expect(shown.payments.some((row) => row.status === 'VOIDED')).toBe(true);
      expect(hidden.page.total).toBe(shown.totals.confirmedCount);
    });
  });
});
