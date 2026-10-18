import request from 'supertest';
import {
  appointmentOutcomeTimingDetailsSchema,
  appointmentResponseSchema,
} from '@clinic/contracts';
import { createHarness, resetDatabase, type Harness } from './harness';
import {
  asUser,
  bookId,
  bookingPayload,
  complete,
  makeTariff,
  putWindows,
  recordAttendance,
  SATURDAY_10_00,
  seedClinic,
  signIn,
} from './appointments-support';

/**
 * No outcome for a session that has not happened yet (M10-A10, T-020), over
 * real HTTP against real PostgreSQL.
 *
 * The rule is decided by the DATABASE clock in Asia/Tehran, so the instants
 * here are computed by the database too: "today at a later minute" and "today,
 * already started" are read from `clinic_date(now())` and `now()`, never from
 * Node. The therapist works every hour of every day in this suite, so
 * availability never decides anything here.
 *
 * Late in the clinic's evening a session "later today" no longer fits before
 * midnight; the cases that need one then check the same refusal on tomorrow's
 * session instead, which is the stronger form of the same rule.
 */
describe('appointment outcome timing (real PostgreSQL)', () => {
  let harness: Harness;
  let manager: { id: string; token: string };
  let receptionist: { id: string; token: string };
  let clinic: Awaited<ReturnType<typeof seedClinic>>;

  const ALL_DAY = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    startTime: '00:00',
    endTime: '23:59',
  }));

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
    expect((await putWindows(harness, manager.token, clinic.therapistId, ALL_DAY)).status).toBe(
      200,
    );
    await makeTariff(harness, manager.token, { serviceId: clinic.serviceId });
  });

  /** Instants on the database clock, whole minutes, as the booking requires. */
  async function clock(): Promise<{
    today: string;
    laterToday: string | null;
    startedToday: string;
    tomorrow: string;
  }> {
    const rows = await harness.prisma.$queryRaw<
      { today: string; later: Date; later_date: string; started: Date; tomorrow: Date }[]
    >`
      SELECT clinic_date(now())::text AS today,
             date_trunc('minute', now()) + interval '3 minutes' AS later,
             clinic_date(date_trunc('minute', now()) + interval '48 minutes')::text AS later_date,
             date_trunc('minute', now()) - interval '1 minute' AS started,
             clinic_moment(clinic_date(now()) + 1, '10:00'::time) AS tomorrow
    `;
    const row = rows[0]!;

    return {
      today: row.today,
      // A 45-minute session starting three minutes from now must end today.
      laterToday: row.later_date === row.today ? row.later.toISOString() : null,
      startedToday: row.started.toISOString(),
      tomorrow: row.tomorrow.toISOString(),
    };
  }

  const bookAt = (startsAt: string) =>
    bookId(harness, receptionist.token, bookingPayload(clinic, { startsAt, durationMinutes: 45 }));

  const seatOf = async (id: string): Promise<string> => {
    const read = await request(harness.app.getHttpServer())
      .get(`/appointments/${id}`)
      .set(asUser(receptionist.token));
    return appointmentResponseSchema.parse(read.body).participants[0]!.id;
  };

  const charges = async () =>
    (await harness.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM session_charge`)[0]!
      .n;

  describe('a session on a later date', () => {
    it('refuses completion, attendance and no-show, for both roles, and charges nothing', async () => {
      const { tomorrow, today } = await clock();
      const id = await bookAt(tomorrow);
      const seat = await seatOf(id);

      for (const token of [manager.token, receptionist.token]) {
        const completed = await complete(harness, token, id);
        expect(completed.status).toBe(422);
        expect(completed.body.error.code).toBe('APPOINTMENT_OUTCOME_DATE_IN_FUTURE');
        const details = appointmentOutcomeTimingDetailsSchema.parse(completed.body.error.details);
        expect(details).toMatchObject({ outcome: 'COMPLETED', startTime: '10:00', today });
        expect(details.sessionDate > today).toBe(true);
        expect(details.startsAt).toBe(tomorrow);

        for (const attendance of ['ATTENDED', 'NO_SHOW']) {
          const recorded = await recordAttendance(harness, token, id, seat, attendance);
          expect(recorded.status).toBe(422);
          expect(recorded.body.error.code).toBe('APPOINTMENT_OUTCOME_DATE_IN_FUTURE');
          expect(recorded.body.error.details.outcome).toBe(attendance);
        }
      }

      const row = await harness.prisma.appointment.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe('SCHEDULED');
      const seatRow = await harness.prisma.appointmentParticipant.findUniqueOrThrow({
        where: { id: seat },
      });
      expect(seatRow.attendance).toBe('PENDING');
      expect(await charges()).toBe(0n);
      expect(
        await harness.prisma.auditLog.count({
          where: {
            action: { in: ['appointment.completed', 'appointment.attendance_recorded'] },
          },
        }),
      ).toBe(0);
    });
  });

  describe('a session on today’s date', () => {
    it('records an arrival before the start but refuses completion and no-show', async () => {
      const { laterToday, tomorrow } = await clock();
      const id = await bookAt(laterToday ?? tomorrow);
      const seat = await seatOf(id);

      const noShow = await recordAttendance(harness, receptionist.token, id, seat, 'NO_SHOW');
      const completed = await complete(harness, receptionist.token, id);

      if (laterToday === null) {
        // Too late in the evening for a session later today: tomorrow's
        // session is refused outright, which is the same rule on its next day.
        expect(noShow.body.error.code).toBe('APPOINTMENT_OUTCOME_DATE_IN_FUTURE');
        expect(completed.body.error.code).toBe('APPOINTMENT_OUTCOME_DATE_IN_FUTURE');
        return;
      }

      expect(noShow.status).toBe(422);
      expect(noShow.body.error.code).toBe('APPOINTMENT_OUTCOME_BEFORE_START');
      expect(completed.status).toBe(422);
      expect(completed.body.error.code).toBe('APPOINTMENT_OUTCOME_BEFORE_START');
      expect(
        appointmentOutcomeTimingDetailsSchema.parse(completed.body.error.details).startsAt,
      ).toBe(laterToday);

      const arrived = await recordAttendance(harness, receptionist.token, id, seat, 'ATTENDED');
      expect(arrived.status).toBe(200);
      expect(appointmentResponseSchema.parse(arrived.body).participants[0]?.attendance).toBe(
        'ATTENDED',
      );
      // Attended but not completed: still no charge.
      expect(await charges()).toBe(0n);
    });

    it('records everything once the session has started, and the charge follows', async () => {
      const { startedToday } = await clock();
      const id = await bookAt(startedToday);
      const seat = await seatOf(id);

      expect(
        (await recordAttendance(harness, receptionist.token, id, seat, 'ATTENDED')).status,
      ).toBe(200);
      expect((await complete(harness, receptionist.token, id)).status).toBe(200);
      expect(await charges()).toBe(1n);
    });

    it('allows a no-show once the session has started', async () => {
      const { startedToday } = await clock();
      const id = await bookAt(startedToday);
      const seat = await seatOf(id);

      expect(
        (await recordAttendance(harness, receptionist.token, id, seat, 'NO_SHOW')).status,
      ).toBe(200);
      expect(await charges()).toBe(0n);
    });
  });

  describe('a past session', () => {
    it('takes every outcome late, as the desk records it afterwards', async () => {
      const id = await bookAt(SATURDAY_10_00);
      const seat = await seatOf(id);

      expect((await complete(harness, receptionist.token, id)).status).toBe(200);
      expect(
        (await recordAttendance(harness, receptionist.token, id, seat, 'NO_SHOW')).status,
      ).toBe(200);
      expect(
        (await recordAttendance(harness, receptionist.token, id, seat, 'ATTENDED')).status,
      ).toBe(200);
      expect(await charges()).toBe(1n);
    });
  });

  it('keeps a repeated completion a no-op, and a cancelled session a transition refusal', async () => {
    const { tomorrow } = await clock();
    const past = await bookAt(SATURDAY_10_00);
    expect((await complete(harness, receptionist.token, past)).status).toBe(200);
    expect((await complete(harness, receptionist.token, past)).status).toBe(200);

    const future = await bookAt(tomorrow);
    const cancelled = await request(harness.app.getHttpServer())
      .post(`/appointments/${future}/cancel`)
      .set(asUser(receptionist.token))
      .send({ cancelledBy: 'FAMILY', reason: 'لغو نمونه' });
    expect(cancelled.status).toBe(200);
    expect((await complete(harness, receptionist.token, future)).body.error.code).toBe(
      'APPOINTMENT_TRANSITION_INVALID',
    );
  });
});
