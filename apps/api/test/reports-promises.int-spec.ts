import request from 'supertest';
import { promiseReportResponseSchema, type PromiseReportResponse } from '@clinic/contracts';
import { asUser, makeFamilyWithChild, signIn } from './appointments-support';
import {
  cancelPromiseOverHttp,
  clinicDay,
  createPromiseOverHttp,
  fulfilPromiseOverHttp,
  recordPaymentOverHttp,
  reschedulePromiseOverHttp,
} from './payment-support';
import { createHarness, internalHeaders, resetDatabase, type Harness } from './harness';

/**
 * The cross-family promise report: `GET /reports/promises` (Milestone 7,
 * checkpoint C3).
 *
 * EVERYTHING HERE IS SYNTHETIC. No real family, guardian, amount, note or
 * payment reference appears in any fixture in this project.
 *
 * WHAT THIS SUITE IS FOR. Three claims the frozen contract makes, all of which
 * are about what NestJS decides rather than about what a screen renders:
 *
 *   * `MISSED` is DERIVED from the clinic's own calendar day and stored nowhere,
 *     so a promise whose due date is yesterday reads `MISSED` with no job having
 *     run and no column having been written;
 *   * the five statuses PARTITION the result, so the summary's five counts add
 *     up to its total whatever the filter;
 *   * a promise moves no money in any state, so there is NO promised total
 *     anywhere in the response — which the strict frozen schema turns into a
 *     parse failure rather than something a reviewer has to notice.
 *
 * EVERY DAY COMES FROM `clinic_date()`, never from the runner's clock: Tehran
 * rolls over at 20:30 UTC, and a test that built its own "yesterday" would pass
 * for twenty and a half hours a day and fail for the other three and a half.
 */
describe('the promise report (real PostgreSQL)', () => {
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

  const promises = (token: string, query: Record<string, string | number>) =>
    request(harness.app.getHttpServer()).get('/reports/promises').query(query).set(asUser(token));

  const okPromises = async (
    token: string,
    query: Record<string, string | number>,
  ): Promise<PromiseReportResponse> => {
    const response = await promises(token, query);
    expect(response.status).toBe(200);

    return promiseReportResponseSchema.parse(response.body);
  };

  /** A promise recorded the way a receptionist records one: over HTTP. */
  const promise = async (
    token: string,
    familyId: string,
    body: { amountToman?: string; dueOn: string },
  ): Promise<string> => {
    const response = await createPromiseOverHttp(harness, token, familyId, {
      amountToman: body.amountToman ?? '250000',
      dueOn: body.dueOn,
    });

    expect(response.status).toBe(200);
    return response.body.promise.id as string;
  };

  describe('the derived word, which PostgreSQL alone decides', () => {
    it('reads a promise due before today as MISSED without storing anything', async () => {
      const receptionist = await signIn(harness, 'RECEPTIONIST');
      const manager = await signIn(harness, 'MANAGER');
      const { familyId } = await makeFamilyWithChild(harness, manager.token);

      const yesterday = await clinicDay(harness, -1);
      const today = await clinicDay(harness, 0);
      const tomorrow = await clinicDay(harness, 1);

      const overdue = await promise(receptionist.token, familyId, { dueOn: yesterday });
      const dueToday = await promise(receptionist.token, familyId, { dueOn: today });
      const ahead = await promise(receptionist.token, familyId, { dueOn: tomorrow });

      const report = await okPromises(receptionist.token, { from: yesterday, to: tomorrow });

      const wordFor = (id: string): string | undefined =>
        report.promises.find((row) => row.id === id)?.status;

      expect(wordFor(overdue)).toBe('MISSED');
      // Due TODAY is still on time: the comparison is strictly earlier than the
      // clinic's day, not "not in the future".
      expect(wordFor(dueToday)).toBe('OPEN');
      expect(wordFor(ahead)).toBe('OPEN');

      // PostgreSQL stores four states and the wire carries five. Nothing was
      // written to produce the fifth.
      const stored = await harness.prisma.$queryRaw<{ status: string }[]>`
        SELECT status::text AS status FROM payment_promise WHERE id = ${overdue}::uuid
      `;
      expect(stored[0]?.status).toBe('OPEN');

      expect(report.summary).toEqual({
        total: 3,
        open: 2,
        missed: 1,
        fulfilled: 0,
        rescheduled: 0,
        cancelled: 0,
      });
      expect(report.range.dateBasis).toBe('PROMISE_DUE_ON');
    });

    it('partitions every lifecycle state across the five counts', async () => {
      const receptionist = await signIn(harness, 'RECEPTIONIST');
      const manager = await signIn(harness, 'MANAGER');
      const { familyId } = await makeFamilyWithChild(harness, manager.token);

      const yesterday = await clinicDay(harness, -1);
      const today = await clinicDay(harness, 0);
      const tomorrow = await clinicDay(harness, 1);
      const later = await clinicDay(harness, 7);

      await promise(receptionist.token, familyId, { dueOn: yesterday });
      await promise(receptionist.token, familyId, { dueOn: tomorrow });

      // Fulfilled, by a real payment through the Milestone 6 route.
      const toFulfil = await promise(receptionist.token, familyId, { dueOn: today });
      const payment = await recordPaymentOverHttp(harness, receptionist.token, familyId, {
        amountToman: '250000',
        method: 'CASH',
        receivedOn: today,
      });
      expect(payment.status).toBe(200);
      expect(
        (
          await fulfilPromiseOverHttp(harness, receptionist.token, toFulfil, {
            paymentId: payment.body.payment.id,
          })
        ).status,
      ).toBe(200);

      // Rescheduled: the predecessor is terminal and the successor is a row of
      // its own, counted on its own due date.
      const toReschedule = await promise(receptionist.token, familyId, { dueOn: today });
      const rescheduled = await reschedulePromiseOverHttp(
        harness,
        receptionist.token,
        toReschedule,
        {
          dueOn: later,
          reason: 'توافق بر تاریخ جدید',
        },
      );
      expect(rescheduled.status).toBe(200);

      const toCancel = await promise(receptionist.token, familyId, { dueOn: today });
      expect((await cancelPromiseOverHttp(harness, receptionist.token, toCancel)).status).toBe(200);

      const report = await okPromises(receptionist.token, { from: yesterday, to: later });

      expect(report.summary).toEqual({
        total: 6,
        open: 2,
        missed: 1,
        fulfilled: 1,
        rescheduled: 1,
        cancelled: 1,
      });

      // The five add up to the total, which is what makes `status` a filter
      // rather than a flag.
      const { total, ...parts } = report.summary;
      expect(Object.values(parts).reduce((a, b) => a + b, 0)).toBe(total);

      // Every terminal row carries the instant it ended; every live one carries
      // null, and nothing else about the resolution reaches this page.
      for (const row of report.promises) {
        if (row.status === 'OPEN' || row.status === 'MISSED') {
          expect(row.resolvedAt).toBeNull();
        } else {
          expect(row.resolvedAt).not.toBeNull();
        }
      }
    });

    it('filters on the derived word, and OPEN excludes the overdue ones', async () => {
      const receptionist = await signIn(harness, 'RECEPTIONIST');
      const manager = await signIn(harness, 'MANAGER');
      const { familyId } = await makeFamilyWithChild(harness, manager.token);

      const yesterday = await clinicDay(harness, -1);
      const tomorrow = await clinicDay(harness, 1);

      const overdue = await promise(receptionist.token, familyId, { dueOn: yesterday });
      const onTime = await promise(receptionist.token, familyId, { dueOn: tomorrow });

      const missed = await okPromises(receptionist.token, {
        from: yesterday,
        to: tomorrow,
        status: 'MISSED',
      });
      expect(missed.promises.map((row) => row.id)).toEqual([overdue]);
      // Filter-scoped: the summary describes exactly the rows this query matched.
      expect(missed.summary).toEqual({
        total: 1,
        open: 0,
        missed: 1,
        fulfilled: 0,
        rescheduled: 0,
        cancelled: 0,
      });

      const open = await okPromises(receptionist.token, {
        from: yesterday,
        to: tomorrow,
        status: 'OPEN',
      });
      expect(open.promises.map((row) => row.id)).toEqual([onTime]);

      // The two are exact complements over the stored-OPEN rows: no overlap and
      // no gap.
      expect(missed.summary.total + open.summary.total).toBe(2);
    });
  });

  describe('the range and the filters', () => {
    it('includes both ends of the due-date range and answers an empty period successfully', async () => {
      const receptionist = await signIn(harness, 'RECEPTIONIST');
      const manager = await signIn(harness, 'MANAGER');
      const { familyId } = await makeFamilyWithChild(harness, manager.token);

      const from = await clinicDay(harness, 3);
      const middle = await clinicDay(harness, 4);
      const to = await clinicDay(harness, 5);

      const first = await promise(receptionist.token, familyId, { dueOn: from });
      const last = await promise(receptionist.token, familyId, { dueOn: to });

      const both = await okPromises(receptionist.token, { from, to });
      // Soonest due date first.
      expect(both.promises.map((row) => row.id)).toEqual([first, last]);
      expect(both.summary.total).toBe(2);

      // Each end alone, proving neither boundary is exclusive.
      expect((await okPromises(receptionist.token, { from, to: from })).summary.total).toBe(1);
      expect((await okPromises(receptionist.token, { from: to, to })).summary.total).toBe(1);

      // A window between them that nobody promised into.
      const quiet = await okPromises(receptionist.token, { from: middle, to: middle });
      expect(quiet.promises).toEqual([]);
      expect(quiet.summary.total).toBe(0);
      expect(quiet.page).toEqual({ page: 1, pageSize: 25, total: 0, hasMore: false });
    });

    it('narrows to one family by opaque id, and refuses free text', async () => {
      const receptionist = await signIn(harness, 'RECEPTIONIST');
      const manager = await signIn(harness, 'MANAGER');
      const mine = await makeFamilyWithChild(harness, manager.token);
      const theirs = await makeFamilyWithChild(harness, manager.token, {
        firstName: 'کودک خانوادهٔ دیگر',
      });

      const due = await clinicDay(harness, 2);
      const ours = await promise(receptionist.token, mine.familyId, { dueOn: due });
      await promise(receptionist.token, theirs.familyId, { dueOn: due });

      const clinicWide = await okPromises(receptionist.token, { from: due, to: due });
      expect(clinicWide.summary.total).toBe(2);
      // A report row names the family so somebody can telephone them, and carries
      // no guardian, mobile, landline or address.
      for (const row of clinicWide.promises) expect(row.family.familyName).toBeTruthy();

      const oneFamily = await okPromises(receptionist.token, {
        from: due,
        to: due,
        familyId: mine.familyId,
      });
      expect(oneFamily.promises.map((row) => row.id)).toEqual([ours]);

      // A guardian's name in a query string reaches the browser history, the
      // `Referer` header and every access log.
      const named = await promises(receptionist.token, { from: due, to: due, guardian: 'سرپرست' });
      expect(named.status).toBe(400);
      expect(named.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('pages without the totals changing meaning', async () => {
      const receptionist = await signIn(harness, 'RECEPTIONIST');
      const manager = await signIn(harness, 'MANAGER');
      const { familyId } = await makeFamilyWithChild(harness, manager.token);

      const from = await clinicDay(harness, 1);
      const to = await clinicDay(harness, 3);

      const made: string[] = [];
      for (const offset of [1, 2, 3]) {
        made.push(
          await promise(receptionist.token, familyId, { dueOn: await clinicDay(harness, offset) }),
        );
      }

      const first = await okPromises(receptionist.token, { from, to, page: 1, pageSize: 2 });
      const second = await okPromises(receptionist.token, { from, to, page: 2, pageSize: 2 });

      expect(first.summary).toEqual(second.summary);
      expect(first.summary.total).toBe(3);
      expect(first.page).toEqual({ page: 1, pageSize: 2, total: 3, hasMore: true });
      expect(second.page).toEqual({ page: 2, pageSize: 2, total: 3, hasMore: false });

      // The order is total, so every promise appears exactly once.
      expect([...first.promises, ...second.promises].map((row) => row.id)).toEqual(made);
    });
  });

  describe('a promise moves no money, and the report says so by its shape', () => {
    it('carries a per-row amount and no aggregate of any kind', async () => {
      const receptionist = await signIn(harness, 'RECEPTIONIST');
      const manager = await signIn(harness, 'MANAGER');
      const { familyId } = await makeFamilyWithChild(harness, manager.token);
      const due = await clinicDay(harness, 1);

      await promise(receptionist.token, familyId, { amountToman: '400000', dueOn: due });

      const response = await promises(receptionist.token, { from: due, to: due });
      expect(response.status).toBe(200);

      const report = promiseReportResponseSchema.parse(response.body);

      // The amount is a fact of the promise and is on the row.
      expect(report.promises[0]?.amountToman).toBe('400000');

      // And nowhere else. A clinic-wide promised total would look like money the
      // clinic is owed, sit one line from the amounts that really are owed, and
      // be added to them. The strict schema already refuses one; this asserts it
      // against the RAW body, before any parse could have dropped a key.
      expect(JSON.stringify(response.body.summary)).not.toMatch(/oman/);
      expect(Object.keys(response.body.summary).sort()).toEqual([
        'cancelled',
        'fulfilled',
        'missed',
        'open',
        'rescheduled',
        'total',
      ]);
    });
  });

  describe('authority: chasing a promise is the receptionist’s own work', () => {
    it('answers a receptionist and a manager identically', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const receptionist = await signIn(harness, 'RECEPTIONIST');
      const { familyId } = await makeFamilyWithChild(harness, manager.token);
      const due = await clinicDay(harness, 1);

      await promise(receptionist.token, familyId, { dueOn: due });

      const asReceptionist = await okPromises(receptionist.token, { from: due, to: due });
      const asManager = await okPromises(manager.token, { from: due, to: due });

      expect(asReceptionist).toEqual(asManager);
    });

    it('refuses a caller with no session', async () => {
      const due = await clinicDay(harness, 1);

      const response = await request(harness.app.getHttpServer())
        .get('/reports/promises')
        .query({ from: due, to: due })
        .set(internalHeaders());

      expect(response.status).toBe(401);
    });
  });
});
