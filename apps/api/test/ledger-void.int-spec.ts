import { sessionChargeResponseSchema, tomanAmountSchema } from '@clinic/contracts';
import {
  complete,
  makeFamilyWithChild,
  recordAttendance,
  reopen,
  signIn,
} from './appointments-support';
import { uuidv7 } from '../src/common/uuid';
import { createHarness, resetDatabase, type Harness, ownerPrisma } from './harness';
import {
  chargeRowsFor,
  insertAdjustment,
  seedPostedSession,
  sqlStateOf,
  voidAdjustment,
  voidChargeOverHttp,
  voidedAuditRowsFor,
  type PostedSession,
} from './ledger-support';

/**
 * Voiding a charge, and the two lifecycle reversals a standing charge forbids.
 *
 * THE PREMISE THIS SUITE PROTECTS. A valid primary session charge asserts two
 * things about the world: the appointment is `COMPLETED` and the seat is
 * `ATTENDED`. If either can be taken back while the charge stands, the ledger
 * holds money for a session the diary says never happened — and nothing in the
 * record explains it. So the reversal is refused, the manager withdraws the money
 * deliberately, and only then corrects the session.
 *
 * TWO DECISIONS, NEVER COLLAPSED INTO ONE REQUEST. Reopening does not auto-void,
 * and voiding does not reopen. Each carries its own reason and writes its own
 * audit fact, which is what makes "why is this session not billed?" answerable a
 * year later.
 *
 * EVERY CHARGE HERE WAS RAISED BY THE APPLICATION, through the real completion
 * path, and every lifecycle reversal goes through the real Milestone 4 endpoints.
 * A fixture that wrote the charge with SQL would prove nothing about the guard
 * that has to live in front of those endpoints.
 */
describe('session charge void and lifecycle reversal guards', () => {
  let harness: Harness;
  let session: PostedSession;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    session = await seedPostedSession(harness);
  });

  const chargeRow = () =>
    harness.prisma.sessionCharge.findUniqueOrThrow({ where: { id: session.chargeId } });

  const appointmentRow = () =>
    harness.prisma.appointment.findUniqueOrThrow({ where: { id: session.appointmentId } });

  const participantRow = () =>
    harness.prisma.appointmentParticipant.findUniqueOrThrow({
      where: { id: session.participantId },
    });

  const reopenIt = (reason = 'تکمیل اشتباه ثبت شده بود') =>
    reopen(harness, session.managerToken, session.appointmentId, reason);

  const setAttendance = (attendance: string) =>
    recordAttendance(
      harness,
      session.managerToken,
      session.appointmentId,
      session.participantId,
      attendance,
    );

  describe('POST /session-charges/:id/void', () => {
    it('withdraws the charge and preserves its whole original snapshot', async () => {
      const before = await chargeRow();

      const response = await voidChargeOverHttp(
        harness,
        session.managerToken,
        session.chargeId,
        'جلسه اشتباه ثبت شده بود',
      );

      expect(response.status).toBe(200);

      const charge = sessionChargeResponseSchema.parse(response.body).charge;

      // The void, as the frozen read reports it.
      expect(charge.id).toBe(session.chargeId);
      expect(charge.voidedAt).not.toBeNull();
      expect(charge.voidedByUserId).toBe(session.managerId);
      expect(charge.voidReason).toBe('جلسه اشتباه ثبت شده بود');

      // NOT ONE SNAPSHOT FIELD MOVED. A void withdraws the money; it does not
      // revise what the session was, who delivered it, or what it cost.
      expect(charge.familyId).toBe(before.familyId);
      expect(charge.childId).toBe(before.childId);
      expect(charge.appointmentId).toBe(before.appointmentId);
      expect(charge.appointmentParticipantId).toBe(before.appointmentParticipantId);
      expect(charge.serviceId).toBe(before.serviceId);
      expect(charge.therapistId).toBe(before.therapistId);
      expect(charge.durationMinutes).toBe(before.durationMinutes);
      expect(charge.serviceDate).toBe(session.serviceDate);
      expect(charge.tariffId).toBe(before.tariffId);
      expect(charge.priceMode).toBe('PAID');
      expect(charge.amountToman).toBe(session.amountToman);
      expect(charge.createdAt).toBe(before.createdAt.toISOString());
      expect(charge.createdByUserId).toBe(before.createdByUserId);

      // NO DELETE. The row is still there, and it is the same row.
      const rows = await chargeRowsFor(harness, session.participantId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(session.chargeId);
      expect(rows[0]?.amountToman).toBe(250000n);
    });

    it('writes exactly one session_charge.voided audit row, carrying no personal data', async () => {
      await voidChargeOverHttp(
        harness,
        session.managerToken,
        session.chargeId,
        'اصلاح مالی',
      ).expect(200);

      const rows = await voidedAuditRowsFor(harness, session.chargeId);
      expect(rows).toHaveLength(1);

      const row = rows[0];
      expect(row?.actorUserId).toBe(session.managerId);
      expect(row?.entityType).toBe('session_charge');
      expect(row?.before).toEqual({ voidedAt: null });
      expect(row?.after).toMatchObject({ voidReason: 'اصلاح مالی' });

      // Identifiers and amounts only. A permanent, append-only store is the last
      // place a child's name or file number should be duplicated into.
      expect(row?.metadata).toEqual({
        familyId: session.familyId,
        childId: session.childId,
        appointmentId: session.appointmentId,
        appointmentParticipantId: session.participantId,
        priceMode: 'PAID',
        amountToman: session.amountToman,
      });

      // The audit row and the state change share one instant, so the trail
      // cannot report them as separate events.
      const charge = await chargeRow();
      expect(row?.occurredAt).toEqual(charge.voidedAt);
    });

    it('refuses a receptionist with 403 and changes nothing', async () => {
      const receptionist = await signIn(harness, 'RECEPTIONIST');

      const response = await voidChargeOverHttp(harness, receptionist.token, session.chargeId);

      expect(response.status).toBe(403);
      expect((await chargeRow()).voidedAt).toBeNull();
      expect(await voidedAuditRowsFor(harness, session.chargeId)).toHaveLength(0);
    });

    it('refuses a second void without rewriting the first reason or actor', async () => {
      await voidChargeOverHttp(harness, session.managerToken, session.chargeId, 'دلیل اول').expect(
        200,
      );

      const first = await chargeRow();

      // A different manager, a different reason: neither may reach the row.
      const other = await signIn(harness, 'MANAGER');
      const second = await voidChargeOverHttp(harness, other.token, session.chargeId, 'دلیل دوم');

      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('CHARGE_ALREADY_VOIDED');

      const after = await chargeRow();
      expect(after.voidReason).toBe('دلیل اول');
      expect(after.voidedByUserId).toBe(session.managerId);
      expect(after.voidedAt).toEqual(first.voidedAt);

      // One financial transition, one audit fact.
      expect(await voidedAuditRowsFor(harness, session.chargeId)).toHaveLength(1);
    });

    it('answers 404 for a charge that does not exist', async () => {
      const response = await voidChargeOverHttp(
        harness,
        session.managerToken,
        '01998f00-0000-7000-8000-000000000000',
      );

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('CHARGE_NOT_FOUND');
    });

    it('will not let the void’s reason, actor or instant be rewritten afterwards', async () => {
      await voidChargeOverHttp(harness, session.managerToken, session.chargeId, 'دلیل ثبت‌شده');

      // The final protection, below every service: the database itself. 23001 is
      // the one code every "this may not be rewritten" refusal raises.
      for (const statement of [
        harness.prisma
          .$executeRaw`UPDATE session_charge SET void_reason = 'دلیل جعلی' WHERE id = ${session.chargeId}::uuid`,
        harness.prisma
          .$executeRaw`UPDATE session_charge SET voided_by_user_id = ${session.managerId}::uuid, voided_at = now() WHERE id = ${session.chargeId}::uuid`,
        // Un-voiding, which no request in the frozen contract expresses either.
        harness.prisma
          .$executeRaw`UPDATE session_charge SET voided_at = NULL, voided_by_user_id = NULL, void_reason = NULL WHERE id = ${session.chargeId}::uuid`,
        harness.prisma
          .$executeRaw`UPDATE session_charge SET amount_toman = 1 WHERE id = ${session.chargeId}::uuid`,
      ]) {
        expect(await sqlStateOf(statement)).toBe('23001');
      }

      const charge = await chargeRow();
      expect(charge.voidReason).toBe('دلیل ثبت‌شده');
      expect(charge.amountToman).toBe(250000n);
    });
  });

  describe('a valid charge forbids the reversals that would falsify it', () => {
    it('refuses to reopen the completed appointment, atomically', async () => {
      const response = await reopenIt();

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CHARGE_EXISTS_FOR_PARTICIPANT');

      // THE REFUSAL NAMES THE RECORD THAT BLOCKED. "A charge exists" is not
      // actionable; the manager's next step is to open this charge and decide
      // whether to void it.
      expect(response.body.error.details).toEqual({
        sessionChargeId: session.chargeId,
        effectiveAmountToman: '250000',
      });

      // Nothing moved on any of the three: the appointment, the seat, the money.
      const appointment = await appointmentRow();
      expect(appointment.status).toBe('COMPLETED');
      expect(appointment.completedAt).not.toBeNull();
      expect((await participantRow()).attendance).toBe('ATTENDED');

      const charge = await chargeRow();
      expect(charge.voidedAt).toBeNull();
      expect(charge.amountToman).toBe(250000n);

      // And no lifecycle fact was recorded for a reopen that did not happen.
      const reopened = await harness.prisma.auditLog.findMany({
        where: { action: 'appointment.reopened', entityId: session.appointmentId },
      });
      expect(reopened).toHaveLength(0);
    });

    it('refuses ATTENDED → NO_SHOW for the charged seat, atomically', async () => {
      const response = await setAttendance('NO_SHOW');

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CHARGE_EXISTS_FOR_PARTICIPANT');
      expect(response.body.error.details).toEqual({
        sessionChargeId: session.chargeId,
        effectiveAmountToman: '250000',
      });

      expect((await participantRow()).attendance).toBe('ATTENDED');
      expect((await appointmentRow()).status).toBe('COMPLETED');
      expect((await chargeRow()).voidedAt).toBeNull();

      const recorded = await harness.prisma.auditLog.findMany({
        where: { action: 'appointment.attendance_recorded', entityId: session.participantId },
      });
      // Only the original ATTENDED, from the fixture.
      expect(recorded).toHaveLength(1);
    });

    it('still allows re-recording ATTENDED, which falsifies nothing', async () => {
      // A resubmitted form. The outcome is unchanged, so it is a no-op — and it
      // must not be mistaken for a reversal and refused.
      await setAttendance('ATTENDED').expect(200);

      expect((await participantRow()).attendance).toBe('ATTENDED');
      expect((await chargeRow()).voidedAt).toBeNull();
      expect(await chargeRowsFor(harness, session.participantId)).toHaveLength(1);
    });

    /**
     * The blocking amount is what the family currently owes for the session, not
     * what the charge was raised for.
     *
     * The adjustment rows are seeded with SQL because the A5 runtime that grants
     * concessions does not exist yet. What is under test is the guard's
     * arithmetic, and the rows it reads are the same rows A5 will write — the
     * schema, the clinic-borne split and the cumulative floor are all A1's and
     * are enforced by PostgreSQL whoever inserts them.
     */
    describe('the reported effective amount', () => {
      it('subtracts an active adjustment rather than reporting the base amount', async () => {
        await insertAdjustment(harness, session, session.chargeId, { amountToman: '40000' });

        const blocked = await reopenIt();

        expect(blocked.status).toBe(409);
        expect(blocked.body.error.details).toEqual({
          sessionChargeId: session.chargeId,
          // 250,000 raised, 40,000 conceded. Reporting 250,000 here would show
          // the manager a number the family was never going to owe.
          effectiveAmountToman: '210000',
        });

        // The same number the frozen charge read states, computed once per
        // definition and not twice.
        const voided = await voidChargeOverHttp(harness, session.managerToken, session.chargeId);
        expect(sessionChargeResponseSchema.parse(voided.body).charge.effectiveAmountToman).toBe(
          '210000',
        );
      });

      it('sums several active adjustments, on the attendance path too', async () => {
        await insertAdjustment(harness, session, session.chargeId, { amountToman: '40000' });
        await insertAdjustment(harness, session, session.chargeId, { amountToman: '10000' });

        const blocked = await setAttendance('NO_SHOW');

        expect(blocked.status).toBe(409);
        expect(blocked.body.error.details).toEqual({
          sessionChargeId: session.chargeId,
          effectiveAmountToman: '200000',
        });
      });

      it('ignores voided adjustments, which have stopped reducing anything', async () => {
        await insertAdjustment(harness, session, session.chargeId, { amountToman: '40000' });

        // Granted and then withdrawn — two statements, because the database
        // refuses a concession created already void. It stays in the table as
        // history and must not go on reducing the amount.
        const withdrawn = await insertAdjustment(harness, session, session.chargeId, {
          amountToman: '90000',
        });
        await voidAdjustment(harness, session, withdrawn);

        const blocked = await reopenIt();

        expect(blocked.status).toBe(409);
        expect(blocked.body.error.details).toEqual({
          sessionChargeId: session.chargeId,
          effectiveAmountToman: '210000',
        });

        // Both rows are still there. Nothing was deleted to make the sum right.
        expect(
          await harness.prisma.chargeAdjustment.count({
            where: { sessionChargeId: session.chargeId },
          }),
        ).toBe(2);
      });

      it('reports canonical digits, and a fully waived charge as zero', async () => {
        await insertAdjustment(harness, session, session.chargeId, { amountToman: '250000' });

        const blocked = await reopenIt();
        const details = blocked.body.error.details;

        // The canonical wire form the whole ledger uses: unsigned decimal digits,
        // no separators, no exponent, never a JSON number.
        expect(typeof details.effectiveAmountToman).toBe('string');
        expect(details.effectiveAmountToman).toMatch(/^(0|[1-9]\d*)$/);
        expect(tomanAmountSchema.parse(details.effectiveAmountToman)).toBe('0');

        // Worth nothing and STILL BLOCKING: a charge of zero is a live financial
        // record, and reversing the session behind it is still a correction the
        // manager must make deliberately.
        expect(blocked.status).toBe(409);
        expect(details.sessionChargeId).toBe(session.chargeId);
      });

      it('carries no name, file number or other patient data', async () => {
        const blocked = await reopenIt();

        // Stated as an exact shape rather than as absences, so a field added
        // later has to be justified here before this test will pass.
        expect(Object.keys(blocked.body.error.details).sort()).toEqual([
          'effectiveAmountToman',
          'sessionChargeId',
        ]);

        const child = await harness.prisma.child.findUniqueOrThrow({
          where: { id: session.childId },
        });
        const serialised = JSON.stringify(blocked.body);

        expect(serialised).not.toContain(child.firstName);
        expect(serialised).not.toContain(child.lastName);
        expect(serialised).not.toContain(child.fileNumber);
      });
    });

    /**
     * A GROUP SESSION: one booking, several children, one seat each.
     *
     * The two-level model is the accepted one (DECISION_LOG, 2026-08-02): an
     * appointment is the shared resource booking and a participant is a child's
     * seat in it, with its own attendance and its own charge. An individual
     * appointment has one seat; a group session has several, and nothing in
     * PostgreSQL constrains an appointment to one participant — deliberately.
     *
     * THE GUARD MUST NOT READ THE FIRST SEAT AND STOP. Reopening changes the
     * status of the BOOKING, which falsifies the premise of every charge under it
     * at once, so one charged child among several is enough to refuse the whole
     * reversal. A guard that looked only at one seat would let a group session be
     * reopened while another family's money still stood on it.
     *
     * The extra seats are inserted with SQL because the booking endpoint creates
     * individual appointments today — the group FEATURE is not built, the
     * STRUCTURE is settled, and this is exactly the shape the guard has to
     * survive when it arrives.
     */
    describe('a group appointment with several participants', () => {
      /** Another family's child, seated in the same booking, attendance PENDING. */
      async function addSeat(): Promise<{ participantId: string; childId: string }> {
        const family = await makeFamilyWithChild(harness, session.managerToken);
        const participantId = uuidv7();

        await harness.prisma.$executeRaw`
          INSERT INTO appointment_participant (id, appointment_id, child_id, attendance)
          VALUES (
            ${participantId}::uuid, ${session.appointmentId}::uuid, ${family.childId}::uuid,
            'PENDING'::attendance_outcome
          )
        `;

        return { participantId, childId: family.childId };
      }

      /**
       * Marks a seat attended through the real endpoint, which — the appointment
       * being COMPLETED already — raises that seat's charge on the A3 path.
       */
      async function chargeSeat(participantId: string): Promise<string> {
        await recordAttendance(
          harness,
          session.managerToken,
          session.appointmentId,
          participantId,
          'ATTENDED',
        ).expect(200);

        const charge = await harness.prisma.sessionCharge.findFirstOrThrow({
          where: { appointmentParticipantId: participantId, voidedAt: null },
        });

        return charge.id;
      }

      const voidFirstSeat = () =>
        voidChargeOverHttp(harness, session.managerToken, session.chargeId).expect(200);

      it('reopens normally when no seat carries a valid charge', async () => {
        const second = await addSeat();
        await voidFirstSeat();

        // Two seats, neither chargeable: one voided, one never attended.
        expect(await chargeRowsFor(harness, second.participantId)).toHaveLength(0);

        await reopenIt().expect(200);
        expect((await appointmentRow()).status).toBe('SCHEDULED');
      });

      it('refuses the reopen when only the SECOND seat is charged', async () => {
        const second = await addSeat();

        // The seat the fixture charged is cleared, so the only thing that can
        // block is the other child's money. A guard reading one seat would let
        // this through.
        await voidFirstSeat();
        const secondChargeId = await chargeSeat(second.participantId);

        const blocked = await reopenIt();

        expect(blocked.status).toBe(409);
        expect(blocked.body.error.code).toBe('CHARGE_EXISTS_FOR_PARTICIPANT');
        expect(blocked.body.error.details).toEqual({
          sessionChargeId: secondChargeId,
          effectiveAmountToman: '250000',
        });

        // NOTHING MOVED, ON ANY SEAT. The booking, both attendances and both
        // families' financial rows are exactly as they were.
        expect((await appointmentRow()).status).toBe('COMPLETED');
        expect((await participantRow()).attendance).toBe('ATTENDED');

        const secondSeat = await harness.prisma.appointmentParticipant.findUniqueOrThrow({
          where: { id: second.participantId },
        });
        expect(secondSeat.attendance).toBe('ATTENDED');

        expect((await chargeRow()).voidedAt).not.toBeNull();
        const live = await harness.prisma.sessionCharge.findMany({ where: { voidedAt: null } });
        expect(live.map((row) => row.id)).toEqual([secondChargeId]);

        expect(
          await harness.prisma.auditLog.count({
            where: { action: 'appointment.reopened', entityId: session.appointmentId },
          }),
        ).toBe(0);
      });

      it('names one of the actually charged seats, deterministically, when several block', async () => {
        const second = await addSeat();
        const secondChargeId = await chargeSeat(second.participantId);

        const first = await reopenIt();
        const again = await reopenIt();

        expect([first.status, again.status]).toEqual([409, 409]);

        const blocker = first.body.error.details.sessionChargeId;
        // It belongs to a seat that really is charged — not an arbitrary id.
        expect([session.chargeId, secondChargeId]).toContain(blocker);
        // The fixture's charge was raised first, and `ORDER BY created_at, id`
        // is what makes a retry name the same record rather than alternating.
        expect(blocker).toBe(session.chargeId);
        expect(again.body.error.details).toEqual(first.body.error.details);
      });

      it('still lets an uncharged seat’s attendance be corrected while another seat is charged', async () => {
        const second = await addSeat();

        // The attendance guard is per seat, and must stay that way: this child
        // did not arrive, and another family's charge is not a reason to refuse
        // recording that.
        await recordAttendance(
          harness,
          session.managerToken,
          session.appointmentId,
          second.participantId,
          'NO_SHOW',
        ).expect(200);

        const secondSeat = await harness.prisma.appointmentParticipant.findUniqueOrThrow({
          where: { id: second.participantId },
        });
        expect(secondSeat.attendance).toBe('NO_SHOW');

        // The charged seat's own reversal is still refused.
        const blocked = await setAttendance('NO_SHOW');
        expect(blocked.status).toBe(409);
        expect(blocked.body.error.details.sessionChargeId).toBe(session.chargeId);
      });
    });

    it('is scoped to the affected seats and blocks nothing else', async () => {
      // The guard asks about the seats the operation actually touches. Another
      // family's session, voided and reopened in the same database, must neither
      // be blocked by this charge nor relax it.
      const other = await seedPostedSession(harness);
      await voidChargeOverHttp(harness, other.managerToken, other.chargeId).expect(200);

      await reopen(harness, other.managerToken, other.appointmentId, 'اصلاح').expect(200);

      // This session's own charge and status are exactly as they were.
      expect((await appointmentRow()).status).toBe('COMPLETED');
      expect((await chargeRow()).voidedAt).toBeNull();
    });
  });

  describe('the approved correction sequence', () => {
    it('void, then reopen, succeeds', async () => {
      await voidChargeOverHttp(
        harness,
        session.managerToken,
        session.chargeId,
        'هزینه اشتباه ثبت شد',
      ).expect(200);

      const reopened = await reopenIt('جلسه در واقع برگزار نشد');
      expect(reopened.status).toBe(200);

      expect((await appointmentRow()).status).toBe('SCHEDULED');
      // Attendance is a separate fact and is left exactly as recorded.
      expect((await participantRow()).attendance).toBe('ATTENDED');

      // TWO DECISIONS, TWO AUDIT FACTS, each with its own reason.
      expect(await voidedAuditRowsFor(harness, session.chargeId)).toHaveLength(1);
      const lifecycle = await harness.prisma.auditLog.findMany({
        where: { action: 'appointment.reopened', entityId: session.appointmentId },
      });
      expect(lifecycle).toHaveLength(1);
      expect(lifecycle[0]?.metadata).toEqual({ reason: 'جلسه در واقع برگزار نشد' });

      // The withdrawn charge is still there, and still says what it said.
      const charge = await chargeRow();
      expect(charge.voidReason).toBe('هزینه اشتباه ثبت شد');
      expect(charge.amountToman).toBe(250000n);
    });

    it('void, then the attendance correction M4 allows, succeeds', async () => {
      await voidChargeOverHttp(harness, session.managerToken, session.chargeId).expect(200);

      // The appointment stays COMPLETED; only the child's own outcome changes.
      // M4 permits this on a non-cancelled booking.
      await setAttendance('NO_SHOW').expect(200);

      expect((await participantRow()).attendance).toBe('NO_SHOW');
      expect((await appointmentRow()).status).toBe('COMPLETED');

      // A NO_SHOW is not chargeable, so the ledger raised nothing in its place.
      const rows = await chargeRowsFor(harness, session.participantId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.voidedAt).not.toBeNull();
    });

    it('void → reopen → re-complete raises a NEW charge and keeps the old one voided', async () => {
      await voidChargeOverHttp(harness, session.managerToken, session.chargeId, 'اصلاح').expect(
        200,
      );
      await reopenIt().expect(200);

      // The session did happen after all, and the child did attend: the ordinary
      // A3 path charges it again. Possible only because the exactly-once index is
      // partial on `voided_at IS NULL`.
      await complete(harness, session.managerToken, session.appointmentId).expect(200);

      const rows = await chargeRowsFor(harness, session.participantId);
      expect(rows).toHaveLength(2);

      const [old, fresh] = rows;
      expect(old?.id).toBe(session.chargeId);
      expect(old?.voidedAt).not.toBeNull();
      expect(old?.voidReason).toBe('اصلاح');

      expect(fresh?.id).not.toBe(session.chargeId);
      expect(fresh?.voidedAt).toBeNull();
      expect(fresh?.amountToman).toBe(250000n);

      // Exactly one valid charge for the seat, as the index requires.
      expect(rows.filter((row) => row.voidedAt === null)).toHaveLength(1);

      // And the new charge blocks the reversal all over again.
      const blocked = await reopenIt();
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe('CHARGE_EXISTS_FOR_PARTICIPANT');
    });

    it('never deletes a financial row across the whole sequence', async () => {
      await voidChargeOverHttp(harness, session.managerToken, session.chargeId).expect(200);
      await reopenIt().expect(200);
      await complete(harness, session.managerToken, session.appointmentId).expect(200);

      expect(await harness.prisma.sessionCharge.count()).toBe(2);

      // The last protection: nothing may remove a financial record, whatever
      // reaches the table.
      expect(
        await sqlStateOf(
          ownerPrisma()
            .$executeRaw`DELETE FROM session_charge WHERE id = ${session.chargeId}::uuid`,
        ),
      ).toBe('23001');

      expect(await harness.prisma.sessionCharge.count()).toBe(2);
    });
  });
});
