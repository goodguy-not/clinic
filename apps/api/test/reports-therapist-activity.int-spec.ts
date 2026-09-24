import request from 'supertest';
import { therapistActivityResponseSchema, type TherapistActivityResponse } from '@clinic/contracts';
import {
  asUser,
  bookId,
  bookingPayload,
  cancel,
  complete,
  makeRoom,
  makeService,
  makeTherapist,
  putWindows,
  readView,
  recordAttendance,
  seedClinic,
  signIn,
  pastSaturday,
  SATURDAY_MORNING,
} from './appointments-support';
import { createHarness, internalHeaders, resetDatabase, type Harness } from './harness';

/**
 * Therapist activity: `GET /reports/therapist-activity` (Milestone 7,
 * checkpoint C3).
 *
 * EVERYTHING HERE IS SYNTHETIC. No real therapist, service, room, family, child
 * or schedule appears in any fixture in this project.
 *
 * THE CLAIM THAT MATTERS MOST IS A NEGATIVE ONE, and it is asserted against the
 * raw body as well as through the frozen schema: NOT ONE FIELD OF MONEY exists
 * in this response. Therapist settlement is based on completed-session value and
 * on share percentages approved for Milestone 8; a "session value" column here
 * would be the first half of a settlement calculation published on a screen
 * before anybody had approved the second half (CLAUDE.md — any settlement rule
 * not explicitly approved remains unresolved and must not be inferred).
 *
 * THE OTHER CLAIMS: the counts are SEATS and distinguish completed work from
 * no-shows and cancellations; `attendedDurationMinutes` counts attended seats
 * only, so it is never a figure that reads as hours delivered and is not; the
 * totals are the exact column sum of the rows; and `includeInactive` decides who
 * appears with NO activity, never whose work is counted.
 *
 * THE FIXTURES SIT IN THE PAST, so every session has certainly ended and the
 * unresolved-outcome predicate is being tested against the state it describes.
 */
describe('the therapist activity report (real PostgreSQL)', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  const activity = (token: string, query: Record<string, string>) =>
    request(harness.app.getHttpServer())
      .get('/reports/therapist-activity')
      .query(query)
      .set(asUser(token));

  const okActivity = async (
    token: string,
    query: Record<string, string>,
  ): Promise<TherapistActivityResponse> => {
    const response = await activity(token, query);
    expect(response.status).toBe(200);

    return therapistActivityResponseSchema.parse(response.body);
  };

  const seatOf = async (token: string, appointmentId: string): Promise<string> => {
    const response = await readView(harness, token, appointmentId);
    expect(response.status).toBe(200);

    return response.body.participants[0].participant.id as string;
  };

  const day = (): { date: string; startsAt: string } => pastSaturday();

  /** 09:00, 10:00, 11:00 and 12:00 Tehran — four slots inside the seeded window. */
  const at = (date: string, index: number): string => `${date}T0${String(5 + index)}:30:00.000Z`;

  const deactivate = (token: string, therapistId: string) =>
    request(harness.app.getHttpServer())
      .patch(`/catalog/therapists/${therapistId}/status`)
      .set(asUser(token))
      .send({ status: 'INACTIVE' });

  describe('what a therapist did, counted as seats', () => {
    it('separates completed, attended, no-show, cancelled and unresolved work', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const clinic = await seedClinic(harness, manager.token);
      const { date } = day();

      const attended = await bookId(
        harness,
        manager.token,
        bookingPayload(clinic, { startsAt: at(date, 0) }),
      );
      const noShow = await bookId(
        harness,
        manager.token,
        bookingPayload(clinic, { startsAt: at(date, 1) }),
      );
      const cancelled = await bookId(
        harness,
        manager.token,
        bookingPayload(clinic, { startsAt: at(date, 2) }),
      );
      await bookId(harness, manager.token, bookingPayload(clinic, { startsAt: at(date, 3) }));

      await recordAttendance(
        harness,
        manager.token,
        attended,
        await seatOf(manager.token, attended),
        'ATTENDED',
      );
      expect((await complete(harness, manager.token, attended)).status).toBe(200);

      await recordAttendance(
        harness,
        manager.token,
        noShow,
        await seatOf(manager.token, noShow),
        'NO_SHOW',
      );

      expect(
        (
          await cancel(harness, manager.token, cancelled, {
            cancelledBy: 'CLINIC',
            reason: 'لغو توسط مرکز',
          })
        ).status,
      ).toBe(200);

      const report = await okActivity(manager.token, { from: date, to: date });

      expect(report.therapists).toHaveLength(1);
      expect(report.therapists[0]).toEqual({
        therapist: { id: clinic.therapistId, fullName: expect.any(String) },
        // Two bookings are still SCHEDULED: the no-show (a seat fact, not a
        // booking one) and the untouched session.
        scheduledCount: 2,
        completedCount: 1,
        cancelledCount: 1,
        attendedCount: 1,
        noShowCount: 1,
        // Only the untouched, long-finished, uncancelled session is outstanding
        // work. The cancelled one never is; the two resolved ones no longer are.
        unresolvedOutcomeCount: 1,
        // ATTENDED SEATS ONLY: 45 minutes, not the 180 that were booked. Summing
        // cancellations and no-shows into one figure would produce a number that
        // reads as time delivered and is not.
        attendedDurationMinutes: 45,
      });

      // `totals` is the exact column sum of the rows, so a reader adding the
      // column by hand reaches the server's answer.
      expect(report.totals).toEqual({
        therapistCount: 1,
        scheduledCount: 2,
        completedCount: 1,
        cancelledCount: 1,
        attendedCount: 1,
        noShowCount: 1,
        unresolvedOutcomeCount: 1,
        attendedDurationMinutes: 45,
      });

      expect(report.range).toEqual({ from: date, to: date, dateBasis: 'SESSION_DATE' });
    });

    it('carries no money of any kind, anywhere in the response', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const clinic = await seedClinic(harness, manager.token);
      const { date, startsAt } = day();

      const id = await bookId(harness, manager.token, bookingPayload(clinic, { startsAt }));
      await recordAttendance(
        harness,
        manager.token,
        id,
        await seatOf(manager.token, id),
        'ATTENDED',
      );
      await complete(harness, manager.token, id);

      const response = await activity(manager.token, { from: date, to: date });
      expect(response.status).toBe(200);

      // Asserted against the RAW body, before any parse could have dropped a
      // key: no amount, no toman, no price, no tariff, no share, no percentage
      // and no settlement, in any casing, anywhere in the payload.
      const raw = JSON.stringify(response.body);
      expect(raw).not.toMatch(/toman|price|tariff|amount|share|percent|settle|charge/i);

      // And the frozen schema is strict, so an added field would fail here too.
      therapistActivityResponseSchema.parse(response.body);
    });
  });

  describe('the range, and the period as the question', () => {
    it('includes both ends and answers a quiet period with zeroed totals', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const clinic = await seedClinic(harness, manager.token);
      const first = pastSaturday();
      const secondDate = new Date(`${first.date}T00:00:00.000Z`);
      secondDate.setUTCDate(secondDate.getUTCDate() + 7);
      const second = secondDate.toISOString().slice(0, 10);

      await bookId(harness, manager.token, bookingPayload(clinic, { startsAt: first.startsAt }));
      await bookId(
        harness,
        manager.token,
        bookingPayload(clinic, { startsAt: `${second}T06:30:00.000Z` }),
      );

      expect(
        (await okActivity(manager.token, { from: first.date, to: first.date })).totals
          .scheduledCount,
      ).toBe(1);
      expect(
        (await okActivity(manager.token, { from: second, to: second })).totals.scheduledCount,
      ).toBe(1);
      expect(
        (await okActivity(manager.token, { from: first.date, to: second })).totals.scheduledCount,
      ).toBe(2);

      // A fortnight the therapist did nothing in is a successful read: they are
      // still on the active roster, so they appear as a zero row.
      const quiet = await okActivity(manager.token, { from: '2019-01-01', to: '2019-01-31' });
      expect(quiet.therapists).toHaveLength(1);
      expect(quiet.totals).toEqual({
        therapistCount: 1,
        scheduledCount: 0,
        completedCount: 0,
        cancelledCount: 0,
        attendedCount: 0,
        noShowCount: 0,
        unresolvedOutcomeCount: 0,
        attendedDurationMinutes: 0,
      });
    });

    it('refuses an inverted range and imposes no maximum span', async () => {
      const manager = await signIn(harness, 'MANAGER');

      const inverted = await activity(manager.token, { from: '2026-01-02', to: '2026-01-01' });
      expect(inverted.status).toBe(400);
      expect(inverted.body.error.code).toBe('VALIDATION_FAILED');

      const decade = await okActivity(manager.token, { from: '2020-01-01', to: '2030-01-01' });
      expect(decade.range.to).toBe('2030-01-01');
    });

    it('is not paged, and refuses a paging parameter', async () => {
      const manager = await signIn(harness, 'MANAGER');

      const paged = await activity(manager.token, {
        from: '2026-01-01',
        to: '2026-01-31',
        page: '2',
      });

      expect(paged.status).toBe(400);
      expect(paged.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('who appears, which is a different question from whose work is counted', () => {
    it('always counts a departed therapist’s work, and includeInactive only adds zero rows', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const clinic = await seedClinic(harness, manager.token);
      const { date, startsAt } = day();

      // A second therapist who never worked, and who then leaves the clinic.
      const quietService = await makeService(harness, manager.token);
      const departed = await makeTherapist(harness, manager.token, [quietService]);

      const worked = await bookId(harness, manager.token, bookingPayload(clinic, { startsAt }));
      await recordAttendance(
        harness,
        manager.token,
        worked,
        await seatOf(manager.token, worked),
        'ATTENDED',
      );

      const bothActive = await okActivity(manager.token, { from: date, to: date });
      expect(bothActive.therapists).toHaveLength(2);

      expect((await deactivate(manager.token, departed)).status).toBe(200);

      // Off: the active roster, plus anybody who worked. The departed therapist
      // did nothing in the period, so they drop off.
      const roster = await okActivity(manager.token, { from: date, to: date });
      expect(roster.therapists.map((row) => row.therapist.id)).toEqual([clinic.therapistId]);

      // On: every therapist the clinic has ever recorded, zero rows included.
      const everyone = await okActivity(manager.token, {
        from: date,
        to: date,
        includeInactive: 'true',
      });
      expect(everyone.therapists.map((row) => row.therapist.id).sort()).toEqual(
        [clinic.therapistId, departed].sort(),
      );
      expect(everyone.therapists.find((row) => row.therapist.id === departed)?.attendedCount).toBe(
        0,
      );

      // The counted work is identical either way: `includeInactive` decides who
      // is listed, never whose sessions count.
      expect(everyone.totals.attendedCount).toBe(roster.totals.attendedCount);
      expect(everyone.totals.therapistCount).toBe(2);
      expect(roster.totals.therapistCount).toBe(1);
    });

    it('keeps a therapist who worked and then left, whatever includeInactive says', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const clinic = await seedClinic(harness, manager.token);
      const { date, startsAt } = day();

      const id = await bookId(harness, manager.token, bookingPayload(clinic, { startsAt }));
      await recordAttendance(
        harness,
        manager.token,
        id,
        await seatOf(manager.token, id),
        'ATTENDED',
      );

      expect((await deactivate(manager.token, clinic.therapistId)).status).toBe(200);

      // A therapist who has left the clinic did the work they did, and nothing
      // filters on their status.
      const roster = await okActivity(manager.token, { from: date, to: date });
      expect(roster.therapists.map((row) => row.therapist.id)).toEqual([clinic.therapistId]);
      expect(roster.totals.attendedCount).toBe(1);
    });

    it('answers a named therapist with their own row even when it is empty', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const clinic = await seedClinic(harness, manager.token);
      const { date } = day();

      expect((await deactivate(manager.token, clinic.therapistId)).status).toBe(200);

      // Naming somebody by id is an explicit request for that person's period.
      // An empty list would leave the reader unable to tell "no sessions" from
      // "wrong id", so the zero row is the answer to the question asked.
      const report = await okActivity(manager.token, {
        from: date,
        to: date,
        therapistId: clinic.therapistId,
      });

      expect(report.therapists.map((row) => row.therapist.id)).toEqual([clinic.therapistId]);
      expect(report.totals.therapistCount).toBe(1);
      expect(report.totals.scheduledCount).toBe(0);
    });
  });

  describe('narrowing by service, which narrows the work and not the roster', () => {
    it('counts only the named service and leaves other active therapists as zero rows', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const clinic = await seedClinic(harness, manager.token);
      const { date } = day();

      const otherService = await makeService(harness, manager.token);
      const otherTherapist = await makeTherapist(harness, manager.token, [otherService]);
      const otherRoom = await makeRoom(harness, manager.token);
      expect(
        (await putWindows(harness, manager.token, otherTherapist, [SATURDAY_MORNING])).status,
      ).toBe(200);

      await bookId(harness, manager.token, bookingPayload(clinic, { startsAt: at(date, 0) }));
      await bookId(harness, manager.token, {
        ...bookingPayload(clinic, { startsAt: at(date, 1) }),
        serviceId: otherService,
        therapistId: otherTherapist,
        roomId: otherRoom,
      });

      const everything = await okActivity(manager.token, { from: date, to: date });
      expect(everything.totals.scheduledCount).toBe(2);
      expect(everything.totals.therapistCount).toBe(2);

      const narrowed = await okActivity(manager.token, {
        from: date,
        to: date,
        serviceId: otherService,
      });

      // Both therapists are still listed — the roster is the active one — but
      // only the work of the named service is counted.
      expect(narrowed.totals.therapistCount).toBe(2);
      expect(narrowed.totals.scheduledCount).toBe(1);
      expect(
        narrowed.therapists.find((row) => row.therapist.id === clinic.therapistId)?.scheduledCount,
      ).toBe(0);
      expect(
        narrowed.therapists.find((row) => row.therapist.id === otherTherapist)?.scheduledCount,
      ).toBe(1);
    });
  });

  describe('authority: a diary fact, shared by both roles', () => {
    it('answers a receptionist and a manager identically', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const receptionist = await signIn(harness, 'RECEPTIONIST');
      const clinic = await seedClinic(harness, manager.token);
      const { date, startsAt } = day();

      await bookId(harness, manager.token, bookingPayload(clinic, { startsAt }));

      const asManager = await okActivity(manager.token, { from: date, to: date });
      const asReceptionist = await okActivity(receptionist.token, { from: date, to: date });

      // No share, no settlement, no money: nothing here is the manager's alone.
      expect(asReceptionist).toEqual(asManager);
    });

    it('refuses a caller with no session', async () => {
      const response = await request(harness.app.getHttpServer())
        .get('/reports/therapist-activity')
        .query({ from: '2026-01-01', to: '2026-01-31' })
        .set(internalHeaders());

      expect(response.status).toBe(401);
    });
  });
});
