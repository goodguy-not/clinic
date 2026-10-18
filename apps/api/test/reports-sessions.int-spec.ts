import request from 'supertest';
import { sessionReportResponseSchema, type SessionReportResponse } from '@clinic/contracts';
import {
  asUser,
  bookId,
  bookingPayload,
  cancel,
  complete,
  makeFamilyWithChild,
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
 * The cross-family session report: `GET /reports/sessions` (Milestone 7,
 * checkpoint C3).
 *
 * EVERYTHING HERE IS SYNTHETIC. No real family, child, therapist, room or
 * schedule appears in any fixture in this project.
 *
 * WHAT THIS SUITE IS FOR. The report is the first read in this system that
 * crosses families, and the claims worth proving at the HTTP boundary are the
 * ones a unit test could not fail on: that a row is a SEAT rather than a
 * booking, that both ends of the range are inclusive, that the totals describe
 * the whole filtered result rather than the page, that an empty period is a
 * successful read, and that not one field of money reaches the wire — which the
 * strict frozen schema turns into a parse failure rather than something a
 * reviewer has to notice.
 *
 * THE FIXTURES SIT IN THE PAST, DELIBERATELY. `pastSaturday()` is a Saturday
 * more than a year behind whichever day the suite runs on, so every session in
 * it has certainly ended and the unresolved-outcome predicate — "over, not
 * cancelled, attendance still `PENDING`" — is being tested against the state it
 * describes. A hard-coded date would quietly stop meaning that as the calendar
 * moved past it.
 *
 * THE DAYS ARE ASKED OF THE CLINIC'S OWN CALENDAR. Tehran rolls over at 20:30
 * UTC, so a test that derived a day from the runner's clock would pass for
 * twenty and a half hours a day and fail for the other three and a half.
 */
describe('the session report (real PostgreSQL)', () => {
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

  const sessions = (token: string, query: Record<string, string | number>) =>
    request(harness.app.getHttpServer()).get('/reports/sessions').query(query).set(asUser(token));

  const okSessions = async (
    token: string,
    query: Record<string, string | number>,
  ): Promise<SessionReportResponse> => {
    const response = await sessions(token, query);
    expect(response.status).toBe(200);

    // Parsed against the FROZEN schema, which is half of every assertion here: a
    // strict object refuses an extra key, so a price, a charge flag or any other
    // money-shaped field appearing on a row would fail this line.
    return sessionReportResponseSchema.parse(response.body);
  };

  /** The one seat of an individual appointment, read back through the view. */
  const seatOf = async (token: string, appointmentId: string): Promise<string> => {
    const response = await readView(harness, token, appointmentId);
    expect(response.status).toBe(200);

    return response.body.participants[0].participant.id as string;
  };

  /** The Saturday `offsetWeeks` after the reference past Saturday, and 10:00 on it. */
  const week = (offsetWeeks: number): { date: string; startsAt: string } => {
    const base = new Date(`${pastSaturday().date}T00:00:00.000Z`);
    base.setUTCDate(base.getUTCDate() + offsetWeeks * 7);
    const date = base.toISOString().slice(0, 10);

    return { date, startsAt: `${date}T06:30:00.000Z` };
  };

  /** The day after a given clinic day, used for the exclusive-boundary probes. */
  const dayAfter = (date: string): string => {
    const moment = new Date(`${date}T00:00:00.000Z`);
    moment.setUTCDate(moment.getUTCDate() + 1);

    return moment.toISOString().slice(0, 10);
  };

  describe('the range, which is the question rather than a refinement of it', () => {
    it('includes both ends, and answers a quiet period with a successful empty read', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const clinic = await seedClinic(harness, manager.token);
      const first = week(0);
      const second = week(1);

      await bookId(harness, manager.token, bookingPayload(clinic, { startsAt: first.startsAt }));
      await bookId(harness, manager.token, bookingPayload(clinic, { startsAt: second.startsAt }));

      // `from` inclusive: a range that begins on the day of a session contains it.
      const startDay = await okSessions(manager.token, { from: first.date, to: first.date });
      expect(startDay.summary.total).toBe(1);
      expect(startDay.sessions[0]?.date).toBe(first.date);

      // `to` inclusive: a range that ends on the day of a session contains it.
      const endDay = await okSessions(manager.token, {
        from: dayAfter(first.date),
        to: second.date,
      });
      expect(endDay.summary.total).toBe(1);
      expect(endDay.sessions[0]?.date).toBe(second.date);

      const whole = await okSessions(manager.token, { from: first.date, to: second.date });
      expect(whole.summary.total).toBe(2);
      // Oldest first within the range.
      expect(whole.sessions.map((row) => row.date)).toEqual([first.date, second.date]);

      // The echoed range says what was asked and which day it counts, so a
      // printed page can date itself.
      expect(whole.range).toEqual({ from: first.date, to: second.date, dateBasis: 'SESSION_DATE' });

      // A period the clinic did nothing in is an ANSWER: 200, an empty array and
      // zeroed counts, never a 404 and never an error code.
      const quiet = await okSessions(manager.token, {
        from: dayAfter(first.date),
        to: dayAfter(first.date),
      });
      expect(quiet.sessions).toEqual([]);
      expect(quiet.summary).toEqual({
        total: 0,
        scheduled: 0,
        completed: 0,
        cancelled: 0,
        attended: 0,
        noShows: 0,
        unresolvedOutcomes: 0,
        totalDurationMinutes: 0,
      });
      expect(quiet.page).toEqual({ page: 1, pageSize: 25, total: 0, hasMore: false });
    });

    it('refuses a range that ends before it starts, and imposes no maximum span', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const first = week(0);

      const inverted = await sessions(manager.token, { from: first.date, to: '2000-01-01' });
      expect(inverted.status).toBe(400);
      expect(inverted.body.error.code).toBe('VALIDATION_FAILED');

      // Ten years is a real question a clinic may ask, and the server answers it.
      const decade = await okSessions(manager.token, { from: '2020-01-01', to: '2030-01-01' });
      expect(decade.range.from).toBe('2020-01-01');
    });
  });

  describe('a row is a seat, and the two levels are two different questions', () => {
    it('reports the seat, its attendance and the booking status side by side', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const clinic = await seedClinic(harness, manager.token);
      const day = week(0);

      const attended = await bookId(
        harness,
        manager.token,
        bookingPayload(clinic, { startsAt: day.startsAt }),
      );
      const noShow = await bookId(
        harness,
        manager.token,
        bookingPayload(clinic, { startsAt: `${day.date}T07:30:00.000Z` }),
      );
      const cancelled = await bookId(
        harness,
        manager.token,
        bookingPayload(clinic, { startsAt: `${day.date}T08:30:00.000Z` }),
      );
      const untouched = await bookId(
        harness,
        manager.token,
        bookingPayload(clinic, { startsAt: `${day.date}T05:30:00.000Z` }),
      );

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
            cancelledBy: 'FAMILY',
            reason: 'لغو توسط خانواده',
          })
        ).status,
      ).toBe(200);

      const report = await okSessions(manager.token, { from: day.date, to: day.date });

      // Every row names its booking AND its seat: a report that could not say
      // which child failed to arrive would be unable to answer the question it is
      // most often opened for.
      expect(report.sessions).toHaveLength(4);
      for (const row of report.sessions) {
        expect(row.participantId).not.toBe(row.appointmentId);
        expect(row.child.fileNumber).toBeTruthy();
        expect(row.family.familyName).toBeTruthy();
        expect(row.therapist.id).toBe(clinic.therapistId);
        expect(row.service.id).toBe(clinic.serviceId);
        expect(row.room.id).toBe(clinic.roomId);
      }

      // The counts: three still on the diary as SCHEDULED or COMPLETED, one
      // cancelled; and attendance counted separately from the booking status.
      expect(report.summary).toEqual({
        total: 4,
        scheduled: 2,
        completed: 1,
        cancelled: 1,
        attended: 1,
        noShows: 1,
        // The cancelled seat is never outstanding work — nothing happened. The
        // attended and no-show seats are resolved. Only the untouched booking,
        // whose session is long over, is on the list.
        unresolvedOutcomes: 1,
        // Every matched seat's booked length, cancellations included, because
        // `total` counts them too.
        totalDurationMinutes: 4 * 45,
      });

      expect(report.sessions.find((row) => row.appointmentId === untouched)?.attendance).toBe(
        'PENDING',
      );
    });

    it('filters the booking by status and the seat by attendance, independently', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const clinic = await seedClinic(harness, manager.token);
      const day = week(0);

      const completed = await bookId(
        harness,
        manager.token,
        bookingPayload(clinic, { startsAt: day.startsAt }),
      );
      const pendingSeat = await bookId(
        harness,
        manager.token,
        bookingPayload(clinic, { startsAt: `${day.date}T07:30:00.000Z` }),
      );

      await recordAttendance(
        harness,
        manager.token,
        completed,
        await seatOf(manager.token, completed),
        'ATTENDED',
      );
      await complete(harness, manager.token, completed);

      const byStatus = await okSessions(manager.token, {
        from: day.date,
        to: day.date,
        status: 'COMPLETED',
      });
      expect(byStatus.sessions.map((row) => row.appointmentId)).toEqual([completed]);
      // Filter-scoped: every number describes exactly the rows this query matched.
      expect(byStatus.summary.total).toBe(1);
      expect(byStatus.summary.completed).toBe(1);
      expect(byStatus.summary.scheduled).toBe(0);

      const byAttendance = await okSessions(manager.token, {
        from: day.date,
        to: day.date,
        attendance: 'PENDING',
      });
      expect(byAttendance.sessions.map((row) => row.appointmentId)).toEqual([pendingSeat]);

      // A completed booking may still carry PENDING, which is why the two
      // filters are not two spellings of one question.
      const both = await okSessions(manager.token, {
        from: day.date,
        to: day.date,
        status: 'COMPLETED',
        attendance: 'ATTENDED',
      });
      expect(both.summary.total).toBe(1);
      expect(both.sessions[0]?.appointmentId).toBe(completed);
    });
  });

  describe('filtering across families, by opaque id only', () => {
    it('narrows by family, child, therapist, service and room, and combines them', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const clinic = await seedClinic(harness, manager.token);
      const day = week(0);

      // A second family, a second therapist, a second room and a second service:
      // enough for every filter to be able to exclude something.
      const other = await makeFamilyWithChild(harness, manager.token, {
        firstName: 'کودک دوم',
      });
      const otherService = await makeService(harness, manager.token);
      const otherTherapist = await makeTherapist(harness, manager.token, [otherService]);
      const otherRoom = await makeRoom(harness, manager.token);
      expect(
        (await putWindows(harness, manager.token, otherTherapist, [SATURDAY_MORNING])).status,
      ).toBe(200);

      const mine = await bookId(
        harness,
        manager.token,
        bookingPayload(clinic, { startsAt: day.startsAt }),
      );
      const theirs = await bookId(harness, manager.token, {
        ...bookingPayload(clinic, { startsAt: day.startsAt }),
        serviceId: otherService,
        therapistId: otherTherapist,
        roomId: otherRoom,
        childId: other.childId,
      });

      const all = await okSessions(manager.token, { from: day.date, to: day.date });
      expect(all.summary.total).toBe(2);

      const only = async (filter: Record<string, string>): Promise<string[]> => {
        const report = await okSessions(manager.token, { from: day.date, to: day.date, ...filter });
        expect(report.summary.total).toBe(report.sessions.length);

        return report.sessions.map((row) => row.appointmentId);
      };

      expect(await only({ familyId: clinic.familyId })).toEqual([mine]);
      expect(await only({ childId: other.childId })).toEqual([theirs]);
      expect(await only({ therapistId: clinic.therapistId })).toEqual([mine]);
      expect(await only({ serviceId: otherService })).toEqual([theirs]);
      expect(await only({ roomId: otherRoom })).toEqual([theirs]);

      // Combined, on ids that describe the same session.
      expect(await only({ familyId: clinic.familyId, roomId: clinic.roomId })).toEqual([mine]);
      // Combined, on ids that describe no session at all: a successful empty read.
      expect(await only({ familyId: clinic.familyId, roomId: otherRoom })).toEqual([]);
    });

    it('refuses a free-text filter rather than ignoring it', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const day = week(0);

      // A child's name in a query string reaches the browser history, the
      // `Referer` header and every access log. The strict schema is what makes
      // this a refused request rather than a silently dropped parameter.
      const response = await sessions(manager.token, {
        from: day.date,
        to: day.date,
        childName: 'کودک',
      });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('paging, which must not change what a number means', () => {
    it('keeps the totals over the whole filtered result on every page', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const clinic = await seedClinic(harness, manager.token);
      const day = week(0);

      const booked: string[] = [];
      for (const hour of ['06:30', '07:30', '08:30']) {
        booked.push(
          await bookId(
            harness,
            manager.token,
            bookingPayload(clinic, { startsAt: `${day.date}T${hour}:00.000Z` }),
          ),
        );
      }

      const first = await okSessions(manager.token, {
        from: day.date,
        to: day.date,
        page: 1,
        pageSize: 2,
      });
      const second = await okSessions(manager.token, {
        from: day.date,
        to: day.date,
        page: 2,
        pageSize: 2,
      });

      expect(first.sessions).toHaveLength(2);
      expect(second.sessions).toHaveLength(1);

      // A count that changed when the reader turned the page would be read as a
      // different clinic.
      expect(second.summary).toEqual(first.summary);
      expect(first.summary.total).toBe(3);

      expect(first.page).toEqual({ page: 1, pageSize: 2, total: 3, hasMore: true });
      expect(second.page).toEqual({ page: 2, pageSize: 2, total: 3, hasMore: false });

      // The order is total, so every seat appears exactly once across the pages.
      expect([...first.sessions, ...second.sessions].map((row) => row.appointmentId)).toEqual(
        booked,
      );

      // A page past the end is a successful empty read, not a refusal.
      const beyond = await okSessions(manager.token, {
        from: day.date,
        to: day.date,
        page: 9,
        pageSize: 2,
      });
      expect(beyond.sessions).toEqual([]);
      expect(beyond.page.total).toBe(3);
      expect(beyond.page.hasMore).toBe(false);
    });
  });

  describe('authority: an operational report, shared by both roles', () => {
    it('answers a receptionist and a manager identically', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const receptionist = await signIn(harness, 'RECEPTIONIST');
      const clinic = await seedClinic(harness, manager.token);
      const day = week(0);

      await bookId(harness, manager.token, bookingPayload(clinic, { startsAt: day.startsAt }));

      const asManager = await okSessions(manager.token, { from: day.date, to: day.date });
      const asReceptionist = await okSessions(receptionist.token, { from: day.date, to: day.date });

      // No variant, no hidden block, no financial scope: the operational report
      // carries no money, which is exactly why both roles read the same page.
      expect(asReceptionist).toEqual(asManager);
    });

    it('refuses a caller with no session', async () => {
      const day = week(0);

      const response = await request(harness.app.getHttpServer())
        .get('/reports/sessions')
        .query({ from: day.date, to: day.date })
        .set(internalHeaders());

      expect(response.status).toBe(401);
    });
  });
});
