import request from 'supertest';
import { appointmentResponseSchema } from '@clinic/contracts';
import { createHarness, resetDatabase, type Harness } from './harness';
import {
  asUser,
  book,
  bookId,
  bookingPayload,
  cancel,
  complete,
  makeFamilyWithChild,
  makeRoom,
  makeTherapist,
  move,
  movePayload,
  putWindows,
  recordAttendance,
  reopen,
  SATURDAY_10_00,
  SATURDAY_10_30,
  SATURDAY_11_00,
  SATURDAY_20_00,
  SATURDAY_MORNING,
  seedClinic,
  signIn,
} from './appointments-support';

/**
 * What happens to an appointment after it is booked, over real HTTP against
 * real PostgreSQL.
 *
 * Everything is synthetic. The suite is organised as the lifecycle is: the move,
 * the two cancellations, the completion, the reopen, and the seat's own
 * attendance — which is deliberately last, because it is a separate fact and
 * nothing above it decides it.
 *
 * THREE PROPERTIES ARE ASSERTED THROUGHOUT, because they are what the
 * checkpoint is for:
 *
 *   * a repeated request changes nothing and audits nothing twice;
 *   * every state change writes exactly one audit row, in the same transaction;
 *   * nothing financial appears anywhere — no charge table is written, because
 *     none exists, and a no-show and a cancellation produce nothing at all.
 */
describe('appointment lifecycle (real PostgreSQL)', () => {
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
  const placement = (overrides: Record<string, unknown> = {}) => movePayload(clinic, overrides);

  const auditRows = (action: string) =>
    harness.prisma.auditLog.findMany({ where: { action }, orderBy: { occurredAt: 'asc' } });

  const seatOf = async (id: string): Promise<string> => {
    const read = await request(harness.app.getHttpServer())
      .get(`/appointments/${id}`)
      .set(asUser(receptionist.token));

    const participant = appointmentResponseSchema.parse(read.body).participants[0];
    if (participant === undefined) throw new Error('the fixture booking has no seat');
    return participant.id;
  };

  describe('moving a scheduled appointment', () => {
    it('moves it in place, keeping its id and its seat', async () => {
      const id = await bookId(harness, receptionist.token, payload());

      const moved = await move(
        harness,
        receptionist.token,
        id,
        placement({ startsAt: SATURDAY_11_00, durationMinutes: 60 }),
      );

      expect(moved.status).toBe(200);

      const body = appointmentResponseSchema.parse(moved.body);

      // The same appointment, not a new one: no status invented for the move,
      // and the seat is the seat that was already there.
      expect(body.appointment.id).toBe(id);
      expect(body.appointment.status).toBe('SCHEDULED');
      expect(body.appointment.startsAt).toBe(SATURDAY_11_00);
      expect(body.appointment.endsAt).toBe('2026-09-05T08:30:00.000Z');
      expect(body.participants).toHaveLength(1);
      expect(body.participants[0]?.childId).toBe(clinic.childId);

      expect(await harness.prisma.appointment.count()).toBe(1);
    });

    it('moves by less than its own length, which its old position must not block', async () => {
      const id = await bookId(harness, receptionist.token, payload());

      // Half an hour into a 45-minute session: the new window overlaps the old
      // one, and the only row it overlaps is itself.
      const moved = await move(
        harness,
        receptionist.token,
        id,
        placement({ startsAt: SATURDAY_10_30 }),
      );

      expect(moved.status).toBe(200);
      expect(appointmentResponseSchema.parse(moved.body).appointment.startsAt).toBe(SATURDAY_10_30);
    });

    it('records one audit row carrying both sides of the change', async () => {
      const id = await bookId(harness, receptionist.token, payload());
      await move(harness, receptionist.token, id, placement({ startsAt: SATURDAY_11_00 }));

      const rows = await auditRows('appointment.updated');

      expect(rows).toHaveLength(1);
      expect(rows[0]?.actorUserId).toBe(receptionist.id);
      expect(rows[0]?.entityId).toBe(id);
      expect((rows[0]?.before as Record<string, unknown>)['startsAt']).toBe(SATURDAY_10_00);
      expect((rows[0]?.after as Record<string, unknown>)['startsAt']).toBe(SATURDAY_11_00);
    });

    it('is a no-op when the placement is the one it already has', async () => {
      const id = await bookId(harness, receptionist.token, payload());

      const again = await move(harness, receptionist.token, id, placement());

      expect(again.status).toBe(200);
      // A resubmitted form must not write an audit row for a move that moved
      // nothing.
      expect(await auditRows('appointment.updated')).toHaveLength(0);
    });

    it('refuses a move onto a therapist or a room that is already busy', async () => {
      const id = await bookId(harness, receptionist.token, payload());
      const other = await makeFamilyWithChild(harness, manager.token);
      await bookId(
        harness,
        receptionist.token,
        payload({ startsAt: SATURDAY_11_00, durationMinutes: 60, childId: other.childId }),
      );

      const collision = await move(
        harness,
        receptionist.token,
        id,
        placement({ startsAt: SATURDAY_11_00 }),
      );

      expect(collision.status).toBe(409);
      expect(collision.body.error.code).toBe('APPOINTMENT_THERAPIST_CONFLICT');

      const therapistB = await makeTherapist(harness, manager.token, [clinic.serviceId]);
      await putWindows(harness, manager.token, therapistB, [SATURDAY_MORNING]);

      // Same hour, a free therapist, but the room the other booking is in.
      const roomCollision = await move(
        harness,
        receptionist.token,
        id,
        placement({ startsAt: SATURDAY_11_00, therapistId: therapistB }),
      );

      expect(roomCollision.status).toBe(409);
      expect(roomCollision.body.error.code).toBe('APPOINTMENT_ROOM_CONFLICT');
    });

    it('refuses a move that would double-book the child', async () => {
      const id = await bookId(harness, receptionist.token, payload());

      const therapistB = await makeTherapist(harness, manager.token, [clinic.serviceId]);
      const roomB = await makeRoom(harness, manager.token);
      await putWindows(harness, manager.token, therapistB, [SATURDAY_MORNING]);
      await bookId(
        harness,
        receptionist.token,
        payload({ startsAt: SATURDAY_11_00, therapistId: therapistB, roomId: roomB }),
      );

      // The same child is in both; moving the first onto the second is the one
      // conflict no constraint can decide.
      const collision = await move(
        harness,
        receptionist.token,
        id,
        placement({ startsAt: SATURDAY_11_00, therapistId: therapistB, roomId: roomB }),
      );

      expect(collision.status).toBe(409);
      expect(collision.body.error.code).toBe('APPOINTMENT_CHILD_CONFLICT');
    });

    it('refuses a move outside the therapist’s hours, and allows it with a recorded reason', async () => {
      const id = await bookId(harness, receptionist.token, payload());

      const refused = await move(
        harness,
        receptionist.token,
        id,
        placement({ startsAt: SATURDAY_20_00 }),
      );

      expect(refused.status).toBe(422);
      expect(refused.body.error.code).toBe('APPOINTMENT_OUTSIDE_AVAILABILITY');

      const authorized = await move(
        harness,
        receptionist.token,
        id,
        placement({
          startsAt: SATURDAY_20_00,
          availabilityOverrideReason: 'جلسهٔ جبرانی با هماهنگی درمانگر',
        }),
      );

      expect(authorized.status).toBe(200);
      expect(
        appointmentResponseSchema.parse(authorized.body).appointment.availabilityOverrideReason,
      ).toBe('جلسهٔ جبرانی با هماهنگی درمانگر');

      // The override is a property of the move that carried it, in that row's
      // metadata — not a second action.
      const rows = await auditRows('appointment.updated');
      const metadata = rows.at(-1)?.metadata as Record<string, unknown>;
      expect(metadata['availabilityOverride']).toBe(true);
      expect(metadata['reason']).toBe('جلسهٔ جبرانی با هماهنگی درمانگر');
    });

    it('clears the recorded override when the appointment moves back inside the hours', async () => {
      const id = await bookId(
        harness,
        receptionist.token,
        payload({ startsAt: SATURDAY_20_00, availabilityOverrideReason: 'خارج از ساعت کاری' }),
      );

      const back = await move(harness, receptionist.token, id, placement());

      expect(back.status).toBe(200);
      expect(
        appointmentResponseSchema.parse(back.body).appointment.availabilityOverrideReason,
      ).toBeNull();
    });

    it('refuses an overnight move as an invalid time, with or without a reason', async () => {
      const id = await bookId(harness, receptionist.token, payload());

      const overnight = await move(
        harness,
        receptionist.token,
        id,
        placement({
          // 23:45 Tehran, running past midnight.
          startsAt: '2026-09-05T20:15:00.000Z',
          durationMinutes: 60,
          availabilityOverrideReason: 'هر دلیلی',
        }),
      );

      expect(overnight.status).toBe(422);
      expect(overnight.body.error.code).toBe('APPOINTMENT_TIME_INVALID');
    });

    it('refuses a move onto a therapist who does not provide the service, or an inactive room', async () => {
      const id = await bookId(harness, receptionist.token, payload());

      const unrelated = await makeTherapist(harness, manager.token, []);
      await putWindows(harness, manager.token, unrelated, [SATURDAY_MORNING]);

      const wrongTherapist = await move(
        harness,
        receptionist.token,
        id,
        placement({ therapistId: unrelated }),
      );

      expect(wrongTherapist.status).toBe(422);
      expect(wrongTherapist.body.error.code).toBe('APPOINTMENT_THERAPIST_SERVICE_NOT_SUPPORTED');

      const roomB = await makeRoom(harness, manager.token);
      await request(harness.app.getHttpServer())
        .patch(`/catalog/rooms/${roomB}/status`)
        .set(asUser(manager.token))
        .send({ status: 'INACTIVE' });

      const inactiveRoom = await move(
        harness,
        receptionist.token,
        id,
        placement({ roomId: roomB }),
      );

      expect(inactiveRoom.status).toBe(422);
      expect(inactiveRoom.body.error.code).toBe('ROOM_INACTIVE');
    });

    it('refuses to move a cancelled or a completed appointment', async () => {
      const cancelled = await bookId(harness, receptionist.token, payload());
      await cancel(harness, receptionist.token, cancelled, {
        cancelledBy: 'FAMILY',
        reason: 'بیماری کودک',
      });

      const movedCancelled = await move(
        harness,
        receptionist.token,
        cancelled,
        placement({ startsAt: SATURDAY_11_00 }),
      );

      expect(movedCancelled.status).toBe(409);
      expect(movedCancelled.body.error.code).toBe('APPOINTMENT_TRANSITION_INVALID');

      const completed = await bookId(
        harness,
        receptionist.token,
        payload({ startsAt: SATURDAY_11_00 }),
      );
      await complete(harness, receptionist.token, completed);

      const movedCompleted = await move(
        harness,
        receptionist.token,
        completed,
        placement({ startsAt: SATURDAY_10_30 }),
      );

      expect(movedCompleted.status).toBe(409);
      expect(movedCompleted.body.error.code).toBe('APPOINTMENT_TRANSITION_INVALID');
    });

    it('accepts no service and no child, which would make it a different booking', async () => {
      const id = await bookId(harness, receptionist.token, payload());

      for (const extra of [{ serviceId: clinic.serviceId }, { childId: clinic.childId }]) {
        const response = await move(harness, receptionist.token, id, placement(extra));

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      }
    });
  });

  describe('cancelling', () => {
    it('records who cancelled and why, and keeps the appointment visible', async () => {
      const id = await bookId(harness, receptionist.token, payload());

      const cancelled = await cancel(harness, receptionist.token, id, {
        cancelledBy: 'CLINIC',
        reason: 'درمانگر در دسترس نیست',
      });

      expect(cancelled.status).toBe(200);

      const body = appointmentResponseSchema.parse(cancelled.body);
      expect(body.appointment.status).toBe('CANCELLED_BY_CLINIC');
      expect(body.appointment.cancellationReason).toBe('درمانگر در دسترس نیست');
      expect(body.appointment.cancelledAt).not.toBeNull();

      // Never deleted: a cancelled appointment stays in the history and in the
      // day it was booked into.
      expect(await harness.prisma.appointment.count()).toBe(1);

      const rows = await auditRows('appointment.cancelled');
      expect(rows).toHaveLength(1);
      expect((rows[0]?.metadata as Record<string, unknown>)['cancelledBy']).toBe('CLINIC');
    });

    it('releases the slot, so the hour can be booked again', async () => {
      const id = await bookId(harness, receptionist.token, payload());

      const blocked = await book(harness, receptionist.token, payload({ childId: clinic.childId }));
      expect(blocked.status).toBe(409);

      await cancel(harness, receptionist.token, id, {
        cancelledBy: 'FAMILY',
        reason: 'سفر خانواده',
      });

      const rebooked = await book(harness, receptionist.token, payload());
      expect(rebooked.status).toBe(201);
    });

    it('is a no-op when repeated the same way, and refuses the other way', async () => {
      const id = await bookId(harness, receptionist.token, payload());
      const body = { cancelledBy: 'FAMILY', reason: 'بیماری کودک' };

      await cancel(harness, receptionist.token, id, body);
      const again = await cancel(harness, receptionist.token, id, {
        ...body,
        reason: 'دلیل دیگری',
      });

      expect(again.status).toBe(200);
      // The reason and the instant somebody recorded are not overwritten by a
      // second submission, and there is one cancellation, not two.
      expect(appointmentResponseSchema.parse(again.body).appointment.cancellationReason).toBe(
        'بیماری کودک',
      );
      expect(await auditRows('appointment.cancelled')).toHaveLength(1);

      const otherParty = await cancel(harness, receptionist.token, id, {
        cancelledBy: 'CLINIC',
        reason: 'اصلاح',
      });

      expect(otherParty.status).toBe(409);
      expect(otherParty.body.error.code).toBe('APPOINTMENT_TRANSITION_INVALID');
    });

    it('always requires a reason', async () => {
      const id = await bookId(harness, receptionist.token, payload());

      for (const body of [{ cancelledBy: 'FAMILY' }, { cancelledBy: 'FAMILY', reason: '   ' }]) {
        const response = await cancel(harness, receptionist.token, id, body);
        expect(response.status).toBe(400);
      }
    });

    it('refuses to cancel a completed session', async () => {
      const id = await bookId(harness, receptionist.token, payload());
      await complete(harness, receptionist.token, id);

      const response = await cancel(harness, receptionist.token, id, {
        cancelledBy: 'FAMILY',
        reason: 'اشتباه',
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('APPOINTMENT_TRANSITION_INVALID');
    });
  });

  describe('completing', () => {
    it('records the completion and keeps the slot occupied', async () => {
      const id = await bookId(harness, receptionist.token, payload());

      const completed = await complete(harness, receptionist.token, id);

      expect(completed.status).toBe(200);

      const body = appointmentResponseSchema.parse(completed.body);
      expect(body.appointment.status).toBe('COMPLETED');
      expect(body.appointment.completedAt).not.toBeNull();
      // The seat is untouched: completing a session says nothing about who
      // arrived.
      expect(body.participants[0]?.attendance).toBe('PENDING');

      // Completion does not release the hour.
      const overlapping = await book(harness, receptionist.token, payload());
      expect(overlapping.status).toBe(409);
    });

    it('is idempotent, and writes exactly one audit row', async () => {
      const id = await bookId(harness, receptionist.token, payload());

      const first = await complete(harness, receptionist.token, id);
      const second = await complete(harness, receptionist.token, id);

      expect([first.status, second.status]).toEqual([200, 200]);
      expect(appointmentResponseSchema.parse(second.body)).toEqual(
        appointmentResponseSchema.parse(first.body),
      );
      expect(await auditRows('appointment.completed')).toHaveLength(1);
    });

    it('refuses to complete a cancelled appointment', async () => {
      const id = await bookId(harness, receptionist.token, payload());
      await cancel(harness, receptionist.token, id, { cancelledBy: 'FAMILY', reason: 'سفر' });

      const response = await complete(harness, receptionist.token, id);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('APPOINTMENT_TRANSITION_INVALID');
    });

    it('accepts no field in the body, so nothing can be smuggled through it', async () => {
      const id = await bookId(harness, receptionist.token, payload());

      const response = await request(harness.app.getHttpServer())
        .post(`/appointments/${id}/complete`)
        .set(asUser(receptionist.token))
        .send({ priceToman: '250000' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('reopening a completion entered by mistake', () => {
    it('is refused to a receptionist and allowed to a manager, with a reason', async () => {
      const id = await bookId(harness, receptionist.token, payload());
      await complete(harness, receptionist.token, id);

      const refused = await reopen(harness, receptionist.token, id, 'اشتباه ثبت شد');
      expect(refused.status).toBe(403);

      const reopened = await reopen(harness, manager.token, id, 'تکمیل اشتباه توسط پذیرش');
      expect(reopened.status).toBe(200);

      const body = appointmentResponseSchema.parse(reopened.body);
      expect(body.appointment.status).toBe('SCHEDULED');
      expect(body.appointment.completedAt).toBeNull();

      const rows = await auditRows('appointment.reopened');
      expect(rows).toHaveLength(1);
      expect(rows[0]?.actorUserId).toBe(manager.id);
      expect((rows[0]?.metadata as Record<string, unknown>)['reason']).toBe(
        'تکمیل اشتباه توسط پذیرش',
      );
      expect((rows[0]?.before as Record<string, unknown>)['status']).toBe('COMPLETED');
      expect((rows[0]?.after as Record<string, unknown>)['status']).toBe('SCHEDULED');
    });

    it('requires a reason, and refuses an appointment that is not completed', async () => {
      const id = await bookId(harness, receptionist.token, payload());

      const scheduled = await reopen(harness, manager.token, id, 'هنوز تکمیل نشده');
      expect(scheduled.status).toBe(409);
      expect(scheduled.body.error.code).toBe('APPOINTMENT_TRANSITION_INVALID');

      await complete(harness, receptionist.token, id);

      const noReason = await request(harness.app.getHttpServer())
        .post(`/appointments/${id}/reopen`)
        .set(asUser(manager.token))
        .send({});

      expect(noReason.status).toBe(400);

      await reopen(harness, manager.token, id, 'اصلاح');

      // Not idempotent, deliberately: a second reopen describes nothing, and
      // saying so is more useful than accepting it silently.
      const twice = await reopen(harness, manager.token, id, 'دوباره');
      expect(twice.status).toBe(409);
    });

    it('leaves the recorded attendance exactly as it was', async () => {
      const id = await bookId(harness, receptionist.token, payload());
      const seat = await seatOf(id);

      await recordAttendance(harness, receptionist.token, id, seat, 'ATTENDED');
      await complete(harness, receptionist.token, id);
      const reopened = await reopen(harness, manager.token, id, 'اصلاح');

      // What the child did is a separate fact; reversing a wrong completion did
      // not say they were absent.
      expect(appointmentResponseSchema.parse(reopened.body).participants[0]?.attendance).toBe(
        'ATTENDED',
      );
    });

    it('can be completed again after being reopened and moved', async () => {
      const id = await bookId(harness, receptionist.token, payload());
      await complete(harness, receptionist.token, id);
      await reopen(harness, manager.token, id, 'اصلاح');

      const moved = await move(
        harness,
        receptionist.token,
        id,
        placement({ startsAt: SATURDAY_11_00 }),
      );
      expect(moved.status).toBe(200);

      const completed = await complete(harness, receptionist.token, id);
      expect(appointmentResponseSchema.parse(completed.body).appointment.status).toBe('COMPLETED');
    });
  });

  describe('recording the seat’s attendance', () => {
    it('records an outcome without touching the booking’s status', async () => {
      const id = await bookId(harness, receptionist.token, payload());
      const seat = await seatOf(id);

      const recorded = await recordAttendance(harness, receptionist.token, id, seat, 'ATTENDED');

      expect(recorded.status).toBe(200);

      const body = appointmentResponseSchema.parse(recorded.body);
      expect(body.participants[0]?.attendance).toBe('ATTENDED');
      expect(body.participants[0]?.attendanceRecordedAt).not.toBeNull();
      // Two facts: the session is still scheduled, and the child has arrived.
      expect(body.appointment.status).toBe('SCHEDULED');

      const rows = await auditRows('appointment.attendance_recorded');
      expect(rows).toHaveLength(1);
      expect(rows[0]?.entityType).toBe('appointment_participant');
      expect(rows[0]?.entityId).toBe(seat);
      expect((rows[0]?.before as Record<string, unknown>)['attendance']).toBe('PENDING');
      expect((rows[0]?.after as Record<string, unknown>)['attendance']).toBe('ATTENDED');
    });

    it('records a no-show, and creates nothing financial', async () => {
      const id = await bookId(harness, receptionist.token, payload());
      const seat = await seatOf(id);

      const recorded = await recordAttendance(harness, receptionist.token, id, seat, 'NO_SHOW');

      expect(recorded.status).toBe(200);
      expect(appointmentResponseSchema.parse(recorded.body).participants[0]?.attendance).toBe(
        'NO_SHOW',
      );
      // A no-show creates no charge until a policy is approved, and there is no
      // charge to create: nothing in this milestone prices a session.
      expect(await harness.prisma.tariff.count()).toBe(0);
    });

    it('is a no-op when the same outcome is recorded twice', async () => {
      const id = await bookId(harness, receptionist.token, payload());
      const seat = await seatOf(id);

      const first = await recordAttendance(harness, receptionist.token, id, seat, 'ATTENDED');
      const second = await recordAttendance(harness, receptionist.token, id, seat, 'ATTENDED');

      expect(
        appointmentResponseSchema.parse(second.body).participants[0]?.attendanceRecordedAt,
      ).toBe(appointmentResponseSchema.parse(first.body).participants[0]?.attendanceRecordedAt);
      expect(await auditRows('appointment.attendance_recorded')).toHaveLength(1);
    });

    it('corrects a wrong outcome, keeping both values in the audit row', async () => {
      const id = await bookId(harness, receptionist.token, payload());
      const seat = await seatOf(id);

      await recordAttendance(harness, receptionist.token, id, seat, 'NO_SHOW');
      const corrected = await recordAttendance(harness, receptionist.token, id, seat, 'ATTENDED');

      expect(appointmentResponseSchema.parse(corrected.body).participants[0]?.attendance).toBe(
        'ATTENDED',
      );

      const rows = await auditRows('appointment.attendance_recorded');
      expect(rows).toHaveLength(2);
      expect((rows[1]?.before as Record<string, unknown>)['attendance']).toBe('NO_SHOW');
      expect((rows[1]?.after as Record<string, unknown>)['attendance']).toBe('ATTENDED');
    });

    it('does not accept PENDING, because un-recording an entry is not correcting it', async () => {
      const id = await bookId(harness, receptionist.token, payload());
      const seat = await seatOf(id);

      const response = await recordAttendance(harness, receptionist.token, id, seat, 'PENDING');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses an outcome on a cancelled appointment', async () => {
      const id = await bookId(harness, receptionist.token, payload());
      const seat = await seatOf(id);
      await cancel(harness, receptionist.token, id, { cancelledBy: 'FAMILY', reason: 'بیماری' });

      const response = await recordAttendance(harness, receptionist.token, id, seat, 'NO_SHOW');

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('APPOINTMENT_TRANSITION_INVALID');
    });

    it('refuses a seat that belongs to another booking', async () => {
      const first = await bookId(harness, receptionist.token, payload());
      const other = await makeFamilyWithChild(harness, manager.token);
      const second = await bookId(
        harness,
        receptionist.token,
        payload({ startsAt: SATURDAY_11_00, childId: other.childId }),
      );

      const foreignSeat = appointmentResponseSchema.parse(
        (
          await request(harness.app.getHttpServer())
            .get(`/appointments/${second}`)
            .set(asUser(receptionist.token))
        ).body,
      ).participants[0]?.id;

      const response = await recordAttendance(
        harness,
        receptionist.token,
        first,
        foreignSeat ?? first,
        'ATTENDED',
      );

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('APPOINTMENT_PARTICIPANT_NOT_FOUND');
    });

    it('records an outcome on a completed session, which is the ordinary order', async () => {
      const id = await bookId(harness, receptionist.token, payload());
      const seat = await seatOf(id);

      await complete(harness, receptionist.token, id);
      const recorded = await recordAttendance(harness, receptionist.token, id, seat, 'ATTENDED');

      expect(recorded.status).toBe(200);

      const body = appointmentResponseSchema.parse(recorded.body);
      // Both facts, which is exactly what Milestone 5 will require before a
      // session charge may exist.
      expect(body.appointment.status).toBe('COMPLETED');
      expect(body.participants[0]?.attendance).toBe('ATTENDED');
    });
  });

  it('creates nothing financial anywhere in the lifecycle', async () => {
    const id = await bookId(harness, receptionist.token, payload());
    const seat = await seatOf(id);

    await move(harness, receptionist.token, id, placement({ startsAt: SATURDAY_11_00 }));
    await recordAttendance(harness, receptionist.token, id, seat, 'ATTENDED');
    await complete(harness, receptionist.token, id);
    await reopen(harness, manager.token, id, 'اصلاح');

    // Not one tariff was read or written by any of it. The financial tables a
    // charge would live in do not exist yet, and the assertion that keeps this
    // true when they do is that nothing above ever names one.
    expect(await harness.prisma.tariff.count()).toBe(0);

    const financialActions = await harness.prisma.auditLog.findMany({
      where: { action: { contains: 'charge' } },
    });
    expect(financialActions).toHaveLength(0);
  });

  it('keeps every state change and its audit row in one transaction', async () => {
    const id = await bookId(harness, receptionist.token, payload());
    await complete(harness, receptionist.token, id);

    const rows = await auditRows('appointment.completed');
    const appointment = await harness.prisma.appointment.findUniqueOrThrow({ where: { id } });

    // `transaction_timestamp()` on both sides: the state change and the record
    // of it are the same instant, which is what atomicity looks like from the
    // outside.
    expect(rows[0]?.occurredAt.toISOString()).toBe(appointment.completedAt?.toISOString());
  });

  it('refuses every lifecycle verb to a caller with no session', async () => {
    const id = await bookId(harness, receptionist.token, payload());

    const anonymous = [
      request(harness.app.getHttpServer()).patch(`/appointments/${id}`).send(placement()),
      request(harness.app.getHttpServer())
        .post(`/appointments/${id}/cancel`)
        .send({ cancelledBy: 'FAMILY', reason: 'x' }),
      request(harness.app.getHttpServer()).post(`/appointments/${id}/complete`).send({}),
      request(harness.app.getHttpServer()).post(`/appointments/${id}/reopen`).send({ reason: 'x' }),
    ];

    for (const response of await Promise.all(anonymous)) {
      expect(response.status).toBe(401);
    }
  });
});
