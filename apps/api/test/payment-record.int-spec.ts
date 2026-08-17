import request from 'supertest';
import { paymentResponseSchema, type Payment } from '@clinic/contracts';
import { AuditService } from '../src/audit/audit.service';
import { ENDPOINT_ACCESS_KEY } from '../src/auth/decorators/endpoint-access';
import { PaymentsController } from '../src/payments/payments.controller';
import { signIn } from './appointments-support';
import { createHarness, internalHeaders, resetDatabase, type Harness } from './harness';
import {
  clinicDay,
  insertPromise,
  recordPaymentOverHttp,
  seedAnotherFamily,
  seedPayingFamily,
  type PaymentFixture,
} from './payment-support';

/**
 * Recording money that arrived — checkpoint A3.
 *
 * EVERYTHING HERE IS SYNTHETIC. No real family, guardian, amount, bank reference
 * or note appears in any fixture in this project.
 *
 * WHAT THIS SUITE IS ABOUT. A payment is a family fact: it names no charge, no
 * session and no child, it moves no balance — there is no stored balance — and
 * it is born confirmed with an audit row written in the same transaction. Every
 * test below is one of those sentences, and the ones that depend on a database
 * invariant (the clinic's calendar day, the born-active trigger, the shared
 * transaction instant) are asked of real PostgreSQL rather than of a mock.
 */
describe('recording a family payment', () => {
  let harness: Harness;
  let fixture: PaymentFixture;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
    fixture = await seedPayingFamily(harness);
  });

  /**
   * Records a payment and returns it parsed by the FROZEN response schema.
   *
   * 200, which is the approved Milestone 6 decision for this route rather than
   * the 201 a create elsewhere in this application answers with. Every success
   * below goes through here, so the code is asserted on all of them and not only
   * on the one test that says so explicitly.
   */
  async function record(
    body: Record<string, unknown>,
    token = fixture.managerToken,
    familyId = fixture.familyId,
  ): Promise<Payment> {
    const response = await recordPaymentOverHttp(harness, token, familyId, body).expect(200);
    return paymentResponseSchema.parse(response.body).payment;
  }

  async function countPayments(): Promise<number> {
    const rows = await harness.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM payment
    `;
    return Number(rows[0]?.count ?? 0n);
  }

  async function auditRows(): Promise<
    { action: string; entity_type: string; entity_id: string; after: unknown; occurred_at: Date }[]
  > {
    return harness.prisma.$queryRaw`
      SELECT action, entity_type, entity_id, after, occurred_at FROM audit_log
      WHERE action = 'payment.recorded'
      ORDER BY occurred_at ASC
    `;
  }

  describe('the ordinary record', () => {
    it('answers 200 with the frozen { payment } body', async () => {
      const response = await recordPaymentOverHttp(
        harness,
        fixture.managerToken,
        fixture.familyId,
        { amountToman: '250000', method: 'CASH', receivedOn: await clinicDay(harness) },
      );

      // The approved Milestone 6 route decision, asserted directly rather than
      // inferred from a helper: 200, not the 201 a create answers with
      // elsewhere in this application.
      expect(response.status).toBe(200);
      expect(Object.keys(response.body)).toEqual(['payment']);
      expect(() => paymentResponseSchema.parse(response.body)).not.toThrow();
    });

    it('records a manager payment against the family in the path', async () => {
      const today = await clinicDay(harness);

      const payment = await record({ amountToman: '250000', method: 'CASH', receivedOn: today });

      expect(payment.familyId).toBe(fixture.familyId);
      expect(payment.amountToman).toBe('250000');
      expect(payment.method).toBe('CASH');
      expect(payment.receivedOn).toBe(today);
      // The actor and the entry instant are the server's, never the caller's.
      expect(payment.createdByUserId).toBe(fixture.managerId);
      expect(Date.parse(payment.createdAt)).not.toBeNaN();
      // Born confirmed: no status column, no pending state, no void triple.
      expect(payment.status).toBe('CONFIRMED');
      expect(payment.voidedAt).toBeNull();
      expect(payment.voidedByUserId).toBeNull();
      expect(payment.voidReason).toBeNull();
      // Optional, and absent means null rather than an empty string.
      expect(payment.reference).toBeNull();
      expect(payment.note).toBeNull();
    });

    it('lets a receptionist record money, because money arrives at the counter', async () => {
      const receptionist = await signIn(harness, 'RECEPTIONIST');

      const payment = await record(
        { amountToman: '80000', method: 'CARD', receivedOn: await clinicDay(harness) },
        receptionist.token,
      );

      expect(payment.createdByUserId).toBe(receptionist.id);
      expect(payment.status).toBe('CONFIRMED');
    });

    it('is born active in the table, not merely on the wire', async () => {
      const payment = await record({
        amountToman: '250000',
        method: 'TRANSFER',
        receivedOn: await clinicDay(harness),
      });

      const rows = await harness.prisma.$queryRaw<
        { voided_at: Date | null; created_by_user_id: string; created_at: Date }[]
      >`
        SELECT voided_at, created_by_user_id, created_at FROM payment WHERE id = ${payment.id}::uuid
      `;

      expect(rows[0]?.voided_at).toBeNull();
      expect(rows[0]?.created_by_user_id).toBe(fixture.managerId);
      expect(rows[0]?.created_at.toISOString()).toBe(payment.createdAt);
    });

    it('accepts each of the three approved methods and nothing else', async () => {
      const today = await clinicDay(harness);

      for (const method of ['CASH', 'CARD', 'TRANSFER'] as const) {
        const payment = await record({ amountToman: '10000', method, receivedOn: today });
        expect(payment.method).toBe(method);
      }

      // `CHEQUE` and `OTHER` were declined in A0 and are not in the enum; the
      // strict contract refuses them before anything reaches the database.
      for (const method of ['CHEQUE', 'OTHER', 'cash', '']) {
        const refused = await recordPaymentOverHttp(
          harness,
          fixture.managerToken,
          fixture.familyId,
          {
            amountToman: '10000',
            method,
            receivedOn: today,
          },
        ).expect(400);

        expect(refused.body.error.code).toBe('VALIDATION_FAILED');
      }

      expect(await countPayments()).toBe(3);
    });

    it('refuses an amount that is not positive integer toman', async () => {
      const today = await clinicDay(harness);

      for (const amountToman of ['0', '-5000', '1000.5', '', '250000 ', 250000]) {
        await recordPaymentOverHttp(harness, fixture.managerToken, fixture.familyId, {
          amountToman,
          method: 'CASH',
          receivedOn: today,
        }).expect(400);
      }

      expect(await countPayments()).toBe(0);
    });

    it('refuses a body that states what belongs to the server', async () => {
      const today = await clinicDay(harness);

      for (const extra of [
        { familyId: fixture.familyId },
        { status: 'CONFIRMED' },
        { createdAt: new Date().toISOString() },
        { createdByUserId: fixture.managerId },
        { sessionChargeId: fixture.familyId },
      ]) {
        await recordPaymentOverHttp(harness, fixture.managerToken, fixture.familyId, {
          amountToman: '10000',
          method: 'CASH',
          receivedOn: today,
          ...extra,
        }).expect(400);
      }

      expect(await countPayments()).toBe(0);
    });
  });

  describe('the day the money arrived', () => {
    it('accepts a back-dated payment with no age limit', async () => {
      const longAgo = await clinicDay(harness, -400);

      const payment = await record({
        amountToman: '250000',
        method: 'CASH',
        receivedOn: longAgo,
      });

      expect(payment.receivedOn).toBe(longAgo);
      // The back-date is visible AS one: the business day is the past, the entry
      // instant is now.
      expect(Date.parse(payment.createdAt)).toBeGreaterThan(Date.parse(`${longAgo}T00:00:00Z`));
    });

    it('refuses a future clinic date with PAYMENT_DATE_IN_FUTURE and writes nothing', async () => {
      const tomorrow = await clinicDay(harness, 1);

      const refused = await recordPaymentOverHttp(harness, fixture.managerToken, fixture.familyId, {
        amountToman: '250000',
        method: 'CASH',
        receivedOn: tomorrow,
      }).expect(422);

      expect(refused.body.error.code).toBe('PAYMENT_DATE_IN_FUTURE');
      expect(await countPayments()).toBe(0);
      expect(await auditRows()).toHaveLength(0);
    });

    it('records today at the clinic, which is not the caller’s idea of today', async () => {
      // `clinic_date()` is Asia/Tehran and is the only authority here: the same
      // function the trigger compares against, so the application refusal and
      // the database backstop can never disagree about which day it is.
      const today = await clinicDay(harness);

      const payment = await record({ amountToman: '250000', method: 'CASH', receivedOn: today });

      expect(payment.receivedOn).toBe(today);
    });
  });

  describe('the family', () => {
    it('is 404 when the family does not exist, and writes nothing', async () => {
      const refused = await recordPaymentOverHttp(
        harness,
        fixture.managerToken,
        '0199a000-0000-7000-8000-0000000000ff',
        { amountToman: '250000', method: 'CASH', receivedOn: await clinicDay(harness) },
      ).expect(404);

      expect(refused.body.error.code).toBe('FAMILY_NOT_FOUND');
      expect(await countPayments()).toBe(0);
    });

    it('belongs to the family in the path and to no other', async () => {
      const otherFamilyId = await seedAnotherFamily(harness, fixture);

      const payment = await record(
        { amountToman: '250000', method: 'CASH', receivedOn: await clinicDay(harness) },
        fixture.managerToken,
        otherFamilyId,
      );

      expect(payment.familyId).toBe(otherFamilyId);

      const rows = await harness.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count FROM payment WHERE family_id = ${fixture.familyId}::uuid
      `;
      expect(Number(rows[0]?.count ?? 0n)).toBe(0);
    });
  });

  describe('reference and note', () => {
    it('stores the reference on the payment and keeps it out of the audit trail', async () => {
      const reference = 'TRACE-000123';

      const payment = await record({
        amountToman: '250000',
        method: 'TRANSFER',
        receivedOn: await clinicDay(harness),
        reference,
      });

      // On the read, because the operator reconciling a transfer looks it up here.
      expect(payment.reference).toBe(reference);

      const [audit] = await auditRows();
      const after = audit?.after as Record<string, unknown>;

      // `audit_log` is append-only and permanent: only the FACT that a reference
      // exists is recorded there, never the banking identifier itself.
      expect(after['hasReference']).toBe(true);
      expect(JSON.stringify(after)).not.toContain(reference);
      expect(Object.keys(after)).not.toContain('reference');
    });

    it('records hasReference as false when none was given', async () => {
      await record({
        amountToman: '250000',
        method: 'CASH',
        receivedOn: await clinicDay(harness),
      });

      const [audit] = await auditRows();
      expect((audit?.after as Record<string, unknown>)['hasReference']).toBe(false);
    });

    it('stores the note and writes it into audit in full', async () => {
      const note = 'پرداخت بابت جلسات هفتهٔ گذشته';

      const payment = await record({
        amountToman: '250000',
        method: 'CASH',
        receivedOn: await clinicDay(harness),
        note,
      });

      expect(payment.note).toBe(note);

      const [audit] = await auditRows();
      // The note IS the fact being recorded, so masking it would make the trail
      // useless — the existing notes-in-full policy, unchanged for money.
      expect((audit?.after as Record<string, unknown>)['note']).toBe(note);
    });

    it('refuses a reference longer than the column accepts, before the database sees it', async () => {
      await recordPaymentOverHttp(harness, fixture.managerToken, fixture.familyId, {
        amountToman: '250000',
        method: 'TRANSFER',
        receivedOn: await clinicDay(harness),
        reference: 'x'.repeat(41),
      }).expect(400);

      expect(await countPayments()).toBe(0);
    });
  });

  describe('the audit fact', () => {
    it('writes exactly one payment.recorded row, in the payment’s own transaction', async () => {
      const today = await clinicDay(harness);

      const payment = await record({ amountToman: '250000', method: 'CARD', receivedOn: today });

      const rows = await auditRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.action).toBe('payment.recorded');
      expect(rows[0]?.entity_type).toBe('payment');
      expect(rows[0]?.entity_id).toBe(payment.id);

      // `transaction_timestamp()` on both, so the state change and its record
      // report the same instant. Different instants would be a trail quietly
      // disagreeing with itself about atomicity.
      expect(rows[0]?.occurred_at.toISOString()).toBe(payment.createdAt);

      expect(rows[0]?.after).toEqual({
        familyId: fixture.familyId,
        amountToman: '250000',
        method: 'CARD',
        receivedOn: today,
        hasReference: false,
        note: null,
      });
    });

    it('names no person and no identifier beyond the family', async () => {
      await record({
        amountToman: '250000',
        method: 'CASH',
        receivedOn: await clinicDay(harness),
        note: 'یادداشت آزمایشی',
      });

      const [audit] = await auditRows();
      expect(Object.keys(audit?.after as Record<string, unknown>).sort()).toEqual([
        'amountToman',
        'familyId',
        'hasReference',
        'method',
        'note',
        'receivedOn',
      ]);
    });

    it('takes the payment down with it when the audit write fails', async () => {
      const audit = harness.app.get(AuditService);
      const spy = jest
        .spyOn(audit, 'record')
        .mockRejectedValueOnce(new Error('audit is unavailable'));

      try {
        await recordPaymentOverHttp(harness, fixture.managerToken, fixture.familyId, {
          amountToman: '250000',
          method: 'CASH',
          receivedOn: await clinicDay(harness),
        }).expect(500);
      } finally {
        spy.mockRestore();
      }

      // An unaudited payment is worse than a refused one: the operator can
      // re-enter the money, and nobody can reconstruct a financial act that was
      // never recorded.
      expect(await countPayments()).toBe(0);
    });
  });

  describe('what a payment does not touch', () => {
    it('modifies no charge, no adjustment and no promise', async () => {
      const promiseId = await insertPromise(harness, fixture, { amountToman: '250000' });

      await record({
        amountToman: '250000',
        method: 'CASH',
        receivedOn: await clinicDay(harness),
      });

      // A payment is a family fact and allocates nothing: the promise it might
      // look like it settles stays OPEN until somebody says otherwise (A6).
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

      // And there is no balance or credit row to check, deliberately: the
      // family's position is derived from rows at read time and stored nowhere.
      expect(await countPayments()).toBe(1);
    });
  });

  describe('who may record money', () => {
    it('is classified as requiring exactly payment.create', () => {
      // The coverage test in `guards.int-spec` proves every route is classified;
      // this proves THIS route is classified as the frozen A2 vocabulary says,
      // so a rename or a widened list fails here rather than in review. Both
      // roles hold `payment.create` today, which is why the two refusals below
      // are the reachable ones.
      const access = Reflect.getMetadata(
        ENDPOINT_ACCESS_KEY,
        PaymentsController.prototype.record,
      ) as { kind: string; permissions: string[] };

      expect(access).toEqual({ kind: 'permissions', permissions: ['payment.create'] });
    });

    it('refuses a request with no session, and writes nothing', async () => {
      const anonymous = await request(harness.app.getHttpServer())
        .post(`/families/${fixture.familyId}/payments`)
        .set(internalHeaders())
        .send({ amountToman: '250000', method: 'CASH', receivedOn: await clinicDay(harness) });

      expect(anonymous.status).toBe(401);
      expect(await countPayments()).toBe(0);
    });

    it('refuses a request that never crossed the internal boundary', async () => {
      const outside = await request(harness.app.getHttpServer())
        .post(`/families/${fixture.familyId}/payments`)
        .send({ amountToman: '250000', method: 'CASH', receivedOn: await clinicDay(harness) });

      expect(outside.status).toBe(401);
      expect(await countPayments()).toBe(0);
    });
  });
});
