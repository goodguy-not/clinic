import { PrismaClient } from '@prisma/client';
import { uuidv7 } from '../src/common/uuid';
import { createHarness, resetDatabase, testDatabaseUrl, type Harness } from './harness';
import {
  insertCharge,
  seedChargeableSession,
  voidCharge,
  type LedgerFixture,
} from './ledger-support';

/**
 * What happens when two financial writers arrive at once.
 *
 * The single most important file in this checkpoint, because every rule it
 * exercises is one that a read-then-write in the application would appear to
 * satisfy and would not actually hold. Two adjustments of 200,000 against a
 * charge of 250,000, submitted together, both read a stale total of zero — and
 * without the parent-row lock both would pass, leaving a family owing minus
 * 150,000 toman.
 *
 * The writers here are SEPARATE PRISMA CLIENTS, so each has its own connection
 * and the two really do run concurrently against PostgreSQL. Synchronisation is
 * on an observable database condition, never on a timer, exactly as
 * `catalog-tariffs-concurrency.int-spec.ts` established: a `sleep` long enough
 * to be reliable is slow, and one short enough to be fast passes on a quiet
 * machine and fails in CI.
 *
 * All of this is enforced by the database and none of it by a service, because
 * in checkpoint A1 there is no service. That is the point.
 */
describe('ledger concurrency (real PostgreSQL)', () => {
  let harness: Harness;
  let writerA: PrismaClient;
  let writerB: PrismaClient;

  beforeAll(async () => {
    harness = await createHarness();

    const datasources = { db: { url: testDatabaseUrl() } };
    writerA = new PrismaClient({ datasources });
    writerB = new PrismaClient({ datasources });
    await Promise.all([writerA.$connect(), writerB.$connect()]);
  });

  afterAll(async () => {
    await Promise.all([writerA.$disconnect(), writerB.$disconnect()]);
    await harness.close();
  });

  let fixture: LedgerFixture;

  beforeEach(async () => {
    await resetDatabase();
    fixture = await seedChargeableSession(harness);
  });

  /**
   * Returns once at least `count` backends are waiting on a lock for a query
   * matching `pattern`.
   *
   * A condition, not a duration: it returns the instant the state is reached and
   * fails loudly if it never is.
   */
  async function waitUntilBlocked(pattern: string, count = 1): Promise<void> {
    for (let attempt = 0; attempt < 2000; attempt += 1) {
      const rows = await harness.prisma.$queryRaw<{ blocked: bigint }[]>`
        SELECT count(*) AS blocked
        FROM pg_stat_activity
        WHERE wait_event_type = 'Lock'
          AND state = 'active'
          AND query ILIKE ${pattern}
      `;

      if (Number(rows[0]?.blocked ?? 0) >= count) return;

      await new Promise((resolve) => setImmediate(resolve));
    }

    throw new Error(`No statement ever blocked on a lock matching ${pattern}`);
  }

  /** Inserts an adjustment on a given client, in its own transaction. */
  function adjustOn(client: PrismaClient, chargeId: string, amount: string): Promise<unknown> {
    return client.$executeRaw`
      INSERT INTO charge_adjustment (
        id, session_charge_id, amount_toman,
        therapist_discount_toman, clinic_discount_toman, reason,
        created_at, created_by_user_id
      ) VALUES (
        ${uuidv7()}::uuid,
        ${chargeId}::uuid,
        ${amount}::bigint,
        0::bigint,
        ${amount}::bigint,
        'تخفیف همزمان آزمایشی',
        transaction_timestamp(),
        ${fixture.managerId}::uuid
      )
    `;
  }

  async function activeTotal(chargeId: string): Promise<bigint> {
    const rows = await harness.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT coalesce(sum(amount_toman), 0)::bigint AS total
      FROM charge_adjustment
      WHERE session_charge_id = ${chargeId}::uuid AND voided_at IS NULL
    `;

    return rows[0]?.total ?? 0n;
  }

  describe('two adjustments against one charge', () => {
    it('cannot both pass against a stale sum', async () => {
      const chargeId = await insertCharge(harness, fixture, { amountToman: '250000' });

      // Each alone fits; together they exceed the charge by 150,000. Fired with
      // no coordination at all, on two connections.
      const results = await Promise.allSettled([
        adjustOn(writerA, chargeId, '200000'),
        adjustOn(writerB, chargeId, '200000'),
      ]);

      const accepted = results.filter((result) => result.status === 'fulfilled');
      const refused = results.filter((result) => result.status === 'rejected');

      expect(accepted).toHaveLength(1);
      expect(refused).toHaveLength(1);

      // The invariant, stated as the number it protects: the family's effective
      // amount never went below zero.
      expect(await activeTotal(chargeId)).toBe(200000n);
      expect(await harness.prisma.chargeAdjustment.count()).toBe(1);
    }, 30000);

    it('lets both pass when together they still fit', async () => {
      const chargeId = await insertCharge(harness, fixture, { amountToman: '250000' });

      const results = await Promise.allSettled([
        adjustOn(writerA, chargeId, '100000'),
        adjustOn(writerB, chargeId, '150000'),
      ]);

      // Serialising them must not mean refusing one. The lock orders the two; it
      // does not invent a conflict.
      for (const result of results) expect(result.status).toBe('fulfilled');
      expect(await activeTotal(chargeId)).toBe(250000n);
    }, 30000);

    it('makes the second writer wait for the first to commit, then re-read the total', async () => {
      const chargeId = await insertCharge(harness, fixture, { amountToman: '250000' });

      let second!: Promise<unknown>;

      await writerA.$transaction(async (tx) => {
        // The first adjustment takes the parent row's FOR UPDATE lock inside its
        // BEFORE INSERT trigger and holds it until this transaction commits.
        await tx.$executeRaw`
          INSERT INTO charge_adjustment (
            id, session_charge_id, amount_toman,
            therapist_discount_toman, clinic_discount_toman, reason,
            created_at, created_by_user_id
          ) VALUES (
            ${uuidv7()}::uuid, ${chargeId}::uuid, 200000::bigint, 0::bigint, 200000::bigint,
            'تخفیف اول', transaction_timestamp(), ${fixture.managerId}::uuid
          )
        `;

        second = adjustOn(writerB, chargeId, '100000').catch((error: unknown) => error);

        // Prove it really is waiting on the parent row before committing, so the
        // ordering under test is a fact rather than an assumption.
        await waitUntilBlocked('%charge_adjustment%');
      });

      // The lock is released, the second writer resumes and re-reads a total
      // that now includes 200,000 — so its 100,000 no longer fits.
      const outcome = await second;

      expect(outcome).toBeInstanceOf(Error);
      expect(await activeTotal(chargeId)).toBe(200000n);
    }, 30000);
  });

  describe('an adjustment racing the void of its charge', () => {
    it('never leaves an active adjustment against a voided charge', async () => {
      const chargeId = await insertCharge(harness, fixture, { amountToman: '250000' });

      const results = await Promise.allSettled([
        adjustOn(writerA, chargeId, '50000'),
        writerB.$executeRaw`
          UPDATE session_charge
             SET voided_at = transaction_timestamp(),
                 voided_by_user_id = ${fixture.managerId}::uuid,
                 void_reason = 'ابطال همزمان'
           WHERE id = ${chargeId}::uuid
        `,
      ]);

      // Either order is legitimate; the invariant is what must hold in both. The
      // void always succeeds — it is an UPDATE on a live row — and the
      // adjustment succeeds only if it committed first.
      expect(results[1]?.status).toBe('fulfilled');

      const charge = await harness.prisma.sessionCharge.findUniqueOrThrow({
        where: { id: chargeId },
      });
      expect(charge.voidedAt).not.toBeNull();

      const adjustments = await harness.prisma.chargeAdjustment.count();
      expect(adjustments).toBe(results[0]?.status === 'fulfilled' ? 1 : 0);
    }, 30000);
  });

  describe('two postings for one seat', () => {
    it('lets exactly one succeed', async () => {
      const charge = (client: PrismaClient, amount: string) => client.$executeRaw`
        INSERT INTO session_charge (
          id, family_id, child_id, appointment_id, appointment_participant_id,
          service_id, therapist_id, duration_minutes, service_date,
          tariff_id, price_mode, amount_toman, created_at, created_by_user_id
        ) VALUES (
          ${uuidv7()}::uuid,
          ${fixture.familyId}::uuid, ${fixture.childId}::uuid,
          ${fixture.appointmentId}::uuid, ${fixture.participantId}::uuid,
          ${fixture.serviceId}::uuid, ${fixture.therapistId}::uuid,
          ${fixture.durationMinutes}, ${fixture.serviceDate}::date,
          ${fixture.tariffId}::uuid, 'PAID'::tariff_price_mode, ${amount}::bigint,
          transaction_timestamp(), ${fixture.managerId}::uuid
        )
      `;

      const results = await Promise.allSettled([
        charge(writerA, '250000'),
        charge(writerB, '250000'),
      ]);

      // The partial unique index decides this, not an application pre-check: the
      // second inserter blocks until the first commits, then is refused. This is
      // what makes a repeated completion idempotent rather than double-billed.
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect(await harness.prisma.sessionCharge.count()).toBe(1);
    }, 30000);

    it('lets a re-post succeed once the first charge is voided', async () => {
      const first = await insertCharge(harness, fixture, { amountToman: '250000' });
      await voidCharge(harness, fixture, first);

      await insertCharge(harness, fixture, { amountToman: '300000' });

      expect(await harness.prisma.sessionCharge.count()).toBe(2);
      expect(await harness.prisma.sessionCharge.count({ where: { voidedAt: null } })).toBe(1);
    }, 30000);
  });
});
