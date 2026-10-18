import {
  familyAccountResponseSchema,
  postSessionChargeResponseSchema,
  type FamilyAccountResponse,
  type FamilyFinancialPosition,
} from '@clinic/contracts';
import { makeFamilyWithChild, signIn, SATURDAY } from './appointments-support';
import { uuidv7 } from '../src/common/uuid';
import { createHarness, resetDatabase, type Harness } from './harness';
import {
  familyAccount,
  postCharge,
  seedFamilyLedger,
  NEXT_SATURDAY,
  type FamilyLedgerFixture,
} from './ledger-support';
import {
  cancelPromise,
  clinicDay,
  fulfilPromise,
  insertPromise,
  recordPaymentOverHttp,
  reschedulePromise,
  voidPaymentOverHttp,
  type PaymentFixture,
} from './payment-support';

/**
 * WHERE A FAMILY STANDS, derived on every request from rows nobody maintains.
 *
 * THE CLAIM UNDER TEST IS THAT NOTHING IS STORED. There is no balance column, no
 * credit column and no allocation table anywhere in this system (DECISION_LOG,
 * 2026-08-15 — Credit is derived), so every number below has to fall out of
 * `session_charge`, `charge_adjustment`, `payment` and `payment_promise` as they
 * stand at the moment of the read. The way to prove that is to move a family
 * through every financial state one can reach — owing, square, in credit, in
 * credit and then charged again, paid and then reversed — and to check the
 * position after each move without anything ever having been updated.
 *
 * THE TWO NUMBERS THAT MUST NEVER BE CONFUSED. `totals` is the charge view the
 * query asked for; `position` is the whole family. Half of this suite is the same
 * account read under different filters, asserting that the first moves and the
 * second does not.
 *
 * PROMISES APPEAR HERE ONLY TO PROVE THEY DO NOTHING. A promise moves no money in
 * any state (CLAUDE.md), so the fixtures put every state on one family and assert
 * the money is identical either way. The promise RUNTIME is checkpoint A6 and
 * nothing here creates one over HTTP — these rows are written with SQL, exactly
 * as the A1 schema suite writes them.
 *
 * Every fixture is synthetic: no real family, child, therapist, price, amount or
 * bank reference appears anywhere in this file.
 */
describe('family financial position', () => {
  let harness: Harness;
  let ledger: FamilyLedgerFixture;
  let fixture: PaymentFixture;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    ledger = await seedFamilyLedger(harness);
    fixture = {
      managerId: ledger.managerId,
      managerToken: ledger.managerToken,
      familyId: ledger.familyId,
    };
  });

  /**
   * Reads the account and parses it against the FINAL frozen contract, which is
   * half of every assertion in this file: `position` is required, so a response
   * without one — or with one whose credit and amount due are both non-zero —
   * fails here before a single expectation runs.
   */
  async function read(
    query: Record<string, string | number> = {},
    token = ledger.managerToken,
    familyId = ledger.familyId,
  ): Promise<FamilyAccountResponse> {
    const response = await familyAccount(harness, token, familyId, query).expect(200);
    return familyAccountResponseSchema.parse(response.body);
  }

  async function position(
    query: Record<string, string | number> = {},
  ): Promise<FamilyFinancialPosition> {
    return (await read(query)).position;
  }

  /** Money over the counter, the way a receptionist records it. */
  async function pay(amountToman: string, receivedOn?: string): Promise<string> {
    const body: Record<string, unknown> = { amountToman, method: 'CASH' };
    body['receivedOn'] = receivedOn ?? (await clinicDay(harness));

    const response = await recordPaymentOverHttp(
      harness,
      ledger.managerToken,
      ledger.familyId,
      body,
    ).expect(200);

    return response.body.payment.id as string;
  }

  /**
   * One more session charged, through the real posting route.
   *
   * The seat is the one whose original charge was WITHDRAWN, so the partial
   * unique index lets a replacement take its place — the ordinary "the wrong
   * charge was voided, raise it again" path, used here because it is the only way
   * to add money to this family's ledger without inventing a row.
   */
  async function chargeAgain(): Promise<string> {
    const response = await postCharge(harness, ledger.managerToken, ledger.voidedParticipantId);
    expect(response.status).toBe(200);

    const result = postSessionChargeResponseSchema.parse(response.body);
    expect(result.outcome).toBe('POSTED');

    return result.charge.effectiveAmountToman;
  }

  describe('what the family owes', () => {
    it('states the whole family as owing everything when nothing has been paid', async () => {
      const owed = await position();

      // The fixture's four valid charges, net of the concessions still standing:
      // 200000 + 250000 + 0 (waived) + 0 (free).
      expect(owed.netChargedTotalToman).toBe('450000');
      expect(owed.confirmedPaymentTotalToman).toBe('0');
      expect(owed.amountDueToman).toBe('450000');
      expect(owed.creditToman).toBe('0');
      expect(owed.paymentCount).toBe(0);
      expect(owed.voidedPaymentCount).toBe(0);
      expect(owed.lastPayment).toBeNull();
    });

    it('leaves exactly the unpaid remainder after a partial payment', async () => {
      // Three charges carrying money: 200000, 250000 and the 250000 replacement.
      const replacement = await chargeAgain();
      expect(replacement).toBe('250000');

      await pay('300000');

      const owed = await position();

      expect(owed.netChargedTotalToman).toBe('700000');
      expect(owed.confirmedPaymentTotalToman).toBe('300000');
      expect(owed.amountDueToman).toBe('400000');
      expect(owed.creditToman).toBe('0');
      // A partial payment is an ordinary payment: nothing is allocated to a
      // charge, and no charge is marked as settled (DECISION_LOG, 2026-08-15).
      expect(owed.paymentCount).toBe(1);
    });

    it('answers for the whole family when two children were charged and one payment arrived', async () => {
      await pay('100000');

      const owed = await position();

      // Child A was charged 200000 net and child B 250000. Balance is
      // family-level (CLAUDE.md): there is ONE position, and the payment names no
      // child because a payment cannot.
      expect(owed.netChargedTotalToman).toBe('450000');
      expect(owed.amountDueToman).toBe('350000');

      // And it does not become two positions when the reader looks at one child.
      expect(await position({ childId: ledger.childAId })).toStrictEqual(owed);
      expect(await position({ childId: ledger.childBId })).toStrictEqual(owed);
    });

    it('shows a family that has settled exactly as owing nothing and owed nothing', async () => {
      await pay('450000');

      const owed = await position();

      expect(owed.confirmedPaymentTotalToman).toBe('450000');
      expect(owed.amountDueToman).toBe('0');
      expect(owed.creditToman).toBe('0');
    });

    it('turns the surplus of an overpayment into credit', async () => {
      await pay('500000');

      const owed = await position();

      expect(owed.creditToman).toBe('50000');
      expect(owed.amountDueToman).toBe('0');
      // Never both, which the frozen refinement also refuses.
      expect(owed.creditToman === '0' || owed.amountDueToman === '0').toBe(true);
    });

    it('adds up across several payments rather than only the latest', async () => {
      await pay('100000');
      await pay('50000');
      await pay('300000');

      const owed = await position();

      expect(owed.confirmedPaymentTotalToman).toBe('450000');
      expect(owed.amountDueToman).toBe('0');
      expect(owed.paymentCount).toBe(3);
    });
  });

  describe('credit is derived, never held', () => {
    it('reads a prepayment against no charges at all as credit', async () => {
      // A different family, with no session and therefore no charge: the family a
      // parent pays in advance for a programme that has not started.
      const { familyId } = await makeFamilyWithChild(harness, ledger.managerToken, {
        firstName: 'کودک پیش‌پرداخت',
      });

      await recordPaymentOverHttp(harness, ledger.managerToken, familyId, {
        amountToman: '400000',
        method: 'TRANSFER',
        receivedOn: await clinicDay(harness),
      }).expect(200);

      const account = await read({}, ledger.managerToken, familyId);

      expect(account.charges).toHaveLength(0);
      expect(account.position.netChargedTotalToman).toBe('0');
      expect(account.position.creditToman).toBe('400000');
      expect(account.position.amountDueToman).toBe('0');
      // Intent is not observable at the counter: there is no prepayment flag and
      // no credit row — a prepayment is a payment (DECISION_LOG, 2026-08-15).
      expect(account.position.paymentCount).toBe(1);
    });

    it('lets a later charge consume standing credit with no allocation step', async () => {
      await pay('700000');

      const before = await position();
      expect(before.creditToman).toBe('250000');
      expect(before.amountDueToman).toBe('0');

      // One more session, charged at 250000. Nothing is written against the
      // credit, because there is no credit row to write against.
      expect(await chargeAgain()).toBe('250000');

      const after = await position();

      expect(after.netChargedTotalToman).toBe('700000');
      expect(after.confirmedPaymentTotalToman).toBe('700000');
      expect(after.creditToman).toBe('0');
      expect(after.amountDueToman).toBe('0');
      // The payment itself did not move: the same row, still confirmed.
      expect(after.paymentCount).toBe(1);
      expect(after.lastPayment).toStrictEqual(before.lastPayment);
    });
  });

  describe('a void is an absence, not a negative', () => {
    it('restores the position that stood before a payment was recorded', async () => {
      const before = await position();

      const paymentId = await pay('200000');
      const paid = await position();
      expect(paid.amountDueToman).toBe('250000');

      await voidPaymentOverHttp(harness, ledger.managerToken, paymentId).expect(200);

      const after = await position();

      // Every money number is exactly what it was before the payment existed.
      expect(after.netChargedTotalToman).toBe(before.netChargedTotalToman);
      expect(after.confirmedPaymentTotalToman).toBe('0');
      expect(after.amountDueToman).toBe(before.amountDueToman);
      expect(after.creditToman).toBe(before.creditToman);

      // And the reversal is visible rather than erased: the row is still there,
      // counted where a manager can see it.
      expect(after.paymentCount).toBe(0);
      expect(after.voidedPaymentCount).toBe(1);
      expect(after.lastPayment).toBeNull();
    });

    it('keeps the M5 reading of a voided charge and a withdrawn concession', async () => {
      const account = await read({ pageSize: 100 });

      // The position's charge side IS the account's, over the whole family: the
      // unfiltered totals and the position must agree exactly, because they are
      // the same aggregate with the same predicates.
      expect(account.position.netChargedTotalToman).toBe(account.totals.netChargedTotalToman);
      expect(account.totals.voidedChargeCount).toBe(1);

      // The withdrawn charge counts for nothing and its own live concession
      // reduces nothing; the withdrawn concession restored what it had removed.
      // Milestone 6 introduces no second reading of either.
      expect(account.position.netChargedTotalToman).toBe('450000');
    });

    it('rewrites no charge or adjustment row when the account is read', async () => {
      const before = await harness.prisma.$queryRaw<{ charges: bigint; adjustments: bigint }[]>`
        SELECT
          (SELECT count(*) FROM session_charge) AS charges,
          (SELECT count(*) FROM charge_adjustment) AS adjustments
      `;

      await pay('100000');
      await read();
      await read({ includeVoided: 'false' });

      const after = await harness.prisma.$queryRaw<{ charges: bigint; adjustments: bigint }[]>`
        SELECT
          (SELECT count(*) FROM session_charge) AS charges,
          (SELECT count(*) FROM charge_adjustment) AS adjustments
      `;

      expect(after).toStrictEqual(before);
    });
  });

  describe('the last payment', () => {
    it('names the most recent confirmed payment, by the day the money arrived', async () => {
      const older = await clinicDay(harness, -3);
      const newer = await clinicDay(harness, -1);

      await pay('100000', older);
      const latest = await pay('250000', newer);

      const owed = await position();

      expect(owed.lastPayment?.id).toBe(latest);
      expect(owed.lastPayment?.receivedOn).toBe(newer);
      expect(owed.lastPayment?.amountToman).toBe('250000');
      expect(owed.lastPayment?.status).toBe('CONFIRMED');
    });

    it('never offers a withdrawn payment as the money that arrived', async () => {
      const today = await clinicDay(harness);

      const standing = await pay('100000', await clinicDay(harness, -2));
      // Recorded later, for a later day, and then withdrawn: the newest row in
      // the family's history, and not money the clinic received.
      const mistake = await pay('900000', today);

      expect((await position()).lastPayment?.id).toBe(mistake);

      await voidPaymentOverHttp(harness, ledger.managerToken, mistake).expect(200);

      const owed = await position();

      // The correction falls back to the payment that still stands, rather than
      // presenting a reversal as the family's latest payment.
      expect(owed.lastPayment?.id).toBe(standing);
      expect(owed.lastPayment?.status).toBe('CONFIRMED');
      expect(owed.confirmedPaymentTotalToman).toBe('100000');
      expect(owed.voidedPaymentCount).toBe(1);
    });

    it('resolves two payments received on one day deterministically', async () => {
      const today = await clinicDay(harness);

      await pay('100000', today);
      const second = await pay('120000', today);

      // The order is the history's: the day, then the instant it was entered,
      // then the id. The same read twice is the same answer.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect((await position()).lastPayment?.id).toBe(second);
      }
    });

    it('summarises rather than embedding the payment', async () => {
      await pay('100000');

      const summary = await position().then((owed) => owed.lastPayment);

      expect(Object.keys(summary ?? {}).sort()).toEqual([
        'amountToman',
        'id',
        'method',
        'receivedOn',
        'status',
      ]);
    });
  });

  describe('promises are counted and move no money', () => {
    /**
     * Every promise state a family can be in, written the way A6 will write them.
     *
     * A PROMISE IS BORN `OPEN` AND IS NEVER BORN TERMINAL — the database refuses
     * anything else — so each terminal state here is reached by the transition
     * that produces it, exactly as the schema suite reaches them. `MISSED` is
     * written nowhere at all: it is a stored `OPEN` row and a clinic date.
     */
    async function seedEveryPromiseState(paymentId: string): Promise<void> {
      const overdue = await clinicDay(harness, -2);
      const soon = await clinicDay(harness, 5);

      await insertPromise(harness, fixture, { dueOn: soon });
      await insertPromise(harness, fixture, { dueOn: overdue });

      const cancelled = await insertPromise(harness, fixture, { dueOn: overdue });
      await cancelPromise(harness, fixture, cancelled);

      const rescheduled = await insertPromise(harness, fixture, { dueOn: overdue });
      const successor = await insertPromise(harness, fixture, { dueOn: soon });
      await reschedulePromise(harness, fixture, rescheduled, successor);

      // A promise kept by a payment that stands, which is the one state where a
      // promise touches money at all — and it touches it by pointing, not by
      // reducing anything.
      // Promised for what the payment actually was: one payment fulfils a
      // promise in full or not at all, and PostgreSQL refuses a smaller one.
      const fulfilled = await insertPromise(harness, fixture, {
        dueOn: overdue,
        amountToman: '50000',
      });
      await fulfilPromise(harness, fixture, fulfilled, paymentId);
    }

    it('changes no financial number in any promise state', async () => {
      await pay('100000');
      const before = await position();

      const paymentId = await pay('50000');
      await seedEveryPromiseState(paymentId);

      const after = await position();

      expect(after.netChargedTotalToman).toBe(before.netChargedTotalToman);
      // Only the second payment moved the money. The six promises moved none.
      expect(after.confirmedPaymentTotalToman).toBe('150000');
      expect(after.amountDueToman).toBe('300000');
      expect(after.creditToman).toBe('0');

      // Two still open and on time (one of them a reschedule successor), one
      // overdue, three terminal.
      expect(after.openPromiseCount).toBe(2);
      expect(after.missedPromiseCount).toBe(1);
    });

    it('counts an overdue OPEN promise as missed and never as both', async () => {
      const overdue = await clinicDay(harness, -1);
      const today = await clinicDay(harness);
      const later = await clinicDay(harness, 10);

      await insertPromise(harness, fixture, { dueOn: overdue });
      await insertPromise(harness, fixture, { dueOn: overdue });
      // Due TODAY is still on time: `MISSED` is due_on EARLIER than the clinic's
      // calendar day, not "not paid yet today".
      await insertPromise(harness, fixture, { dueOn: today });
      await insertPromise(harness, fixture, { dueOn: later });

      const owed = await position();

      expect(owed.missedPromiseCount).toBe(2);
      expect(owed.openPromiseCount).toBe(2);
      // The five wire statuses partition the family's promises: four rows, four
      // counted, none counted twice.
      expect(owed.openPromiseCount + owed.missedPromiseCount).toBe(4);
    });

    it('counts a terminal promise as neither open nor missed, however overdue', async () => {
      const overdue = await clinicDay(harness, -4);
      const paymentId = await pay('50000');

      // Promised for what the payment actually was: one payment fulfils a
      // promise in full or not at all, and PostgreSQL refuses a smaller one.
      const fulfilled = await insertPromise(harness, fixture, {
        dueOn: overdue,
        amountToman: '50000',
      });
      await fulfilPromise(harness, fixture, fulfilled, paymentId);

      const cancelled = await insertPromise(harness, fixture, { dueOn: overdue });
      await cancelPromise(harness, fixture, cancelled);

      // A successor may not be agreed already overdue (DECISION_LOG, 2026-08-15),
      // so the new date is a future one and the closed promise keeps the old.
      const rescheduled = await insertPromise(harness, fixture, { dueOn: overdue });
      const successor = await insertPromise(harness, fixture, {
        dueOn: await clinicDay(harness, 7),
      });
      await reschedulePromise(harness, fixture, rescheduled, successor);

      const owed = await position();

      // Three resolved promises count as neither, however overdue their dates
      // are. The successor is a row of its own, counted once on its own date, so
      // a chain of reschedules contributes one promise and not one per link.
      expect(owed.openPromiseCount).toBe(1);
      expect(owed.missedPromiseCount).toBe(0);
    });

    it('counts the promises of this family alone', async () => {
      const { familyId: other } = await makeFamilyWithChild(harness, ledger.managerToken, {
        firstName: 'کودک خانوادهٔ دیگر',
      });

      await insertPromise(harness, fixture, { dueOn: await clinicDay(harness, 3) });
      await insertPromise(harness, fixture, {
        familyId: other,
        dueOn: await clinicDay(harness, 3),
      });

      expect((await position()).openPromiseCount).toBe(1);
    });
  });

  describe('the position ignores every filter the charge view honours', () => {
    it('does not move when the reader narrows to one child or one day', async () => {
      await pay('120000');

      const whole = await position();

      const filtered: Record<string, string | number>[] = [
        { childId: ledger.childAId },
        { childId: ledger.childBId },
        { from: SATURDAY, to: SATURDAY },
        { from: NEXT_SATURDAY, to: NEXT_SATURDAY },
        { includeVoided: 'false' },
        { page: 2, pageSize: 2 },
        { childId: ledger.childBId, from: SATURDAY, to: SATURDAY, includeVoided: 'false' },
      ];

      for (const query of filtered) {
        expect(await position(query)).toStrictEqual(whole);
      }
    });

    it('keeps the filtered totals moving while the position stands still', async () => {
      await pay('120000');

      const account = await read({ childId: ledger.childAId });

      // The charge view is child A's: 250000 raised, 50000 conceded.
      expect(account.totals.netChargedTotalToman).toBe('200000');
      // The position is the family's, and says what the family owes.
      expect(account.position.netChargedTotalToman).toBe('450000');
      expect(account.position.amountDueToman).toBe('330000');
    });

    it('states the position for a family with no charges at all', async () => {
      const { familyId } = await makeFamilyWithChild(harness, ledger.managerToken, {
        firstName: 'کودک بی‌جلسه',
      });

      const account = await read({}, ledger.managerToken, familyId);

      expect(account.position.netChargedTotalToman).toBe('0');
      expect(account.position.confirmedPaymentTotalToman).toBe('0');
      expect(account.position.amountDueToman).toBe('0');
      expect(account.position.creditToman).toBe('0');
      expect(account.position.lastPayment).toBeNull();
      expect(account.position.openPromiseCount).toBe(0);
      expect(account.position.missedPromiseCount).toBe(0);
    });

    it('carries every position amount as a canonical unsigned toman string', async () => {
      await pay('500000');

      const owed = await position();

      for (const amount of [
        owed.netChargedTotalToman,
        owed.confirmedPaymentTotalToman,
        owed.creditToman,
        owed.amountDueToman,
        owed.lastPayment?.amountToman ?? '0',
      ]) {
        expect(amount).toMatch(/^(?:0|[1-9]\d*)$/);
      }
    });
  });

  describe('access and privacy', () => {
    it('lets a receptionist read the position', async () => {
      // Manager and receptionist both hold `charge.read`, `payment.read` and
      // `promise.read`, which this route requires ALL of.
      const receptionist = await signIn(harness, 'RECEPTIONIST');
      await pay('100000');

      const account = await read({}, receptionist.token);

      expect(account.position.amountDueToman).toBe('350000');
    });

    it('refuses a caller without a session', async () => {
      await familyAccount(harness, 'not-a-session-token', ledger.familyId).expect(401);
    });

    it('answers 404 for a family that does not exist', async () => {
      const response = await familyAccount(harness, ledger.managerToken, uuidv7()).expect(404);

      expect(response.body.error.code).toBe('FAMILY_NOT_FOUND');
    });

    it('writes no audit row for a position read', async () => {
      await pay('100000');
      const before = await harness.prisma.auditLog.count();

      await read();
      await read({ childId: ledger.childAId });

      // `audit_log` is append-only and permanent. Audit records financial ACTS,
      // and reading what a family owes performs none.
      expect(await harness.prisma.auditLog.count()).toBe(before);
    });
  });

  /**
   * ONE RESPONSE, ONE DATABASE MOMENT — the part of it that is arithmetic.
   *
   * The position is charges MINUS payments, read in separate statements. Under
   * `READ COMMITTED` a payment committing between them would produce an amount
   * due that follows from neither number printed beside it, which is a balance a
   * family is quoted rather than a stale row a reader refreshes. The read is
   * `REPEATABLE READ` for exactly that reason, and the deterministic half of the
   * proof — that the transaction is opened and that no statement escapes it —
   * lives in `family-account-snapshot.spec.ts`.
   */
  describe('snapshot consistency', () => {
    function expectSelfConsistent(account: FamilyAccountResponse): void {
      const net = BigInt(account.position.netChargedTotalToman);
      const paid = BigInt(account.position.confirmedPaymentTotalToman);
      const due = BigInt(account.position.amountDueToman);
      const credit = BigInt(account.position.creditToman);

      expect(due - credit).toBe(net - paid);
      expect(due === 0n || credit === 0n).toBe(true);
    }

    it('adds up while payments are being recorded against the same family', async () => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const [account] = await Promise.all([read({ pageSize: 100 }), pay('10000')]);

        expectSelfConsistent(account);
      }

      const after = await read({ pageSize: 100 });
      expect(after.position.confirmedPaymentTotalToman).toBe('80000');
      expectSelfConsistent(after);
    });
  });
});
