import request from 'supertest';
import {
  appointmentConflictDetailsSchema,
  availabilityRefusalDetailsSchema,
  recurrencePreviewResponseSchema,
} from '@clinic/contracts';
import { AppError } from '../src/common/app-error';
import { uuidv7 } from '../src/common/uuid';
import { SchedulingRules } from '../src/appointments/scheduling-rules';
import { actorSession, createHarness, resetDatabase, type Harness } from './harness';
import {
  asUser,
  book,
  bookId,
  bookingPayload,
  makeFamilyWithChild,
  makeRoom,
  makeTherapist,
  move,
  movePayload,
  previewSeries,
  putWindows,
  SATURDAY,
  SATURDAY_10_00,
  SATURDAY_10_30,
  SATURDAY_11_00,
  SATURDAY_20_00,
  SATURDAY_MORNING,
  seedClinic,
  seriesPayload,
  signIn,
} from './appointments-support';

/**
 * Refusals that explain themselves (M10-A10, T-024 and T-025), over real HTTP
 * against real PostgreSQL.
 *
 * A conflict names every busy dimension at once — child, therapist, room — with
 * the sessions in the way; an availability refusal says why the hour is
 * outside, and whether this caller could override it. The same for a move and
 * for the series preview. The codes are unchanged, so a caller reading only the
 * code is unaffected.
 */
describe('scheduling refusal details (real PostgreSQL)', () => {
  let harness: Harness;
  let manager: { id: string; token: string };
  let receptionist: { id: string; token: string };
  let clinic: Awaited<ReturnType<typeof seedClinic>>;

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

  const otherTherapist = async () => {
    const id = await makeTherapist(harness, manager.token, [clinic.serviceId]);
    expect((await putWindows(harness, manager.token, id, [SATURDAY_MORNING])).status).toBe(200);
    return id;
  };

  const close = (body: Record<string, unknown>) =>
    request(harness.app.getHttpServer())
      .post(`/availability/therapists/${clinic.therapistId}/exceptions`)
      .set(asUser(manager.token))
      .send({ isAvailable: false, exceptionDate: SATURDAY, reason: null, ...body });

  describe('conflicts', () => {
    it('names the child, the therapist and the room at once when all three are busy', async () => {
      const first = await bookId(harness, receptionist.token, payload());

      const response = await book(
        harness,
        receptionist.token,
        payload({ startsAt: SATURDAY_10_30 }),
      );

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('APPOINTMENT_CHILD_CONFLICT');
      const { conflicts } = appointmentConflictDetailsSchema.parse(response.body.error.details);
      expect(conflicts).toEqual([
        {
          resource: 'CHILD',
          resourceId: clinic.childId,
          appointmentId: first,
          startsAt: SATURDAY_10_00,
          endsAt: '2026-09-05T07:15:00.000Z',
        },
        expect.objectContaining({ resource: 'THERAPIST', resourceId: clinic.therapistId }),
        expect.objectContaining({ resource: 'ROOM', resourceId: clinic.roomId }),
      ]);
      expect(new Set(conflicts.map((conflict) => conflict.appointmentId))).toEqual(
        new Set([first]),
      );
    });

    it('names only the dimensions that are busy, the first one as the code', async () => {
      const first = await bookId(harness, receptionist.token, payload());
      const other = await makeFamilyWithChild(harness, manager.token);

      const response = await book(
        harness,
        receptionist.token,
        payload({ childId: other.childId, startsAt: SATURDAY_10_30 }),
      );

      expect(response.body.error.code).toBe('APPOINTMENT_THERAPIST_CONFLICT');
      const { conflicts } = appointmentConflictDetailsSchema.parse(response.body.error.details);
      expect(conflicts.map((conflict) => [conflict.resource, conflict.appointmentId])).toEqual([
        ['THERAPIST', first],
        ['ROOM', first],
      ]);

      const roomOnly = await book(
        harness,
        receptionist.token,
        payload({
          childId: other.childId,
          therapistId: await otherTherapist(),
          startsAt: SATURDAY_10_30,
        }),
      );
      expect(roomOnly.body.error.code).toBe('APPOINTMENT_ROOM_CONFLICT');
      expect(
        appointmentConflictDetailsSchema
          .parse(roomOnly.body.error.details)
          .conflicts.map((conflict) => conflict.resource),
      ).toEqual(['ROOM']);
    });

    it('lists two different sessions when the child and the room are busy with each', async () => {
      const childBusy = await bookId(harness, receptionist.token, payload());
      const other = await makeFamilyWithChild(harness, manager.token);
      const secondRoom = await makeRoom(harness, manager.token);
      const roomBusy = await bookId(
        harness,
        receptionist.token,
        payload({
          childId: other.childId,
          therapistId: await otherTherapist(),
          roomId: secondRoom,
          startsAt: SATURDAY_11_00,
        }),
      );

      // A third therapist, so only the child (10:00) and the room (11:00) clash.
      const third = await otherTherapist();
      const response = await book(
        harness,
        receptionist.token,
        payload({ therapistId: third, roomId: secondRoom, startsAt: SATURDAY_10_30 }),
      );

      expect(response.body.error.code).toBe('APPOINTMENT_CHILD_CONFLICT');
      expect(
        appointmentConflictDetailsSchema
          .parse(response.body.error.details)
          .conflicts.map((conflict) => [conflict.resource, conflict.appointmentId]),
      ).toEqual([
        ['CHILD', childBusy],
        ['ROOM', roomBusy],
      ]);
    });

    it('describes a move the same way, never counting the position it leaves', async () => {
      const blocking = await bookId(harness, receptionist.token, payload());
      const other = await makeFamilyWithChild(harness, manager.token);
      const moving = await bookId(
        harness,
        receptionist.token,
        payload({
          childId: other.childId,
          therapistId: await otherTherapist(),
          roomId: await makeRoom(harness, manager.token),
          startsAt: SATURDAY_11_00,
        }),
      );

      const response = await move(
        harness,
        receptionist.token,
        moving,
        movePayload(clinic, { startsAt: SATURDAY_10_30 }),
      );

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('APPOINTMENT_THERAPIST_CONFLICT');
      const { conflicts } = appointmentConflictDetailsSchema.parse(response.body.error.details);
      expect(conflicts.every((conflict) => conflict.appointmentId === blocking)).toBe(true);
      expect(conflicts.map((conflict) => conflict.resource)).toEqual(['THERAPIST', 'ROOM']);
    });

    it('describes the loser of a simultaneous booking too, every time', async () => {
      const children = [clinic.childId];
      for (let i = 0; i < 5; i += 1) {
        children.push((await makeFamilyWithChild(harness, manager.token)).childId);
      }

      for (let round = 0; round < 10; round += 1) {
        const startsAt = new Date(
          Date.parse(SATURDAY_10_00) + round * 7 * 86_400_000,
        ).toISOString();
        const [left, right] = await Promise.all([
          book(harness, receptionist.token, payload({ childId: children[round % 6], startsAt })),
          book(harness, manager.token, payload({ childId: children[(round + 1) % 6], startsAt })),
        ]);

        const statuses = [left.status, right.status].sort();
        expect(statuses).toEqual([201, 409]);
        const loser = left.status === 409 ? left : right;
        const winner = left.status === 201 ? left : right;

        expect(loser.body.error.code).toBe('APPOINTMENT_THERAPIST_CONFLICT');
        const { conflicts } = appointmentConflictDetailsSchema.parse(loser.body.error.details);
        expect(conflicts.map((conflict) => conflict.resource)).toEqual(['THERAPIST', 'ROOM']);
        expect(conflicts[0]?.appointmentId).toBe(winner.body.appointment.id);
      }
    });

    it('describes a refusal raised by the exclusion constraint itself, and the transaction survives it', async () => {
      // The path a lost race takes: the pre-check saw nothing, the constraint
      // fired on the write. Reached directly by skipping the pre-check.
      const blocking = await bookId(harness, receptionist.token, payload());
      const other = await makeFamilyWithChild(harness, manager.token);
      const rules = harness.app.get(SchedulingRules);

      const outcome = await harness.prisma.$transaction(async (tx) => {
        let caught: unknown;
        try {
          await rules.insertAppointment(tx, {
            appointmentId: uuidv7(),
            seriesId: null,
            serviceId: clinic.serviceId,
            placement: {
              durationMinutes: 45,
              therapistId: clinic.therapistId,
              roomId: clinic.roomId,
              startsAt: SATURDAY_10_30,
            },
            note: null,
            overrideReason: null,
            actor: actorSession(manager.id),
            childIds: [other.childId],
          });
        } catch (error) {
          caught = error;
        }
        // Rolled back to the savepoint: the transaction still answers.
        const alive = await tx.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`;
        return { caught, alive: alive[0]?.ok };
      });

      expect(outcome.alive).toBe(1);
      expect(outcome.caught).toBeInstanceOf(AppError);
      const error = outcome.caught as AppError;
      expect(error.code).toBe('APPOINTMENT_THERAPIST_CONFLICT');
      expect(
        appointmentConflictDetailsSchema
          .parse(error.details)
          .conflicts.map((conflict) => [conflict.resource, conflict.appointmentId]),
      ).toEqual([
        ['THERAPIST', blocking],
        ['ROOM', blocking],
      ]);
    });
  });

  describe('outside availability', () => {
    it('says the hour is outside the weekly hours, and that this caller may override', async () => {
      const response = await book(
        harness,
        receptionist.token,
        payload({ startsAt: SATURDAY_20_00 }),
      );

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('APPOINTMENT_OUTSIDE_AVAILABILITY');
      expect(availabilityRefusalDetailsSchema.parse(response.body.error.details)).toEqual({
        reason: 'OUTSIDE_WORKING_HOURS',
        date: SATURDAY,
        startTime: '20:00',
        endTime: '20:45',
        availableWindows: [{ startTime: '09:00', endTime: '13:00' }],
        closedRanges: [],
        overridable: true,
      });
    });

    it('says the day is closed', async () => {
      expect((await close({ reason: 'مرخصی' })).status).toBe(201);

      const response = await book(harness, receptionist.token, payload());

      expect(availabilityRefusalDetailsSchema.parse(response.body.error.details)).toMatchObject({
        reason: 'CLOSED_DAY',
        availableWindows: [],
      });
    });

    it('says a partial closure is in the way, and where it is', async () => {
      expect((await close({ startTime: '10:15', endTime: '11:00' })).status).toBe(201);

      const response = await book(harness, receptionist.token, payload());

      expect(availabilityRefusalDetailsSchema.parse(response.body.error.details)).toMatchObject({
        reason: 'PARTIAL_CLOSURE',
        closedRanges: [{ startTime: '10:15', endTime: '11:00' }],
        availableWindows: [
          { startTime: '09:00', endTime: '10:15' },
          { startTime: '11:00', endTime: '13:00' },
        ],
      });
    });

    it('says the same for a move', async () => {
      const id = await bookId(harness, receptionist.token, payload());

      const response = await move(
        harness,
        receptionist.token,
        id,
        movePayload(clinic, { startsAt: SATURDAY_20_00 }),
      );

      expect(response.body.error.code).toBe('APPOINTMENT_OUTSIDE_AVAILABILITY');
      expect(response.body.error.details.reason).toBe('OUTSIDE_WORKING_HOURS');
    });
  });

  describe('the series preview', () => {
    it('gives each week its reason and every conflict', async () => {
      // Week two: closed by a partial closure. Week three: the room is taken.
      expect(
        (await close({ exceptionDate: '2026-09-12', startTime: '10:00', endTime: '10:30' })).status,
      ).toBe(201);
      const other = await makeFamilyWithChild(harness, manager.token);
      const roomTaken = await bookId(
        harness,
        receptionist.token,
        payload({
          childId: other.childId,
          therapistId: await otherTherapist(),
          startsAt: '2026-09-19T06:30:00.000Z',
        }),
      );

      const response = await previewSeries(harness, receptionist.token, seriesPayload(clinic));
      expect(response.status).toBe(200);
      const { occurrences } = recurrencePreviewResponseSchema.parse(response.body);

      expect(occurrences.map((each) => [each.outsideAvailabilityReason, each.blockedBy])).toEqual([
        [null, null],
        ['PARTIAL_CLOSURE', 'APPOINTMENT_OUTSIDE_AVAILABILITY'],
        [null, 'APPOINTMENT_ROOM_CONFLICT'],
      ]);
      expect(occurrences[2]?.conflicts).toEqual([
        expect.objectContaining({ resource: 'ROOM', appointmentId: roomTaken }),
      ]);
      expect(occurrences[0]?.conflicts).toEqual([]);
    });
  });
});
