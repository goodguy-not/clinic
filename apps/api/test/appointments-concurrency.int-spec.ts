import { appointmentResponseSchema } from '@clinic/contracts';
import { createHarness, resetDatabase, type Harness } from './harness';
import {
  book,
  bookingPayload,
  cancel,
  cancelSeriesFrom,
  complete,
  createSeries,
  createSeriesOrThrow,
  makeFamilyWithChild,
  makeRoom,
  makeTherapist,
  move,
  movePayload,
  putWindows,
  recordAttendance,
  SATURDAY_10_00,
  SATURDAY_10_30,
  SATURDAY_11_00,
  SATURDAY_MORNING,
  seedClinic,
  seriesPayload,
  signIn,
  updateSeriesFrom,
} from './appointments-support';

/**
 * What happens when two receptionists book at the same moment.
 *
 * This is the suite that decides whether the conflict rules mean anything. A
 * check that reads before it writes is not a check under concurrency: both
 * requests read "free", both insert, and the clinic ends up with the two
 * bookings the check existed to prevent.
 *
 * Two mechanisms are proved here, and they are different mechanisms:
 *
 *   * the THERAPIST and ROOM overlaps are exclusion constraints, so the second
 *     writer is refused by PostgreSQL as it inserts;
 *   * the CHILD overlap is a recomputation under a transaction-scoped advisory
 *     lock, so the second writer waits, re-reads, and finds the row the first
 *     one committed.
 *
 * As in the Milestone 2 and 3 concurrency suites, nothing is synchronised on a
 * timer. A `sleep` long enough to be reliable is slow, and one short enough to be
 * fast passes on a quiet machine and fails in CI. Requests are fired together and
 * the assertion is on the invariant that must hold whichever order they land in.
 */
describe('appointment concurrency (real PostgreSQL)', () => {
  let harness: Harness;
  let manager: { id: string; token: string };
  let receptionist: { id: string; token: string };
  let clinic: {
    serviceId: string;
    therapistId: string;
    roomId: string;
    familyId: string;
    childId: string;
  };

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    manager = await signIn(harness, 'MANAGER');
    receptionist = await signIn(harness, 'RECEPTIONIST');
    clinic = await seedClinic(harness, manager.token);
  });

  const payload = (overrides: Record<string, unknown> = {}) => bookingPayload(clinic, overrides);

  it('gives one therapist to one booking, whichever request lands first', async () => {
    const roomB = await makeRoom(harness, manager.token);
    const childB = await makeFamilyWithChild(harness, manager.token);

    const [first, second] = await Promise.all([
      book(harness, receptionist.token, payload()),
      book(
        harness,
        receptionist.token,
        payload({ startsAt: SATURDAY_10_30, roomId: roomB, childId: childB.childId }),
      ),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);

    const refused = first.status === 409 ? first : second;
    expect(refused.body.error.code).toBe('APPOINTMENT_THERAPIST_CONFLICT');

    expect(await harness.prisma.appointment.count()).toBe(1);
    expect(await harness.prisma.appointmentParticipant.count()).toBe(1);
    expect(await harness.prisma.auditLog.count({ where: { action: 'appointment.created' } })).toBe(
      1,
    );
  }, 30000);

  it('gives one room to one booking', async () => {
    const therapistB = await makeTherapist(harness, manager.token, [clinic.serviceId]);
    await putWindows(harness, manager.token, therapistB, [SATURDAY_MORNING]);
    const childB = await makeFamilyWithChild(harness, manager.token);

    const [first, second] = await Promise.all([
      book(harness, receptionist.token, payload()),
      book(
        harness,
        receptionist.token,
        payload({ startsAt: SATURDAY_10_30, therapistId: therapistB, childId: childB.childId }),
      ),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);

    const refused = first.status === 409 ? first : second;
    expect(refused.body.error.code).toBe('APPOINTMENT_ROOM_CONFLICT');
    expect(await harness.prisma.appointment.count()).toBe(1);
  }, 30000);

  it('never books one child into two overlapping sessions', async () => {
    // THE ONE THE ADVISORY LOCK EXISTS FOR. Both bookings use a different
    // therapist and a different room, so neither exclusion constraint applies and
    // nothing in PostgreSQL would refuse the pair. Only the recomputation under
    // the lock stands between this and a child in two rooms at once.
    const therapistB = await makeTherapist(harness, manager.token, [clinic.serviceId]);
    await putWindows(harness, manager.token, therapistB, [SATURDAY_MORNING]);
    const roomB = await makeRoom(harness, manager.token);

    const [first, second] = await Promise.all([
      book(harness, receptionist.token, payload()),
      book(
        harness,
        receptionist.token,
        payload({ startsAt: SATURDAY_10_30, therapistId: therapistB, roomId: roomB }),
      ),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);

    const refused = first.status === 409 ? first : second;
    expect(refused.body.error.code).toBe('APPOINTMENT_CHILD_CONFLICT');

    expect(await harness.prisma.appointment.count()).toBe(1);
    expect(await harness.prisma.appointmentParticipant.count()).toBe(1);
  }, 30000);

  it('serialises two identical bookings for one child down to exactly one', async () => {
    const [first, second] = await Promise.all([
      book(harness, receptionist.token, payload()),
      book(harness, receptionist.token, payload()),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(await harness.prisma.appointment.count()).toBe(1);
  }, 30000);

  it('lets two children book the same hour with different therapists and rooms', async () => {
    // The negative half: the lock must serialise a child against themselves and
    // nothing else. Two unrelated bookings in the same hour are ordinary clinic
    // work and both must succeed.
    const therapistB = await makeTherapist(harness, manager.token, [clinic.serviceId]);
    await putWindows(harness, manager.token, therapistB, [SATURDAY_MORNING]);
    const roomB = await makeRoom(harness, manager.token);
    const childB = await makeFamilyWithChild(harness, manager.token);

    const [first, second] = await Promise.all([
      book(harness, receptionist.token, payload()),
      book(
        harness,
        receptionist.token,
        payload({
          startsAt: SATURDAY_10_00,
          therapistId: therapistB,
          roomId: roomB,
          childId: childB.childId,
        }),
      ),
    ]);

    expect([first.status, second.status]).toEqual([201, 201]);
    expect(await harness.prisma.appointment.count()).toBe(2);
  }, 30000);

  it('writes no half-booking when a conflict refuses one of them', async () => {
    // The seat and the appointment are written in one transaction, so a refused
    // booking must leave neither — and no audit row claiming it happened.
    const roomB = await makeRoom(harness, manager.token);
    const childB = await makeFamilyWithChild(harness, manager.token);

    await Promise.all([
      book(harness, receptionist.token, payload()),
      book(
        harness,
        receptionist.token,
        payload({ startsAt: SATURDAY_10_30, roomId: roomB, childId: childB.childId }),
      ),
    ]);

    const appointments = await harness.prisma.appointment.count();
    const seats = await harness.prisma.appointmentParticipant.count();
    const created = await harness.prisma.auditLog.count({
      where: { action: 'appointment.created' },
    });

    expect([appointments, seats, created]).toEqual([1, 1, 1]);
  }, 30000);

  /**
   * The lifecycle under the same pressure.
   *
   * Every transition decides what it may do from a status it reads, and a status
   * read without a lock is a fact about a moment that has already passed. These
   * are the cases where two people act on one booking at once; the assertion is
   * always on the invariant, never on which request won.
   */
  describe('two people acting on one appointment', () => {
    const bookOne = async (): Promise<string> => {
      const created = await book(harness, receptionist.token, payload());
      return appointmentResponseSchema.parse(created.body).appointment.id;
    };

    it('completes a session exactly once, however many requests arrive together', async () => {
      const id = await bookOne();

      const responses = await Promise.all([
        complete(harness, receptionist.token, id),
        complete(harness, receptionist.token, id),
        complete(harness, receptionist.token, id),
      ]);

      // All three succeed — the transition is idempotent — and exactly one of
      // them is the completion. PROJECT_SPEC.md 6 requires this of the
      // transition that will create a session charge.
      expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
      expect(
        await harness.prisma.auditLog.count({ where: { action: 'appointment.completed' } }),
      ).toBe(1);
    }, 30000);

    it('lets a completion and a cancellation race, and records only the one that won', async () => {
      const id = await bookOne();

      const [completed, cancelled] = await Promise.all([
        complete(harness, receptionist.token, id),
        cancel(harness, receptionist.token, id, { cancelledBy: 'FAMILY', reason: 'بیماری کودک' }),
      ]);

      // One of them found `SCHEDULED` and the other found what the first
      // committed; the loser is refused rather than overwriting it.
      expect([completed.status, cancelled.status].sort()).toEqual([200, 409]);

      const row = await harness.prisma.appointment.findUniqueOrThrow({ where: { id } });
      const audited = await harness.prisma.auditLog.count({
        where: { action: { in: ['appointment.completed', 'appointment.cancelled'] } },
      });

      expect(audited).toBe(1);
      // The row and its audit trail agree: one outcome, one record of it.
      expect(row.status === 'COMPLETED' ? row.completedAt : row.cancelledAt).not.toBeNull();
    }, 30000);

    it('never moves two appointments onto the same therapist', async () => {
      // Two bookings an hour apart, both moved onto the same free slot at once.
      // Nothing read before writing decides this: the exclusion constraint does,
      // exactly as it does for two inserts.
      const roomB = await makeRoom(harness, manager.token);
      const childB = await makeFamilyWithChild(harness, manager.token);

      const first = await bookOne();
      const secondResponse = await book(
        harness,
        receptionist.token,
        payload({ startsAt: SATURDAY_11_00, roomId: roomB, childId: childB.childId }),
      );
      const second = appointmentResponseSchema.parse(secondResponse.body).appointment.id;

      const target = '2026-09-05T08:30:00.000Z'; // 12:00 Tehran, free for both.

      const [movedFirst, movedSecond] = await Promise.all([
        move(harness, receptionist.token, first, movePayload(clinic, { startsAt: target })),
        move(
          harness,
          receptionist.token,
          second,
          movePayload(clinic, { startsAt: target, roomId: roomB }),
        ),
      ]);

      expect([movedFirst.status, movedSecond.status].sort()).toEqual([200, 409]);

      const refused = movedFirst.status === 409 ? movedFirst : movedSecond;
      expect(refused.body.error.code).toBe('APPOINTMENT_THERAPIST_CONFLICT');

      // The refused move left its appointment exactly where it was, and wrote
      // no audit row claiming otherwise.
      expect(
        await harness.prisma.auditLog.count({ where: { action: 'appointment.updated' } }),
      ).toBe(1);
      expect(
        await harness.prisma.appointment.count({ where: { startsAt: new Date(target) } }),
      ).toBe(1);
    }, 30000);

    it('records one attendance for one seat when the same outcome arrives twice', async () => {
      const id = await bookOne();
      const seat = appointmentResponseSchema.parse(
        (await complete(harness, receptionist.token, id)).body,
      ).participants[0]?.id;

      const responses = await Promise.all([
        recordAttendance(harness, receptionist.token, id, seat ?? id, 'ATTENDED'),
        recordAttendance(harness, receptionist.token, id, seat ?? id, 'ATTENDED'),
      ]);

      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      expect(
        await harness.prisma.auditLog.count({
          where: { action: 'appointment.attendance_recorded' },
        }),
      ).toBe(1);
    }, 30000);
  });

  /**
   * A whole series under the same pressure.
   *
   * A series creation is one transaction that writes many rows, so the questions
   * are different in kind: does a conflict on the eleventh week take the first
   * ten back, and do two people running this-and-future operations on one series
   * decide against each other's committed state rather than against a stale
   * read?
   */
  describe('two people acting on one series', () => {
    it('books one of two identical series and leaves not one row of the other', async () => {
      const [first, second] = await Promise.all([
        createSeries(harness, receptionist.token, seriesPayload(clinic)),
        createSeries(harness, receptionist.token, seriesPayload(clinic)),
      ]);

      expect([first.status, second.status].sort()).toEqual([201, 409]);

      // Three occurrences, three seats, one series row and four audit rows —
      // the refused transaction left nothing at all, not even the weeks it had
      // already inserted before the clash.
      expect(await harness.prisma.appointment.count()).toBe(3);
      expect(await harness.prisma.appointmentParticipant.count()).toBe(3);
      expect(await harness.prisma.appointmentSeries.count()).toBe(1);
      expect(
        await harness.prisma.auditLog.count({ where: { action: 'appointment.created' } }),
      ).toBe(3);
    }, 30000);

    it('lets a series creation and a single booking race for one hour, and gives it to one', async () => {
      // The single booking is for another child in the same room, on the middle
      // Saturday. Whichever lands first, the other is refused entirely.
      const otherTherapist = await makeTherapist(harness, manager.token, [clinic.serviceId]);
      const otherFamily = await makeFamilyWithChild(harness, manager.token);
      await putWindows(harness, manager.token, otherTherapist, [SATURDAY_MORNING]);

      const [series, single] = await Promise.all([
        createSeries(harness, receptionist.token, seriesPayload(clinic)),
        book(
          harness,
          receptionist.token,
          payload({
            startsAt: '2026-09-12T06:30:00.000Z',
            therapistId: otherTherapist,
            childId: otherFamily.childId,
          }),
        ),
      ]);

      if (series.status === 201) {
        expect(single.status).toBe(409);
        expect(await harness.prisma.appointment.count()).toBe(3);
      } else {
        expect(series.status).toBe(409);
        expect(single.status).toBe(201);
        // Nothing survived the refused series, including the first Saturday it
        // had already written.
        expect(await harness.prisma.appointment.count()).toBe(1);
        expect(await harness.prisma.appointmentSeries.count()).toBe(0);
      }
    }, 30000);

    it('serialises two this-and-future cancellations of one series down to one', async () => {
      const series = await createSeriesOrThrow(harness, receptionist.token, seriesPayload(clinic));
      const from = series.occurrences[0]!.appointment.id;
      const body = { fromAppointmentId: from, cancelledBy: 'CLINIC', reason: 'تعطیلی درمانگاه' };

      const responses = await Promise.all([
        cancelSeriesFrom(harness, receptionist.token, series.series.id, body),
        cancelSeriesFrom(harness, receptionist.token, series.series.id, body),
      ]);

      // Both succeed — the second finds a tail somebody has already cancelled
      // and changes nothing — and exactly three cancellations are recorded.
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      expect(
        await harness.prisma.auditLog.count({ where: { action: 'appointment.cancelled' } }),
      ).toBe(3);
      expect(
        await harness.prisma.auditLog.count({ where: { action: 'appointment_series.updated' } }),
      ).toBe(1);
    }, 30000);

    it('decides a this-and-future update against the cancellation that committed first', async () => {
      const series = await createSeriesOrThrow(harness, receptionist.token, seriesPayload(clinic));
      const from = series.occurrences[0]!.appointment.id;

      const [cancelled, updated] = await Promise.all([
        cancelSeriesFrom(harness, receptionist.token, series.series.id, {
          fromAppointmentId: from,
          cancelledBy: 'CLINIC',
          reason: 'تعطیلی درمانگاه',
        }),
        updateSeriesFrom(harness, receptionist.token, series.series.id, {
          fromAppointmentId: from,
          durationMinutes: 45,
          therapistId: clinic.therapistId,
          roomId: clinic.roomId,
          startTime: '11:00',
          note: null,
          availabilityOverrideReason: null,
        }),
      ]);

      expect([cancelled.status, updated.status]).toEqual([200, 200]);

      // The two serialise on the series row, so one of them saw the other's
      // committed state: either every occurrence was moved and then cancelled,
      // or they were cancelled and the update found nothing eligible. What
      // cannot happen is a cancelled occurrence that also moved after the fact.
      const rows = await harness.prisma.appointment.findMany({
        where: { seriesId: series.series.id },
        orderBy: { startsAt: 'asc' },
      });

      expect(rows).toHaveLength(3);
      expect(rows.every((row) => row.status === 'CANCELLED_BY_CLINIC')).toBe(true);

      const moves = await harness.prisma.auditLog.count({
        where: { action: 'appointment.updated' },
      });
      const movedHour = rows.filter((row) => row.startsAt.toISOString().endsWith('07:30:00.000Z'));

      expect(movedHour).toHaveLength(moves === 0 ? 0 : 3);
    }, 30000);
  });
});
