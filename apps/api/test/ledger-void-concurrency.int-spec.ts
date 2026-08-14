import { complete, recordAttendance, reopen } from './appointments-support';
import { createHarness, resetDatabase, type Harness } from './harness';
import {
  chargeRowsFor,
  postCharge,
  seedPostedSession,
  voidChargeOverHttp,
  voidedAuditRowsFor,
  type PostedSession,
} from './ledger-support';

/**
 * What happens when a void and a lifecycle reversal arrive at the same moment.
 *
 * THE FAILURE THIS SUITE EXISTS TO EXCLUDE is a half-corrected session: an
 * appointment reopened while its charge still stands, or a charge voided twice
 * with the second void quietly overwriting the first manager's reason. Both are
 * states a read-then-write would reach and neither is recoverable afterwards,
 * because financial history may not be rewritten.
 *
 * TWO SERIALISATION POINTS, AND THEY DO NOT CROSS. A void takes the charge row
 * `FOR UPDATE` and nothing else. A lifecycle reversal takes the APPOINTMENT row
 * `FOR UPDATE` — the lock every Milestone 4 write already takes first — and reads
 * the seat's charges under it. So no transaction holds one and waits for the
 * other, and no cycle can form. What makes the guard sound is not a lock on the
 * charge but the appointment lock it already runs under: nothing can CREATE a
 * charge behind the check, because creating one requires that same lock.
 *
 * EITHER ORDER IS LEGITIMATE; the invariant is what must hold in both. A reversal
 * that refuses on a charge which is voided a millisecond later has not failed —
 * it has reported the state it saw, changed nothing, and the retry succeeds.
 *
 * NOTHING IS SYNCHRONISED ON A TIMER, as in every other concurrency suite here.
 */
describe('charge void and lifecycle reversal concurrency (real PostgreSQL)', () => {
  let harness: Harness;
  let session: PostedSession;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
    session = await seedPostedSession(harness);
  });

  const charges = () => chargeRowsFor(harness, session.participantId);

  const appointmentStatus = async () =>
    (await harness.prisma.appointment.findUniqueOrThrow({ where: { id: session.appointmentId } }))
      .status;

  const attendance = async () =>
    (
      await harness.prisma.appointmentParticipant.findUniqueOrThrow({
        where: { id: session.participantId },
      })
    ).attendance;

  /** No race may be answered with an unexplained 500. */
  const noInternalErrors = (...responses: { status: number }[]): void => {
    for (const response of responses) expect(response.status).not.toBe(500);
  };

  it('lets exactly one of two simultaneous voids succeed', async () => {
    const [first, second] = await Promise.all([
      voidChargeOverHttp(harness, session.managerToken, session.chargeId, 'دلیل الف'),
      voidChargeOverHttp(harness, session.managerToken, session.chargeId, 'دلیل ب'),
    ]);

    noInternalErrors(first, second);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);

    const refused = first.status === 409 ? first : second;
    expect(refused.body.error.code).toBe('CHARGE_ALREADY_VOIDED');

    // ONE financial transition and ONE audit fact, whichever request won.
    const rows = await charges();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.voidedAt).not.toBeNull();
    expect(await voidedAuditRowsFor(harness, session.chargeId)).toHaveLength(1);

    // The winner's reason stands: the loser did not overwrite it.
    const winner = first.status === 200 ? first : second;
    expect(rows[0]?.voidReason).toBe(winner.body.charge.voidReason);
    expect(['دلیل الف', 'دلیل ب']).toContain(rows[0]?.voidReason);
  }, 30000);

  it('never reopens a session while a valid charge stands, however the race lands', async () => {
    const [reopened, voided] = await Promise.all([
      reopen(harness, session.managerToken, session.appointmentId, 'اصلاح چرخهٔ حیات'),
      voidChargeOverHttp(harness, session.managerToken, session.chargeId, 'اصلاح مالی'),
    ]);

    noInternalErrors(reopened, voided);

    // The void is an update of a live row and always succeeds.
    expect(voided.status).toBe(200);
    // The reopen either saw the void committed and proceeded, or saw a valid
    // charge and refused. Both are correct; a reopen alongside a live charge
    // would not be.
    expect([200, 409]).toContain(reopened.status);

    const rows = await charges();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.voidedAt).not.toBeNull();

    if (reopened.status === 200) {
      expect(await appointmentStatus()).toBe('SCHEDULED');
    } else {
      expect(reopened.body.error.code).toBe('CHARGE_EXISTS_FOR_PARTICIPANT');
      // Refused atomically: the appointment is untouched and no lifecycle fact
      // was recorded.
      expect(await appointmentStatus()).toBe('COMPLETED');
      expect(
        await harness.prisma.auditLog.count({
          where: { action: 'appointment.reopened', entityId: session.appointmentId },
        }),
      ).toBe(0);
    }

    // Either way the void is recorded exactly once, and the retry after a
    // refusal succeeds.
    expect(await voidedAuditRowsFor(harness, session.chargeId)).toHaveLength(1);
    if (reopened.status === 409) {
      await reopen(harness, session.managerToken, session.appointmentId, 'تلاش دوم').expect(200);
      expect(await appointmentStatus()).toBe('SCHEDULED');
    }
  }, 30000);

  it('never reverses attendance while a valid charge stands, however the race lands', async () => {
    const [recorded, voided] = await Promise.all([
      recordAttendance(
        harness,
        session.managerToken,
        session.appointmentId,
        session.participantId,
        'NO_SHOW',
      ),
      voidChargeOverHttp(harness, session.managerToken, session.chargeId, 'اصلاح مالی'),
    ]);

    noInternalErrors(recorded, voided);
    expect(voided.status).toBe(200);
    expect([200, 409]).toContain(recorded.status);

    // The seat is NO_SHOW only if the attendance write actually committed, and
    // in that case the charge was already withdrawn.
    expect(await attendance()).toBe(recorded.status === 200 ? 'NO_SHOW' : 'ATTENDED');

    const rows = await charges();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.voidedAt).not.toBeNull();

    // A NO_SHOW never produced a charge of its own.
    expect(rows.filter((row) => row.voidedAt === null)).toHaveLength(0);
  }, 30000);

  it('never leaves two valid charges when a void races an explicit re-post', async () => {
    const [voided, reposted] = await Promise.all([
      voidChargeOverHttp(harness, session.managerToken, session.chargeId, 'اصلاح مالی'),
      postCharge(harness, session.managerToken, session.participantId),
    ]);

    noInternalErrors(voided, reposted);
    expect(voided.status).toBe(200);
    expect(reposted.status).toBe(200);

    const rows = await charges();

    // Two landings are legitimate. The re-post arrived first and found the
    // charge still valid (ALREADY_POSTED, one row); or it arrived after the void
    // and raised a replacement (two rows, one of them voided). In neither case
    // does the seat carry two valid charges — which is the exactly-once index's
    // guarantee and the only thing that matters to a family.
    expect(rows.filter((row) => row.voidedAt === null).length).toBeLessThanOrEqual(1);
    expect(rows.find((row) => row.id === session.chargeId)?.voidedAt).not.toBeNull();
    expect(rows.length).toBe(reposted.body.outcome === 'POSTED' ? 2 : 1);
  }, 30000);

  it('creates no duplicate charge when a re-completion races the void of the old one', async () => {
    // Reopen first, so the completion below is a real transition rather than the
    // idempotent no-op.
    await voidChargeOverHttp(harness, session.managerToken, session.chargeId, 'اصلاح').expect(200);
    await reopen(harness, session.managerToken, session.appointmentId, 'اصلاح').expect(200);

    const [first, second] = await Promise.all([
      complete(harness, session.managerToken, session.appointmentId),
      complete(harness, session.managerToken, session.appointmentId),
    ]);

    noInternalErrors(first, second);
    expect([first.status, second.status]).toEqual([200, 200]);

    const rows = await charges();
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.voidedAt === null)).toHaveLength(1);
  }, 30000);
});
