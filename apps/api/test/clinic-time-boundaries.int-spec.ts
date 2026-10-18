import request from 'supertest';
import { appointmentDayResponseSchema, sessionReportResponseSchema } from '@clinic/contracts';
import {
  asUser,
  bookId,
  bookingPayload,
  complete,
  makeTariff,
  recordAttendance,
  seedClinic,
  signIn,
} from './appointments-support';
import { createHarness, ownerPrisma, resetDatabase, type Harness } from './harness';

/**
 * BUSINESS TIME IS TEHRAN, WHATEVER THE HOST, THE PROCESS OR THE SESSION SAYS.
 *
 * Owner decision (Milestone 10, A3 close-out): the production server runs in
 * UTC and the clinic's business time is Asia/Tehran. Every business date must be
 * decided in Tehran explicitly. This suite is the regression guard for that, and
 * it makes the environment as hostile as it can:
 *
 *   * THE DATABASE SESSION runs in `Pacific/Kiritimati` (UTC+14): this suite
 *     sets it as the database default before the API connects, so every pooled
 *     connection the application opens has it. A date taken from the session
 *     timezone is then a day LATER than Tehran for most of every day.
 *   * THE NODE PROCESS runs in whatever the run uses — UTC in CI and on the
 *     server, Tehran on a developer's machine. The instants below are chosen so
 *     that UTC gives the WRONG calendar day for half of them.
 *
 * Four sessions straddle Tehran midnight at two boundaries that matter:
 *
 *   * the last night of Jalali 1404 — 2026-03-20 23:00 Tehran (19:30 UTC) and
 *     2026-03-21 00:15 Tehran, Nowruz (20:45 UTC — still the 20th in UTC);
 *   * a Gregorian month end — 2026-01-31 23:00 Tehran and 2026-02-01 00:15. (A session may not cross
 *     Tehran midnight — a rule of its own — so each ends inside its day.)
 *
 * and each is followed through the day view, the charge the completion posts
 * and the session report's date range. Retention clocks (90 and 30 days) and
 * session expiry are measured between INSTANTS, not calendar days, and need no
 * zone at all; the nightly schedules name `Asia/Tehran` in their timers.
 *
 * Everything is synthetic.
 */
describe('business time at Tehran midnight, under a hostile timezone (real PostgreSQL)', () => {
  let harness: Harness;
  let database: string;

  const HOSTILE_SESSION_ZONE = 'Pacific/Kiritimati';

  const SESSIONS = {
    lastNightOf1404: { startsAt: '2026-03-20T19:30:00.000Z', clinicDay: '2026-03-20' },
    nowruz: { startsAt: '2026-03-20T20:45:00.000Z', clinicDay: '2026-03-21' },
    januaryLastNight: { startsAt: '2026-01-31T19:30:00.000Z', clinicDay: '2026-01-31' },
    februaryFirstMorning: { startsAt: '2026-01-31T20:45:00.000Z', clinicDay: '2026-02-01' },
  } as const;

  type Name = keyof typeof SESSIONS;

  let token: string;
  const ids = {} as Record<Name, { appointmentId: string; participantId: string }>;

  beforeAll(async () => {
    const rows = await ownerPrisma().$queryRaw<{ name: string }[]>`
      SELECT current_database() AS name
    `;
    database = rows[0]!.name;
    await ownerPrisma().$executeRawUnsafe(
      `ALTER DATABASE "${database}" SET timezone TO '${HOSTILE_SESSION_ZONE}'`,
    );

    // Created after the default changed, so every connection it opens has it.
    harness = await createHarness();
  }, 60_000);

  afterAll(async () => {
    await harness.close();
    await ownerPrisma().$executeRawUnsafe(`ALTER DATABASE "${database}" RESET timezone`);
  });

  beforeEach(async () => {
    await resetDatabase();

    const manager = await signIn(harness, 'MANAGER');
    token = manager.token;
    const clinic = await seedClinic(harness, token);
    await makeTariff(harness, token, {
      serviceId: clinic.serviceId,
      durationMinutes: 45,
      priceToman: '250000',
      effectiveStart: '2025-12-01',
    });

    for (const [name, session] of Object.entries(SESSIONS) as [Name, (typeof SESSIONS)[Name]][]) {
      // Late at night is outside any working window: the manager's recorded
      // override is the product's own way to book it.
      const appointmentId = await bookId(
        harness,
        token,
        bookingPayload(clinic, {
          startsAt: session.startsAt,
          availabilityOverrideReason: 'جلسهٔ دیروقت برای آزمون مرز روز',
        }),
      );
      const participant = await harness.prisma.appointmentParticipant.findFirstOrThrow({
        where: { appointmentId },
      });
      await recordAttendance(harness, token, appointmentId, participant.id, 'ATTENDED').expect(200);
      await complete(harness, token, appointmentId).expect(200);
      ids[name] = { appointmentId, participantId: participant.id };
    }
  });

  it('really is running with a session timezone that is not Tehran', async () => {
    const rows = await harness.prisma.$queryRaw<
      { zone: string }[]
    >`SELECT current_setting('TimeZone') AS zone`;
    expect(rows[0]?.zone).toBe(HOSTILE_SESSION_ZONE);
  });

  it('puts each session on its Tehran day in the diary', async () => {
    const day = async (date: string) =>
      appointmentDayResponseSchema.parse(
        (
          await request(harness.app.getHttpServer())
            .get('/appointment-day')
            .query({ date })
            .set(asUser(token))
        ).body,
      );

    for (const [name, session] of Object.entries(SESSIONS) as [Name, (typeof SESSIONS)[Name]][]) {
      const listed = JSON.stringify((await day(session.clinicDay)).appointments);
      expect({ name, onItsDay: listed.includes(ids[name].appointmentId) }).toEqual({
        name,
        onItsDay: true,
      });
    }

    // And not on the neighbouring day that UTC, or the session zone, would pick.
    const twentieth = JSON.stringify((await day('2026-03-20')).appointments);
    expect(twentieth).not.toContain(ids.nowruz.appointmentId);
    const twentyFirst = JSON.stringify((await day('2026-03-21')).appointments);
    expect(twentyFirst).not.toContain(ids.lastNightOf1404.appointmentId);
  });

  it('dates the charge the completion posts on the Tehran day', async () => {
    for (const [name, session] of Object.entries(SESSIONS) as [Name, (typeof SESSIONS)[Name]][]) {
      const rows = await harness.prisma.$queryRaw<{ service_date: string }[]>`
        SELECT service_date::text AS service_date FROM session_charge
        WHERE appointment_participant_id = ${ids[name].participantId}::uuid
          AND voided_at IS NULL
      `;
      expect({ name, date: rows[0]?.service_date }).toEqual({ name, date: session.clinicDay });
    }
  });

  it('keeps each session inside its own day and month in the session report', async () => {
    const report = async (from: string, to: string) =>
      sessionReportResponseSchema.parse(
        (
          await request(harness.app.getHttpServer())
            .get('/reports/sessions')
            .query({ from, to })
            .set(asUser(token))
        ).body,
      );

    const onlyThe20th = await report('2026-03-20', '2026-03-20');
    expect(onlyThe20th.sessions.map((row) => [row.appointmentId, row.date])).toEqual([
      [ids.lastNightOf1404.appointmentId, '2026-03-20'],
    ]);

    const nowruz = await report('2026-03-21', '2026-03-21');
    expect(nowruz.sessions.map((row) => [row.appointmentId, row.date])).toEqual([
      [ids.nowruz.appointmentId, '2026-03-21'],
    ]);

    const january = await report('2026-01-01', '2026-01-31');
    expect(january.sessions.map((row) => row.appointmentId)).toEqual([
      ids.januaryLastNight.appointmentId,
    ]);

    const february = await report('2026-02-01', '2026-02-28');
    expect(february.sessions.map((row) => row.appointmentId)).toEqual([
      ids.februaryFirstMorning.appointmentId,
    ]);
  });
});
