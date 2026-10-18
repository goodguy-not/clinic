import request from 'supertest';
import {
  appointmentResponseSchema,
  appointmentSeriesOperationResponseSchema,
  appointmentSeriesResponseSchema,
  RECURRENCE_OCCURRENCES_MAX,
  recurrencePreviewResponseSchema,
  type CreateAppointmentSeriesRequest,
} from '@clinic/contracts';
import { AppointmentSeriesService } from '../src/appointments/appointment-series.service';
import { actorSession, auditContext, createHarness, resetDatabase, type Harness } from './harness';
import {
  asUser,
  book,
  bookingPayload,
  cancel,
  cancelSeriesFrom,
  complete,
  createSeries,
  createSeriesOrThrow,
  makeFamilyWithChild,
  makeRoom,
  makeService,
  makeTherapist,
  move,
  movePayload,
  previewSeries,
  putWindows,
  readSeries,
  SATURDAY_10_00,
  SATURDAY_11_00,
  SATURDAY_MORNING,
  seedClinic,
  seriesPayload,
  signIn,
  updateSeriesFrom,
} from './appointments-support';

/**
 * Weekly recurrence, over real HTTP against real PostgreSQL.
 *
 * Everything is synthetic. 2026-09-05 is a Saturday and the default series is
 * three consecutive Saturdays at 10:00 Tehran, all inside the therapist's
 * 09:00–13:00 week.
 *
 * WHAT THIS SUITE ASSERTS ABOVE ALL: that a series is booked by the rules a
 * single appointment is booked by, that creation is all-or-nothing, and that a
 * this-and-future operation never rewrites a session that already happened.
 */
describe('appointment recurrence (real PostgreSQL)', () => {
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

  const SATURDAYS = ['2026-09-05', '2026-09-12', '2026-09-19'];
  const SECOND_SATURDAY_10_00 = '2026-09-12T06:30:00.000Z';
  const THIRD_SATURDAY_10_00 = '2026-09-19T06:30:00.000Z';

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

  const payload = (overrides: Record<string, unknown> = {}) => seriesPayload(clinic, overrides);

  describe('creating a series', () => {
    it('books one occurrence per week, each with its own seat and its own id', async () => {
      const response = await createSeries(harness, receptionist.token, payload());

      expect(response.status).toBe(201);

      const body = appointmentSeriesResponseSchema.parse(response.body);

      expect(body.series.intervalWeeks).toBe(1);
      expect(body.series.endMode).toBe('OCCURRENCE_COUNT');
      expect(body.series.occurrenceCount).toBe(3);
      expect(body.series.endsOn).toBeNull();
      expect(body.series.startsOn).toBe(SATURDAYS[0]);

      expect(body.occurrences).toHaveLength(3);
      expect(body.occurrences.map((each) => each.appointment.startsAt)).toEqual([
        SATURDAY_10_00,
        SECOND_SATURDAY_10_00,
        THIRD_SATURDAY_10_00,
      ]);

      // Every occurrence is an ordinary appointment: its own id, its own
      // pending seat, and a status of its own.
      expect(new Set(body.occurrences.map((each) => each.appointment.id)).size).toBe(3);

      for (const occurrence of body.occurrences) {
        expect(occurrence.appointment.status).toBe('SCHEDULED');
        expect(occurrence.appointment.seriesId).toBe(body.series.id);
        expect(occurrence.participants).toHaveLength(1);
        expect(occurrence.participants[0]?.childId).toBe(clinic.childId);
        expect(occurrence.participants[0]?.attendance).toBe('PENDING');
      }
    });

    it('repeats the wall-clock hour rather than adding seven days of seconds', async () => {
      const body = await createSeriesOrThrow(harness, receptionist.token, payload());

      // 10:00 Tehran on each of the three Saturdays. Iran keeps no DST, so this
      // and the arithmetic agree today; the assertion is that the hour is what
      // repeats, which is what the family was told.
      for (const occurrence of body.occurrences) {
        expect(occurrence.appointment.startsAt.slice(11)).toBe('06:30:00.000Z');
      }
    });

    it('bounds a series by a last date, inclusive of a session falling on it', async () => {
      const body = await createSeriesOrThrow(
        harness,
        receptionist.token,
        payload({ recurrence: { endMode: 'END_DATE', intervalWeeks: 1, endsOn: '2026-09-19' } }),
      );

      expect(body.series.endMode).toBe('END_DATE');
      expect(body.series.endsOn).toBe('2026-09-19');
      expect(body.series.occurrenceCount).toBeNull();
      expect(body.occurrences).toHaveLength(3);
    });

    it('skips a week when the interval is two', async () => {
      const body = await createSeriesOrThrow(
        harness,
        receptionist.token,
        payload({
          recurrence: { endMode: 'OCCURRENCE_COUNT', intervalWeeks: 2, occurrenceCount: 2 },
        }),
      );

      expect(body.occurrences.map((each) => each.appointment.startsAt)).toEqual([
        SATURDAY_10_00,
        THIRD_SATURDAY_10_00,
      ]);
    });

    it('refuses a last date before the first session, which generates nothing', async () => {
      const response = await createSeries(
        harness,
        receptionist.token,
        payload({ recurrence: { endMode: 'END_DATE', intervalWeeks: 1, endsOn: '2026-09-04' } }),
      );

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('RECURRENCE_RULE_INVALID');
    });

    /**
     * THE TWO APPROVED BOUNDS: at most 52 sessions, and none more than 12
     * months past the first.
     *
     * Both are asserted against BOTH end modes and against BOTH endpoints. A
     * preview that showed eighty weeks the create would refuse would be worse
     * than no preview, and a bound enforced on one end mode only would be
     * reachable through the other.
     */
    describe('the approved bounds', () => {
      // Twenty-eight fortnights: well inside the count, and past the horizon.
      const overHorizon = { endMode: 'OCCURRENCE_COUNT', intervalWeeks: 2, occurrenceCount: 28 };
      const endDateOverCount = { endMode: 'END_DATE', intervalWeeks: 1, endsOn: '2028-03-05' };
      const endDateOverHorizon = { endMode: 'END_DATE', intervalWeeks: 12, endsOn: '2029-09-05' };

      it('books a full year of weekly sessions', async () => {
        const body = await createSeriesOrThrow(
          harness,
          receptionist.token,
          payload({
            recurrence: {
              endMode: 'OCCURRENCE_COUNT',
              intervalWeeks: 1,
              occurrenceCount: RECURRENCE_OCCURRENCES_MAX,
            },
          }),
        );

        expect(body.occurrences).toHaveLength(52);
        expect(body.occurrences.at(-1)?.appointment.startsAt).toBe('2027-08-28T06:30:00.000Z');
      }, 60000);

      /**
       * A count past the ceiling is refused by the REQUEST SHAPE, which is the
       * earliest point it can be — the same place `AVAILABILITY_WINDOWS_MAX` is
       * enforced. It is the one breach a shape can see, because it needs no
       * knowledge of the first occurrence's clinic date.
       */
      it('refuses a count past 52 at the boundary, on create and on preview alike', async () => {
        const recurrence = {
          endMode: 'OCCURRENCE_COUNT',
          intervalWeeks: 1,
          occurrenceCount: RECURRENCE_OCCURRENCES_MAX + 1,
        };

        for (const response of [
          await createSeries(harness, receptionist.token, payload({ recurrence })),
          await previewSeries(harness, receptionist.token, payload({ recurrence })),
        ]) {
          expect(response.status).toBe(400);
          expect(response.body.error.code).toBe('VALIDATION_FAILED');
        }

        await expectNoSeriesRows();
      });

      it.each([
        ['a count inside 52 that runs past 12 months', overHorizon],
        ['an end date past 52 sessions', endDateOverCount],
        ['an end date past 12 months', endDateOverHorizon],
      ])('refuses %s, on create and on preview alike', async (_name, recurrence) => {
        const created = await createSeries(harness, receptionist.token, payload({ recurrence }));

        expect(created.status).toBe(422);
        expect(created.body.error.code).toBe('RECURRENCE_RULE_INVALID');

        const previewed = await previewSeries(harness, receptionist.token, payload({ recurrence }));

        expect(previewed.status).toBe(422);
        expect(previewed.body.error.code).toBe('RECURRENCE_RULE_INVALID');

        await expectNoSeriesRows();
      });
    });

    it('cannot state two bounds or none, because the request shape has no way to', async () => {
      const both = await createSeries(
        harness,
        receptionist.token,
        payload({
          recurrence: {
            endMode: 'OCCURRENCE_COUNT',
            intervalWeeks: 1,
            occurrenceCount: 3,
            endsOn: '2026-09-19',
          },
        }),
      );

      expect(both.status).toBe(400);
      expect(both.body.error.code).toBe('VALIDATION_FAILED');

      const neither = await createSeries(
        harness,
        receptionist.token,
        payload({ recurrence: { endMode: 'OCCURRENCE_COUNT', intervalWeeks: 1 } }),
      );

      expect(neither.status).toBe(400);
      expect(neither.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('carries nothing financial', async () => {
      const body = await createSeriesOrThrow(harness, receptionist.token, payload());
      const serialised = JSON.stringify(body);

      for (const word of ['price', 'tariff', 'toman', 'charge', 'amount', 'discount']) {
        expect(serialised.toLowerCase()).not.toContain(word);
      }
    });
  });

  describe('creation is all or nothing', () => {
    it('books no occurrence at all when one week clashes with the room', async () => {
      // Somebody else's booking on the middle Saturday, in the same room.
      const otherTherapist = await makeTherapist(harness, manager.token, [clinic.serviceId]);
      const otherFamily = await makeFamilyWithChild(harness, manager.token);
      await putWindows(harness, manager.token, otherTherapist, [SATURDAY_MORNING]);

      const blocker = await book(
        harness,
        receptionist.token,
        bookingPayload(
          { ...clinic, therapistId: otherTherapist, childId: otherFamily.childId },
          { startsAt: SECOND_SATURDAY_10_00 },
        ),
      );

      expect(blocker.status).toBe(201);

      const response = await createSeries(harness, receptionist.token, payload());

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('APPOINTMENT_ROOM_CONFLICT');

      // Not one occurrence, and not one series row: the first Saturday was
      // inserted before the middle one failed, and the transaction took it back.
      const appointments = await harness.prisma.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) AS count FROM appointment WHERE series_id IS NOT NULL`;
      const series = await harness.prisma.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) AS count FROM appointment_series`;

      expect(Number(appointments[0]?.count)).toBe(0);
      expect(Number(series[0]?.count)).toBe(0);
    });

    it('books nothing when one week clashes with the therapist', async () => {
      const otherRoom = await makeRoom(harness, manager.token);
      const otherFamily = await makeFamilyWithChild(harness, manager.token);

      await book(
        harness,
        receptionist.token,
        bookingPayload(
          { ...clinic, roomId: otherRoom, childId: otherFamily.childId },
          { startsAt: THIRD_SATURDAY_10_00 },
        ),
      );

      const response = await createSeries(harness, receptionist.token, payload());

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('APPOINTMENT_THERAPIST_CONFLICT');
      await expectNoSeriesRows();
    });

    it('books nothing when one week clashes with the child', async () => {
      const otherTherapist = await makeTherapist(harness, manager.token, [clinic.serviceId]);
      const otherRoom = await makeRoom(harness, manager.token);
      await putWindows(harness, manager.token, otherTherapist, [SATURDAY_MORNING]);

      await book(
        harness,
        receptionist.token,
        bookingPayload(
          { ...clinic, therapistId: otherTherapist, roomId: otherRoom },
          { startsAt: SECOND_SATURDAY_10_00 },
        ),
      );

      const response = await createSeries(harness, receptionist.token, payload());

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('APPOINTMENT_CHILD_CONFLICT');
      await expectNoSeriesRows();
    });

    it('books nothing when one week falls on a day the therapist has closed', async () => {
      const closed = await request(harness.app.getHttpServer())
        .post(`/availability/therapists/${clinic.therapistId}/exceptions`)
        .set(asUser(manager.token))
        .send({
          exceptionDate: SATURDAYS[1],
          isAvailable: false,
          reason: 'روز تعطیل آزمایشی',
        });

      expect(closed.status).toBe(201);

      const response = await createSeries(harness, receptionist.token, payload());

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('APPOINTMENT_OUTSIDE_AVAILABILITY');
      await expectNoSeriesRows();
    });

    it('accepts the whole series when the one closed week carries the recorded override', async () => {
      await request(harness.app.getHttpServer())
        .post(`/availability/therapists/${clinic.therapistId}/exceptions`)
        .set(asUser(manager.token))
        .send({
          exceptionDate: SATURDAYS[1],
          isAvailable: false,
          reason: 'روز تعطیل آزمایشی',
        });

      const body = await createSeriesOrThrow(
        harness,
        receptionist.token,
        payload({ availabilityOverrideReason: 'درمانگر برای این هفته موافقت کرده است' }),
      );

      // Recorded on the occurrence that actually needed it, and on no other:
      // nothing was overridden in the other two weeks, so there is nothing to
      // explain and nothing to count.
      const reasons = body.occurrences.map((each) => each.appointment.availabilityOverrideReason);

      expect(reasons).toEqual([null, 'درمانگر برای این هفته موافقت کرده است', null]);
    });

    /**
     * Driven past the guard chain, because both roles this product defines hold
     * `appointment.override_availability` and no request can therefore arrive
     * without it. The rule still has to hold: the authority is checked against
     * the session the guard resolved, not against the role, and a future role
     * that lacks it must be refused rather than silently allowed.
     */
    it('refuses the override to an actor who does not hold the permission', async () => {
      await request(harness.app.getHttpServer())
        .post(`/availability/therapists/${clinic.therapistId}/exceptions`)
        .set(asUser(manager.token))
        .send({
          exceptionDate: SATURDAYS[1],
          isAvailable: false,
          reason: 'روز تعطیل آزمایشی',
        });

      const series = harness.app.get(AppointmentSeriesService);
      const withoutAuthority = actorSession(receptionist.id);
      const body = seriesPayload(clinic, {
        availabilityOverrideReason: 'بدون اختیار',
      }) as unknown as CreateAppointmentSeriesRequest;

      await expect(series.create(body, withoutAuthority, auditContext())).rejects.toMatchObject({
        code: 'AUTH_FORBIDDEN',
      });

      // The preview refuses it too, and for the same reason: showing somebody
      // the weeks they could book with an authority they do not have is worse
      // than telling them now.
      await expect(series.preview(body, withoutAuthority)).rejects.toMatchObject({
        code: 'AUTH_FORBIDDEN',
      });

      await expectNoSeriesRows();
    });

    it('applies the same catalog and lifecycle rules a single booking applies', async () => {
      const strangerService = await makeService(harness, manager.token);

      const unsupported = await createSeries(
        harness,
        receptionist.token,
        payload({ serviceId: strangerService }),
      );

      expect(unsupported.status).toBe(422);
      expect(unsupported.body.error.code).toBe('APPOINTMENT_THERAPIST_SERVICE_NOT_SUPPORTED');

      const badDuration = await createSeries(
        harness,
        receptionist.token,
        payload({ durationMinutes: 30 }),
      );

      expect(badDuration.status).toBe(422);
      await expectNoSeriesRows();
    });
  });

  describe('the preview', () => {
    it('reports every week and writes nothing', async () => {
      const response = await previewSeries(harness, receptionist.token, payload());

      expect(response.status).toBe(200);

      const body = recurrencePreviewResponseSchema.parse(response.body);

      expect(body.pattern.weekday).toBe(0);
      expect(body.pattern.startTime).toBe('10:00');
      expect(body.pattern.endTime).toBe('10:45');
      expect(body.pattern.occurrenceCount).toBe(3);
      expect(body.occurrences.map((each) => each.date)).toEqual(SATURDAYS);
      expect(body.occurrences.map((each) => each.index)).toEqual([0, 1, 2]);
      expect(body.blockedCount).toBe(0);
      expect(body.bookable).toBe(true);

      await expectNoSeriesRows();

      const appointments = await harness.prisma.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) AS count FROM appointment`;

      expect(Number(appointments[0]?.count)).toBe(0);
    });

    it('names the occurrence-specific finding for each blocked week, and still writes nothing', async () => {
      const otherTherapist = await makeTherapist(harness, manager.token, [clinic.serviceId]);
      const otherFamily = await makeFamilyWithChild(harness, manager.token);
      await putWindows(harness, manager.token, otherTherapist, [SATURDAY_MORNING]);

      // The middle Saturday: the room is taken by somebody else.
      await book(
        harness,
        receptionist.token,
        bookingPayload(
          { ...clinic, therapistId: otherTherapist, childId: otherFamily.childId },
          { startsAt: SECOND_SATURDAY_10_00 },
        ),
      );

      // The last Saturday: the therapist is closed.
      await request(harness.app.getHttpServer())
        .post(`/availability/therapists/${clinic.therapistId}/exceptions`)
        .set(asUser(manager.token))
        .send({
          exceptionDate: SATURDAYS[2],
          isAvailable: false,
          reason: 'روز تعطیل آزمایشی',
        });

      const response = await previewSeries(harness, receptionist.token, payload());
      const body = recurrencePreviewResponseSchema.parse(response.body);

      expect(body.occurrences.map((each) => each.blockedBy)).toEqual([
        null,
        'APPOINTMENT_ROOM_CONFLICT',
        'APPOINTMENT_OUTSIDE_AVAILABILITY',
      ]);
      expect(body.occurrences.map((each) => each.outsideAvailability)).toEqual([
        false,
        false,
        true,
      ]);
      expect(body.blockedCount).toBe(2);
      expect(body.bookable).toBe(false);

      const appointments = await harness.prisma.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) AS count FROM appointment WHERE series_id IS NOT NULL`;

      expect(Number(appointments[0]?.count)).toBe(0);
    });

    it('reports a week outside the hours as coverable when the override is supplied', async () => {
      await request(harness.app.getHttpServer())
        .post(`/availability/therapists/${clinic.therapistId}/exceptions`)
        .set(asUser(manager.token))
        .send({
          exceptionDate: SATURDAYS[1],
          isAvailable: false,
          reason: 'روز تعطیل آزمایشی',
        });

      const response = await previewSeries(
        harness,
        receptionist.token,
        payload({ availabilityOverrideReason: 'درمانگر موافقت کرده است' }),
      );

      const body = recurrencePreviewResponseSchema.parse(response.body);

      // Outside her hours, and not blocked: the interface still has to show
      // which weeks the receptionist is agreeing to.
      expect(body.occurrences[1]?.outsideAvailability).toBe(true);
      expect(body.occurrences[1]?.blockedBy).toBeNull();
      expect(body.bookable).toBe(true);
    });

    it('refuses a rule that generates nothing, exactly as the create does', async () => {
      const response = await previewSeries(
        harness,
        receptionist.token,
        payload({ recurrence: { endMode: 'END_DATE', intervalWeeks: 1, endsOn: '2026-09-04' } }),
      );

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('RECURRENCE_RULE_INVALID');
    });
  });

  describe('an occurrence is an ordinary appointment', () => {
    it('moves one week without touching the others, and keeps its series', async () => {
      const series = await createSeriesOrThrow(harness, receptionist.token, payload());
      const middle = series.occurrences[1]!.appointment;

      const response = await move(
        harness,
        receptionist.token,
        middle.id,
        movePayload(clinic, { startsAt: '2026-09-12T07:30:00.000Z' }),
      );

      expect(response.status).toBe(200);

      const moved = appointmentResponseSchema.parse(response.body);

      expect(moved.appointment.startsAt).toBe('2026-09-12T07:30:00.000Z');
      expect(moved.appointment.seriesId).toBe(series.series.id);

      const after = appointmentSeriesResponseSchema.parse(
        (await readSeries(harness, receptionist.token, series.series.id)).body,
      );

      expect(after.occurrences.map((each) => each.appointment.startsAt)).toEqual([
        SATURDAY_10_00,
        '2026-09-12T07:30:00.000Z',
        THIRD_SATURDAY_10_00,
      ]);
    });

    it('cancels and completes one week through the ordinary lifecycle', async () => {
      const series = await createSeriesOrThrow(harness, receptionist.token, payload());
      const [first, , third] = series.occurrences;

      expect((await complete(harness, receptionist.token, first!.appointment.id)).status).toBe(200);
      expect(
        (
          await cancel(harness, receptionist.token, third!.appointment.id, {
            cancelledBy: 'FAMILY',
            reason: 'سفر خانوادگی',
          })
        ).status,
      ).toBe(200);

      const after = appointmentSeriesResponseSchema.parse(
        (await readSeries(harness, receptionist.token, series.series.id)).body,
      );

      expect(after.occurrences.map((each) => each.appointment.status)).toEqual([
        'COMPLETED',
        'SCHEDULED',
        'CANCELLED_BY_FAMILY',
      ]);
    });
  });

  describe('cancel this and future', () => {
    it('cancels the pivot and every later week, and preserves what already happened', async () => {
      const series = await createSeriesOrThrow(harness, receptionist.token, payload());
      const [first, second, third] = series.occurrences;

      await complete(harness, receptionist.token, first!.appointment.id);

      const response = await cancelSeriesFrom(harness, receptionist.token, series.series.id, {
        fromAppointmentId: second!.appointment.id,
        cancelledBy: 'FAMILY',
        reason: 'خانواده ادامه نمی‌دهد',
      });

      expect(response.status).toBe(200);

      const body = appointmentSeriesOperationResponseSchema.parse(response.body);

      expect(body.changedAppointmentIds).toEqual([second!.appointment.id, third!.appointment.id]);
      expect(body.occurrences.map((each) => each.appointment.status)).toEqual([
        'COMPLETED',
        'CANCELLED_BY_FAMILY',
        'CANCELLED_BY_FAMILY',
      ]);
      // The completed week keeps its outcome; the cancelled ones carry the
      // reason on the row, as a single cancellation does.
      expect(body.occurrences[0]?.appointment.completedAt).not.toBeNull();
      expect(body.occurrences[1]?.appointment.cancellationReason).toBe('خانواده ادامه نمی‌دهد');
    });

    it('leaves earlier weeks alone', async () => {
      const series = await createSeriesOrThrow(harness, receptionist.token, payload());
      const third = series.occurrences[2]!.appointment;

      const body = appointmentSeriesOperationResponseSchema.parse(
        (
          await cancelSeriesFrom(harness, receptionist.token, series.series.id, {
            fromAppointmentId: third.id,
            cancelledBy: 'CLINIC',
            reason: 'تعطیلی درمانگاه',
          })
        ).body,
      );

      expect(body.changedAppointmentIds).toEqual([third.id]);
      expect(body.occurrences.map((each) => each.appointment.status)).toEqual([
        'SCHEDULED',
        'SCHEDULED',
        'CANCELLED_BY_CLINIC',
      ]);
    });

    it('does not rewrite a week somebody had already cancelled', async () => {
      const series = await createSeriesOrThrow(harness, receptionist.token, payload());
      const [first, second] = series.occurrences;

      await cancel(harness, receptionist.token, second!.appointment.id, {
        cancelledBy: 'FAMILY',
        reason: 'دلیل اصلی',
      });

      const body = appointmentSeriesOperationResponseSchema.parse(
        (
          await cancelSeriesFrom(harness, receptionist.token, series.series.id, {
            fromAppointmentId: first!.appointment.id,
            cancelledBy: 'CLINIC',
            reason: 'دلیل تازه',
          })
        ).body,
      );

      expect(body.occurrences[1]?.appointment.status).toBe('CANCELLED_BY_FAMILY');
      expect(body.occurrences[1]?.appointment.cancellationReason).toBe('دلیل اصلی');
      expect(body.changedAppointmentIds).not.toContain(second!.appointment.id);
    });

    it('changes nothing and audits nothing when the tail is already cancelled', async () => {
      const series = await createSeriesOrThrow(harness, receptionist.token, payload());
      const first = series.occurrences[0]!.appointment;
      const request_ = () =>
        cancelSeriesFrom(harness, receptionist.token, series.series.id, {
          fromAppointmentId: first.id,
          cancelledBy: 'CLINIC',
          reason: 'تعطیلی درمانگاه',
        });

      await request_();

      const second = appointmentSeriesOperationResponseSchema.parse((await request_()).body);

      expect(second.changedAppointmentIds).toEqual([]);

      const rows = await harness.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count FROM audit_log WHERE action = 'appointment_series.updated'
      `;

      expect(Number(rows[0]?.count)).toBe(1);
    });

    it('refuses a pivot that belongs to another series', async () => {
      const series = await createSeriesOrThrow(harness, receptionist.token, payload());
      const stranger = await book(
        harness,
        receptionist.token,
        bookingPayload(clinic, { startsAt: SATURDAY_11_00 }),
      );

      const response = await cancelSeriesFrom(harness, receptionist.token, series.series.id, {
        fromAppointmentId: appointmentResponseSchema.parse(stranger.body).appointment.id,
        cancelledBy: 'CLINIC',
        reason: 'تعطیلی درمانگاه',
      });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('APPOINTMENT_NOT_FOUND');
    });
  });

  describe('update this and future', () => {
    it('moves the hour of the pivot and every later week, leaving the dates alone', async () => {
      const series = await createSeriesOrThrow(harness, receptionist.token, payload());
      const [first, second, third] = series.occurrences;

      const response = await updateSeriesFrom(harness, receptionist.token, series.series.id, {
        fromAppointmentId: second!.appointment.id,
        durationMinutes: 45,
        therapistId: clinic.therapistId,
        roomId: clinic.roomId,
        startTime: '11:00',
        note: null,
        availabilityOverrideReason: null,
      });

      expect(response.status).toBe(200);

      const body = appointmentSeriesOperationResponseSchema.parse(response.body);

      expect(body.changedAppointmentIds).toEqual([second!.appointment.id, third!.appointment.id]);
      expect(body.occurrences.map((each) => each.appointment.startsAt)).toEqual([
        first!.appointment.startsAt,
        '2026-09-12T07:30:00.000Z',
        '2026-09-19T07:30:00.000Z',
      ]);
      // The rule itself is untouched: what moved is a set of appointments.
      expect(body.series.intervalWeeks).toBe(1);
      expect(body.series.startsOn).toBe(SATURDAYS[0]);
    });

    it('moves the room and the therapist for the remaining weeks', async () => {
      const series = await createSeriesOrThrow(harness, receptionist.token, payload());
      const otherRoom = await makeRoom(harness, manager.token);
      const first = series.occurrences[0]!.appointment;

      const body = appointmentSeriesOperationResponseSchema.parse(
        (
          await updateSeriesFrom(harness, receptionist.token, series.series.id, {
            fromAppointmentId: first.id,
            durationMinutes: 45,
            therapistId: clinic.therapistId,
            roomId: otherRoom,
            startTime: '10:00',
            note: 'اتاق تازه',
            availabilityOverrideReason: null,
          })
        ).body,
      );

      expect(body.changedAppointmentIds).toHaveLength(3);

      for (const occurrence of body.occurrences) {
        expect(occurrence.appointment.roomId).toBe(otherRoom);
        expect(occurrence.appointment.note).toBe('اتاق تازه');
      }
    });

    it('preserves a completed week and an already-cancelled one', async () => {
      const series = await createSeriesOrThrow(harness, receptionist.token, payload());
      const [first, second, third] = series.occurrences;

      await complete(harness, receptionist.token, first!.appointment.id);
      await cancel(harness, receptionist.token, second!.appointment.id, {
        cancelledBy: 'FAMILY',
        reason: 'بیماری',
      });

      const body = appointmentSeriesOperationResponseSchema.parse(
        (
          await updateSeriesFrom(harness, receptionist.token, series.series.id, {
            fromAppointmentId: first!.appointment.id,
            durationMinutes: 45,
            therapistId: clinic.therapistId,
            roomId: clinic.roomId,
            startTime: '11:00',
            note: null,
            availabilityOverrideReason: null,
          })
        ).body,
      );

      expect(body.changedAppointmentIds).toEqual([third!.appointment.id]);
      expect(body.occurrences[0]?.appointment.startsAt).toBe(SATURDAY_10_00);
      expect(body.occurrences[0]?.appointment.status).toBe('COMPLETED');
      expect(body.occurrences[1]?.appointment.startsAt).toBe(SECOND_SATURDAY_10_00);
      expect(body.occurrences[1]?.appointment.status).toBe('CANCELLED_BY_FAMILY');
    });

    it('refuses the whole update and moves nothing when one week would clash', async () => {
      const series = await createSeriesOrThrow(harness, receptionist.token, payload());
      const otherTherapist = await makeTherapist(harness, manager.token, [clinic.serviceId]);
      const otherFamily = await makeFamilyWithChild(harness, manager.token);
      await putWindows(harness, manager.token, otherTherapist, [SATURDAY_MORNING]);

      // 11:00 on the LAST Saturday only: the first two would move cleanly.
      await book(
        harness,
        receptionist.token,
        bookingPayload(
          { ...clinic, therapistId: otherTherapist, childId: otherFamily.childId },
          { startsAt: '2026-09-19T07:30:00.000Z' },
        ),
      );

      const response = await updateSeriesFrom(harness, receptionist.token, series.series.id, {
        fromAppointmentId: series.occurrences[0]!.appointment.id,
        durationMinutes: 45,
        therapistId: clinic.therapistId,
        roomId: clinic.roomId,
        startTime: '11:00',
        note: null,
        availabilityOverrideReason: null,
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('APPOINTMENT_ROOM_CONFLICT');

      // Every occurrence is exactly where it was.
      const after = appointmentSeriesResponseSchema.parse(
        (await readSeries(harness, receptionist.token, series.series.id)).body,
      );

      expect(after.occurrences.map((each) => each.appointment.startsAt)).toEqual([
        SATURDAY_10_00,
        SECOND_SATURDAY_10_00,
        THIRD_SATURDAY_10_00,
      ]);
    });

    it('refuses to move the series outside the therapist’s hours without a reason', async () => {
      const series = await createSeriesOrThrow(harness, receptionist.token, payload());

      const response = await updateSeriesFrom(harness, receptionist.token, series.series.id, {
        fromAppointmentId: series.occurrences[0]!.appointment.id,
        durationMinutes: 45,
        therapistId: clinic.therapistId,
        roomId: clinic.roomId,
        startTime: '20:00',
        note: null,
        availabilityOverrideReason: null,
      });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('APPOINTMENT_OUTSIDE_AVAILABILITY');
    });

    it('changes nothing and audits nothing when every week is already there', async () => {
      const series = await createSeriesOrThrow(harness, receptionist.token, payload());

      const body = appointmentSeriesOperationResponseSchema.parse(
        (
          await updateSeriesFrom(harness, receptionist.token, series.series.id, {
            fromAppointmentId: series.occurrences[0]!.appointment.id,
            durationMinutes: 45,
            therapistId: clinic.therapistId,
            roomId: clinic.roomId,
            startTime: '10:00',
            note: null,
            availabilityOverrideReason: null,
          })
        ).body,
      );

      expect(body.changedAppointmentIds).toEqual([]);

      const rows = await harness.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count FROM audit_log
        WHERE action IN ('appointment.updated', 'appointment_series.updated')
      `;

      expect(Number(rows[0]?.count)).toBe(0);
    });

    it('refuses a series that does not exist', async () => {
      const response = await updateSeriesFrom(
        harness,
        receptionist.token,
        '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
        {
          fromAppointmentId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
          durationMinutes: 45,
          therapistId: clinic.therapistId,
          roomId: clinic.roomId,
          startTime: '10:00',
          note: null,
          availabilityOverrideReason: null,
        },
      );

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('APPOINTMENT_SERIES_NOT_FOUND');
    });
  });

  /**
   * The verbs are part of the contract, not an accident of how the controller
   * was written.
   *
   * Re-placing sessions is an EDIT of rows that already exist — the same thing
   * `PATCH /appointments/:id` does to one of them — so `update-from` is a
   * `PATCH`. Cancelling is a stated act carrying who cancelled and why, exactly
   * as `POST /appointments/:id/cancel` is, so it stays a `POST`.
   */
  describe('the route matrix', () => {
    it('re-places the tail of a series with PATCH and refuses POST', async () => {
      const series = await createSeriesOrThrow(harness, receptionist.token, payload());
      const body = {
        fromAppointmentId: series.occurrences[0]!.appointment.id,
        durationMinutes: 45,
        therapistId: clinic.therapistId,
        roomId: clinic.roomId,
        startTime: '11:00',
        note: null,
        availabilityOverrideReason: null,
      };

      const wrongVerb = await request(harness.app.getHttpServer())
        .post(`/appointment-series/${series.series.id}/update-from`)
        .set(asUser(receptionist.token))
        .send(body);

      expect(wrongVerb.status).toBe(404);

      const patched = await updateSeriesFrom(harness, receptionist.token, series.series.id, body);

      expect(patched.status).toBe(200);
    });

    it('cancels the tail of a series with POST and refuses PATCH', async () => {
      const series = await createSeriesOrThrow(harness, receptionist.token, payload());
      const body = {
        fromAppointmentId: series.occurrences[0]!.appointment.id,
        cancelledBy: 'CLINIC',
        reason: 'تعطیلی درمانگاه',
      };

      const wrongVerb = await request(harness.app.getHttpServer())
        .patch(`/appointment-series/${series.series.id}/cancel-from`)
        .set(asUser(receptionist.token))
        .send(body);

      expect(wrongVerb.status).toBe(404);

      const posted = await cancelSeriesFrom(harness, receptionist.token, series.series.id, body);

      expect(posted.status).toBe(200);
    });
  });

  describe('the audit trail', () => {
    it('records every occurrence and the series, in one transaction', async () => {
      const series = await createSeriesOrThrow(harness, receptionist.token, payload());

      const rows = await harness.prisma.$queryRaw<
        { action: string; entity_id: string; occurred_at: Date; metadata: unknown }[]
      >`
        SELECT action, entity_id, occurred_at, metadata FROM audit_log
        WHERE action IN ('appointment.created', 'appointment_series.created')
        ORDER BY id ASC
      `;

      expect(rows).toHaveLength(4);
      expect(rows.filter((row) => row.action === 'appointment.created')).toHaveLength(3);

      // One instant for all four rows: `transaction_timestamp()` is what makes
      // the audit trail agree with the atomicity of the write it describes.
      expect(new Set(rows.map((row) => row.occurred_at.getTime())).size).toBe(1);

      // Every occurrence names its series, and the series row names every
      // occurrence: membership is traceable from either end.
      for (const row of rows.filter((each) => each.action === 'appointment.created')) {
        expect((row.metadata as { seriesId: string }).seriesId).toBe(series.series.id);
      }

      const seriesRow = rows.find((row) => row.action === 'appointment_series.created');

      expect(seriesRow?.entity_id).toBe(series.series.id);
    });

    it('records a this-and-future cancellation per occurrence and once for the series', async () => {
      const series = await createSeriesOrThrow(harness, receptionist.token, payload());

      await cancelSeriesFrom(harness, receptionist.token, series.series.id, {
        fromAppointmentId: series.occurrences[1]!.appointment.id,
        cancelledBy: 'CLINIC',
        reason: 'تعطیلی درمانگاه',
      });

      const rows = await harness.prisma.$queryRaw<
        { action: string; entity_id: string; metadata: Record<string, unknown> }[]
      >`
        SELECT action, entity_id, metadata FROM audit_log
        WHERE action IN ('appointment.cancelled', 'appointment_series.updated')
        ORDER BY id ASC
      `;

      expect(rows.filter((row) => row.action === 'appointment.cancelled')).toHaveLength(2);
      expect(rows.filter((row) => row.action === 'appointment_series.updated')).toHaveLength(1);

      for (const row of rows.filter((each) => each.action === 'appointment.cancelled')) {
        expect(row.metadata['seriesOperation']).toBe('CANCEL_FROM');
        expect(row.metadata['cancelledBy']).toBe('CLINIC');
      }
    });
  });

  async function expectNoSeriesRows(): Promise<void> {
    const rows = await harness.prisma.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) AS count FROM appointment_series`;

    expect(Number(rows[0]?.count)).toBe(0);
  }
});
