import request from 'supertest';
import {
  availabilityExceptionResponseSchema,
  closureConflictResponseSchema,
  recurrencePreviewResponseSchema,
  resolveAvailabilityResponseSchema,
} from '@clinic/contracts';
import { createHarness, resetDatabase, type Harness } from './harness';
import {
  asUser,
  book,
  bookId,
  bookingPayload,
  cancel,
  createSeriesOrThrow,
  makeFamilyWithChild,
  previewSeries,
  SATURDAY,
  SATURDAY_10_00,
  SATURDAY_11_00,
  seedClinic,
  seriesPayload,
  signIn,
} from './appointments-support';

/**
 * Partial-day closures (Milestone 10, checkpoint A9; tour item T-012).
 *
 * A closure with a time range behaves exactly as a whole-day closure does, but
 * only for its range: the resolved day loses it, a booking inside it is refused
 * unless overridden, and the sessions already sitting in it are surfaced —
 * never cancelled.
 *
 * Everything is synthetic. Times are the clinic's wall clock: SATURDAY_10_00 is
 * 06:30 UTC, which is 10:00 in Asia/Tehran, so a closure from 10:00 covers it
 * whatever timezone the suite runs in.
 */
describe('partial-day closures (real PostgreSQL)', () => {
  let harness: Harness;
  let manager: { id: string; token: string };
  let receptionist: { id: string; token: string };
  let clinic: Awaited<ReturnType<typeof seedClinic>>;

  const NEXT_SATURDAY = '2026-09-12';

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

  const server = () => harness.app.getHttpServer();

  const close = (
    body: Record<string, unknown>,
    token = manager.token,
    therapistId = clinic.therapistId,
  ) =>
    request(server())
      .post(`/availability/therapists/${therapistId}/exceptions`)
      .set(asUser(token))
      .send({ isAvailable: false, exceptionDate: SATURDAY, reason: null, ...body });

  const addWindow = (body: Record<string, unknown>) =>
    request(server())
      .post(`/availability/therapists/${clinic.therapistId}/exceptions`)
      .set(asUser(manager.token))
      .send({ isAvailable: true, exceptionDate: SATURDAY, reason: null, ...body });

  const resolve = async (date = SATURDAY) =>
    resolveAvailabilityResponseSchema.parse(
      (
        await request(server())
          .get('/availability/resolution')
          .query({ therapistId: clinic.therapistId, date })
          .set(asUser(manager.token))
      ).body,
    ).availability;

  const conflicts = (from: string, to: string, token = manager.token) =>
    request(server())
      .get(`/availability/therapists/${clinic.therapistId}/closure-conflicts`)
      .query({ from, to })
      .set(asUser(token));

  const payload = (overrides: Record<string, unknown> = {}) => bookingPayload(clinic, overrides);

  describe('recording one', () => {
    it('records a range on a date and takes only that range out of the day', async () => {
      const response = await close({ startTime: '11:00', endTime: '12:00', reason: 'جلسهٔ اداری' });

      expect(response.status).toBe(201);
      const { exception, affectedAppointments } = availabilityExceptionResponseSchema.parse(
        response.body,
      );
      expect(exception).toMatchObject({
        isAvailable: false,
        exceptionDate: SATURDAY,
        startTime: '11:00',
        endTime: '12:00',
        reason: 'جلسهٔ اداری',
      });
      expect(affectedAppointments).toEqual([]);

      const day = await resolve();
      // Not a whole-day closure: the flag keeps its meaning.
      expect(day.isClosed).toBe(false);
      expect(day.closedReason).toBeNull();
      expect(day.closedRanges).toEqual([
        { startTime: '11:00', endTime: '12:00', reason: 'جلسهٔ اداری' },
      ]);
      expect(day.windows).toEqual([
        { startTime: '09:00', endTime: '11:00' },
        { startTime: '12:00', endTime: '13:00' },
      ]);

      // Another date is untouched.
      expect((await resolve(NEXT_SATURDAY)).windows).toEqual([
        { startTime: '09:00', endTime: '13:00' },
      ]);
    });

    it('states "leaves at 11:00" and "arrives at 10:00" as ranges to the day’s edge', async () => {
      expect((await close({ startTime: '11:00', endTime: '23:59' })).status).toBe(201);
      expect((await close({ startTime: '00:00', endTime: '10:00' })).status).toBe(201);

      const day = await resolve();
      expect(day.windows).toEqual([{ startTime: '10:00', endTime: '11:00' }]);
      expect(day.closedRanges.map((range) => range.startTime)).toEqual(['00:00', '11:00']);
    });

    it('still records a whole-day closure exactly as before, with absent or null times', async () => {
      const absent = await close({});
      expect(absent.status).toBe(201);
      expect(availabilityExceptionResponseSchema.parse(absent.body).exception.startTime).toBeNull();
      expect((await resolve()).isClosed).toBe(true);

      const nulls = await close({ exceptionDate: NEXT_SATURDAY, startTime: null, endTime: null });
      expect(nulls.status).toBe(201);
      expect(availabilityExceptionResponseSchema.parse(nulls.body).exception.endTime).toBeNull();
      expect((await resolve(NEXT_SATURDAY)).windows).toEqual([]);
    });

    it('refuses an invalid range before writing anything', async () => {
      for (const range of [
        { startTime: '12:00', endTime: '11:00' },
        { startTime: '12:00', endTime: '12:00' },
        { startTime: '12:00' },
        { endTime: '12:00' },
        { startTime: '12:00', endTime: null },
        // Outside the day: the clock stops at 23:59.
        { startTime: '22:00', endTime: '24:00' },
        { startTime: '09:00:30', endTime: '10:00' },
      ]) {
        const response = await close(range);
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      }

      expect(await harness.prisma.therapistAvailabilityException.count()).toBe(0);
    });
  });

  describe('overlapping closures and windows on one date', () => {
    it('refuses overlapping closures, allows back-to-back ones', async () => {
      expect((await close({ startTime: '10:00', endTime: '11:00' })).status).toBe(201);

      const overlapping = await close({ startTime: '10:30', endTime: '11:30' });
      expect(overlapping.status).toBe(409);
      expect(overlapping.body.error.code).toBe('AVAILABILITY_EXCEPTION_CONFLICT');

      const containing = await close({ startTime: '09:00', endTime: '12:00' });
      expect(containing.status).toBe(409);

      expect((await close({ startTime: '11:00', endTime: '12:00' })).status).toBe(201);

      // Back-to-back closures read as one stretch.
      expect((await resolve()).windows).toEqual([
        { startTime: '09:00', endTime: '10:00' },
        { startTime: '12:00', endTime: '13:00' },
      ]);
    });

    it('refuses a whole-day closure beside a partial one, in either order', async () => {
      expect((await close({ startTime: '10:00', endTime: '11:00' })).status).toBe(201);
      const whole = await close({});
      expect(whole.status).toBe(409);
      expect(whole.body.error.code).toBe('AVAILABILITY_EXCEPTION_CONFLICT');

      expect((await close({ exceptionDate: NEXT_SATURDAY })).status).toBe(201);
      const partial = await close({
        exceptionDate: NEXT_SATURDAY,
        startTime: '10:00',
        endTime: '11:00',
      });
      expect(partial.status).toBe(409);

      // And a second whole-day closure, which the old unique index refused.
      expect((await close({ exceptionDate: NEXT_SATURDAY })).status).toBe(409);
    });

    it('refuses a partial closure over an extra window, in either order', async () => {
      expect((await addWindow({ startTime: '15:00', endTime: '17:00' })).status).toBe(201);
      const over = await close({ startTime: '16:00', endTime: '18:00' });
      expect(over.status).toBe(409);
      expect(over.body.error.code).toBe('AVAILABILITY_EXCEPTION_CONFLICT');

      expect((await close({ startTime: '10:00', endTime: '11:00' })).status).toBe(201);
      const under = await addWindow({ startTime: '10:30', endTime: '11:30' });
      expect(under.status).toBe(409);
      expect(under.body.error.code).toBe('AVAILABILITY_EXCEPTION_CONFLICT');

      // Touching is not overlapping.
      expect((await addWindow({ startTime: '17:00', endTime: '18:00' })).status).toBe(201);
    });

    it('still allows a whole-day closure beside an extra window', async () => {
      expect((await addWindow({ startTime: '15:00', endTime: '17:00' })).status).toBe(201);
      expect((await close({})).status).toBe(201);
      expect((await resolve()).windows).toEqual([{ startTime: '15:00', endTime: '17:00' }]);
    });
  });

  describe('booking inside a closed range', () => {
    it('is refused, as on a closed day, and allowed only with a recorded override', async () => {
      expect((await close({ startTime: '10:00', endTime: '11:00' })).status).toBe(201);

      const refused = await book(harness, receptionist.token, payload());
      expect(refused.status).toBe(422);
      expect(refused.body.error.code).toBe('APPOINTMENT_OUTSIDE_AVAILABILITY');

      // Straddling the edge of the range is still inside it.
      const straddling = await book(
        harness,
        receptionist.token,
        payload({ startsAt: '2026-09-05T07:00:00.000Z' }),
      );
      expect(straddling.status).toBe(422);

      // Outside the range, the rest of the morning books as usual.
      expect(
        (await book(harness, receptionist.token, payload({ startsAt: SATURDAY_11_00 }))).status,
      ).toBe(201);

      const other = await makeFamilyWithChild(harness, manager.token);
      const overridden = await book(
        harness,
        receptionist.token,
        payload({ childId: other.childId, availabilityOverrideReason: 'جلسهٔ جبرانی' }),
      );
      expect(overridden.status).toBe(201);

      const audit = await harness.prisma.auditLog.findMany({
        where: {
          action: 'appointment.created',
          metadata: { path: ['availabilityOverride'], equals: true },
        },
      });
      expect(audit).toHaveLength(1);
      const metadata = audit[0]?.metadata as Record<string, unknown>;
      expect(metadata['isClosed']).toBe(false);
      expect(metadata['closedRanges']).toEqual([{ startTime: '10:00', endTime: '11:00' }]);
      expect(metadata['availableWindows']).toEqual([
        { startTime: '09:00', endTime: '10:00' },
        { startTime: '11:00', endTime: '13:00' },
      ]);
    });

    it('marks the closed week outside availability in a recurrence preview', async () => {
      expect(
        (await close({ exceptionDate: NEXT_SATURDAY, startTime: '10:00', endTime: '10:30' }))
          .status,
      ).toBe(201);

      const preview = recurrencePreviewResponseSchema.parse(
        (await previewSeries(harness, receptionist.token, seriesPayload(clinic))).body,
      );

      expect(preview.occurrences.map((one) => [one.date, one.outsideAvailability])).toEqual([
        [SATURDAY, false],
        [NEXT_SATURDAY, true],
        ['2026-09-19', false],
      ]);
    });
  });

  describe('sessions already in the closed range', () => {
    it('surfaces them with the closure and afterwards, and cancels nothing', async () => {
      // 10:00 one-off; an 11:00 weekly series for another child; a 09:00 one-off
      // that the closure does not reach; and a cancelled session in the range.
      const oneOff = await bookId(harness, receptionist.token, payload());
      const second = await makeFamilyWithChild(harness, manager.token, { firstName: 'دوم' });
      const series = await createSeriesOrThrow(
        harness,
        receptionist.token,
        seriesPayload(clinic, { childId: second.childId, startsAt: SATURDAY_11_00 }),
      );
      const third = await makeFamilyWithChild(harness, manager.token);
      await bookId(harness, receptionist.token, {
        ...payload({ childId: third.childId, startsAt: '2026-09-05T05:30:00.000Z' }),
      });
      const fourth = await makeFamilyWithChild(harness, manager.token);
      const cancelledId = await bookId(
        harness,
        receptionist.token,
        payload({ childId: fourth.childId, startsAt: '2026-09-05T08:30:00.000Z' }),
      );
      await cancel(harness, receptionist.token, cancelledId, {
        cancelledBy: 'FAMILY',
        reason: 'نمونه',
      });

      const response = await close({ startTime: '10:30', endTime: '12:30', reason: 'نمونه' });
      expect(response.status).toBe(201);
      const { affectedAppointments } = availabilityExceptionResponseSchema.parse(response.body);

      const firstOccurrence = series.occurrences[0]!.appointment.id;
      expect(
        affectedAppointments.map((one) => [one.appointmentId, one.seriesId, one.startTime]),
      ).toEqual([
        [oneOff, null, '10:00'],
        [firstOccurrence, series.series.id, '11:00'],
      ]);
      expect(affectedAppointments[0]).toMatchObject({
        date: SATURDAY,
        endTime: '10:45',
        startsAt: SATURDAY_10_00,
        availabilityOverrideReason: null,
      });
      expect(affectedAppointments[1]!.children.map((child) => child.id)).toEqual([second.childId]);
      expect(affectedAppointments[1]!.children[0]).toMatchObject({
        familyId: second.familyId,
        firstName: 'دوم',
      });

      // Nothing was cancelled or moved.
      const statuses = await harness.prisma.appointment.findMany({
        where: { id: { in: [oneOff, firstOccurrence] } },
        select: { status: true, startsAt: true },
      });
      expect(statuses.map((one) => one.status)).toEqual(['SCHEDULED', 'SCHEDULED']);

      // A whole-day closure the next Saturday reaches the series there too, and
      // the read lists both dates.
      const whole = await close({ exceptionDate: NEXT_SATURDAY });
      expect(
        availabilityExceptionResponseSchema
          .parse(whole.body)
          .affectedAppointments.map((one) => one.appointmentId),
      ).toEqual([series.occurrences[1]!.appointment.id]);

      const read = await conflicts(SATURDAY, '2026-09-30');
      expect(read.status).toBe(200);
      expect(
        closureConflictResponseSchema.parse(read.body).appointments.map((one) => one.date),
      ).toEqual([SATURDAY, SATURDAY, NEXT_SATURDAY]);

      // Removing the closure removes the conflict: it was never stored.
      const exceptionId = availabilityExceptionResponseSchema.parse(whole.body).exception.id;
      await request(server())
        .delete(`/availability/therapists/${clinic.therapistId}/exceptions/${exceptionId}`)
        .set(asUser(manager.token))
        .expect(204);
      expect(
        closureConflictResponseSchema.parse((await conflicts(NEXT_SATURDAY, NEXT_SATURDAY)).body)
          .appointments,
      ).toEqual([]);
    });

    it('does not report a session an extra window still covers on a closed day', async () => {
      await bookId(harness, receptionist.token, payload());
      expect((await addWindow({ startTime: '09:30', endTime: '11:00' })).status).toBe(201);

      const closed = await close({});
      expect(availabilityExceptionResponseSchema.parse(closed.body).affectedAppointments).toEqual(
        [],
      );
    });

    it('reports an overridden session, saying it was placed deliberately', async () => {
      expect((await close({ startTime: '10:00', endTime: '11:00' })).status).toBe(201);
      await bookId(
        harness,
        receptionist.token,
        payload({ availabilityOverrideReason: 'جلسهٔ جبرانی' }),
      );

      const read = closureConflictResponseSchema.parse((await conflicts(SATURDAY, SATURDAY)).body);
      expect(read.appointments.map((one) => one.availabilityOverrideReason)).toEqual([
        'جلسهٔ جبرانی',
      ]);
    });

    it('requires both bounds and refuses an inverted range', async () => {
      expect((await conflicts('2026-09-10', '2026-09-01')).status).toBe(400);
      expect(
        (
          await request(server())
            .get(`/availability/therapists/${clinic.therapistId}/closure-conflicts`)
            .query({ from: SATURDAY })
            .set(asUser(manager.token))
        ).status,
      ).toBe(400);
      expect((await conflicts('2026-01-01', '2026-12-31')).status).toBe(200);
    });
  });

  describe('authority and audit', () => {
    it('lets only the manager close part of a day; the conflict read is a schedule read', async () => {
      const refused = await close({ startTime: '10:00', endTime: '11:00' }, receptionist.token);
      expect(refused.status).toBe(403);

      expect((await conflicts(SATURDAY, SATURDAY, receptionist.token)).status).toBe(200);
    });

    it('audits a partial closure like a whole-day one, with its range', async () => {
      const created = availabilityExceptionResponseSchema.parse(
        (await close({ startTime: '10:00', endTime: '11:00', reason: 'نمونه' })).body,
      ).exception;

      await request(server())
        .delete(`/availability/therapists/${clinic.therapistId}/exceptions/${created.id}`)
        .set(asUser(manager.token))
        .expect(204);

      const rows = await harness.prisma.auditLog.findMany({
        where: { action: 'therapist_availability.updated', entityId: clinic.therapistId },
        orderBy: { occurredAt: 'asc' },
      });
      const exceptionRows = rows.filter(
        (row) => (row.metadata as Record<string, unknown>)['change'] !== 'windows_replaced',
      );

      expect(
        exceptionRows.map((row) => (row.metadata as Record<string, unknown>)['change']),
      ).toEqual(['exception_added', 'exception_removed']);
      expect(exceptionRows[0]?.actorUserId).toBe(manager.id);
      const fact = {
        id: created.id,
        exceptionDate: SATURDAY,
        isAvailable: false,
        startTime: '10:00',
        endTime: '11:00',
        reason: 'نمونه',
      };
      expect((exceptionRows[0]?.after as Record<string, unknown>)['exception']).toEqual(fact);
      expect((exceptionRows[1]?.before as Record<string, unknown>)['exception']).toEqual(fact);
    });
  });
});
