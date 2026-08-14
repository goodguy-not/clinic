import { complete, makeTariff, recordAttendance } from './appointments-support';
import { createHarness, resetDatabase, type Harness } from './harness';
import { chargeRowsFor, postCharge, seedBookedSession, type BookedSession } from './ledger-support';

/**
 * What happens when two requests try to charge one session at the same moment.
 *
 * This is the suite that decides whether "exactly once" means anything. A
 * read-then-insert is not a guarantee under concurrency: both requests see no
 * charge, both insert, and the family is billed twice for one session — which is
 * the failure PROJECT_SPEC.md 15 item 4 names outright and the one a partial
 * unique index exists to make impossible.
 *
 * TWO MECHANISMS ARE PROVED, AND THEY ARE DIFFERENT MECHANISMS. The final
 * authority is `session_charge_one_valid_per_participant_uq`, a partial unique
 * index accepted in checkpoint A1, which no application path may loosen. Above
 * it, every posting path takes the appointment's row lock FIRST and re-reads the
 * seat's charge under it, so the second request waits for the first and then
 * finds what it committed — it never reaches the index and never has to be
 * rescued by it. Both halves matter: the lock is what keeps a duplicate race from
 * surfacing as an error at all, and the index is what stays true if the lock is
 * ever weakened.
 *
 * NOTHING IS SYNCHRONISED ON A TIMER, as in every other concurrency suite here. A
 * `sleep` long enough to be reliable is slow, and one short enough to be fast
 * passes on a quiet machine and fails in CI. Requests are fired together and the
 * assertion is on the invariant that must hold whichever order they land in.
 */
describe('session charge posting concurrency (real PostgreSQL)', () => {
  let harness: Harness;
  let session: BookedSession;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
    session = await seedBookedSession(harness);

    await makeTariff(harness, session.managerToken, {
      serviceId: session.serviceId,
      durationMinutes: 45,
      priceToman: '250000',
    });
  });

  const attend = (attendance = 'ATTENDED') =>
    recordAttendance(
      harness,
      session.managerToken,
      session.appointmentId,
      session.participantId,
      attendance,
    );

  const finish = () => complete(harness, session.managerToken, session.appointmentId);

  const charges = () => chargeRowsFor(harness, session.participantId);

  /** No path may answer a duplicate race with an unexplained 500. */
  const noInternalErrors = (...responses: { status: number }[]): void => {
    for (const response of responses) expect(response.status).not.toBe(500);
  };

  it('creates one charge when the same session is completed twice at once', async () => {
    await attend().expect(200);

    const [first, second] = await Promise.all([finish(), finish()]);

    noInternalErrors(first, second);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(await charges()).toHaveLength(1);
  });

  it('creates one charge when the completion races the attendance record', async () => {
    // Neither fact is true yet, so whichever transaction commits second is the
    // one that must raise the charge — and it can only know that by re-reading
    // under the lock the first one held.
    const [completion, attendance] = await Promise.all([finish(), attend()]);

    noInternalErrors(completion, attendance);
    expect([completion.status, attendance.status]).toEqual([200, 200]);

    const rows = await charges();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amountToman).toBe(250000n);
  });

  it('creates one charge when two explicit re-posts arrive together', async () => {
    await attend().expect(200);
    await finish().expect(200);

    // The completion already raised it, so both of these must come back
    // ALREADY_POSTED rather than one of them raising a second charge.
    const [first, second] = await Promise.all([
      postCharge(harness, session.managerToken, session.participantId),
      postCharge(harness, session.managerToken, session.participantId),
    ]);

    noInternalErrors(first, second);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(first.body.charge.id).toBe(second.body.charge.id);
    expect(await charges()).toHaveLength(1);
  });

  it('creates one charge when a re-post races the completion that would raise it', async () => {
    await attend().expect(200);

    const [completion, repost] = await Promise.all([
      finish(),
      postCharge(harness, session.managerToken, session.participantId),
    ]);

    noInternalErrors(completion, repost);
    expect(completion.status).toBe(200);
    // The re-post either found the completed session and charged it, or arrived
    // first and correctly refused a session that was not yet complete. Both are
    // right; two charges would not be.
    expect([200, 422]).toContain(repost.status);
    expect(await charges()).toHaveLength(1);
  });

  it('writes one posting audit row however the race lands', async () => {
    const [, ,] = await Promise.all([finish(), attend(), finish()]);

    const rows = await charges();
    expect(rows).toHaveLength(1);

    const posted = await harness.prisma.auditLog.findMany({
      where: { action: 'session_charge.posted', entityId: rows[0]?.id },
    });

    expect(posted).toHaveLength(1);
  });
});
