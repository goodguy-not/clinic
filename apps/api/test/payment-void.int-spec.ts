import request from 'supertest';
import { paymentResponseSchema, type Payment } from '@clinic/contracts';
import { AuditService } from '../src/audit/audit.service';
import { ENDPOINT_ACCESS_KEY } from '../src/auth/decorators/endpoint-access';
import { PaymentVoidController } from '../src/payments/payment-void.controller';
import { uuidv7 } from '../src/common/uuid';
import { signIn } from './appointments-support';
import { createHarness, internalHeaders, resetDatabase, type Harness } from './harness';
import {
  clinicDay,
  fulfilPromise,
  insertPromise,
  recordPaymentOverHttp,
  seedPayingFamily,
  voidPaymentOverHttp,
  voidedPaymentAuditRows,
  type PaymentFixture,
} from './payment-support';

/**
 * Withdrawing a payment that should not stand — checkpoint A4.
 *
 * EVERYTHING HERE IS SYNTHETIC. No real family, guardian, amount, bank reference
 * or note appears in any fixture in this project.
 *
 * WHAT THIS SUITE IS ABOUT. A void is a financial CORRECTION: the row survives
 * whole, three columns are written beside it exactly once, a manager and only a
 * manager may do it, the reason is mandatory, and one `payment.voided` audit row
 * is written in the same transaction. Nothing is deleted, nothing is replaced
 * and no total is computed — what the family owes stays derived from rows.
 *
 * The invariants that belong to the database (immutability, the one-way
 * transition, the void triple) are asked of real PostgreSQL rather than of a
 * mock, because the triggers are the final backstop and this suite's claim is
 * that the service and the database agree.
 */
describe('voiding a family payment', () => {
  let harness: Harness;
  let fixture: PaymentFixture;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    fixture = await seedPayingFamily(harness);
  });

  /** Records a payment over the A3 route and returns it, parsed. */
  async function record(body: Record<string, unknown> = {}): Promise<Payment> {
    const response = await recordPaymentOverHttp(harness, fixture.managerToken, fixture.familyId, {
      amountToman: '250000',
      method: 'CASH',
      receivedOn: await clinicDay(harness),
      ...body,
    }).expect(200);

    return paymentResponseSchema.parse(response.body).payment;
  }

  /** Voids over the frozen route and returns the payment, parsed by the frozen schema. */
  async function voidPayment(
    paymentId: string,
    reason = 'ثبت اشتباه مبلغ',
    token = fixture.managerToken,
  ): Promise<Payment> {
    const response = await voidPaymentOverHttp(harness, token, paymentId, { reason }).expect(200);
    return paymentResponseSchema.parse(response.body).payment;
  }

  /** The stored row, every column, exactly as PostgreSQL holds it. */
  async function paymentRow(paymentId: string): Promise<Record<string, unknown>> {
    const rows = await harness.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT id, family_id, amount_toman, method::text AS method,
             received_on::text AS received_on, reference, note,
             created_at, created_by_user_id, voided_at, voided_by_user_id, void_reason
      FROM payment WHERE id = ${paymentId}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new Error(`payment ${paymentId} is missing`);
    return row;
  }

  describe('the ordinary void', () => {
    it('answers 200 with the frozen { payment } body reporting VOIDED', async () => {
      const payment = await record();

      const response = await voidPaymentOverHttp(harness, fixture.managerToken, payment.id, {
        reason: 'ثبت اشتباه مبلغ',
      });

      expect(response.status).toBe(200);
      expect(Object.keys(response.body)).toEqual(['payment']);

      // Parsed by the FROZEN schema, whose refinements refuse a response that
      // says VOIDED without a void instant or carries a partial void triple.
      const voided = paymentResponseSchema.parse(response.body).payment;
      expect(voided.status).toBe('VOIDED');
      expect(voided.voidedAt).not.toBeNull();
      expect(voided.voidedByUserId).toBe(fixture.managerId);
      expect(voided.voidReason).toBe('ثبت اشتباه مبلغ');
    });

    it('records the server actor, the server instant and the exact reason', async () => {
      const before = Date.now();
      const payment = await record();
      const voided = await voidPayment(payment.id, 'واریز تکراری خانواده');
      const after = Date.now();

      const row = await paymentRow(payment.id);

      // The actor is the session's, never the body's, and the instant is
      // PostgreSQL's `transaction_timestamp()`, never the caller's clock.
      expect(row['voided_by_user_id']).toBe(fixture.managerId);
      expect(row['void_reason']).toBe('واریز تکراری خانواده');
      const storedAt = row['voided_at'] as Date;
      expect(storedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(storedAt.getTime()).toBeLessThanOrEqual(after);

      // The wire says exactly what the row says.
      expect(voided.voidedAt).toBe(storedAt.toISOString());
      expect(voided.voidedByUserId).toBe(row['voided_by_user_id']);
      expect(voided.voidReason).toBe(row['void_reason']);
    });

    it('trims the reason before storing it, so the stored value is canonical', async () => {
      const payment = await record();

      const voided = await voidPayment(payment.id, '   اصلاح مالی   ');

      // `payment_void_consistency_chk` asserts `void_reason = btrim(void_reason)`;
      // this is the service arriving with a value that already satisfies it.
      expect(voided.voidReason).toBe('اصلاح مالی');
      expect((await paymentRow(payment.id))['void_reason']).toBe('اصلاح مالی');
    });

    it('preserves the whole payment: nothing but the three void columns changes', async () => {
      const receivedOn = await clinicDay(harness, -4);
      const payment = await record({
        amountToman: '480000',
        method: 'TRANSFER',
        receivedOn,
        reference: 'TRX-000123',
        note: 'یادداشت آزمایشی',
      });

      const beforeRow = await paymentRow(payment.id);
      const voided = await voidPayment(payment.id);
      const afterRow = await paymentRow(payment.id);

      // A void is a correction, not a deletion and not an edit. Every fact the
      // record makes about the money is left exactly as recorded — including
      // the back-dated received day and the creation facts, which are what make
      // the back-date visible as one.
      for (const column of [
        'id',
        'family_id',
        'amount_toman',
        'method',
        'received_on',
        'reference',
        'note',
        'created_at',
        'created_by_user_id',
      ]) {
        expect(afterRow[column]).toEqual(beforeRow[column]);
      }

      // And the same on the wire.
      expect(voided.familyId).toBe(payment.familyId);
      expect(voided.amountToman).toBe('480000');
      expect(voided.method).toBe('TRANSFER');
      expect(voided.receivedOn).toBe(receivedOn);
      expect(voided.reference).toBe('TRX-000123');
      expect(voided.note).toBe('یادداشت آزمایشی');
      expect(voided.createdAt).toBe(payment.createdAt);
      expect(voided.createdByUserId).toBe(payment.createdByUserId);
    });

    it('keeps the row: a void never deletes a payment', async () => {
      const payment = await record();
      await voidPayment(payment.id);

      const rows = await harness.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count FROM payment
      `;
      expect(Number(rows[0]?.count ?? 0n)).toBe(1);
    });
  });

  describe('the transition happens exactly once', () => {
    it('refuses a second void with PAYMENT_ALREADY_VOIDED and changes nothing', async () => {
      const payment = await record();
      const voided = await voidPayment(payment.id, 'دلیل نخست');

      const second = await voidPaymentOverHttp(harness, fixture.managerToken, payment.id, {
        reason: 'دلیل دوم',
      });

      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('PAYMENT_ALREADY_VOIDED');

      // The first manager's reason, actor and instant stand: a second void
      // cannot overwrite a correction that has already been recorded.
      const row = await paymentRow(payment.id);
      expect(row['void_reason']).toBe('دلیل نخست');
      expect((row['voided_at'] as Date).toISOString()).toBe(voided.voidedAt);

      // And one audit fact, not two.
      expect(await voidedPaymentAuditRows(harness, payment.id)).toHaveLength(1);
    });

    it('answers PAYMENT_NOT_FOUND for a payment that does not exist', async () => {
      const response = await voidPaymentOverHttp(harness, fixture.managerToken, uuidv7(), {
        reason: 'ثبت اشتباه مبلغ',
      });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('PAYMENT_NOT_FOUND');
    });

    it('rejects an id that is not a uuid before any table is read', async () => {
      await voidPaymentOverHttp(harness, fixture.managerToken, 'not-a-uuid').expect(400);
    });
  });

  describe('the reason is mandatory', () => {
    it('refuses a request with no reason at all', async () => {
      const payment = await record();

      await voidPaymentOverHttp(harness, fixture.managerToken, payment.id, {}).expect(400);

      expect((await paymentRow(payment.id))['voided_at']).toBeNull();
    });

    it('refuses a blank or whitespace-only reason', async () => {
      const payment = await record();

      await voidPaymentOverHttp(harness, fixture.managerToken, payment.id, {
        reason: '   ',
      }).expect(400);

      expect((await paymentRow(payment.id))['voided_at']).toBeNull();
    });

    it('refuses a reason longer than the column accepts, before the database sees it', async () => {
      const payment = await record();

      await voidPaymentOverHttp(harness, fixture.managerToken, payment.id, {
        reason: 'ا'.repeat(501),
      }).expect(400);

      expect((await paymentRow(payment.id))['voided_at']).toBeNull();
    });

    it('refuses a caller that tries to state the void’s actor or instant', async () => {
      const payment = await record();

      // `voidPaymentRequestSchema` is strict: those are the server's, and a
      // request that states one has misunderstood what it is asking for.
      await voidPaymentOverHttp(harness, fixture.managerToken, payment.id, {
        reason: 'ثبت اشتباه مبلغ',
        voidedByUserId: fixture.managerId,
      }).expect(400);

      expect((await paymentRow(payment.id))['voided_at']).toBeNull();
    });
  });

  describe('the audit fact', () => {
    it('writes exactly one payment.voided row, in the void’s own transaction', async () => {
      const receivedOn = await clinicDay(harness, -2);
      const payment = await record({ amountToman: '310000', method: 'CARD', receivedOn });

      const voided = await voidPayment(payment.id, 'اصلاح مالی');

      const rows = await voidedPaymentAuditRows(harness, payment.id);
      expect(rows).toHaveLength(1);

      const [audit] = rows;
      expect(audit?.action).toBe('payment.voided');
      expect(audit?.entity_type).toBe('payment');
      expect(audit?.entity_id).toBe(payment.id);
      expect(audit?.actor_user_id).toBe(fixture.managerId);

      // `transaction_timestamp()` on both, so the state change and its record
      // report the same instant rather than quietly disagreeing about atomicity.
      expect(audit?.occurred_at.toISOString()).toBe(voided.voidedAt);

      // The transition, stated from both sides: "it is void" does not record
      // that it was not.
      expect(audit?.before).toEqual({ voidedAt: null });
      expect(audit?.after).toEqual({
        voidedAt: voided.voidedAt,
        voidReason: 'اصلاح مالی',
      });
      expect(audit?.metadata).toEqual({
        familyId: fixture.familyId,
        amountToman: '310000',
        method: 'CARD',
        receivedOn,
        fulfilledPromiseId: null,
      });
    });

    it('keeps the bank reference on the payment and out of the trail', async () => {
      const payment = await record({ method: 'TRANSFER', reference: 'TRX-000123' });

      const voided = await voidPayment(payment.id);

      // It stays where an operator reconciling a transfer looks it up …
      expect(voided.reference).toBe('TRX-000123');
      expect((await paymentRow(payment.id))['reference']).toBe('TRX-000123');

      // … and never reaches `audit_log`, which is append-only and permanent
      // (DECISION_LOG, 2026-08-15). Not the value, and not a key naming it.
      const [audit] = await voidedPaymentAuditRows(harness, payment.id);
      const serialised = JSON.stringify([audit?.before, audit?.after, audit?.metadata]);
      expect(serialised).not.toContain('TRX-000123');
      expect(serialised.toLowerCase()).not.toContain('reference');
    });

    it('names no person and no identifier beyond the family and the promise', async () => {
      const payment = await record();
      await voidPayment(payment.id);

      const [audit] = await voidedPaymentAuditRows(harness, payment.id);
      expect(Object.keys(audit?.metadata as Record<string, unknown>).sort()).toEqual([
        'amountToman',
        'familyId',
        'fulfilledPromiseId',
        'method',
        'receivedOn',
      ]);
      expect(Object.keys(audit?.after as Record<string, unknown>).sort()).toEqual([
        'voidReason',
        'voidedAt',
      ]);
    });

    it('takes the void down with it when the audit write fails', async () => {
      const payment = await record();

      const audit = harness.app.get(AuditService);
      const spy = jest
        .spyOn(audit, 'record')
        .mockRejectedValueOnce(new Error('audit is unavailable'));

      try {
        await voidPaymentOverHttp(harness, fixture.managerToken, payment.id, {
          reason: 'ثبت اشتباه مبلغ',
        }).expect(500);
      } finally {
        spy.mockRestore();
      }

      // A financial reversal nobody can explain is exactly what CLAUDE.md
      // forbids of a correction, and this one could not be reconstructed from
      // the row afterwards. The payment is still live and still voidable.
      expect((await paymentRow(payment.id))['voided_at']).toBeNull();
      expect(await voidedPaymentAuditRows(harness, payment.id)).toHaveLength(0);

      const retried = await voidPayment(payment.id);
      expect(retried.status).toBe('VOIDED');
    });
  });

  describe('a payment that already fulfilled a promise', () => {
    it('is still voidable, and the promise is left exactly as it was', async () => {
      const payment = await record();
      const promiseId = await insertPromise(harness, fixture, { amountToman: '250000' });
      await fulfilPromise(harness, fixture, promiseId, payment.id);

      const beforePromise = await harness.prisma.paymentPromise.findUniqueOrThrow({
        where: { id: promiseId },
      });

      const voided = await voidPayment(payment.id, 'واریز تکراری خانواده');
      expect(voided.status).toBe('VOIDED');

      // The promise stays terminal and untouched: a judgement recorded at the
      // time is not un-made by a later correction, and A4 does not "unfulfil"
      // anything (DECISION_LOG, 2026-08-15).
      const afterPromise = await harness.prisma.paymentPromise.findUniqueOrThrow({
        where: { id: promiseId },
      });
      expect(afterPromise).toEqual(beforePromise);
      expect(afterPromise.status).toBe('FULFILLED');
      expect(afterPromise.fulfillingPaymentId).toBe(payment.id);
    });

    it('names the fulfilled promise in the void audit, so the consequence is traceable', async () => {
      const payment = await record();
      const promiseId = await insertPromise(harness, fixture, { amountToman: '250000' });
      await fulfilPromise(harness, fixture, promiseId, payment.id);

      await voidPayment(payment.id);

      // Nothing else records that this promise's evidence has gone stale — the
      // promise itself is deliberately not mutated — so the void has to say so.
      const [audit] = await voidedPaymentAuditRows(harness, payment.id);
      expect((audit?.metadata as Record<string, unknown>)['fulfilledPromiseId']).toBe(promiseId);
    });

    it('records null when the payment fulfilled nothing', async () => {
      const payment = await record();
      // An OPEN promise this payment did not fulfil must not be named.
      await insertPromise(harness, fixture, { amountToman: '250000' });

      await voidPayment(payment.id);

      const [audit] = await voidedPaymentAuditRows(harness, payment.id);
      expect((audit?.metadata as Record<string, unknown>)['fulfilledPromiseId']).toBeNull();
    });
  });

  describe('what a void does not touch', () => {
    it('mutates no charge, no adjustment and no promise', async () => {
      const payment = await record();
      const promiseId = await insertPromise(harness, fixture, { amountToman: '250000' });

      await voidPayment(payment.id);

      const promises = await harness.prisma.$queryRaw<
        { status: string; fulfilling_payment_id: string | null; resolved_at: Date | null }[]
      >`
        SELECT status::text AS status, fulfilling_payment_id, resolved_at
        FROM payment_promise WHERE id = ${promiseId}::uuid
      `;
      expect(promises[0]).toEqual({
        status: 'OPEN',
        fulfilling_payment_id: null,
        resolved_at: null,
      });

      const totals = await harness.prisma.$queryRaw<{ charges: bigint; adjustments: bigint }[]>`
        SELECT
          (SELECT count(*) FROM session_charge) AS charges,
          (SELECT count(*) FROM charge_adjustment) AS adjustments
      `;
      expect(Number(totals[0]?.charges ?? 0n)).toBe(0);
      expect(Number(totals[0]?.adjustments ?? 0n)).toBe(0);

      // And there is no balance, credit or paid-total row to check: the
      // family's position is derived at read time and stored nowhere. A5 owns
      // what a void changes about it; A4 owns only the ledger fact.
      const other = await harness.prisma.$queryRaw<{ actions: bigint }[]>`
        SELECT count(*) AS actions FROM audit_log WHERE action <> 'payment.voided'
          AND action LIKE 'payment%'
      `;
      expect(Number(other[0]?.actions ?? 0n)).toBe(1); // the `payment.recorded` row
    });
  });

  describe('who may void money', () => {
    it('is classified as requiring exactly payment.void', () => {
      const access = Reflect.getMetadata(
        ENDPOINT_ACCESS_KEY,
        PaymentVoidController.prototype.void,
      ) as { kind: string; permissions: string[] };

      expect(access).toEqual({ kind: 'permissions', permissions: ['payment.void'] });
    });

    it('refuses a receptionist with 403 and writes nothing', async () => {
      const payment = await record();
      const receptionist = await signIn(harness, 'RECEPTIONIST');

      const response = await voidPaymentOverHttp(harness, receptionist.token, payment.id, {
        reason: 'ثبت اشتباه مبلغ',
      });

      // Manager-only, with no same-day window and no expiring authority
      // (DECISION_LOG, 2026-08-15 — Payment void is manager-only).
      expect(response.status).toBe(403);
      expect((await paymentRow(payment.id))['voided_at']).toBeNull();
      expect(await voidedPaymentAuditRows(harness, payment.id)).toHaveLength(0);
    });

    it('refuses a receptionist before revealing whether the payment exists', async () => {
      const receptionist = await signIn(harness, 'RECEPTIONIST');

      const response = await voidPaymentOverHttp(harness, receptionist.token, uuidv7(), {
        reason: 'ثبت اشتباه مبلغ',
      });

      // The guard runs before any payment is read, so a receptionist guessing
      // ids learns nothing: the same 403 for a real payment and an invented one.
      expect(response.status).toBe(403);
    });

    it('refuses a request with no session, and writes nothing', async () => {
      const payment = await record();

      const anonymous = await request(harness.app.getHttpServer())
        .post(`/payments/${payment.id}/void`)
        .set(internalHeaders())
        .send({ reason: 'ثبت اشتباه مبلغ' });

      expect(anonymous.status).toBe(401);
      expect((await paymentRow(payment.id))['voided_at']).toBeNull();
    });

    it('refuses a request that never crossed the internal boundary', async () => {
      const payment = await record();

      const outside = await request(harness.app.getHttpServer())
        .post(`/payments/${payment.id}/void`)
        .send({ reason: 'ثبت اشتباه مبلغ' });

      expect(outside.status).toBe(401);
      expect((await paymentRow(payment.id))['voided_at']).toBeNull();
    });
  });
});
