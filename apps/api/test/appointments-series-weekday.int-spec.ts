import request from 'supertest';
import {
  appointmentConflictDetailsSchema,
  appointmentSeriesOperationResponseSchema,
  seriesUpdatePreviewResponseSchema,
} from '@clinic/contracts';
import { createHarness, resetDatabase, type Harness } from './harness';
import {
  asUser,
  bookId,
  bookingPayload,
  createSeriesOrThrow,
  makeFamilyWithChild,
  makeTherapist,
  putWindows,
  readSeries,
  SATURDAY_10_00,
  SATURDAY_MORNING,
  seedClinic,
  seriesPayload,
  signIn,
  updateSeriesFrom,
} from './appointments-support';

/**
 * "This and future" may move the weekday (M10-A10, T-023), over real HTTP
 * against real PostgreSQL.
 *
 * The series is the suite's usual three Saturdays at 10:00 — 2026-09-05, -12
 * and -19. Saturday-first numbering: Saturday 0, Sunday 1, Monday 2. Monday
 * 16:00 Tehran is 12:30 UTC.
 */
describe('series weekday change (real PostgreSQL)', () => {
  let harness: Harness;
  let manager: { id: string; token: string };
  let receptionist: { id: string; token: string };
  let clinic: Awaited<ReturnType<typeof seedClinic>>;

  const MONDAY_AFTERNOON = { weekday: 2, startTime: '15:00', endTime: '19:00' };

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
    clinic = await seedClinic(harness, manager.token, {
      windows: [SATURDAY_MORNING, MONDAY_AFTERNOON],
    });
  });

  const preview = (seriesId: string, body: Record<string, unknown>) =>
    request(harness.app.getHttpServer())
      .post(`/appointment-series/${seriesId}/update-from/preview`)
      .set(asUser(receptionist.token))
      .send(body);

  const change = (pivot: string, overrides: Record<string, unknown> = {}) => ({
    fromAppointmentId: pivot,
    durationMinutes: 45,
    therapistId: clinic.therapistId,
    roomId: clinic.roomId,
    weekday: 2,
    startTime: '16:00',
    note: null,
    availabilityOverrideReason: null,
    ...overrides,
  });

  const starts = async (seriesId: string) =>
    appointmentSeriesOperationResponseSchema
      .omit({ changedAppointmentIds: true })
      .parse((await readSeries(harness, receptionist.token, seriesId)).body)
      .occurrences.map((each) => [each.appointment.startsAt, each.appointment.status]);

  it('previews, then moves the pivot and later weeks to Monday, leaving earlier ones alone', async () => {
    const series = await createSeriesOrThrow(harness, receptionist.token, seriesPayload(clinic));
    const ids = series.occurrences.map((each) => each.appointment.id);
    const before = await starts(series.series.id);

    const dry = await preview(series.series.id, change(ids[1]!));
    expect(dry.status).toBe(200);
    const findings = seriesUpdatePreviewResponseSchema.parse(dry.body);
    expect(findings.applicable).toBe(true);
    expect(
      findings.occurrences.map((each) => [each.appointmentId, each.date, each.startsAt]),
    ).toEqual([
      [ids[1], '2026-09-14', '2026-09-14T12:30:00.000Z'],
      [ids[2], '2026-09-21', '2026-09-21T12:30:00.000Z'],
    ]);
    // The preview wrote nothing.
    expect(await starts(series.series.id)).toEqual(before);

    const applied = await updateSeriesFrom(
      harness,
      receptionist.token,
      series.series.id,
      change(ids[1]!),
    );
    expect(applied.status).toBe(200);
    const body = appointmentSeriesOperationResponseSchema.parse(applied.body);
    expect(body.changedAppointmentIds).toEqual([ids[1], ids[2]]);
    expect(
      body.occurrences.map((each) => [each.appointment.id, each.appointment.startsAt]),
    ).toEqual([
      [ids[0], SATURDAY_10_00],
      [ids[1], '2026-09-14T12:30:00.000Z'],
      [ids[2], '2026-09-21T12:30:00.000Z'],
    ]);
    // Moved, not cancelled and rebooked: the same three rows, all scheduled.
    expect(body.occurrences.every((each) => each.appointment.status === 'SCHEDULED')).toBe(true);
    expect(await harness.prisma.appointment.count()).toBe(3);

    const seriesAudit = await harness.prisma.auditLog.findMany({
      where: { action: 'appointment_series.updated', entityId: series.series.id },
    });
    expect(seriesAudit).toHaveLength(1);
    expect(seriesAudit[0]?.metadata).toMatchObject({ operation: 'UPDATE_FROM', weekday: 2 });
    expect(
      await harness.prisma.auditLog.count({
        where: { action: 'appointment.updated', entityId: { in: [ids[1]!, ids[2]!] } },
      }),
    ).toBe(2);

    // Resubmitting the same change moves nothing and audits nothing.
    const again = await updateSeriesFrom(
      harness,
      receptionist.token,
      series.series.id,
      change(ids[1]!),
    );
    expect(
      appointmentSeriesOperationResponseSchema.parse(again.body).changedAppointmentIds,
    ).toEqual([]);
  });

  it('moves earlier in the week too, inside each occurrence’s own week', async () => {
    // Friday (6) of the Saturday-first week that starts 2026-09-12 is 2026-09-18.
    await putWindows(harness, manager.token, clinic.therapistId, [
      SATURDAY_MORNING,
      { weekday: 6, startTime: '09:00', endTime: '13:00' },
    ]);
    const series = await createSeriesOrThrow(harness, receptionist.token, seriesPayload(clinic));
    const ids = series.occurrences.map((each) => each.appointment.id);

    const applied = await updateSeriesFrom(
      harness,
      receptionist.token,
      series.series.id,
      change(ids[1]!, { weekday: 6, startTime: '10:00' }),
    );

    expect(applied.status).toBe(200);
    expect(
      appointmentSeriesOperationResponseSchema
        .parse(applied.body)
        .occurrences.map((each) => each.appointment.startsAt),
    ).toEqual([SATURDAY_10_00, '2026-09-18T06:30:00.000Z', '2026-09-25T06:30:00.000Z']);
  });

  it('refuses a weekday outside the therapist’s hours and says why, moving nothing', async () => {
    const series = await createSeriesOrThrow(harness, receptionist.token, seriesPayload(clinic));
    const ids = series.occurrences.map((each) => each.appointment.id);
    const before = await starts(series.series.id);
    const sunday = change(ids[1]!, { weekday: 1 });

    const findings = seriesUpdatePreviewResponseSchema.parse(
      (await preview(series.series.id, sunday)).body,
    );
    expect(findings.applicable).toBe(false);
    expect(
      findings.occurrences.map((each) => [each.outsideAvailabilityReason, each.blockedBy]),
    ).toEqual([
      ['OUTSIDE_WORKING_HOURS', 'APPOINTMENT_OUTSIDE_AVAILABILITY'],
      ['OUTSIDE_WORKING_HOURS', 'APPOINTMENT_OUTSIDE_AVAILABILITY'],
    ]);

    const refused = await updateSeriesFrom(harness, receptionist.token, series.series.id, sunday);
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('APPOINTMENT_OUTSIDE_AVAILABILITY');
    expect(refused.body.error.details).toMatchObject({
      reason: 'OUTSIDE_WORKING_HOURS',
      date: '2026-09-13',
      overridable: true,
    });
    expect(await starts(series.series.id)).toEqual(before);

    // With a stated reason, the same change is applied and recorded.
    const overridden = await updateSeriesFrom(harness, receptionist.token, series.series.id, {
      ...sunday,
      availabilityOverrideReason: 'درمانگر برای این دوره یکشنبه‌ها می‌آید',
    });
    expect(overridden.status).toBe(200);
  });

  it('checks every new week for conflicts, shows them first, and moves nothing if one clashes', async () => {
    const series = await createSeriesOrThrow(harness, receptionist.token, seriesPayload(clinic));
    const ids = series.occurrences.map((each) => each.appointment.id);
    const before = await starts(series.series.id);

    // Another child with another therapist holds the room on the second Monday.
    const other = await makeFamilyWithChild(harness, manager.token);
    const colleague = await makeTherapist(harness, manager.token, [clinic.serviceId]);
    await putWindows(harness, manager.token, colleague, [MONDAY_AFTERNOON]);
    const blocking = await bookId(
      harness,
      receptionist.token,
      bookingPayload(clinic, {
        childId: other.childId,
        therapistId: colleague,
        startsAt: '2026-09-21T12:30:00.000Z',
      }),
    );

    const findings = seriesUpdatePreviewResponseSchema.parse(
      (await preview(series.series.id, change(ids[1]!))).body,
    );
    expect(findings.blockedCount).toBe(1);
    expect(findings.occurrences[0]?.blockedBy).toBeNull();
    expect(findings.occurrences[1]?.blockedBy).toBe('APPOINTMENT_ROOM_CONFLICT');
    expect(findings.occurrences[1]?.conflicts).toEqual([
      expect.objectContaining({
        resource: 'ROOM',
        resourceId: clinic.roomId,
        appointmentId: blocking,
      }),
    ]);

    const refused = await updateSeriesFrom(
      harness,
      receptionist.token,
      series.series.id,
      change(ids[1]!),
    );
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('APPOINTMENT_ROOM_CONFLICT');
    expect(
      appointmentConflictDetailsSchema.parse(refused.body.error.details).conflicts[0]
        ?.appointmentId,
    ).toBe(blocking);
    expect(await starts(series.series.id)).toEqual(before);
  });

  it('never moves a session that has not started into the past', async () => {
    await putWindows(
      harness,
      manager.token,
      clinic.therapistId,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '00:00', endTime: '23:59' })),
    );
    const rows = await harness.prisma.$queryRaw<{ later: Date; fits: boolean; weekday: number }[]>`
      SELECT date_trunc('minute', now()) + interval '3 minutes' AS later,
             clinic_date(date_trunc('minute', now()) + interval '48 minutes') = clinic_date(now())
               AS fits,
             (EXTRACT(DOW FROM clinic_date(now()))::int + 1) % 7 AS weekday
    `;
    const now = rows[0]!;
    // Too late in the clinic's evening for a session later today; nothing to test.
    if (!now.fits) return;

    const series = await createSeriesOrThrow(
      harness,
      receptionist.token,
      seriesPayload(clinic, {
        startsAt: now.later.toISOString(),
        recurrence: { endMode: 'OCCURRENCE_COUNT', intervalWeeks: 1, occurrenceCount: 2 },
      }),
    );
    const ids = series.occurrences.map((each) => each.appointment.id);
    const toMidnight = change(ids[0]!, { weekday: now.weekday, startTime: '00:00' });

    const findings = seriesUpdatePreviewResponseSchema.parse(
      (await preview(series.series.id, toMidnight)).body,
    );
    expect(findings.occurrences.map((each) => each.blockedBy)).toEqual([
      'RECURRENCE_OCCURRENCE_IN_PAST',
      null,
    ]);

    const refused = await updateSeriesFrom(
      harness,
      receptionist.token,
      series.series.id,
      toMidnight,
    );
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('RECURRENCE_OCCURRENCE_IN_PAST');
    expect(refused.body.error.details.appointmentId).toBe(ids[0]);
  });

  it('keeps every date when no weekday is given, exactly as before', async () => {
    const series = await createSeriesOrThrow(harness, receptionist.token, seriesPayload(clinic));
    const ids = series.occurrences.map((each) => each.appointment.id);

    const applied = await updateSeriesFrom(
      harness,
      receptionist.token,
      series.series.id,
      change(ids[1]!, { weekday: null, startTime: '11:00' }),
    );
    expect(
      appointmentSeriesOperationResponseSchema
        .parse(applied.body)
        .occurrences.map((each) => each.appointment.startsAt),
    ).toEqual([SATURDAY_10_00, '2026-09-12T07:30:00.000Z', '2026-09-19T07:30:00.000Z']);
  });
});
