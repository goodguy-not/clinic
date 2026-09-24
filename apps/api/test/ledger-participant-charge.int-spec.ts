import { sessionChargeResponseSchema } from '@clinic/contracts';
import { signIn } from './appointments-support';
import { uuidv7 } from '../src/common/uuid';
import { createHarness, resetDatabase, type Harness } from './harness';
import {
  adjustOverHttp,
  postCharge,
  readParticipantCharge,
  seedBookedSession,
  seedFamilyLedger,
  voidChargeOverHttp,
  type FamilyLedgerFixture,
} from './ledger-support';

/**
 * What one seat currently owes.
 *
 * THE SMALLEST READ AN APPOINTMENT SCREEN CAN ASK FOR. It answers with the frozen
 * `sessionChargeResponse` that voiding and adjusting already return, built by the
 * same `readChargeDetail`, so the amount a session detail page prints and the
 * amount the manager sees after granting a concession are the same number
 * computed once.
 *
 * ONE CHARGE, CHOSEN BY A TOTAL ORDER. A standing charge always wins; failing
 * that, the seat's most recently withdrawn charge answers, carrying its void
 * metadata and its adjustments. "This session was charged and the charge was
 * taken back" and "this session was never charged" are opposite situations for
 * the person deciding whether to re-post, and a single 404 could not tell them
 * apart — so `CHARGE_NOT_FOUND` now means only the second.
 *
 * A VOIDED ROW IS A READ REPRESENTATION AND NOT MONEY. Every total in this system
 * is computed from `voided_at IS NULL` and none of them consults this route, so
 * nothing below makes a withdrawn charge owed again.
 */
describe('participant charge read', () => {
  let harness: Harness;
  let ledger: FamilyLedgerFixture;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    ledger = await seedFamilyLedger(harness);
  });

  async function read(participantId: string, token = ledger.managerToken) {
    const response = await readParticipantCharge(harness, token, participantId).expect(200);
    return sessionChargeResponseSchema.parse(response.body).charge;
  }

  it('returns the charge that stands for an attended, completed session', async () => {
    const charge = await read(ledger.restoredParticipantId);

    expect(charge.id).toBe(ledger.restoredChargeId);
    expect(charge.appointmentParticipantId).toBe(ledger.restoredParticipantId);
    expect(charge.childId).toBe(ledger.childBId);
    expect(charge.familyId).toBe(ledger.familyId);
    expect(charge.priceMode).toBe('PAID');
    expect(charge.amountToman).toBe('250000');
    expect(charge.voidedAt).toBeNull();

    // The withdrawn concession is history and reduces nothing.
    expect(charge.adjustments).toHaveLength(1);
    expect(charge.adjustments[0]?.voidedAt).not.toBeNull();
    expect(charge.effectiveAmountToman).toBe('250000');
  });

  it('states the effective amount the server derived, never the raw charge', async () => {
    const charge = await read(ledger.reducedParticipantId);

    // CLAUDE.md keeps this arithmetic out of the web tier entirely, so both sums
    // travel on the response rather than being recovered from the array.
    expect(charge.amountToman).toBe('250000');
    expect(charge.activeAdjustmentTotalToman).toBe('50000');
    expect(charge.effectiveAmountToman).toBe('200000');
  });

  it('reports a waived charge as zero and still PAID', async () => {
    const waived = await read(ledger.waivedParticipantId);

    expect(waived.priceMode).toBe('PAID');
    expect(waived.amountToman).toBe('250000');
    expect(waived.effectiveAmountToman).toBe('0');
  });

  it('reports a complimentary session as FREE and zero at source', async () => {
    const free = await read(ledger.freeParticipantId);

    // A different fact from the waiver above, and neither is reachable from the
    // other (DECISION_LOG, 2026-08-06).
    expect(free.priceMode).toBe('FREE');
    expect(free.amountToman).toBe('0');
    expect(free.effectiveAmountToman).toBe('0');
    expect(free.adjustments).toHaveLength(0);
  });

  it('returns the withdrawn charge when the seat has no standing one', async () => {
    const charge = await read(ledger.voidedParticipantId);

    expect(charge.id).toBe(ledger.voidedChargeId);

    // The whole of "this was charged and taken back": the instant, the actor and
    // the reason, which is what makes the withdrawal explicable a year later.
    expect(charge.voidedAt).not.toBeNull();
    expect(charge.voidedByUserId).toBe(ledger.managerId);
    expect(charge.voidReason).not.toBeNull();
    expect(charge.voidReason).not.toBe('');

    // The concession granted before the void is still attached and still
    // explained — history is not rewritten by a void.
    const orphaned = charge.adjustments.find((one) => one.id === ledger.adjustmentOnVoidedChargeId);
    expect(orphaned?.amountToman).toBe('30000');
    expect(orphaned?.voidedAt).toBeNull();

    // The authoritative detail calculation is unchanged: the arithmetic is still
    // stated, and it is still not money — the account counts this charge in
    // nothing.
    expect(charge.amountToman).toBe('250000');
    expect(charge.activeAdjustmentTotalToman).toBe('30000');
    expect(charge.effectiveAmountToman).toBe('220000');
  });

  it('returns the most recently withdrawn charge when a seat has several', async () => {
    // Void, re-post, void again: the seat now has two withdrawn charges and no
    // standing one, and the answer must be the later withdrawal rather than
    // whichever row the planner happened to reach first.
    const first = await read(ledger.reducedParticipantId);
    await voidChargeOverHttp(harness, ledger.managerToken, first.id).expect(200);
    await postCharge(harness, ledger.managerToken, ledger.reducedParticipantId).expect(200);

    const second = await read(ledger.reducedParticipantId);
    expect(second.id).not.toBe(first.id);
    await voidChargeOverHttp(harness, ledger.managerToken, second.id).expect(200);

    expect(
      await harness.prisma.sessionCharge.count({
        where: { appointmentParticipantId: ledger.reducedParticipantId },
      }),
    ).toBe(2);

    const latest = await read(ledger.reducedParticipantId);
    expect(latest.id).toBe(second.id);
    expect(latest.voidedAt).not.toBeNull();

    // Repeatable, not incidental: the order is total, so the same seat answers
    // with the same row every time.
    expect((await read(ledger.reducedParticipantId)).id).toBe(second.id);
  });

  it('follows the valid charge across a void and a re-post', async () => {
    const before = await read(ledger.reducedParticipantId);
    await voidChargeOverHttp(harness, ledger.managerToken, before.id).expect(200);

    // Between the two, the seat reads as withdrawn rather than as uncharged.
    const between = await read(ledger.reducedParticipantId);
    expect(between.id).toBe(before.id);
    expect(between.voidedAt).not.toBeNull();

    await postCharge(harness, ledger.managerToken, ledger.reducedParticipantId).expect(200);
    const after = await read(ledger.reducedParticipantId);

    // A correction is void-and-re-post, never an edit: the seat now holds two
    // rows, and a standing charge always outranks history.
    expect(after.id).not.toBe(before.id);
    expect(after.voidedAt).toBeNull();
    expect(after.amountToman).toBe('250000');
    // The concession belonged to the charge that was withdrawn and does not
    // follow the new one.
    expect(after.adjustments).toHaveLength(0);
    expect(after.effectiveAmountToman).toBe('250000');

    expect(
      await harness.prisma.sessionCharge.count({
        where: { appointmentParticipantId: ledger.reducedParticipantId },
      }),
    ).toBe(2);
  });

  it('answers 404 for a real seat that has no charge history at all', async () => {
    // A booked session nobody has attended, completed or priced. This is the ONE
    // thing `CHARGE_NOT_FOUND` still means: not "the charge was withdrawn", which
    // now answers with the withdrawal.
    const booked = await seedBookedSession(harness);

    const response = await readParticipantCharge(
      harness,
      booked.managerToken,
      booked.participantId,
    ).expect(404);

    expect(response.body.error.code).toBe('CHARGE_NOT_FOUND');

    expect(
      await harness.prisma.sessionCharge.count({
        where: { appointmentParticipantId: booked.participantId },
      }),
    ).toBe(0);
  });

  it('answers 404 for a participant that does not exist', async () => {
    const response = await readParticipantCharge(harness, ledger.managerToken, uuidv7()).expect(
      404,
    );

    // The same code as an uncharged seat: a caller guessing ids learns only that
    // there is no charge to see.
    expect(response.body.error.code).toBe('CHARGE_NOT_FOUND');
  });

  it('refuses a caller without a session', async () => {
    await readParticipantCharge(harness, 'not-a-session-token', ledger.reducedParticipantId).expect(
      401,
    );
  });

  it('lets a receptionist read without letting them correct', async () => {
    const receptionist = await signIn(harness, 'RECEPTIONIST');

    const charge = await read(ledger.reducedParticipantId, receptionist.token);
    expect(charge.effectiveAmountToman).toBe('200000');

    // `charge.read` broadens no mutation: voiding and adjusting stay manager-only
    // (DECISION_LOG, 2026-08-14).
    await voidChargeOverHttp(harness, receptionist.token, charge.id).expect(403);
    await adjustOverHttp(harness, receptionist.token, charge.id, '1000').expect(403);
  });

  it('writes no audit row for a read', async () => {
    const before = await harness.prisma.auditLog.count();

    await read(ledger.reducedParticipantId);
    await read(ledger.freeParticipantId);

    expect(await harness.prisma.auditLog.count()).toBe(before);
  });
});
