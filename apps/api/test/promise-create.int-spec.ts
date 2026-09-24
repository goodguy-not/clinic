import { promiseResponseSchema, type PaymentPromise } from '@clinic/contracts';
import { signIn } from './appointments-support';
import { uuidv7 } from '../src/common/uuid';
import { createHarness, resetDatabase, type Harness } from './harness';
import {
  clinicDay,
  createPromiseOverHttp,
  promiseAuditRows,
  seedPayingFamily,
  type PaymentFixture,
} from './payment-support';

/**
 * Recording that a family said it would pay — checkpoint A6.
 *
 * EVERYTHING HERE IS SYNTHETIC. No real family, guardian, amount or note appears
 * in any fixture in this project.
 *
 * THE CLAIM UNDER TEST is that a promise is created as an INTENTION and as
 * nothing else: three fields from the caller, the family from the path, the
 * actor, the instant and the `OPEN` state from the server, and no effect
 * whatsoever on any money. The financial non-effect is proved against the A5
 * position in `promise-resolve.int-spec.ts`, where every state a promise can
 * reach is put on one family; what this file proves is the act itself.
 *
 * THE DUE DATE RULE THIS ROUTE HAS IS THAT IT HAS NONE. A promise MAY be born
 * late (DECISION_LOG, 2026-08-15) and reads immediately as derived `MISSED`,
 * with no age bound at all — which is the opposite of the rescheduled successor,
 * tested next door.
 */
describe('promise creation (real PostgreSQL)', () => {
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

  /**
   * Creates a promise and parses it against the FINAL frozen contract, which is
   * half of every assertion here: `promiseSchema` refuses a response whose status
   * and resolution disagree, or that claims a fulfilment with no payment.
   */
  async function create(
    body: Record<string, unknown>,
    token = fixture.managerToken,
  ): Promise<PaymentPromise> {
    const response = await createPromiseOverHttp(harness, token, fixture.familyId, body).expect(
      200,
    );

    return promiseResponseSchema.parse(response.body).promise;
  }

  describe('who may record one', () => {
    it('lets a manager record a promise', async () => {
      const promise = await create({ amountToman: '400000', dueOn: await clinicDay(harness, 7) });

      expect(promise.familyId).toBe(fixture.familyId);
      expect(promise.amountToman).toBe('400000');
      expect(promise.status).toBe('OPEN');
      expect(promise.createdByUserId).toBe(fixture.managerId);
    });

    /**
     * A promise moves no money in any state (CLAUDE.md), so there is no financial
     * authority here for the manager to keep: agreeing a payment date with a
     * family at the counter is exactly the receptionist's work.
     */
    it('lets a receptionist record one too, and records them as the actor', async () => {
      const receptionist = await signIn(harness, 'RECEPTIONIST');

      const promise = await create(
        { amountToman: '150000', dueOn: await clinicDay(harness, 3) },
        receptionist.token,
      );

      expect(promise.status).toBe('OPEN');
      expect(promise.createdByUserId).toBe(receptionist.id);
      expect(promise.createdByUserId).not.toBe(fixture.managerId);
    });
  });

  describe('the promise it produces', () => {
    it('is OPEN, unresolved, unlinked, and dated by the caller', async () => {
      const dueOn = await clinicDay(harness, 10);
      const promise = await create({ amountToman: '999000', dueOn, note: 'قول شفاهی مادر' });

      expect(promise.dueOn).toBe(dueOn);
      expect(promise.note).toBe('قول شفاهی مادر');
      expect(promise.status).toBe('OPEN');

      // Nothing has ended it, and it points at nothing.
      expect(promise.resolvedAt).toBeNull();
      expect(promise.resolvedByUserId).toBeNull();
      expect(promise.resolutionReason).toBeNull();
      expect(promise.fulfillingPayment).toBeNull();
      expect(promise.rescheduledToPromiseId).toBeNull();
      expect(promise.rescheduledFromPromiseId).toBeNull();
    });

    it('trims the note and keeps an absent one absent', async () => {
      const dueOn = await clinicDay(harness, 1);

      const padded = await create({ amountToman: '100000', dueOn, note: '  یادداشت  ' });
      expect(padded.note).toBe('یادداشت');

      const bare = await create({ amountToman: '100000', dueOn });
      expect(bare.note).toBeNull();
    });

    it('takes the creation instant from the server, not from the caller', async () => {
      const before = Date.now();
      const promise = await create({ amountToman: '100000', dueOn: await clinicDay(harness) });
      const after = Date.now();

      const createdAt = Date.parse(promise.createdAt);
      expect(createdAt).toBeGreaterThanOrEqual(before - 1000);
      expect(createdAt).toBeLessThanOrEqual(after + 1000);
    });
  });

  /**
   * A promise agreed last week and entered today is a real fact, and refusing it
   * would push the clinic to enter a false date (DECISION_LOG, 2026-08-15 — A
   * promise may be born late).
   */
  describe('a promise born late', () => {
    it('accepts a past due date and reads it back as derived MISSED', async () => {
      const promise = await create({
        amountToman: '250000',
        dueOn: await clinicDay(harness, -1),
      });

      expect(promise.status).toBe('MISSED');

      // MISSED is derived and is stored nowhere: PostgreSQL has four values and
      // the wire has five.
      const stored = await harness.prisma.paymentPromise.findUniqueOrThrow({
        where: { id: promise.id },
      });
      expect(stored.status).toBe('OPEN');

      // And it is not resolved. `MISSED` is a reading of the clock, not an ending.
      expect(promise.resolvedAt).toBeNull();
      expect(promise.resolutionReason).toBeNull();
    });

    it('applies no age bound at all', async () => {
      const ancient = await create({
        amountToman: '250000',
        dueOn: await clinicDay(harness, -400),
      });

      expect(ancient.status).toBe('MISSED');
    });

    it('reads a promise due TODAY as OPEN, not as missed', async () => {
      const today = await create({ amountToman: '250000', dueOn: await clinicDay(harness) });

      expect(today.status).toBe('OPEN');
    });
  });

  describe('what the trail records', () => {
    it('writes exactly one payment_promise.created row, with the note in full', async () => {
      const dueOn = await clinicDay(harness, 5);
      const promise = await create({
        amountToman: '750000',
        dueOn,
        note: 'پرداخت پس از حقوق',
      });

      const rows = await promiseAuditRows(harness, promise.id);
      expect(rows).toHaveLength(1);

      const [row] = rows;
      expect(row?.action).toBe('payment_promise.created');
      expect(row?.entity_type).toBe('payment_promise');
      expect(row?.actor_user_id).toBe(fixture.managerId);

      // The note IS the fact being recorded, so it is written in full
      // (DECISION_LOG, 2026-08-15).
      expect(row?.after).toEqual({
        familyId: fixture.familyId,
        amountToman: '750000',
        dueOn,
        note: 'پرداخت پس از حقوق',
      });

      // No balance, no credit, no amount due: those are derived from rows at read
      // time and a copy frozen into an append-only table could never be corrected.
      const after = row?.after as Record<string, unknown>;
      expect(Object.keys(after).sort()).toEqual(['amountToman', 'dueOn', 'familyId', 'note']);
    });

    it('carries the promise itself and no payment reference of any kind', async () => {
      const promise = await create({ amountToman: '250000', dueOn: await clinicDay(harness) });

      const [row] = await promiseAuditRows(harness, promise.id);
      expect(row?.entity_id).toBe(promise.id);
      expect(JSON.stringify(row?.after)).not.toContain('reference');
    });
  });

  describe('what it refuses', () => {
    it('refuses an unknown family with 404 and writes nothing', async () => {
      const response = await createPromiseOverHttp(harness, fixture.managerToken, uuidv7(), {
        amountToman: '250000',
        dueOn: await clinicDay(harness),
      });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('FAMILY_NOT_FOUND');

      const count = await harness.prisma.paymentPromise.count();
      expect(count).toBe(0);
    });

    it('refuses a zero, negative or oversized amount at the schema', async () => {
      const dueOn = await clinicDay(harness);

      for (const amountToman of ['0', '-1', '1000000001']) {
        const response = await createPromiseOverHttp(
          harness,
          fixture.managerToken,
          fixture.familyId,
          {
            amountToman,
            dueOn,
          },
        );

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      }
    });

    /**
     * `createPromiseRequestSchema` is strict: a status is never submitted, it is
     * the result of an act, and the payment that settles a promise is named later
     * through the fulfil route.
     */
    it('refuses fields the server owns rather than dropping them', async () => {
      const dueOn = await clinicDay(harness);

      for (const extra of [
        { status: 'FULFILLED' },
        { familyId: fixture.familyId },
        { paymentId: uuidv7() },
        { createdByUserId: fixture.managerId },
        { createdAt: new Date().toISOString() },
      ]) {
        const response = await createPromiseOverHttp(
          harness,
          fixture.managerToken,
          fixture.familyId,
          {
            amountToman: '250000',
            dueOn,
            ...extra,
          },
        );

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      }
    });

    /**
     * `isoDateSchema` bounds the SHAPE and the calendar, not the distance from
     * today: a Gregorian day that does not exist is refused, while a day far in
     * the past is a legitimate promise and is not this schema's business.
     */
    it('refuses a due date that is not a real calendar day', async () => {
      for (const dueOn of ['2026-02-30', '2026-13-01', '26-01-01', 'tomorrow']) {
        const response = await createPromiseOverHttp(
          harness,
          fixture.managerToken,
          fixture.familyId,
          { amountToman: '250000', dueOn },
        );

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      }
    });
  });
});
