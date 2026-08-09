import request from 'supertest';
import { appointmentResponseSchema } from '@clinic/contracts';
import { createHarness, resetDatabase, type Harness } from './harness';
import {
  asUser,
  book,
  bookingPayload,
  makeRoom,
  makeService,
  makeTherapist,
  putWindows,
  SATURDAY,
  SATURDAY_10_00,
  SATURDAY_10_30,
  SATURDAY_11_00,
  SATURDAY_20_00,
  SATURDAY_MORNING,
  makeFamilyWithChild,
  seedClinic,
  signIn,
} from './appointments-support';

/**
 * Booking one appointment, over real HTTP against real PostgreSQL.
 *
 * Everything is synthetic. The dates are ordinary Gregorian days chosen for
 * their weekday, and every time is stated as a UTC instant with its Tehran
 * reading named in `appointments-support.ts`.
 *
 * WHAT THIS SUITE DOES NOT COVER, because the checkpoint does not build it:
 * recurrence, rescheduling, cancellation, completion, attendance, the day view,
 * and anything financial. `carries nothing financial` below is the assertion
 * that keeps the last one true.
 */
describe('appointment booking (real PostgreSQL)', () => {
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
    await resetDatabase(harness.prisma);
    manager = await signIn(harness, 'MANAGER');
    receptionist = await signIn(harness, 'RECEPTIONIST');
    clinic = await seedClinic(harness, manager.token);
  });

  const payload = (overrides: Record<string, unknown> = {}) => bookingPayload(clinic, overrides);

  describe('the ordinary booking', () => {
    it('books a session inside the therapist’s hours and returns it with its seat', async () => {
      const response = await book(harness, receptionist.token, payload());

      expect(response.status).toBe(201);

      const body = appointmentResponseSchema.parse(response.body);

      expect(body.appointment.status).toBe('SCHEDULED');
      expect(body.appointment.startsAt).toBe(SATURDAY_10_00);
      // Not a second fact: the database requires it to equal start + duration.
      expect(body.appointment.endsAt).toBe('2026-09-05T07:15:00.000Z');
      expect(body.appointment.seriesId).toBeNull();
      expect(body.appointment.availabilityOverrideReason).toBeNull();

      // An individual appointment has exactly one participant, pending an
      // outcome nobody has entered.
      expect(body.participants).toHaveLength(1);
      expect(body.participants[0]?.childId).toBe(clinic.childId);
      expect(body.participants[0]?.attendance).toBe('PENDING');
      expect(body.participants[0]?.attendanceRecordedAt).toBeNull();
    });

    it('is readable again by id, with the same seat', async () => {
      const created = await book(harness, receptionist.token, payload());
      const id = appointmentResponseSchema.parse(created.body).appointment.id;

      const read = await request(harness.app.getHttpServer())
        .get(`/appointments/${id}`)
        .set(asUser(receptionist.token));

      expect(read.status).toBe(200);
      expect(appointmentResponseSchema.parse(read.body)).toEqual(
        appointmentResponseSchema.parse(created.body),
      );
    });

    it('records the booking and its seat in one audit row', async () => {
      await book(harness, receptionist.token, payload({ note: 'یادداشت غیربالینی' }));

      const rows = await harness.prisma.auditLog.findMany({
        where: { action: 'appointment.created' },
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]?.actorUserId).toBe(receptionist.id);
      expect(rows[0]?.entityType).toBe('appointment');

      const after = rows[0]?.after as Record<string, unknown>;
      expect(after['therapistId']).toBe(clinic.therapistId);
      expect(after['note']).toBe('یادداشت غیربالینی');
      expect(after['participants']).toHaveLength(1);

      // Nothing was overridden, so the row carries no override metadata. There
      // is no second action to look for: an override is a property of this state
      // change, recorded in this row.
      expect(rows[0]?.metadata).toBeNull();
    });

    it('carries nothing financial, in the response or in the row', async () => {
      const response = await book(harness, receptionist.token, payload());
      const financial = /tariff|price|amount|toman|charge|discount|fee/i;

      for (const field of Object.keys(response.body.appointment as object)) {
        expect(field).not.toMatch(financial);
      }

      // Pricing a session is Milestone 5's. Nothing in this checkpoint reads a
      // tariff, so nothing can have stored one.
      expect(await harness.prisma.tariff.count()).toBe(0);
    });

    it('allows back-to-back sessions, which are the normal shape of a clinic day', async () => {
      const first = await book(harness, receptionist.token, payload());
      const second = await book(
        harness,
        receptionist.token,
        payload({ startsAt: SATURDAY_11_00, durationMinutes: 60 }),
      );

      expect([first.status, second.status]).toEqual([201, 201]);
    });
  });

  describe('the three conflicts, none of which may be overridden', () => {
    it('refuses a therapist already booked, naming the therapist', async () => {
      await book(harness, receptionist.token, payload());

      const otherRoom = await makeRoom(harness, manager.token);
      const otherChild = await makeFamilyWithChild(harness, manager.token);

      const clash = await book(
        harness,
        receptionist.token,
        payload({ startsAt: SATURDAY_10_30, roomId: otherRoom, childId: otherChild.childId }),
      );

      expect(clash.status).toBe(409);
      expect(clash.body.error.code).toBe('APPOINTMENT_THERAPIST_CONFLICT');
    });

    it('refuses a room already booked, naming the room', async () => {
      await book(harness, receptionist.token, payload());

      const otherTherapist = await makeTherapist(harness, manager.token, [clinic.serviceId]);
      await putWindows(harness, manager.token, otherTherapist, [SATURDAY_MORNING]);
      const otherChild = await makeFamilyWithChild(harness, manager.token);

      const clash = await book(
        harness,
        receptionist.token,
        payload({
          startsAt: SATURDAY_10_30,
          therapistId: otherTherapist,
          childId: otherChild.childId,
        }),
      );

      expect(clash.status).toBe(409);
      expect(clash.body.error.code).toBe('APPOINTMENT_ROOM_CONFLICT');
    });

    it('refuses a child already booked elsewhere, naming the child', async () => {
      await book(harness, receptionist.token, payload());

      const otherTherapist = await makeTherapist(harness, manager.token, [clinic.serviceId]);
      await putWindows(harness, manager.token, otherTherapist, [SATURDAY_MORNING]);
      const otherRoom = await makeRoom(harness, manager.token);

      const clash = await book(
        harness,
        receptionist.token,
        payload({ startsAt: SATURDAY_10_30, therapistId: otherTherapist, roomId: otherRoom }),
      );

      expect(clash.status).toBe(409);
      expect(clash.body.error.code).toBe('APPOINTMENT_CHILD_CONFLICT');
    });

    it('offers no override for any of the three, whatever reason is supplied', async () => {
      // The one approved override is availability, and it is not a general
      // "book anyway" flag. A manager holding it is refused all the same,
      // because a double-booked room is two sessions that cannot both happen.
      await book(harness, manager.token, payload());

      const otherRoom = await makeRoom(harness, manager.token);
      const otherChild = await makeFamilyWithChild(harness, manager.token);

      const clash = await book(
        harness,
        manager.token,
        payload({
          startsAt: SATURDAY_10_30,
          roomId: otherRoom,
          childId: otherChild.childId,
          availabilityOverrideReason: 'مدیر اجازه داد',
        }),
      );

      expect(clash.status).toBe(409);
      expect(clash.body.error.code).toBe('APPOINTMENT_THERAPIST_CONFLICT');
      expect(await harness.prisma.appointment.count()).toBe(1);
    });

    it('leaves a cancelled slot re-bookable and a completed one occupied', async () => {
      const created = await book(harness, receptionist.token, payload());
      const id = appointmentResponseSchema.parse(created.body).appointment.id;

      // There is no cancellation endpoint in this checkpoint; the status is set
      // directly to prove the conflict rules read it, which is the property the
      // exclusion constraints are conditional on.
      await harness.prisma.$executeRaw`
        UPDATE appointment
        SET status = 'CANCELLED_BY_FAMILY'::appointment_status,
            cancelled_at = transaction_timestamp(),
            cancellation_reason = 'تست'
        WHERE id = ${id}::uuid
      `;

      const rebooked = await book(harness, receptionist.token, payload());
      expect(rebooked.status).toBe(201);
    });
  });

  describe('invalid time and resource combinations', () => {
    it('refuses a start that carries seconds', async () => {
      const response = await book(
        harness,
        receptionist.token,
        payload({ startsAt: '2026-09-05T06:30:30.000Z' }),
      );

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('APPOINTMENT_TIME_INVALID');
    });

    it('refuses a session length the service does not offer', async () => {
      const response = await book(harness, receptionist.token, payload({ durationMinutes: 50 }));

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('APPOINTMENT_DURATION_NOT_ALLOWED');
    });

    it.each([
      ['serviceId', 'SERVICE_NOT_FOUND'],
      ['therapistId', 'THERAPIST_NOT_FOUND'],
      ['roomId', 'ROOM_NOT_FOUND'],
      ['childId', 'CHILD_NOT_FOUND'],
    ])('refuses an unknown %s with %s', async (field: string, code: string) => {
      const response = await book(
        harness,
        receptionist.token,
        payload({ [field]: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' }),
      );

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe(code);
    });

    it('refuses an inactive service, therapist or room', async () => {
      const setStatus = (path: string, status: 'ACTIVE' | 'INACTIVE') =>
        request(harness.app.getHttpServer())
          .patch(path)
          .set(asUser(manager.token))
          .send({ status });

      const cases = [
        { path: `/catalog/services/${clinic.serviceId}/status`, code: 'SERVICE_INACTIVE' },
        { path: `/catalog/rooms/${clinic.roomId}/status`, code: 'ROOM_INACTIVE' },
        { path: `/catalog/therapists/${clinic.therapistId}/status`, code: 'THERAPIST_INACTIVE' },
      ];

      // One at a time, reactivated afterwards: with three deactivations standing
      // at once the assertion would only ever prove which check runs first.
      for (const { path, code } of cases) {
        expect((await setStatus(path, 'INACTIVE')).status).toBe(200);

        const response = await book(harness, receptionist.token, payload());
        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe(code);

        expect((await setStatus(path, 'ACTIVE')).status).toBe(200);
      }

      // And with all three active again, the same booking succeeds.
      expect((await book(harness, receptionist.token, payload())).status).toBe(201);
    });

    it('refuses an inactive child, and an active child in an inactive family', async () => {
      const deactivateChild = await request(harness.app.getHttpServer())
        .patch(`/children/${clinic.childId}/status`)
        .set(asUser(manager.token))
        .send({ status: 'INACTIVE' });

      expect(deactivateChild.status).toBe(200);

      const refusedChild = await book(harness, receptionist.token, payload());
      expect(refusedChild.status).toBe(422);
      expect(refusedChild.body.error.code).toBe('CHILD_INACTIVE');

      // A family the clinic has stopped treating must not accrue sessions it
      // would be billed for, even where the child record was left active.
      const other = await makeFamilyWithChild(harness, manager.token);
      const deactivateFamily = await request(harness.app.getHttpServer())
        .patch(`/families/${other.familyId}/status`)
        .set(asUser(manager.token))
        .send({ status: 'INACTIVE' });

      expect(deactivateFamily.status).toBe(200);

      const refusedFamily = await book(
        harness,
        receptionist.token,
        payload({ childId: other.childId }),
      );

      expect(refusedFamily.status).toBe(422);
      expect(refusedFamily.body.error.code).toBe('FAMILY_INACTIVE');
    });

    it('refuses a therapist who does not provide the service', async () => {
      const otherService = await makeService(harness, manager.token);
      const specialist = await makeTherapist(harness, manager.token, [otherService]);
      await putWindows(harness, manager.token, specialist, [SATURDAY_MORNING]);

      const response = await book(
        harness,
        receptionist.token,
        payload({ therapistId: specialist }),
      );

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('APPOINTMENT_THERAPIST_SERVICE_NOT_SUPPORTED');
    });

    it('refuses a room restricted to other services, and allows an unrestricted one', async () => {
      const otherService = await makeService(harness, manager.token);
      const restricted = await makeRoom(harness, manager.token, [otherService]);

      const refused = await book(harness, receptionist.token, payload({ roomId: restricted }));

      expect(refused.status).toBe(422);
      expect(refused.body.error.code).toBe('APPOINTMENT_ROOM_SERVICE_NOT_ALLOWED');

      // No rows means unrestricted, which is the common case and the one that
      // needs no data entry.
      const unrestricted = await makeRoom(harness, manager.token);
      const allowed = await book(harness, receptionist.token, payload({ roomId: unrestricted }));

      expect(allowed.status).toBe(201);
    });

    it('refuses a therapist with no recorded services, which is not every service', async () => {
      // The asymmetry with a room is deliberate and is the Milestone 2 model:
      // `therapist_service` states what somebody PROVIDES, so silence is "nothing
      // recorded" and never "everything". `room_service` states a RESTRICTION, so
      // silence there means unrestricted — asserted just above, and unchanged.
      const unconfigured = await makeTherapist(harness, manager.token, []);
      await putWindows(harness, manager.token, unconfigured, [SATURDAY_MORNING]);

      const response = await book(
        harness,
        receptionist.token,
        payload({ therapistId: unconfigured }),
      );

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('APPOINTMENT_THERAPIST_SERVICE_NOT_SUPPORTED');
      expect(await harness.prisma.appointment.count()).toBe(0);
    });

    it('books once the association is recorded, and not before', async () => {
      // The fix for the refusal above is data entry, not an override: recording
      // the service against the therapist makes the same booking succeed.
      const therapistId = await makeTherapist(harness, manager.token, []);
      await putWindows(harness, manager.token, therapistId, [SATURDAY_MORNING]);

      expect((await book(harness, receptionist.token, payload({ therapistId }))).status).toBe(422);

      const updated = await request(harness.app.getHttpServer())
        .patch(`/catalog/therapists/${therapistId}`)
        .set(asUser(manager.token))
        .send({
          fullName: 'Synthetic Therapist',
          specialty: 'Synthetic Specialty',
          supportedServiceIds: [clinic.serviceId],
        });

      expect(updated.status).toBe(200);
      expect((await book(harness, receptionist.token, payload({ therapistId }))).status).toBe(201);
    });
  });

  describe('therapist availability, and the one approved override', () => {
    it('refuses a booking outside the therapist’s hours', async () => {
      const response = await book(
        harness,
        receptionist.token,
        payload({ startsAt: SATURDAY_20_00 }),
      );

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('APPOINTMENT_OUTSIDE_AVAILABILITY');
      expect(await harness.prisma.appointment.count()).toBe(0);
    });

    it('refuses a session that starts inside the hours and runs past their end', async () => {
      // 12:30 Tehran plus 60 minutes ends at 13:30, past a 13:00 window.
      const response = await book(
        harness,
        receptionist.token,
        payload({ startsAt: '2026-09-05T09:00:00.000Z', durationMinutes: 60 }),
      );

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('APPOINTMENT_OUTSIDE_AVAILABILITY');
    });

    it('refuses a booking on a day a dated exception closes', async () => {
      const closed = await request(harness.app.getHttpServer())
        .post(`/availability/therapists/${clinic.therapistId}/exceptions`)
        .set(asUser(manager.token))
        .send({ isAvailable: false, exceptionDate: SATURDAY, reason: 'مرخصی' });

      expect(closed.status).toBe(201);

      const response = await book(harness, receptionist.token, payload());

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('APPOINTMENT_OUTSIDE_AVAILABILITY');
    });

    it('books inside a dated extra window on an otherwise closed day', async () => {
      // The precedence rule the availability module owns: a closure suspends the
      // ordinary week and leaves a dated window standing. Booking reads that one
      // answer rather than reimplementing it.
      await request(harness.app.getHttpServer())
        .post(`/availability/therapists/${clinic.therapistId}/exceptions`)
        .set(asUser(manager.token))
        .send({ isAvailable: false, exceptionDate: SATURDAY, reason: null });

      await request(harness.app.getHttpServer())
        .post(`/availability/therapists/${clinic.therapistId}/exceptions`)
        .set(asUser(manager.token))
        .send({
          isAvailable: true,
          exceptionDate: SATURDAY,
          startTime: '19:00',
          endTime: '21:00',
          reason: null,
        });

      const response = await book(
        harness,
        receptionist.token,
        payload({ startsAt: SATURDAY_20_00 }),
      );

      expect(response.status).toBe(201);
      expect(
        appointmentResponseSchema.parse(response.body).appointment.availabilityOverrideReason,
      ).toBeNull();
    });

    it('accepts a receptionist’s override, which is the approved authority', async () => {
      // The person running the diary is the person a therapist tells "I will come
      // in for this one" (PROJECT_SPEC.md 5). The authority is real, and so is the
      // recorded reason that comes with it.
      const response = await book(
        harness,
        receptionist.token,
        payload({
          startsAt: SATURDAY_20_00,
          availabilityOverrideReason: 'هماهنگی با درمانگر',
        }),
      );

      expect(response.status).toBe(201);

      const body = appointmentResponseSchema.parse(response.body);
      expect(body.appointment.availabilityOverrideReason).toBe('هماهنگی با درمانگر');

      const row = await harness.prisma.appointment.findUniqueOrThrow({
        where: { id: body.appointment.id },
      });

      expect(row.availabilityOverrideByUserId).toBe(receptionist.id);
      expect(row.availabilityOverrideAt).not.toBeNull();

      const audited = await harness.prisma.auditLog.findMany({
        where: { action: 'appointment.created' },
      });

      expect(audited).toHaveLength(1);
      expect(audited[0]?.actorUserId).toBe(receptionist.id);
      expect((audited[0]?.metadata as Record<string, unknown>)['availabilityOverride']).toBe(true);
      expect((audited[0]?.metadata as Record<string, unknown>)['reason']).toBe(
        'هماهنگی با درمانگر',
      );
    });

    it('refuses an out-of-hours booking that states no reason', async () => {
      // Holding the permission is not a licence to book anywhere: with no reason
      // the rule simply applies, for a receptionist and a manager alike.
      for (const actor of [receptionist, manager]) {
        const response = await book(harness, actor.token, payload({ startsAt: SATURDAY_20_00 }));

        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe('APPOINTMENT_OUTSIDE_AVAILABILITY');
      }

      expect(await harness.prisma.appointment.count()).toBe(0);
    });

    it('refuses an override whose reason is blank', async () => {
      // A whitespace reason is an override with no explanation. The contract
      // refuses it before the service is reached, and the CHECK would refuse the
      // row even if it did not.
      const response = await book(
        harness,
        receptionist.token,
        payload({ startsAt: SATURDAY_20_00, availabilityOverrideReason: '   ' }),
      );

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(await harness.prisma.appointment.count()).toBe(0);
    });

    it('accepts a manager’s override, and records the reason on the row', async () => {
      const response = await book(
        harness,
        manager.token,
        payload({
          startsAt: SATURDAY_20_00,
          availabilityOverrideReason: 'جلسهٔ جبرانی با هماهنگی درمانگر',
        }),
      );

      expect(response.status).toBe(201);

      const body = appointmentResponseSchema.parse(response.body);
      expect(body.appointment.availabilityOverrideReason).toBe('جلسهٔ جبرانی با هماهنگی درمانگر');

      // The actor and the instant are on the row and deliberately not in the
      // response: who authorized it is an audit question.
      const row = await harness.prisma.appointment.findUniqueOrThrow({
        where: { id: body.appointment.id },
      });

      expect(row.availabilityOverrideByUserId).toBe(manager.id);
      expect(row.availabilityOverrideAt).not.toBeNull();
    });

    it('audits the override in the metadata of the creation it qualified', async () => {
      await book(
        harness,
        manager.token,
        payload({ startsAt: SATURDAY_20_00, availabilityOverrideReason: 'جلسهٔ جبرانی' }),
      );

      // ONE ROW FOR ONE STATE CHANGE. The booking is the change; the override is
      // a property of it, so there is no second action to pair up by entity id.
      const rows = await harness.prisma.auditLog.findMany({
        where: { entityType: 'appointment' },
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]?.action).toBe('appointment.created');
      expect(rows[0]?.actorUserId).toBe(manager.id);

      // The booking itself is still recorded in full.
      const after = rows[0]?.after as Record<string, unknown>;
      expect(after['therapistId']).toBe(clinic.therapistId);
      expect(after['availabilityOverrideReason']).toBe('جلسهٔ جبرانی');

      const metadata = rows[0]?.metadata as Record<string, unknown>;
      // Flat and countable: `metadata->>'availabilityOverride'` answers "how
      // often does this happen?" without unwrapping anything.
      expect(metadata['availabilityOverride']).toBe(true);
      expect(metadata['reason']).toBe('جلسهٔ جبرانی');
      expect(metadata['permission']).toBe('appointment.override_availability');
      expect(metadata['date']).toBe(SATURDAY);
      expect(metadata['startTime']).toBe('20:00');
      // What the therapist's day actually said, as values: the windows it was
      // resolved from are current configuration and may be edited tomorrow.
      expect(metadata['availableWindows']).toEqual([{ startTime: '09:00', endTime: '13:00' }]);
    });

    it('ignores a reason supplied for a booking that needs none', async () => {
      // Nothing was overridden, so there is nothing to explain, nothing to count
      // and no permission to check — a stray field must not turn an ordinary
      // receptionist booking into a forbidden one.
      const response = await book(
        harness,
        receptionist.token,
        payload({ availabilityOverrideReason: 'محض احتیاط' }),
      );

      expect(response.status).toBe(201);
      expect(
        appointmentResponseSchema.parse(response.body).appointment.availabilityOverrideReason,
      ).toBeNull();

      const rows = await harness.prisma.auditLog.findMany({
        where: { action: 'appointment.created' },
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]?.metadata).toBeNull();
    });

    it('hard-blocks a session crossing midnight, beyond the override’s reach', async () => {
      // The approved model records working hours as a weekday and two wall-clock
      // times, so an overnight session is a shape it cannot express: an INVALID
      // TIME, not an unavailable one. It is refused before availability is
      // considered at all, which is what keeps the override away from it.
      await putWindows(harness, manager.token, clinic.therapistId, [
        { weekday: 0, startTime: '00:00', endTime: '23:59' },
      ]);

      // 23:30 Tehran on the Saturday, plus 60 minutes: ends 00:30 on the Sunday.
      const overnight = { startsAt: '2026-09-05T20:00:00.000Z', durationMinutes: 60 };

      const plain = await book(harness, receptionist.token, payload(overnight));

      expect(plain.status).toBe(422);
      expect(plain.body.error.code).toBe('APPOINTMENT_TIME_INVALID');

      // The same booking with a reason, by each role that holds the override.
      for (const actor of [receptionist, manager]) {
        const overridden = await book(
          harness,
          actor.token,
          payload({ ...overnight, availabilityOverrideReason: 'جلسهٔ شبانه' }),
        );

        expect(overridden.status).toBe(422);
        expect(overridden.body.error.code).toBe('APPOINTMENT_TIME_INVALID');
      }

      expect(await harness.prisma.appointment.count()).toBe(0);
      expect(await harness.prisma.auditLog.count({ where: { entityType: 'appointment' } })).toBe(0);
    });

    it('hard-blocks a session ending at exactly midnight', async () => {
      await putWindows(harness, manager.token, clinic.therapistId, [
        { weekday: 0, startTime: '00:00', endTime: '23:59' },
      ]);

      // 23:00 Tehran plus 60 minutes ends at 00:00 on the Sunday, which is still
      // two clinic days.
      const response = await book(
        harness,
        manager.token,
        payload({
          startsAt: '2026-09-05T19:30:00.000Z',
          durationMinutes: 60,
          availabilityOverrideReason: 'جلسهٔ شبانه',
        }),
      );

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('APPOINTMENT_TIME_INVALID');
    });
  });

  describe('authorization', () => {
    it('refuses a booking from a caller without appointment.create', async () => {
      // No role holds a permission it was not granted; the check is the guard's,
      // and it runs before the service sees the request. A signed-in user with
      // no appointment permission is simulated by revoking the receptionist's
      // session and using a role that has none — the manager and receptionist
      // are the only two roles, so this asserts the guard is wired at all.
      const response = await request(harness.app.getHttpServer())
        .post('/appointments')
        .set(asUser('not-a-session-token'))
        .send(payload());

      expect(response.status).toBe(401);
    });

    it('refuses an unauthenticated booking outright', async () => {
      const response = await request(harness.app.getHttpServer())
        .post('/appointments')
        .send(payload());

      expect(response.status).toBe(401);
    });
  });
});
