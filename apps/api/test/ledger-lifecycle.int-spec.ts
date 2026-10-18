import { appointmentResponseSchema } from '@clinic/contracts';
import {
  makeTherapist,
  move,
  movePayload,
  putWindows,
  reopen,
  SATURDAY_10_00,
  SATURDAY_MORNING,
} from './appointments-support';
import { createHarness, resetDatabase, type Harness } from './harness';
import {
  insertAdjustment,
  insertCharge,
  seedChargeableSession,
  sqlStateOf,
  voidCharge,
  type LedgerFixture,
} from './ledger-support';

/**
 * The interaction between a financial snapshot and the appointment lifecycle.
 *
 * THE REGRESSION THIS FILE EXISTS FOR. An earlier draft of the Milestone 5
 * migration keyed the charge's snapshot columns —
 * `(appointment_id, service_id, duration_minutes, therapist_id)` — to
 * `appointment` with ON UPDATE RESTRICT, so that the snapshot and the booking
 * were provably one session. It made them one session PERMANENTLY, which is a
 * different and wrong thing: the accepted Milestone 4 lifecycle allows a
 * completed appointment to be reopened once its charge is voided, and a reopened
 * SCHEDULED booking to be moved to another therapist or another length. The
 * placement key would have refused that move for the lifetime of a charge that
 * had already been withdrawn — a piece of financial history vetoing the future.
 *
 * The rule the corrected design states: FINANCIAL HISTORY RECORDS WHAT HAPPENED
 * AND DOES NOT CONSTRAIN WHAT HAPPENS NEXT. The voided charge keeps its own
 * therapist, service and length exactly as raised; the appointment moves on.
 *
 * Everything here runs through the real Milestone 4 endpoints — reopen and move
 * — rather than through a second lifecycle written for the test, because the
 * claim being made is about that lifecycle and not about an imitation of it.
 */
describe('ledger snapshots and the appointment lifecycle', () => {
  let harness: Harness;
  let fixture: LedgerFixture;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    fixture = await seedChargeableSession(harness);
  });

  const placement = (overrides: Record<string, unknown> = {}) =>
    movePayload(
      { therapistId: fixture.therapistId, roomId: '' },
      { startsAt: SATURDAY_10_00, ...overrides },
    );

  /** The room the fixture booked into, which a move must restate. */
  async function bookedRoomId(): Promise<string> {
    const appointment = await harness.prisma.appointment.findUniqueOrThrow({
      where: { id: fixture.appointmentId },
    });

    return appointment.roomId;
  }

  /**
   * A second therapist who supports the same service and works the same Saturday
   * morning.
   *
   * The working hours matter: a move to a therapist with no availability is
   * refused as `THERAPIST_UNAVAILABLE`, which would make this suite pass for a
   * reason that has nothing to do with the charge.
   */
  async function replacementTherapist(): Promise<string> {
    const id = await makeTherapist(harness, fixture.managerToken, [fixture.serviceId]);
    const windows = await putWindows(harness, fixture.managerToken, id, [SATURDAY_MORNING]);
    expect(windows.status).toBe(200);

    return id;
  }

  /**
   * Moves the reopened booking to another therapist and another length, and
   * fails loudly if the move is refused.
   *
   * This is the request the rejected design would have blocked, so every test
   * here asserts it succeeded rather than assuming it.
   */
  async function moveToReplacement(replacement: string, roomId: string): Promise<void> {
    const moved = await move(
      harness,
      fixture.managerToken,
      fixture.appointmentId,
      placement({ therapistId: replacement, roomId, durationMinutes: 60 }),
    );

    if (moved.status !== 200) {
      throw new Error(
        `Move was refused with ${String(moved.status)} ` +
          `(${String(moved.body?.error?.code ?? 'no code')})`,
      );
    }
  }

  it('does not pin the appointment to the therapist or length a voided charge recorded', async () => {
    const roomId = await bookedRoomId();

    // A charge was raised for the session as it happened: this therapist, 45
    // minutes.
    const chargeId = await insertCharge(harness, fixture, {
      durationMinutes: 45,
      amountToman: '250000',
    });

    // It was wrong, so it is voided — and only then may the completion be
    // reversed. That ordering is the approved one: reopening a completion voids
    // or offsets a financial record rather than deleting it.
    await voidCharge(harness, fixture, chargeId);

    const reopened = await reopen(harness, fixture.managerToken, fixture.appointmentId, 'اصلاح');
    expect(reopened.status).toBe(200);
    expect(appointmentResponseSchema.parse(reopened.body).appointment.status).toBe('SCHEDULED');

    // A different therapist, who supports the same service, and a different
    // approved length. Under the rejected design this request would have been
    // refused by a foreign key on behalf of a charge nobody was owed.
    const replacement = await replacementTherapist();

    const moved = await move(
      harness,
      fixture.managerToken,
      fixture.appointmentId,
      placement({ therapistId: replacement, roomId, durationMinutes: 60 }),
    );

    expect(moved.status).toBe(200);

    const appointment = appointmentResponseSchema.parse(moved.body).appointment;
    expect(appointment.therapistId).toBe(replacement);
    expect(appointment.durationMinutes).toBe(60);
  });

  it('leaves the voided charge’s own snapshot untouched by the move', async () => {
    const roomId = await bookedRoomId();

    const chargeId = await insertCharge(harness, fixture, {
      durationMinutes: 45,
      amountToman: '250000',
    });
    await voidCharge(harness, fixture, chargeId);
    await reopen(harness, fixture.managerToken, fixture.appointmentId, 'اصلاح');

    const replacement = await replacementTherapist();
    await moveToReplacement(replacement, roomId);

    // THE OTHER HALF OF THE RULE. Nothing cascaded: the charge still says what
    // the session it represented actually was, and a report of last month reads
    // exactly as it did before the booking moved.
    const charge = await harness.prisma.sessionCharge.findUniqueOrThrow({
      where: { id: chargeId },
    });

    expect(charge.therapistId).toBe(fixture.therapistId);
    expect(charge.therapistId).not.toBe(replacement);
    expect(charge.durationMinutes).toBe(45);
    expect(charge.serviceId).toBe(fixture.serviceId);
    expect(charge.amountToman).toBe(250000n);
    expect(charge.serviceDate).toEqual(new Date(`${fixture.serviceDate}T00:00:00.000Z`));
    // Still voided, and still naming the seat it was raised against.
    expect(charge.voidedAt).not.toBeNull();
    expect(charge.appointmentParticipantId).toBe(fixture.participantId);
    expect(charge.appointmentId).toBe(fixture.appointmentId);
  });

  it('keeps a live charge immutable while the appointment is unchanged', async () => {
    const chargeId = await insertCharge(harness, fixture, { amountToman: '250000' });

    // The move path is closed to a COMPLETED appointment in any case, so the
    // statement worth making here is the one about the charge: dropping the
    // placement key removed no protection from the row itself.
    for (const statement of [
      harness.prisma
        .$executeRaw`UPDATE session_charge SET therapist_id = ${fixture.therapistId}::uuid, amount_toman = 1 WHERE id = ${chargeId}::uuid`,
      harness.prisma
        .$executeRaw`UPDATE session_charge SET duration_minutes = 60 WHERE id = ${chargeId}::uuid`,
      harness.prisma
        .$executeRaw`UPDATE session_charge SET appointment_id = ${fixture.appointmentId}::uuid, service_date = '2020-01-01' WHERE id = ${chargeId}::uuid`,
    ]) {
      expect(await sqlStateOf(statement)).toBe('23001');
    }

    const charge = await harness.prisma.sessionCharge.findUniqueOrThrow({
      where: { id: chargeId },
    });
    expect(charge.durationMinutes).toBe(45);
    expect(charge.amountToman).toBe(250000n);
  });

  it('still refuses a second live charge for the seat after the appointment moves', async () => {
    const roomId = await bookedRoomId();

    const first = await insertCharge(harness, fixture, { amountToman: '250000' });
    await voidCharge(harness, fixture, first);
    await reopen(harness, fixture.managerToken, fixture.appointmentId, 'اصلاح');

    const replacement = await replacementTherapist();
    await moveToReplacement(replacement, roomId);

    // The re-post records the session as it is NOW, and the exactly-once index
    // is unaffected by any of the above: the seat may hold one live charge, and
    // a second is still refused.
    const second = await insertCharge(harness, fixture, {
      therapistId: replacement,
      durationMinutes: 60,
      amountToman: '300000',
    });

    expect(
      await sqlStateOf(
        insertCharge(harness, fixture, { therapistId: replacement, durationMinutes: 60 }),
      ),
    ).toBe('23505');

    // Both rows survive, one voided and one live, each with its own snapshot.
    const rows = await harness.prisma.sessionCharge.findMany({
      where: { appointmentParticipantId: fixture.participantId },
      orderBy: { createdAt: 'asc' },
    });

    expect(rows.map((row) => [row.id, row.durationMinutes, row.voidedAt === null])).toEqual([
      [first, 45, false],
      [second, 60, true],
    ]);
  });

  it('keeps child/family and participant/appointment attribution after a move', async () => {
    const roomId = await bookedRoomId();
    const other = await seedChargeableSession(harness);

    const first = await insertCharge(harness, fixture);
    await voidCharge(harness, fixture, first);
    await reopen(harness, fixture.managerToken, fixture.appointmentId, 'اصلاح');

    const replacement = await replacementTherapist();
    await moveToReplacement(replacement, roomId);

    // The two constraints that must survive the correction, asked again on the
    // far side of a real move.
    expect(await sqlStateOf(insertCharge(harness, fixture, { childId: other.childId }))).toBe(
      '23503',
    );
    expect(
      await sqlStateOf(insertCharge(harness, fixture, { participantId: other.participantId })),
    ).toBe('23503');
  });

  it('keeps adjustment integrity across the same lifecycle', async () => {
    const roomId = await bookedRoomId();

    const first = await insertCharge(harness, fixture, { amountToman: '250000' });
    await insertAdjustment(harness, fixture, first, { amountToman: '50000' });
    await voidCharge(harness, fixture, first);
    await reopen(harness, fixture.managerToken, fixture.appointmentId, 'اصلاح');

    const replacement = await replacementTherapist();
    await moveToReplacement(replacement, roomId);

    // The withdrawn charge keeps its adjustment, and takes no new one.
    expect(await sqlStateOf(insertAdjustment(harness, fixture, first, { amountToman: '1' }))).toBe(
      '23001',
    );

    const second = await insertCharge(harness, fixture, {
      therapistId: replacement,
      durationMinutes: 60,
      amountToman: '300000',
    });

    // The replacement takes adjustments under the same floor and the same
    // clinic-borne rule as before.
    await insertAdjustment(harness, fixture, second, { amountToman: '300000' });
    expect(await sqlStateOf(insertAdjustment(harness, fixture, second, { amountToman: '1' }))).toBe(
      '23514',
    );
    expect(
      await sqlStateOf(
        insertAdjustment(harness, fixture, second, {
          amountToman: '10000',
          therapistDiscountToman: '10000',
          clinicDiscountToman: '0',
        }),
      ),
    ).toBe('23514');

    expect(await harness.prisma.chargeAdjustment.count()).toBe(2);
  });
});
