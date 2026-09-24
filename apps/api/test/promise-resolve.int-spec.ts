import request from 'supertest';
import {
  familyAccountResponseSchema,
  promiseResponseSchema,
  rescheduledPromiseResponseSchema,
  type FamilyFinancialPosition,
  type PaymentPromise,
} from '@clinic/contracts';
import { signIn } from './appointments-support';
import { uuidv7 } from '../src/common/uuid';
import { createHarness, internalHeaders, resetDatabase, type Harness } from './harness';
import { familyAccount, seedFamilyLedger, type FamilyLedgerFixture } from './ledger-support';
import {
  cancelPromiseOverHttp,
  clinicDay,
  createPromiseOverHttp,
  fulfilPromiseOverHttp,
  promiseAuditRows,
  recordPaymentOverHttp,
  reschedulePromiseOverHttp,
  seedAnotherFamily,
  voidPaymentOverHttp,
  type PaymentFixture,
} from './payment-support';

/**
 * How a promise ends — checkpoint A6: kept, moved, or abandoned.
 *
 * EVERYTHING HERE IS SYNTHETIC.
 *
 * TWO CLAIMS THIS SUITE EXISTS TO PROVE. The first is that a promise resolves
 * EXACTLY ONCE and that the resolution is a whole historical fact — actor,
 * instant, reason, and the link to whatever replaced or settled it — which no
 * later act rewrites. The second is that NONE OF IT MOVES MONEY: the A5 position
 * is read before and after every state a promise can reach, and the four money
 * fields must be identical each time. That is the regression the frozen contract
 * hangs on, because a promise that quietly reduced a balance would look exactly
 * like a payment nobody recorded.
 *
 * THE FIXTURE IS A FAMILY WITH A REAL LEDGER, not an empty one. A position that
 * is all zeroes cannot demonstrate that a number did not move, so the family
 * carries the Milestone 5 seed's charges and concessions throughout.
 *
 * `MISSED` IS THE ORDINARY CASE FOR ALL THREE VERBS, and each of them is tested
 * against one: a missed promise is stored `OPEN`, so being overdue is never a
 * reason to refuse.
 */
describe('promise resolution (real PostgreSQL)', () => {
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

  /** Where the family stands, parsed against the frozen contract. */
  async function position(): Promise<FamilyFinancialPosition> {
    const response = await familyAccount(harness, fixture.managerToken, fixture.familyId).expect(
      200,
    );

    return familyAccountResponseSchema.parse(response.body).position;
  }

  /** The four numbers a promise must never move, as one comparable value. */
  function money(of: FamilyFinancialPosition): Record<string, string> {
    return {
      netChargedTotalToman: of.netChargedTotalToman,
      confirmedPaymentTotalToman: of.confirmedPaymentTotalToman,
      creditToman: of.creditToman,
      amountDueToman: of.amountDueToman,
    };
  }

  async function promise(
    amountToman = '250000',
    dueOffsetDays = 7,
    familyId = fixture.familyId,
  ): Promise<PaymentPromise> {
    const response = await createPromiseOverHttp(harness, fixture.managerToken, familyId, {
      amountToman,
      dueOn: await clinicDay(harness, dueOffsetDays),
    }).expect(200);

    return promiseResponseSchema.parse(response.body).promise;
  }

  async function payment(amountToman = '250000', familyId = fixture.familyId): Promise<string> {
    const response = await recordPaymentOverHttp(harness, fixture.managerToken, familyId, {
      amountToman,
      method: 'CASH',
      receivedOn: await clinicDay(harness),
    }).expect(200);

    return response.body.payment.id as string;
  }

  async function fulfil(promiseId: string, paymentId: string): Promise<PaymentPromise> {
    const response = await fulfilPromiseOverHttp(harness, fixture.managerToken, promiseId, {
      paymentId,
    }).expect(200);

    return promiseResponseSchema.parse(response.body).promise;
  }

  describe('fulfil', () => {
    it('marks the promise kept and names the payment that kept it', async () => {
      const open = await promise('250000');
      const paymentId = await payment('250000');

      const kept = await fulfil(open.id, paymentId);

      expect(kept.status).toBe('FULFILLED');
      expect(kept.resolvedByUserId).toBe(fixture.managerId);
      expect(kept.resolvedAt).not.toBeNull();

      // Optional on a kept promise: the linked payment is the explanation.
      expect(kept.resolutionReason).toBeNull();

      expect(kept.fulfillingPayment).toEqual({
        id: paymentId,
        amountToman: '250000',
        method: 'CASH',
        receivedOn: await clinicDay(harness),
        status: 'CONFIRMED',
      });
    });

    /**
     * A payment larger than the promise fulfils it entirely; the surplus shows as
     * derived credit on the family position and is recorded against the promise
     * nowhere, because there is no allocation row for a portion to live in.
     */
    it('accepts a payment larger than the promise', async () => {
      const open = await promise('250000');
      const kept = await fulfil(open.id, await payment('800000'));

      expect(kept.status).toBe('FULFILLED');
      expect(kept.amountToman).toBe('250000');
      expect(kept.fulfillingPayment?.amountToman).toBe('800000');
    });

    it('fulfils a MISSED promise, because it is stored OPEN', async () => {
      const overdue = await promise('250000', -3);
      expect(overdue.status).toBe('MISSED');

      const kept = await fulfil(overdue.id, await payment('250000'));
      expect(kept.status).toBe('FULFILLED');
    });

    it('lets a receptionist fulfil one', async () => {
      const receptionist = await signIn(harness, 'RECEPTIONIST');
      const open = await promise('250000');
      const paymentId = await payment('250000');

      const response = await fulfilPromiseOverHttp(harness, receptionist.token, open.id, {
        paymentId,
      }).expect(200);

      expect(promiseResponseSchema.parse(response.body).promise.resolvedByUserId).toBe(
        receptionist.id,
      );
    });

    describe('what it refuses', () => {
      it('refuses an unknown promise with PROMISE_NOT_FOUND', async () => {
        const response = await fulfilPromiseOverHttp(harness, fixture.managerToken, uuidv7(), {
          paymentId: await payment(),
        });

        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe('PROMISE_NOT_FOUND');
      });

      /**
       * The promise is locked and tested FIRST, so a caller naming a promise that
       * has already ended is told so before any payment is touched — which is
       * also what keeps this path out of the forbidden lock direction.
       */
      it('refuses a promise that has already ended with PROMISE_NOT_OPEN', async () => {
        const open = await promise('250000');
        await fulfil(open.id, await payment('250000'));

        const response = await fulfilPromiseOverHttp(harness, fixture.managerToken, open.id, {
          paymentId: await payment('250000'),
        });

        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('PROMISE_NOT_OPEN');
      });

      it('refuses a payment that does not exist with PAYMENT_NOT_FOUND', async () => {
        const open = await promise('250000');

        const response = await fulfilPromiseOverHttp(harness, fixture.managerToken, open.id, {
          paymentId: uuidv7(),
        });

        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe('PAYMENT_NOT_FOUND');
      });

      it("refuses another family's payment with PAYMENT_FAMILY_MISMATCH", async () => {
        const otherFamilyId = await seedAnotherFamily(harness, fixture);
        const open = await promise('250000');
        const theirs = await payment('250000', otherFamilyId);

        const response = await fulfilPromiseOverHttp(harness, fixture.managerToken, open.id, {
          paymentId: theirs,
        });

        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe('PAYMENT_FAMILY_MISMATCH');
      });

      it('refuses a voided payment with PAYMENT_VOIDED', async () => {
        const open = await promise('250000');
        const paymentId = await payment('250000');
        await voidPaymentOverHttp(harness, fixture.managerToken, paymentId).expect(200);

        const response = await fulfilPromiseOverHttp(harness, fixture.managerToken, open.id, {
          paymentId,
        });

        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('PAYMENT_VOIDED');
      });

      it('refuses a payment smaller than the promise with PROMISE_PAYMENT_TOO_SMALL', async () => {
        const open = await promise('250000');

        const response = await fulfilPromiseOverHttp(harness, fixture.managerToken, open.id, {
          paymentId: await payment('249999'),
        });

        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe('PROMISE_PAYMENT_TOO_SMALL');
      });

      it('refuses a payment that already fulfils another promise', async () => {
        const paymentId = await payment('800000');
        const first = await promise('250000');
        const second = await promise('250000');

        await fulfil(first.id, paymentId);

        const response = await fulfilPromiseOverHttp(harness, fixture.managerToken, second.id, {
          paymentId,
        });

        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('PAYMENT_ALREADY_FULFILS_PROMISE');

        // The second promise is untouched: a refusal writes nothing.
        const stored = await harness.prisma.paymentPromise.findUniqueOrThrow({
          where: { id: second.id },
        });
        expect(stored.status).toBe('OPEN');
      });

      it('refuses a request that invents an amount or a reason', async () => {
        const open = await promise('250000');
        const paymentId = await payment('250000');

        for (const extra of [{ amountToman: '250000' }, { reason: 'دلیل' }]) {
          const response = await fulfilPromiseOverHttp(harness, fixture.managerToken, open.id, {
            paymentId,
            ...extra,
          });

          expect(response.status).toBe(400);
          expect(response.body.error.code).toBe('VALIDATION_FAILED');
        }
      });
    });

    it('writes exactly one payment_promise.fulfilled row carrying both amounts', async () => {
      const open = await promise('250000');
      const paymentId = await payment('800000');
      await fulfil(open.id, paymentId);

      const rows = await promiseAuditRows(harness, open.id);
      expect(rows.map((row) => row.action)).toEqual([
        'payment_promise.created',
        'payment_promise.fulfilled',
      ]);

      const fulfilled = rows[1];
      expect(fulfilled?.actor_user_id).toBe(fixture.managerId);

      // Both amounts, so a reader can explain why a promise of 250,000 is settled
      // by a payment of 800,000 without opening two more tables.
      expect(fulfilled?.after).toEqual({
        familyId: fixture.familyId,
        promisedAmountToman: '250000',
        paymentId,
        paymentAmountToman: '800000',
      });
    });
  });

  /**
   * Voiding the payment behind a kept promise does not un-keep it: a human
   * judgement recorded at the time is not un-made by a later correction, and
   * rewriting the promise to keep an invariant tidy would destroy the history the
   * record exists for (DECISION_LOG, 2026-08-15).
   */
  describe('a fulfilling payment voided afterwards', () => {
    it('leaves the promise FULFILLED and reports the payment as VOIDED', async () => {
      const open = await promise('250000');
      const paymentId = await payment('250000');
      await fulfil(open.id, paymentId);

      await voidPaymentOverHttp(harness, fixture.managerToken, paymentId, {
        reason: 'واریز تکراری خانواده',
      }).expect(200);

      const response = await cancelPromiseOverHttp(harness, fixture.managerToken, open.id);
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('PROMISE_NOT_OPEN');

      const stored = await harness.prisma.paymentPromise.findUniqueOrThrow({
        where: { id: open.id },
      });
      expect(stored.status).toBe('FULFILLED');
      expect(stored.fulfillingPaymentId).toBe(paymentId);
    });
  });

  describe('reschedule', () => {
    it('closes the old promise into a new one and returns both, named', async () => {
      const original = await promise('250000', 2);
      const newDueOn = await clinicDay(harness, 20);

      const response = await reschedulePromiseOverHttp(harness, fixture.managerToken, original.id, {
        dueOn: newDueOn,
        reason: 'تعویق حقوق پدر',
      }).expect(200);

      const { promise: closed, successor } = rescheduledPromiseResponseSchema.parse(response.body);

      expect(closed.id).toBe(original.id);
      expect(closed.status).toBe('RESCHEDULED');
      expect(closed.rescheduledToPromiseId).toBe(successor.id);
      expect(closed.resolutionReason).toBe('تعویق حقوق پدر');
      expect(closed.resolvedByUserId).toBe(fixture.managerId);

      expect(successor.status).toBe('OPEN');
      expect(successor.dueOn).toBe(newDueOn);
      expect(successor.rescheduledFromPromiseId).toBe(original.id);
      expect(successor.rescheduledToPromiseId).toBeNull();
    });

    /**
     * The old promise is preserved, not edited into the new one — which is what
     * makes "rescheduling preserves old due-date history" (PROJECT_SPEC.md 8)
     * structural rather than a convention.
     */
    it('preserves the original due date, amount, note, actor and creation instant', async () => {
      const receptionist = await signIn(harness, 'RECEPTIONIST');

      const created = await createPromiseOverHttp(harness, receptionist.token, fixture.familyId, {
        amountToman: '333000',
        dueOn: await clinicDay(harness, 2),
        note: 'یادداشت اصلی',
      }).expect(200);
      const original = promiseResponseSchema.parse(created.body).promise;

      const response = await reschedulePromiseOverHttp(harness, fixture.managerToken, original.id, {
        dueOn: await clinicDay(harness, 30),
        reason: 'توافق جدید',
      }).expect(200);

      const { promise: closed, successor } = rescheduledPromiseResponseSchema.parse(response.body);

      expect(closed.dueOn).toBe(original.dueOn);
      expect(closed.amountToman).toBe('333000');
      expect(closed.note).toBe('یادداشت اصلی');
      expect(closed.createdAt).toBe(original.createdAt);
      expect(closed.createdByUserId).toBe(receptionist.id);

      // Neither the amount nor the note may change (frozen F1); the successor's
      // creation actor is whoever rescheduled it.
      expect(successor.amountToman).toBe('333000');
      expect(successor.note).toBe('یادداشت اصلی');
      expect(successor.createdByUserId).toBe(fixture.managerId);
    });

    it('reschedules a MISSED promise, because it is stored OPEN', async () => {
      const overdue = await promise('250000', -5);
      expect(overdue.status).toBe('MISSED');

      const response = await reschedulePromiseOverHttp(harness, fixture.managerToken, overdue.id, {
        dueOn: await clinicDay(harness, 7),
        reason: 'قول تازه پس از تأخیر',
      }).expect(200);

      const { promise: closed, successor } = rescheduledPromiseResponseSchema.parse(response.body);
      expect(closed.status).toBe('RESCHEDULED');
      expect(successor.status).toBe('OPEN');
    });

    it('accepts a successor due TODAY', async () => {
      const original = await promise('250000', -1);

      const response = await reschedulePromiseOverHttp(harness, fixture.managerToken, original.id, {
        dueOn: await clinicDay(harness),
        reason: 'پرداخت امروز',
      });

      expect(response.status).toBe(200);
    });

    /**
     * The one place the two due-date rules differ: creation accepts a past date,
     * rescheduling does not. An intention already overdue at the moment it is
     * agreed records nothing.
     */
    it('refuses a successor due in the past with PROMISE_DUE_DATE_IN_PAST, atomically', async () => {
      const original = await promise('250000', 2);
      const before = await harness.prisma.paymentPromise.count();

      const response = await reschedulePromiseOverHttp(harness, fixture.managerToken, original.id, {
        dueOn: await clinicDay(harness, -1),
        reason: 'تاریخ گذشته',
      });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('PROMISE_DUE_DATE_IN_PAST');

      // No orphan successor was left behind, and the predecessor is untouched.
      expect(await harness.prisma.paymentPromise.count()).toBe(before);
      const stored = await harness.prisma.paymentPromise.findUniqueOrThrow({
        where: { id: original.id },
      });
      expect(stored.status).toBe('OPEN');
      expect(stored.rescheduledToPromiseId).toBeNull();
    });

    it('refuses a terminal promise and an unknown one', async () => {
      const cancelled = await promise('250000');
      await cancelPromiseOverHttp(harness, fixture.managerToken, cancelled.id).expect(200);

      const dueOn = await clinicDay(harness, 7);

      const terminal = await reschedulePromiseOverHttp(
        harness,
        fixture.managerToken,
        cancelled.id,
        {
          dueOn,
          reason: 'دلیل',
        },
      );
      expect(terminal.status).toBe(409);
      expect(terminal.body.error.code).toBe('PROMISE_NOT_OPEN');

      const missing = await reschedulePromiseOverHttp(harness, fixture.managerToken, uuidv7(), {
        dueOn,
        reason: 'دلیل',
      });
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('PROMISE_NOT_FOUND');
    });

    it('refuses a missing reason and an amount the caller tried to change', async () => {
      const original = await promise('250000');
      const dueOn = await clinicDay(harness, 7);

      for (const body of [
        { dueOn },
        { dueOn, reason: '   ' },
        { dueOn, reason: 'دلیل', amountToman: '999000' },
      ]) {
        const response = await reschedulePromiseOverHttp(
          harness,
          fixture.managerToken,
          original.id,
          body,
        );

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('writes one payment_promise.rescheduled row carrying both dates and the successor', async () => {
      const original = await promise('250000', 2);
      const newDueOn = await clinicDay(harness, 20);

      const response = await reschedulePromiseOverHttp(harness, fixture.managerToken, original.id, {
        dueOn: newDueOn,
        reason: 'تعویق حقوق پدر',
      }).expect(200);
      const { successor } = rescheduledPromiseResponseSchema.parse(response.body);

      const rows = await promiseAuditRows(harness, original.id);
      expect(rows.map((row) => row.action)).toEqual([
        'payment_promise.created',
        'payment_promise.rescheduled',
      ]);

      expect(rows[1]?.after).toEqual({
        familyId: fixture.familyId,
        amountToman: '250000',
        previousDueOn: original.dueOn,
        newDueOn,
        successorPromiseId: successor.id,
        reason: 'تعویق حقوق پدر',
      });

      // The successor is the other half of ONE act, not a promise created in its
      // own right: a second `created` row would double-count every reschedule.
      expect(await promiseAuditRows(harness, successor.id)).toHaveLength(0);
    });

    it('lets a chain of reschedules read in both directions', async () => {
      const first = await promise('250000', 1);

      const secondResponse = await reschedulePromiseOverHttp(
        harness,
        fixture.managerToken,
        first.id,
        { dueOn: await clinicDay(harness, 10), reason: 'یکم' },
      ).expect(200);
      const second = rescheduledPromiseResponseSchema.parse(secondResponse.body).successor;

      const thirdResponse = await reschedulePromiseOverHttp(
        harness,
        fixture.managerToken,
        second.id,
        { dueOn: await clinicDay(harness, 20), reason: 'دوم' },
      ).expect(200);
      const { promise: middle, successor: third } = rescheduledPromiseResponseSchema.parse(
        thirdResponse.body,
      );

      expect(middle.rescheduledFromPromiseId).toBe(first.id);
      expect(middle.rescheduledToPromiseId).toBe(third.id);
      expect(third.rescheduledFromPromiseId).toBe(second.id);
      expect(third.status).toBe('OPEN');
    });
  });

  describe('cancel', () => {
    it('ends the promise with its reason, its actor and its instant', async () => {
      const open = await promise('250000');

      const response = await cancelPromiseOverHttp(harness, fixture.managerToken, open.id, {
        reason: 'خانواده منصرف شد',
      }).expect(200);

      const cancelled = promiseResponseSchema.parse(response.body).promise;

      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.resolutionReason).toBe('خانواده منصرف شد');
      expect(cancelled.resolvedByUserId).toBe(fixture.managerId);
      expect(cancelled.resolvedAt).not.toBeNull();

      // Nothing is deleted, and nothing is linked.
      expect(cancelled.fulfillingPayment).toBeNull();
      expect(cancelled.rescheduledToPromiseId).toBeNull();
      expect(cancelled.dueOn).toBe(open.dueOn);
      expect(cancelled.amountToman).toBe('250000');
      expect(cancelled.createdAt).toBe(open.createdAt);
    });

    it('cancels a MISSED promise, because it is stored OPEN', async () => {
      const overdue = await promise('250000', -9);
      expect(overdue.status).toBe('MISSED');

      const response = await cancelPromiseOverHttp(harness, fixture.managerToken, overdue.id, {
        reason: 'قول رها شده',
      }).expect(200);

      expect(promiseResponseSchema.parse(response.body).promise.status).toBe('CANCELLED');
    });

    it('refuses a terminal promise, an unknown one, and a missing reason', async () => {
      const open = await promise('250000');
      await cancelPromiseOverHttp(harness, fixture.managerToken, open.id).expect(200);

      const again = await cancelPromiseOverHttp(harness, fixture.managerToken, open.id);
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('PROMISE_NOT_OPEN');

      const missing = await cancelPromiseOverHttp(harness, fixture.managerToken, uuidv7());
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('PROMISE_NOT_FOUND');

      const other = await promise('250000');
      for (const body of [{}, { reason: '  ' }, { reason: 'x'.repeat(501) }]) {
        const response = await cancelPromiseOverHttp(harness, fixture.managerToken, other.id, body);
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('writes one payment_promise.cancelled row with the reason', async () => {
      const open = await promise('250000', 4);

      await cancelPromiseOverHttp(harness, fixture.managerToken, open.id, {
        reason: 'خانواده منصرف شد',
      }).expect(200);

      const rows = await promiseAuditRows(harness, open.id);
      expect(rows.map((row) => row.action)).toEqual([
        'payment_promise.created',
        'payment_promise.cancelled',
      ]);

      expect(rows[1]?.after).toEqual({
        familyId: fixture.familyId,
        amountToman: '250000',
        dueOn: open.dueOn,
        reason: 'خانواده منصرف شد',
      });
    });
  });

  /**
   * A receptionist holds `promise.resolve` for all three verbs, and a caller with
   * no session holds nothing. There is deliberately no manager-only promise
   * correction: none of the three moves a rial.
   */
  describe('permissions', () => {
    it('refuses every promise route without a session', async () => {
      const open = await promise('250000');

      for (const path of [
        `/promises/${open.id}/fulfill`,
        `/promises/${open.id}/reschedule`,
        `/promises/${open.id}/cancel`,
      ]) {
        const response = await request(harness.app.getHttpServer())
          .post(path)
          .set(internalHeaders())
          .send({});

        expect(response.status).toBe(401);
        expect(response.body.error.code).toBe('AUTH_SESSION_INVALID');
      }
    });

    it('lets a receptionist reschedule and cancel', async () => {
      const receptionist = await signIn(harness, 'RECEPTIONIST');

      const toReschedule = await promise('250000');
      const rescheduled = await reschedulePromiseOverHttp(
        harness,
        receptionist.token,
        toReschedule.id,
        { dueOn: await clinicDay(harness, 14), reason: 'توافق پیشخوان' },
      );
      expect(rescheduled.status).toBe(200);

      const toCancel = await promise('250000');
      const cancelled = await cancelPromiseOverHttp(harness, receptionist.token, toCancel.id, {
        reason: 'انصراف',
      });
      expect(cancelled.status).toBe(200);
    });
  });

  /**
   * THE REGRESSION THE WHOLE MILESTONE HANGS ON. A promise never changes the
   * family's financial position, in any state (CLAUDE.md; PROJECT_SPEC.md 8), so
   * the four money fields must survive every verb untouched. Only the promise
   * COUNTS may move, and they move according to the derived status.
   */
  describe('financial non-effect', () => {
    it('moves no money across create, missed, fulfil, reschedule and cancel', async () => {
      const baseline = await position();
      expect(money(baseline)).toEqual({
        netChargedTotalToman: '450000',
        confirmedPaymentTotalToman: '0',
        creditToman: '0',
        amountDueToman: '450000',
      });

      // Created, on time.
      const onTime = await promise('250000', 5);
      expect(money(await position())).toEqual(money(baseline));

      // Created, already overdue — derived MISSED, and still no money.
      const overdue = await promise('250000', -2);
      const afterMissed = await position();
      expect(money(afterMissed)).toEqual(money(baseline));
      expect(afterMissed.openPromiseCount).toBe(1);
      expect(afterMissed.missedPromiseCount).toBe(1);

      // Cancelled: a terminal promise counts as neither open nor missed.
      await cancelPromiseOverHttp(harness, fixture.managerToken, overdue.id, {
        reason: 'رها شد',
      }).expect(200);
      const afterCancel = await position();
      expect(money(afterCancel)).toEqual(money(baseline));
      expect(afterCancel.missedPromiseCount).toBe(0);

      // Rescheduled: the chain contributes exactly one open promise, on the
      // successor's own due date.
      await reschedulePromiseOverHttp(harness, fixture.managerToken, onTime.id, {
        dueOn: await clinicDay(harness, 25),
        reason: 'تعویق',
      }).expect(200);
      const afterReschedule = await position();
      expect(money(afterReschedule)).toEqual(money(baseline));
      expect(afterReschedule.openPromiseCount).toBe(1);
    });

    it('leaves the position exactly where the PAYMENT put it when a promise is fulfilled', async () => {
      const open = await promise('250000');
      const paymentId = await payment('250000');

      // The payment is what moved the money, before any promise touched it.
      const afterPayment = await position();
      expect(afterPayment.confirmedPaymentTotalToman).toBe('250000');
      expect(afterPayment.amountDueToman).toBe('200000');

      await fulfil(open.id, paymentId);

      // Fulfilment recorded a historical LINK and nothing else. The money is
      // identical, and the promise has left the open count without entering any
      // sum.
      const afterFulfil = await position();
      expect(money(afterFulfil)).toEqual(money(afterPayment));
      expect(afterFulfil.openPromiseCount).toBe(0);
      expect(afterFulfil.missedPromiseCount).toBe(0);
    });

    it('does not re-move the money when the fulfilling payment is later voided', async () => {
      const open = await promise('250000');
      const paymentId = await payment('250000');
      await fulfil(open.id, paymentId);

      const beforeVoid = await position();
      await voidPaymentOverHttp(harness, fixture.managerToken, paymentId, {
        reason: 'اشتباه ثبت',
      }).expect(200);

      // The void restores the position that stood before the payment — exactly,
      // and because the payment stopped counting, not because the promise did
      // anything.
      const afterVoid = await position();
      expect(afterVoid.confirmedPaymentTotalToman).toBe('0');
      expect(afterVoid.amountDueToman).toBe('450000');
      expect(beforeVoid.confirmedPaymentTotalToman).toBe('250000');

      // And the promise is still terminal, so it is in neither count.
      expect(afterVoid.openPromiseCount).toBe(0);
      expect(afterVoid.missedPromiseCount).toBe(0);
    });
  });
});
