import {
  appointmentDayResponseSchema,
  appointmentViewResponseSchema,
  type AppointmentView,
} from '@clinic/contracts';
import { createHarness, resetDatabase, type Harness } from './harness';
import {
  bookId,
  bookingPayload,
  cancel,
  complete,
  futureSaturday,
  makeFamilyWithChild,
  makeRoom,
  makeService,
  makeTariff,
  makeTherapist,
  pastSaturday,
  putWindows,
  readDay,
  readView,
  recordAttendance,
  SATURDAY,
  SATURDAY_10_00,
  SATURDAY_11_00,
  SATURDAY_MORNING,
  seedClinic,
  signIn,
} from './appointments-support';

/**
 * The single-day operational read model, over real HTTP against real
 * PostgreSQL.
 *
 * This is the screen the clinic keeps open all day: today's appointments, whose
 * outcome nobody has entered, what was cancelled, who did not arrive, and what
 * each session currently costs according to the price list. Everything is
 * synthetic.
 *
 * TWO PROPERTIES MATTER MOST HERE and are asserted repeatedly:
 *
 *   * the tariff is a SUGGESTION — resolved on the read, stored nowhere, and
 *     never able to fail the day;
 *   * a cancelled appointment stays in its day, because the clinic has to see
 *     the hole in the diary.
 */
describe('appointment day view (real PostgreSQL)', () => {
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

  const day = async (query: Record<string, string> = {}) => {
    const response = await readDay(harness, receptionist.token, { date: SATURDAY, ...query });

    expect(response.status).toBe(200);
    return appointmentDayResponseSchema.parse(response.body);
  };

  const seatOf = (view: AppointmentView): string => {
    const seat = view.participants[0];
    if (seat === undefined) throw new Error('the fixture booking has no seat');
    return seat.participant.id;
  };

  describe('the day itself', () => {
    it('returns the day’s appointments in start order, with every name resolved', async () => {
      await bookId(harness, receptionist.token, payload({ startsAt: SATURDAY_11_00 }));
      await bookId(harness, receptionist.token, payload());

      const body = await day();

      expect(body.date).toBe(SATURDAY);
      expect(body.appointments.map((view) => view.appointment.startsAt)).toEqual([
        SATURDAY_10_00,
        SATURDAY_11_00,
      ]);

      const first = body.appointments[0];
      expect(first?.therapist.id).toBe(clinic.therapistId);
      expect(first?.therapist.fullName).toMatch(/Synthetic Therapist/);
      expect(first?.room.id).toBe(clinic.roomId);
      expect(first?.service.id).toBe(clinic.serviceId);

      // The child is named and reachable: a day list a receptionist can read
      // without a second round trip per row.
      const seat = first?.participants[0];
      expect(seat?.child.id).toBe(clinic.childId);
      expect(seat?.child.familyId).toBe(clinic.familyId);
      expect(seat?.child.firstName).toBe('کودک');
      expect(seat?.child.fileNumber).toMatch(/^\d{5,10}$/);
      expect(seat?.participant.attendance).toBe('PENDING');
    });

    it('carries no sensitive field on the child', async () => {
      await bookId(harness, receptionist.token, payload());

      const body = await day();
      const child = body.appointments[0]?.participants[0]?.child;

      // A strict schema already refuses an extra key; this states which keys
      // were deliberately kept out of a list read at a reception desk.
      for (const sensitive of ['nationalId', 'birthDate', 'mobile', 'address']) {
        expect(child).not.toHaveProperty(sensitive);
      }
    });

    it('is empty for a day with nothing in it, rather than an error', async () => {
      const body = await day({ date: '2026-09-12' });

      expect(body.appointments).toEqual([]);
      expect(body.summary.total).toBe(0);
    });

    it('reads the day in the clinic’s own timezone, not UTC', async () => {
      // 00:30 Tehran on Sunday is 21:00 UTC on Saturday. The clinic day it
      // belongs to is the Sunday, and a UTC reading would file it under
      // Saturday.
      const justAfterMidnight = '2026-09-05T21:00:00.000Z';
      await putWindows(harness, manager.token, clinic.therapistId, [
        SATURDAY_MORNING,
        { weekday: 1, startTime: '00:00', endTime: '02:00' },
      ]);
      await bookId(harness, receptionist.token, payload({ startsAt: justAfterMidnight }));

      expect((await day()).appointments).toHaveLength(0);
      expect((await day({ date: '2026-09-06' })).appointments).toHaveLength(1);
    });

    it('narrows to one therapist or one room, and to nothing else', async () => {
      const therapistB = await makeTherapist(harness, manager.token, [clinic.serviceId]);
      const roomB = await makeRoom(harness, manager.token);
      const other = await makeFamilyWithChild(harness, manager.token);
      await putWindows(harness, manager.token, therapistB, [SATURDAY_MORNING]);

      await bookId(harness, receptionist.token, payload());
      await bookId(
        harness,
        receptionist.token,
        payload({ therapistId: therapistB, roomId: roomB, childId: other.childId }),
      );

      expect((await day()).appointments).toHaveLength(2);
      expect((await day({ therapistId: therapistB })).appointments).toHaveLength(1);
      expect((await day({ roomId: clinic.roomId })).appointments).toHaveLength(1);
    });

    it('refuses a query that is not one clinic day', async () => {
      for (const query of [{}, { date: 'today' }, { date: SATURDAY, childName: 'کودک' }]) {
        const response = await readDay(
          harness,
          receptionist.token,
          query as Record<string, string>,
        );

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      }
    });
  });

  describe('what the receptionist has to see', () => {
    it('keeps a cancelled appointment in its day, with the reason', async () => {
      const id = await bookId(harness, receptionist.token, payload());
      await cancel(harness, receptionist.token, id, {
        cancelledBy: 'FAMILY',
        reason: 'بیماری کودک',
      });

      const body = await day();

      expect(body.appointments).toHaveLength(1);
      expect(body.appointments[0]?.appointment.status).toBe('CANCELLED_BY_FAMILY');
      expect(body.appointments[0]?.appointment.cancellationReason).toBe('بیماری کودک');
      expect(body.summary.cancelled).toBe(1);
      // A cancelled session has no outcome to record: nothing happened.
      expect(body.summary.unresolvedOutcomes).toBe(0);
    });

    it('flags a session that is over and whose outcome nobody entered', async () => {
      const past = pastSaturday();
      const future = futureSaturday();

      await bookId(harness, receptionist.token, payload({ startsAt: past.startsAt }));
      await bookId(harness, receptionist.token, payload({ startsAt: future.startsAt }));

      const finished = await day({ date: past.date });
      expect(finished.appointments[0]?.outcomeUnresolved).toBe(true);
      expect(finished.summary.unresolvedOutcomes).toBe(1);

      // A session still ahead of the clock is not outstanding work.
      const upcoming = await day({ date: future.date });
      expect(upcoming.appointments[0]?.outcomeUnresolved).toBe(false);
      expect(upcoming.summary.unresolvedOutcomes).toBe(0);
    });

    it('stops flagging it once the outcome is recorded', async () => {
      const past = pastSaturday();
      const id = await bookId(harness, receptionist.token, payload({ startsAt: past.startsAt }));

      const before = await day({ date: past.date });
      const seat = seatOf(before.appointments[0] as AppointmentView);

      await recordAttendance(harness, receptionist.token, id, seat, 'NO_SHOW');

      const after = await day({ date: past.date });
      expect(after.appointments[0]?.outcomeUnresolved).toBe(false);
      expect(after.summary.unresolvedOutcomes).toBe(0);
      expect(after.summary.noShows).toBe(1);
    });

    it('counts the day as the dashboard reads it', async () => {
      const other = await makeFamilyWithChild(harness, manager.token);
      const third = await makeFamilyWithChild(harness, manager.token);

      const completed = await bookId(harness, receptionist.token, payload());
      const cancelled = await bookId(
        harness,
        receptionist.token,
        payload({ startsAt: SATURDAY_11_00, childId: other.childId }),
      );
      // 12:00 Tehran: inside the 09:00–13:00 week and clear of both other rows.
      await bookId(
        harness,
        receptionist.token,
        payload({ startsAt: '2026-09-05T08:30:00.000Z', childId: third.childId }),
      );

      await complete(harness, receptionist.token, completed);
      await cancel(harness, receptionist.token, cancelled, {
        cancelledBy: 'CLINIC',
        reason: 'تعطیلی اضطراری',
      });

      const body = await day();

      expect(body.summary.total).toBe(3);
      expect(body.summary.completed).toBe(1);
      expect(body.summary.cancelled).toBe(1);
      expect(body.summary.scheduled).toBe(1);
      // The counts describe exactly the rows returned beside them.
      expect(body.summary.total).toBe(body.appointments.length);
    });
  });

  describe('the tariff suggestion', () => {
    it('resolves the price the clinic’s list currently states', async () => {
      const tariffId = await makeTariff(harness, manager.token, { serviceId: clinic.serviceId });
      await bookId(harness, receptionist.token, payload());

      const body = await day();
      const suggestion = body.appointments[0]?.tariffSuggestion;

      expect(suggestion).toEqual({
        status: 'RESOLVED',
        tariffId,
        priceMode: 'PAID',
        priceToman: '250000',
      });
    });

    it('prefers a therapist-specific price, exactly as tariff resolution does', async () => {
      await makeTariff(harness, manager.token, { serviceId: clinic.serviceId });
      const specific = await makeTariff(harness, manager.token, {
        serviceId: clinic.serviceId,
        therapistId: clinic.therapistId,
        priceToman: '310000',
      });

      await bookId(harness, receptionist.token, payload());

      const suggestion = (await day()).appointments[0]?.tariffSuggestion;

      expect(suggestion).toEqual({
        status: 'RESOLVED',
        tariffId: specific,
        priceMode: 'PAID',
        priceToman: '310000',
      });
    });

    it('shows a missing price without failing the day', async () => {
      const priced = await makeService(harness, manager.token);
      await makeTariff(harness, manager.token, { serviceId: priced });
      const therapistB = await makeTherapist(harness, manager.token, [priced]);
      const roomB = await makeRoom(harness, manager.token);
      const other = await makeFamilyWithChild(harness, manager.token);
      await putWindows(harness, manager.token, therapistB, [SATURDAY_MORNING]);

      // The fixture service has no tariff at all; the second one does.
      await bookId(harness, receptionist.token, payload());
      await bookId(
        harness,
        receptionist.token,
        payload({
          serviceId: priced,
          therapistId: therapistB,
          roomId: roomB,
          childId: other.childId,
        }),
      );

      const body = await day();

      // Visible, not raised, and the priced session beside it is unaffected.
      expect(body.appointments).toHaveLength(2);
      expect(body.appointments.map((view) => view.tariffSuggestion.status).sort()).toEqual([
        'MISSING',
        'RESOLVED',
      ]);
    });

    it('is stored nowhere: it is recomputed, so a later price change moves it', async () => {
      const first = await makeTariff(harness, manager.token, { serviceId: clinic.serviceId });
      const id = await bookId(harness, receptionist.token, payload());

      expect((await day()).appointments[0]?.tariffSuggestion).toMatchObject({ tariffId: first });

      // The approved way a price changes: the old row is voided and a
      // replacement written, never edited in place.
      const replacement = await makeTariff(harness, manager.token, {
        serviceId: clinic.serviceId,
        priceToman: '400000',
        supersedesTariffId: first,
      });

      const suggestion = (await day()).appointments[0]?.tariffSuggestion;
      expect(suggestion).toEqual({
        status: 'RESOLVED',
        tariffId: replacement,
        priceMode: 'PAID',
        priceToman: '400000',
      });

      // Nothing about the price is on the appointment row itself.
      const stored = await harness.prisma.appointment.findUniqueOrThrow({ where: { id } });
      for (const column of Object.keys(stored)) {
        expect(column).not.toMatch(/tariff|price|amount|toman|charge|discount|fee/i);
      }
    });

    it('never blocks the workflow: an unpriced session can still be booked and completed', async () => {
      const id = await bookId(harness, receptionist.token, payload());

      expect((await day()).appointments[0]?.tariffSuggestion.status).toBe('MISSING');
      expect((await complete(harness, receptionist.token, id)).status).toBe(200);
    });
  });

  describe('one appointment, in the same shape', () => {
    it('renders a single appointment exactly as its day row does', async () => {
      await makeTariff(harness, manager.token, { serviceId: clinic.serviceId });
      const id = await bookId(harness, receptionist.token, payload());

      const response = await readView(harness, receptionist.token, id);

      expect(response.status).toBe(200);

      const view = appointmentViewResponseSchema.parse(response.body);
      const row = (await day()).appointments[0];

      expect(view).toEqual(row);
    });

    it('answers 404 for an appointment that does not exist', async () => {
      const response = await readView(
        harness,
        receptionist.token,
        '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      );

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('APPOINTMENT_NOT_FOUND');
    });
  });
});
