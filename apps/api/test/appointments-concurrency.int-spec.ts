import { createHarness, resetDatabase, type Harness } from './harness';
import {
  book,
  bookingPayload,
  makeFamilyWithChild,
  makeRoom,
  makeTherapist,
  putWindows,
  SATURDAY_10_00,
  SATURDAY_10_30,
  SATURDAY_MORNING,
  seedClinic,
  signIn,
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
    await resetDatabase(harness.prisma);
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
});
