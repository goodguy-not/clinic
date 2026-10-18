import request from 'supertest';
import {
  promiseReportResponseSchema,
  sessionReportResponseSchema,
  therapistActivityResponseSchema,
  type PromiseReportResponse,
  type SessionReportResponse,
  type SessionReportRow,
  type TherapistActivityResponse,
} from '@clinic/contracts';
import { seedSyntheticClinic } from '../src/dev/synthetic-clinic';
import { asUser, signIn } from './appointments-support';
import { createHarness, resetDatabase, seedUser, type Harness } from './harness';

/**
 * The three C3 operational reports, reconciled against a whole synthetic clinic:
 * several weeks, several families, several therapists, and every lifecycle state
 * the seeder can reach.
 *
 * EVERYTHING HERE IS SYNTHETIC. The seeder refuses any database whose name does
 * not end in `_test` or `_ci`, and no real clinic data appears in this project.
 *
 * WHAT THIS SUITE ADDS OVER THE THREE FOCUSED ONES. Those build two or three
 * rows by hand and assert exactly what each should be; this one asserts that the
 * reports AGREE — with the rows underneath them, with each other, and with
 * themselves across pages — over a body of data nobody arranged to make an
 * assertion pass. An aggregate that is subtly wrong in a way a three-row fixture
 * cannot show up in is what this is for.
 *
 * THE INDEPENDENT SIDE OF EVERY RECONCILIATION IS RAW SQL against the underlying
 * tables, written from the domain rather than from the service: a check that
 * called the same code path would prove only that the code equals itself.
 *
 * IT IS A READ-ONLY SUITE. The seed is built once in `beforeAll` and no test
 * writes anything, because none of these routes can.
 */
describe('the operational reports against a whole synthetic clinic', () => {
  let harness: Harness;
  let managerToken: string;
  let span: { from: string; to: string };

  beforeAll(async () => {
    harness = await createHarness();
    await resetDatabase();

    // The seeder performs every act under a real manager and creates none.
    await seedUser(harness, { role: 'MANAGER', username: 'synthetic_report_manager' });

    await seedSyntheticClinic(harness.app, {
      runTag: 'reports',
      weeks: 2,
      families: 5,
      therapists: 2,
      slotsPerDay: 2,
    });

    managerToken = (await signIn(harness, 'MANAGER')).token;

    // The whole diary, asked of the clinic's own calendar rather than computed
    // in Node: Tehran rolls over at 20:30 UTC.
    const rows = await harness.prisma.$queryRaw<{ from: string; to: string }[]>`
      SELECT min(clinic_date(starts_at))::text AS from,
             max(clinic_date(starts_at))::text AS to
      FROM appointment
    `;

    const found = rows[0];
    if (found === undefined) throw new Error('the synthetic clinic booked nothing');
    span = found;
  }, 180_000);

  afterAll(async () => {
    await harness.close();
  });

  const get = (path: string, query: Record<string, string | number>) =>
    request(harness.app.getHttpServer()).get(path).query(query).set(asUser(managerToken));

  const sessionReport = async (
    query: Record<string, string | number>,
  ): Promise<SessionReportResponse> => {
    const response = await get('/reports/sessions', { ...span, ...query });
    expect(response.status).toBe(200);

    return sessionReportResponseSchema.parse(response.body);
  };

  const promiseReport = async (
    query: Record<string, string | number>,
  ): Promise<PromiseReportResponse> => {
    const response = await get('/reports/promises', query);
    expect(response.status).toBe(200);

    return promiseReportResponseSchema.parse(response.body);
  };

  const therapistActivity = async (
    query: Record<string, string> = {},
  ): Promise<TherapistActivityResponse> => {
    const response = await get('/reports/therapist-activity', { ...span, ...query });
    expect(response.status).toBe(200);

    return therapistActivityResponseSchema.parse(response.body);
  };

  /** Every row of a report, walked page by page at the contract's own maximum. */
  const allSessions = async (
    query: Record<string, string | number> = {},
  ): Promise<SessionReportRow[]> => {
    const rows: SessionReportRow[] = [];

    for (let page = 1; ; page += 1) {
      const report = await sessionReport({ ...query, page, pageSize: 100 });
      rows.push(...report.sessions);

      if (!report.page.hasMore) return rows;
      if (page > 50) throw new Error('paging did not terminate');
    }
  };

  describe('the session report, against the seats underneath it', () => {
    it('counts exactly the seats the diary holds, over several weeks and families', async () => {
      const report = await sessionReport({});

      const counted = await harness.prisma.$queryRaw<{ seats: number }[]>`
        SELECT count(*)::int AS seats
        FROM appointment_participant ap
        JOIN appointment a ON a.id = ap.appointment_id
        WHERE a.starts_at >= clinic_day_start(${span.from}::date)
          AND a.starts_at < clinic_day_start((${span.to}::date + 1))
      `;

      expect(report.summary.total).toBe(counted[0]?.seats);
      expect(report.summary.total).toBeGreaterThan(10);

      // The four booking statuses partition the seats, and the three attendance
      // outcomes partition them again — two independent readings of one set.
      const { total, scheduled, completed, cancelled } = report.summary;
      expect(scheduled + completed + cancelled).toBe(total);

      const attendance = await harness.prisma.$queryRaw<{ pending: number }[]>`
        SELECT count(*) FILTER (WHERE ap.attendance = 'PENDING')::int AS pending
        FROM appointment_participant ap
        JOIN appointment a ON a.id = ap.appointment_id
        WHERE a.starts_at >= clinic_day_start(${span.from}::date)
          AND a.starts_at < clinic_day_start((${span.to}::date + 1))
      `;
      expect(report.summary.attended + report.summary.noShows + (attendance[0]?.pending ?? 0)).toBe(
        total,
      );

      // The unresolved backlog is a subset of the pending seats and excludes the
      // cancelled and the not-yet-finished ones.
      expect(report.summary.unresolvedOutcomes).toBeLessThanOrEqual(attendance[0]?.pending ?? 0);
      expect(report.summary.unresolvedOutcomes).toBeGreaterThan(0);
    });

    it('pages the whole span without losing, repeating or renumbering anything', async () => {
      const first = await sessionReport({ page: 1, pageSize: 100 });
      const rows = await allSessions();

      expect(rows).toHaveLength(first.summary.total);

      // The order is total, so every seat is returned exactly once.
      expect(new Set(rows.map((row) => row.participantId)).size).toBe(rows.length);

      // Rows arrive oldest first across page boundaries, not merely within a page.
      const instants = rows.map((row) => Date.parse(row.startsAt));
      expect([...instants].sort((a, b) => a - b)).toEqual(instants);

      // The summary is a property of the filter and not of the page.
      const last = await sessionReport({
        page: Math.ceil(first.summary.total / 100),
        pageSize: 100,
      });
      expect(last.summary).toEqual(first.summary);
    });

    it('agrees with itself when the same question is asked one family at a time', async () => {
      const whole = await sessionReport({});

      const families = await harness.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM family ORDER BY id
      `;

      let seats = 0;
      let attended = 0;
      for (const family of families) {
        const scoped = await sessionReport({ familyId: family.id, pageSize: 100 });
        seats += scoped.summary.total;
        attended += scoped.summary.attended;
      }

      // Every seat belongs to exactly one family, so the parts are the whole.
      expect(seats).toBe(whole.summary.total);
      expect(attended).toBe(whole.summary.attended);
    });
  });

  describe('therapist activity, against the same seats read the other way', () => {
    it('sums to the session report over the identical period', async () => {
      const sessions = await sessionReport({});
      const activity = await therapistActivity();

      // Every seat in the diary belongs to exactly one therapist, so the
      // clinic-wide activity totals are the session report's counts regrouped.
      const { scheduledCount, completedCount, cancelledCount } = activity.totals;
      expect(scheduledCount + completedCount + cancelledCount).toBe(sessions.summary.total);
      expect(activity.totals.attendedCount).toBe(sessions.summary.attended);
      expect(activity.totals.noShowCount).toBe(sessions.summary.noShows);
      expect(activity.totals.unresolvedOutcomeCount).toBe(sessions.summary.unresolvedOutcomes);
      expect(activity.totals.therapistCount).toBe(activity.therapists.length);
      expect(activity.totals.therapistCount).toBeGreaterThan(1);
    });

    it('states each therapist’s row as the session report filtered to them', async () => {
      const activity = await therapistActivity();

      for (const row of activity.therapists) {
        const theirs = await sessionReport({ therapistId: row.therapist.id, pageSize: 100 });

        expect(row.scheduledCount).toBe(theirs.summary.scheduled);
        expect(row.completedCount).toBe(theirs.summary.completed);
        expect(row.cancelledCount).toBe(theirs.summary.cancelled);
        expect(row.attendedCount).toBe(theirs.summary.attended);
        expect(row.noShowCount).toBe(theirs.summary.noShows);
        expect(row.unresolvedOutcomeCount).toBe(theirs.summary.unresolvedOutcomes);

        // The one figure the two reports deliberately state differently: the
        // session report's duration is every matched seat, this one's is the
        // attended seats alone, so it can only ever be the smaller.
        expect(row.attendedDurationMinutes).toBeLessThanOrEqual(
          theirs.summary.totalDurationMinutes,
        );
      }

      // And `totals` is the exact column sum of the rows, not a second query.
      const sum = (pick: (row: (typeof activity.therapists)[number]) => number): number =>
        activity.therapists.reduce((running, row) => running + pick(row), 0);

      expect(activity.totals.attendedCount).toBe(sum((row) => row.attendedCount));
      expect(activity.totals.attendedDurationMinutes).toBe(
        sum((row) => row.attendedDurationMinutes),
      );
    });
  });

  describe('the promise report, against the promises underneath it', () => {
    it('partitions every promise the clinic holds and derives MISSED from the clinic day', async () => {
      const range = await harness.prisma.$queryRaw<{ from: string; to: string }[]>`
        SELECT min(due_on)::text AS from, max(due_on)::text AS to FROM payment_promise
      `;
      const window = range[0];
      if (window === undefined) throw new Error('the synthetic clinic promised nothing');

      const report = await promiseReport({ ...window, pageSize: 100 });

      const counted = await harness.prisma.$queryRaw<{ total: number; missed: number }[]>`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE status = 'OPEN' AND due_on < clinic_date())::int AS missed
        FROM payment_promise
        WHERE due_on >= ${window.from}::date AND due_on <= ${window.to}::date
      `;

      expect(report.summary.total).toBe(counted[0]?.total);
      expect(report.summary.total).toBeGreaterThan(1);

      // `MISSED` is stored nowhere: the wire's fifth word is the clinic day
      // compared against a stored `OPEN` row, and it matches the independent
      // reading of exactly that predicate.
      expect(report.summary.missed).toBe(counted[0]?.missed);

      const { total, ...parts } = report.summary;
      expect(Object.values(parts).reduce((a, b) => a + b, 0)).toBe(total);

      // THE ROWS AGREE WITH THE COUNTS THEY WERE SUMMARISED INTO. The whole
      // result fits on one page here, so the two are directly comparable: every
      // count is exactly the number of rows carrying that word, which is the
      // property a summary computed by a separate statement could break.
      const rows = report.promises;
      expect(rows).toHaveLength(report.summary.total);

      const wordCount = (word: string): number => rows.filter((row) => row.status === word).length;

      expect(wordCount('MISSED')).toBe(report.summary.missed);
      expect(wordCount('OPEN')).toBe(report.summary.open);
      expect(wordCount('FULFILLED')).toBe(report.summary.fulfilled);
      expect(wordCount('RESCHEDULED')).toBe(report.summary.rescheduled);
      expect(wordCount('CANCELLED')).toBe(report.summary.cancelled);

      // Soonest due date first, across the whole page.
      expect([...rows.map((row) => row.dueOn)].sort()).toEqual(rows.map((row) => row.dueOn));
    });

    it('agrees with itself when the same period is asked one status at a time', async () => {
      const range = await harness.prisma.$queryRaw<{ from: string; to: string }[]>`
        SELECT min(due_on)::text AS from, max(due_on)::text AS to FROM payment_promise
      `;
      const window = range[0];
      if (window === undefined) throw new Error('the synthetic clinic promised nothing');

      const whole = await promiseReport({ ...window, pageSize: 100 });

      let counted = 0;
      for (const status of ['OPEN', 'MISSED', 'FULFILLED', 'RESCHEDULED', 'CANCELLED']) {
        const scoped = await promiseReport({ ...window, status, pageSize: 100 });

        // A filtered read's summary is scoped to the filter: the asked-for word
        // carries the whole total and the other four are zero.
        const { total, ...parts } = scoped.summary;
        const key = status.toLowerCase() as keyof typeof parts;
        expect(parts[key]).toBe(total);
        expect(Object.values(parts).reduce((a, b) => a + b, 0)).toBe(total);

        counted += total;
      }

      // The five partition the period exactly: no overlap and no gap.
      expect(counted).toBe(whole.summary.total);
    });
  });
});
