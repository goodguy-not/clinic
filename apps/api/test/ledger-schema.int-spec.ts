import { uuidv7 } from '../src/common/uuid';
import { createHarness, resetDatabase, type Harness } from './harness';
import {
  insertAdjustment,
  insertCharge,
  seedChargeableSession,
  sqlStateOf,
  voidCharge,
  type LedgerFixture,
} from './ledger-support';

/**
 * Pins the hand-written half of the Milestone 5 migration, and proves it.
 *
 * `prisma migrate diff` compares the datamodel with the database and sees
 * tables, columns, ordinary indexes and foreign keys. It does not see CHECK
 * constraints, PARTIAL indexes or triggers — so the objects that make this a
 * ledger rather than a set of rows are exactly the ones drift detection would
 * let disappear silently. This asserts each one exists by name AND that it
 * refuses what it exists to refuse.
 *
 * Every rejection is attempted with RAW SQL, deliberately. There is no ledger
 * service in this checkpoint, so a test going through one would prove nothing;
 * and the claim being made is that these rules hold against a repair script and
 * a psql session too, not only against the code that has not been written yet.
 *
 * It also pins the checkpoint's SCOPE: two tables, nothing that is a payment,
 * and no financial column on any Milestone 4 table.
 */
describe('ledger schema objects', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  const M5_TABLES = ['session_charge', 'charge_adjustment'];

  describe('the catalogue', () => {
    it('creates exactly the two approved tables', async () => {
      const rows = await harness.prisma.$queryRaw<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('session_charge', 'charge_adjustment')
      `;

      expect(rows.map((row) => row.table_name).sort()).toEqual([...M5_TABLES].sort());
    });

    it('creates no credit, balance, allocation, invoice or settlement table', async () => {
      // NARROWED THREE TIMES, EACH TIME BY THE CHECKPOINT THAT APPROVED THE
      // TABLE. Milestone 6 permitted `payment` and `payment_promise`; Milestone
      // 8 checkpoint C3 permitted `session_settlement`, which is what a
      // THERAPIST earned from a session rather than anything about a family's
      // money; and checkpoint C6 permits `settlement_period` and
      // `settlement_line`, the closed period and the immutable facts it
      // materialised. Every other financial concept this pattern names is still
      // unapproved, and a table matching one would be state stored before its
      // rules were agreed: there is still no credit, balance, invoice or
      // allocation table anywhere, and nothing that records a therapist payout.
      // `payment_allocation` in particular was refused BY NAME (DECISION_LOG,
      // 2026-08-15 — A payment is a family fact), so it stays caught by the
      // `allocation` alternative even though its name begins with two permitted
      // words.
      const rows = await harness.prisma.$queryRaw<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name ~ '(payment|credit|promise|balance|settlement|invoice|allocation)'
          AND table_name NOT IN (
            'payment', 'payment_promise', 'session_settlement',
            'settlement_period', 'settlement_line'
          )
      `;

      expect(rows).toEqual([]);
    });

    it('adds no financial column to the appointment tables', async () => {
      // The Milestone 4 boundary, restated from the other side of it. The charge
      // row is the financial snapshot; the booking stays a booking.
      const rows = await harness.prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('appointment', 'appointment_participant', 'appointment_series')
          AND (column_name ~ '(tariff|price|amount|toman|charge|discount|fee)')
      `;

      expect(rows).toEqual([]);
    });

    it('carries no share, percentage or settlement column on either ledger table', async () => {
      const rows = await harness.prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('session_charge', 'charge_adjustment')
          AND (column_name ~ '(share|percent|settlement|payment|credit|balance)')
      `;

      expect(rows).toEqual([]);
    });

    it('stores every amount as BIGINT integer toman, and nothing as a decimal', async () => {
      const rows = await harness.prisma.$queryRaw<{ column_name: string; data_type: string }[]>`
        SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('session_charge', 'charge_adjustment')
          AND column_name LIKE '%toman%'
        ORDER BY column_name
      `;

      expect(rows.map((row) => row.column_name)).toEqual([
        'amount_toman',
        'amount_toman',
        'clinic_discount_toman',
        'therapist_discount_toman',
      ]);

      for (const row of rows) expect(row.data_type).toBe('bigint');
    });

    it('holds every hand-written CHECK constraint', async () => {
      const rows = await harness.prisma.$queryRaw<{ conname: string }[]>`
        SELECT conname FROM pg_constraint
        WHERE contype = 'c'
          AND conrelid::regclass::text IN ('session_charge', 'charge_adjustment')
      `;

      expect(rows.map((row) => row.conname).sort()).toEqual(
        [
          'session_charge_amount_bounds_chk',
          'session_charge_price_mode_chk',
          'session_charge_duration_chk',
          'session_charge_void_consistency_chk',
          'charge_adjustment_amount_bounds_chk',
          // `charge_adjustment_clinic_borne_chk` IS DELIBERATELY ABSENT. It
          // pinned `therapist_discount_toman = 0` because Milestone 5 had no
          // approved basis on which a therapist could bear part of a concession;
          // Milestone 8 checkpoint C4 supplied that basis — the applied share
          // snapshot — and dropped the CHECK. What replaced it is a rule about a
          // SUM and therefore cannot be a CHECK at all: it lives in
          // `enforce_charge_adjustment_bounds`, beside the family-side floor,
          // and is exercised below.
          'charge_adjustment_split_identity_chk',
          'charge_adjustment_reason_chk',
          'charge_adjustment_void_consistency_chk',
        ].sort(),
      );
    });

    it('holds the exactly-once partial unique index, keyed on the seat', async () => {
      // Partial, which is precisely what Prisma cannot express and what
      // `migrate diff` cannot see.
      const rows = await harness.prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
        SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'session_charge'
          AND indexdef LIKE '%WHERE%'
      `;

      const byName = new Map(rows.map((row) => [row.indexname, row.indexdef]));
      const definition = byName.get('session_charge_one_valid_per_participant_uq');

      expect(definition).toMatch(/UNIQUE/);
      expect(definition).toMatch(/appointment_participant_id/);
      // Partial on the void, which is what leaves void-then-re-post possible
      // while both rows survive in the table.
      expect(definition).toMatch(/WHERE \(voided_at IS NULL\)/);

      // And it is the only partial index here: a second would be a second rule
      // nobody named.
      expect([...byName.keys()]).toEqual(['session_charge_one_valid_per_participant_uq']);
    });

    it('holds the two composite foreign keys that prove attribution', async () => {
      const rows = await harness.prisma.$queryRaw<{ conname: string; definition: string }[]>`
        SELECT conname, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE contype = 'f' AND conrelid::regclass::text = 'session_charge'
      `;

      const byName = new Map(rows.map((row) => [row.conname, row.definition]));

      expect(byName.get('session_charge_child_id_family_id_fkey')).toMatch(
        /FOREIGN KEY \(child_id, family_id\) REFERENCES child\(id, family_id\)/,
      );
      // Also what keeps `appointment_id` traceable: the seat carries its own key
      // to `appointment`, so a charge can never name a booking that does not
      // exist, and no second single-column key is needed to say it.
      expect(byName.get('session_charge_appointment_participant_id_appointment_id_fkey')).toMatch(
        /FOREIGN KEY \(appointment_participant_id, appointment_id\) REFERENCES appointment_participant\(id, appointment_id\)/,
      );

      expect(byName.get('session_charge_tariff_id_fkey')).toMatch(/REFERENCES tariff\(id\)/);

      // Every one of them refuses a delete. Financial rows are voided, never
      // removed, and neither is anything they name.
      for (const definition of byName.values()) expect(definition).toContain('ON DELETE RESTRICT');
    });

    it('keys the snapshot to the catalog, never to the appointment’s placement', async () => {
      const rows = await harness.prisma.$queryRaw<{ conname: string; definition: string }[]>`
        SELECT conname, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE contype = 'f' AND conrelid::regclass::text = 'session_charge'
      `;

      const byName = new Map(rows.map((row) => [row.conname, row.definition]));

      // The same three keys `tariff` carries, for the same reason: the
      // snapshot must name real catalog records and a length the service
      // actually offers.
      expect(byName.get('session_charge_service_id_fkey')).toMatch(/REFERENCES service\(id\)/);
      expect(byName.get('session_charge_therapist_id_fkey')).toMatch(/REFERENCES therapist\(id\)/);
      expect(byName.get('session_charge_service_id_duration_minutes_fkey')).toMatch(
        /FOREIGN KEY \(service_id, duration_minutes\) REFERENCES service_duration\(service_id, duration_minutes\)/,
      );

      // AND NOTHING KEYED TO THE PLACEMENT. A key from the charge's snapshot
      // columns into `appointment` would let a voided historical charge pin its
      // booking to a therapist and a length it has since legitimately moved
      // away from. The lifecycle proof lives in `ledger-lifecycle.int-spec.ts`;
      // this is the structural half of the same statement.
      const intoAppointment = [...byName.values()].filter((definition) =>
        /REFERENCES appointment\(/.test(definition),
      );
      expect(intoAppointment).toEqual([]);

      // And no relation anywhere on this table restricts an update, which is
      // what such a key would have needed to be.
      for (const definition of byName.values()) {
        expect(definition).not.toContain('ON UPDATE RESTRICT');
      }
    });

    it('leaves no unique index on the appointment’s placement columns', async () => {
      // Removed with the key it existed for. It served no product or
      // data-integrity purpose of its own — `id` is already the primary key —
      // so keeping it would be an index maintained on every booking write for
      // nothing.
      const rows = await harness.prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'appointment'
          AND indexdef LIKE '%UNIQUE%'
      `;

      expect(rows.map((row) => row.indexname)).toEqual(['appointment_pkey']);
    });

    it('holds the four support functions, each in the public schema', async () => {
      const rows = await harness.prisma.$queryRaw<{ proname: string }[]>`
        SELECT p.proname
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('enforce_financial_row_born_active',
                            'enforce_charge_adjustment_bounds',
                            'enforce_session_charge_immutability',
                            'enforce_charge_adjustment_immutability')
      `;

      expect(rows.map((row) => row.proname).sort()).toEqual([
        'enforce_charge_adjustment_bounds',
        'enforce_charge_adjustment_immutability',
        'enforce_financial_row_born_active',
        'enforce_session_charge_immutability',
      ]);
    });

    it('protects both tables with exactly the nine approved triggers', async () => {
      const rows = await harness.prisma.$queryRaw<{ tgname: string }[]>`
        SELECT tgname FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgrelid::regclass::text IN ('session_charge', 'charge_adjustment')
      `;

      expect(rows.map((row) => row.tgname).sort()).toEqual(
        [
          'charge_adjustment_enforce_born_active',
          'charge_adjustment_enforce_bounds',
          'charge_adjustment_enforce_immutability',
          'charge_adjustment_no_delete',
          'charge_adjustment_no_truncate',
          'session_charge_enforce_born_active',
          'session_charge_enforce_immutability',
          'session_charge_no_delete',
          'session_charge_no_truncate',
        ].sort(),
      );
    });

    it('adds two foreign-key targets and asserts no new uniqueness with them', async () => {
      // Each is unique on a superset of a primary key that is unique already, so
      // neither constrains anything the tables did not already guarantee. They
      // exist so the two composite keys above have something to reference, and
      // no supporting index exists that no key still uses.
      const rows = await harness.prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN ('child_id_family_id_key',
                            'appointment_participant_id_appointment_id_key',
                            'appointment_id_service_id_duration_minutes_therapist_id_key')
      `;

      expect(rows.map((row) => row.indexname).sort()).toEqual([
        'appointment_participant_id_appointment_id_key',
        'child_id_family_id_key',
      ]);
    });
  });

  describe('what the database refuses', () => {
    let fixture: LedgerFixture;

    beforeEach(async () => {
      await resetDatabase(harness.prisma);
      fixture = await seedChargeableSession(harness);
    });

    describe('exactly one valid charge per seat', () => {
      it('accepts the first charge for a seat', async () => {
        await insertCharge(harness, fixture);

        expect(await harness.prisma.sessionCharge.count()).toBe(1);
      });

      it('refuses a second valid charge for the same seat', async () => {
        await insertCharge(harness, fixture);

        // 23505, unique_violation, raised by
        // `session_charge_one_valid_per_participant_uq`. This is the whole
        // idempotency guarantee: a repeated completion cannot produce a second
        // live charge, whatever the caller checked first.
        expect(await sqlStateOf(insertCharge(harness, fixture))).toBe('23505');
        expect(await harness.prisma.sessionCharge.count()).toBe(1);
      });

      it('permits a re-post once the first charge is voided, and keeps both rows', async () => {
        const first = await insertCharge(harness, fixture, { amountToman: '250000' });
        await voidCharge(harness, fixture, first);

        const second = await insertCharge(harness, fixture, { amountToman: '300000' });

        expect(second).not.toBe(first);

        // BOTH SURVIVE. The correction is a new row, and the withdrawn one stays
        // readable exactly as it was raised.
        const rows = await harness.prisma.sessionCharge.findMany({
          where: { appointmentParticipantId: fixture.participantId },
          orderBy: { createdAt: 'asc' },
        });

        expect(rows).toHaveLength(2);
        expect(rows[0]?.voidedAt).not.toBeNull();
        expect(rows[0]?.amountToman).toBe(250000n);
        expect(rows[1]?.voidedAt).toBeNull();
        expect(rows[1]?.amountToman).toBe(300000n);
      });

      it('refuses a charge that is born voided', async () => {
        // The hole this closes: voided rows are not in the partial index, so a
        // born-voided charge would let one seat accumulate any number of them
        // and the exactly-once guarantee would quietly stop being one.
        expect(await sqlStateOf(insertCharge(harness, fixture, { voided: true }))).toBe('23001');
        expect(await harness.prisma.sessionCharge.count()).toBe(0);
      });
    });

    describe('attribution', () => {
      it('refuses a charge naming a child who belongs to another family', async () => {
        const other = await seedChargeableSession(harness);

        // 23503, foreign_key_violation, from
        // `session_charge_child_id_family_id_fkey`. The pair does not exist, so
        // there is no way to bill one family for another family's child.
        expect(await sqlStateOf(insertCharge(harness, fixture, { childId: other.childId }))).toBe(
          '23503',
        );
      });

      it('refuses a charge naming a participant from another appointment', async () => {
        const other = await seedChargeableSession(harness);

        expect(
          await sqlStateOf(insertCharge(harness, fixture, { participantId: other.participantId })),
        ).toBe('23503');
      });

      it('refuses a snapshot naming a service or therapist that does not exist', async () => {
        const missing = uuidv7();

        expect(await sqlStateOf(insertCharge(harness, fixture, { serviceId: missing }))).toBe(
          '23503',
        );
        expect(await sqlStateOf(insertCharge(harness, fixture, { therapistId: missing }))).toBe(
          '23503',
        );
      });

      it('refuses a session length the charged service never offered', async () => {
        // The same guarantee `tariff_service_id_duration_minutes_fkey` gives a
        // price, from `(service_id, duration_minutes) -> service_duration`. The
        // fixture's service offers 45 and 60 minutes; 30 was never one of them.
        expect(await sqlStateOf(insertCharge(harness, fixture, { durationMinutes: 30 }))).toBe(
          '23503',
        );

        // 60 is offered, so the database accepts it. Whether it matches the
        // booking is the posting service's question (checkpoint A3), NOT a
        // database key — see the lifecycle suite for why coupling the two would
        // pin a live appointment to a voided charge's placement.
        await insertCharge(harness, fixture, { durationMinutes: 60 });
        expect(await harness.prisma.sessionCharge.count()).toBe(1);
      });
    });

    describe('money and mode', () => {
      it('refuses a negative amount and one past the fat-finger ceiling', async () => {
        expect(await sqlStateOf(insertCharge(harness, fixture, { amountToman: '-1' }))).toBe(
          '23514',
        );
        expect(
          await sqlStateOf(insertCharge(harness, fixture, { amountToman: '1000000001' })),
        ).toBe('23514');
      });

      it('keeps FREE and PAID structurally distinct', async () => {
        // A FREE charge is a genuinely complimentary session and is zero; a PAID
        // one came from a real price and is positive. Neither shape is reachable
        // from the other by accident, which is what stops a discounted session
        // being recorded as a free one.
        expect(
          await sqlStateOf(
            insertCharge(harness, fixture, { priceMode: 'FREE', amountToman: '250000' }),
          ),
        ).toBe('23514');

        expect(
          await sqlStateOf(insertCharge(harness, fixture, { priceMode: 'PAID', amountToman: '0' })),
        ).toBe('23514');
      });

      it('accepts a FREE charge of zero, and then refuses to adjust it', async () => {
        const free = await insertCharge(harness, fixture, {
          priceMode: 'FREE',
          amountToman: '0',
        });

        // There is no concession to record on a session that was never priced,
        // and the floor says so without a rule of its own.
        expect(
          await sqlStateOf(insertAdjustment(harness, fixture, free, { amountToman: '1' })),
        ).toBe('23514');
      });
    });

    /**
     * WHAT MAY BEAR A CONCESSION, ASKED OF THE DATABASE DIRECTLY.
     *
     * The charges in this suite are inserted by raw SQL and are therefore
     * UNRATED — no `session_settlement` row exists for any of them. That is the
     * state every therapist-borne refusal below turns on, and it is the right
     * fixture for this file: the question here is what PostgreSQL refuses to a
     * writer that never went near the service.
     *
     * Milestone 5 refused a therapist portion by CHECK, unconditionally.
     * Checkpoint C4 dropped that CHECK, and the same two statements are still
     * refused — now because the session carries no applied share to bear them
     * against, which is a rule about other rows and lives in
     * `enforce_charge_adjustment_bounds`. The rated case, where a portion is
     * genuinely accepted and genuinely bounded, is proved over the real
     * endpoints in `settlement-concession-split.int-spec.ts`.
     */
    describe('who may bear a concession', () => {
      let chargeId: string;

      beforeEach(async () => {
        chargeId = await insertCharge(harness, fixture, { amountToman: '250000' });
      });

      it('accepts a wholly clinic-borne discount', async () => {
        await insertAdjustment(harness, fixture, chargeId, {
          amountToman: '50000',
          therapistDiscountToman: '0',
          clinicDiscountToman: '50000',
        });

        expect(await harness.prisma.chargeAdjustment.count()).toBe(1);
      });

      it('refuses a non-zero therapist discount on an unrated session', async () => {
        // A portion apportioned to a share nobody ever applied is an unfunded
        // liability recorded as a fact. Refused outright rather than written and
        // sorted out at settlement, which is where a therapist would otherwise
        // discover a deduction they cannot trace.
        expect(
          await sqlStateOf(
            insertAdjustment(harness, fixture, chargeId, {
              amountToman: '50000',
              therapistDiscountToman: '20000',
              clinicDiscountToman: '30000',
            }),
          ),
        ).toBe('23514');
      });

      it('refuses a wholly therapist-borne discount on an unrated session', async () => {
        expect(
          await sqlStateOf(
            insertAdjustment(harness, fixture, chargeId, {
              amountToman: '50000',
              therapistDiscountToman: '50000',
              clinicDiscountToman: '0',
            }),
          ),
        ).toBe('23514');
      });

      it('names the rule that refused it, so two 23514s stay two answers', async () => {
        // The family-side ceiling and the therapist-side refusals share their
        // SQLSTATE. The service maps them onto `ADJUSTMENT_EXCEEDS_CHARGE` and
        // `ADJUSTMENT_SPLIT_INVALID` by matching the name the trigger raises
        // with, so the name reaching the driver is load-bearing rather than
        // decorative.
        const refusal = await insertAdjustment(harness, fixture, chargeId, {
          amountToman: '50000',
          therapistDiscountToman: '20000',
          clinicDiscountToman: '30000',
        }).catch((error: unknown) => error);

        expect(String(refusal)).toContain('charge_adjustment_therapist_share_required');
      });

      it('refuses an incoherent split even when the therapist bears nothing', async () => {
        // therapist + clinic must equal the total. A clinic share that silently
        // covers less than the family was relieved of is money nobody accounts
        // for.
        expect(
          await sqlStateOf(
            insertAdjustment(harness, fixture, chargeId, {
              amountToman: '50000',
              therapistDiscountToman: '0',
              clinicDiscountToman: '30000',
            }),
          ),
        ).toBe('23514');

        expect(
          await sqlStateOf(
            insertAdjustment(harness, fixture, chargeId, {
              amountToman: '50000',
              therapistDiscountToman: '0',
              clinicDiscountToman: '70000',
            }),
          ),
        ).toBe('23514');
      });

      it('refuses a zero or negative adjustment, and one without a reason', async () => {
        expect(
          await sqlStateOf(
            insertAdjustment(harness, fixture, chargeId, {
              amountToman: '0',
              clinicDiscountToman: '0',
            }),
          ),
        ).toBe('23514');

        expect(
          await sqlStateOf(
            insertAdjustment(harness, fixture, chargeId, {
              amountToman: '-50000',
              clinicDiscountToman: '-50000',
            }),
          ),
        ).toBe('23514');

        expect(
          await sqlStateOf(insertAdjustment(harness, fixture, chargeId, { reason: '   ' })),
        ).toBe('23514');
      });

      it('refuses an adjustment that is born voided', async () => {
        expect(
          await sqlStateOf(insertAdjustment(harness, fixture, chargeId, { voided: true })),
        ).toBe('23001');
      });
    });

    describe('the effective-charge floor', () => {
      let chargeId: string;

      beforeEach(async () => {
        chargeId = await insertCharge(harness, fixture, { amountToman: '250000' });
      });

      it('accepts adjustments up to exactly the charge, and refuses the next toman', async () => {
        await insertAdjustment(harness, fixture, chargeId, { amountToman: '200000' });
        await insertAdjustment(harness, fixture, chargeId, { amountToman: '50000' });

        // The family now owes nothing, which is legitimate: a full waiver.
        expect(
          await sqlStateOf(insertAdjustment(harness, fixture, chargeId, { amountToman: '1' })),
        ).toBe('23514');
      });

      it('refuses a single adjustment larger than the charge', async () => {
        expect(
          await sqlStateOf(insertAdjustment(harness, fixture, chargeId, { amountToman: '250001' })),
        ).toBe('23514');
      });

      it('counts only adjustments that are still active', async () => {
        const first = await insertAdjustment(harness, fixture, chargeId, {
          amountToman: '250000',
        });

        expect(
          await sqlStateOf(insertAdjustment(harness, fixture, chargeId, { amountToman: '1' })),
        ).toBe('23514');

        await harness.prisma.$executeRaw`
          UPDATE charge_adjustment
             SET voided_at = transaction_timestamp(),
                 voided_by_user_id = ${fixture.managerId}::uuid,
                 void_reason = 'اصلاح آزمایشی'
           WHERE id = ${first}::uuid
        `;

        // Voiding restored the room it had taken, and the replacement fits.
        await insertAdjustment(harness, fixture, chargeId, { amountToman: '250000' });

        expect(await harness.prisma.chargeAdjustment.count({ where: { voidedAt: null } })).toBe(1);
      });

      it('refuses any adjustment against a voided charge', async () => {
        await voidCharge(harness, fixture, chargeId);

        expect(
          await sqlStateOf(insertAdjustment(harness, fixture, chargeId, { amountToman: '1' })),
        ).toBe('23001');
      });
    });

    describe('immutability', () => {
      let chargeId: string;
      let adjustmentId: string;

      beforeEach(async () => {
        chargeId = await insertCharge(harness, fixture, { amountToman: '250000' });
        adjustmentId = await insertAdjustment(harness, fixture, chargeId, {
          amountToman: '50000',
        });
      });

      it('refuses to rewrite a charge’s amount, attribution or provenance', async () => {
        for (const statement of [
          harness.prisma
            .$executeRaw`UPDATE session_charge SET amount_toman = 1 WHERE id = ${chargeId}::uuid`,
          harness.prisma
            .$executeRaw`UPDATE session_charge SET price_mode = 'FREE' WHERE id = ${chargeId}::uuid`,
          harness.prisma
            .$executeRaw`UPDATE session_charge SET service_date = '2020-01-01' WHERE id = ${chargeId}::uuid`,
          harness.prisma
            .$executeRaw`UPDATE session_charge SET created_at = transaction_timestamp() WHERE id = ${chargeId}::uuid`,
        ]) {
          expect(await sqlStateOf(statement)).toBe('23001');
        }
      });

      it('permits exactly one void transition and refuses to reverse or revise it', async () => {
        await voidCharge(harness, fixture, chargeId);

        expect(
          await sqlStateOf(
            harness.prisma.$executeRaw`
              UPDATE session_charge SET voided_at = NULL, voided_by_user_id = NULL,
                     void_reason = NULL WHERE id = ${chargeId}::uuid`,
          ),
        ).toBe('23001');

        expect(
          await sqlStateOf(
            harness.prisma.$executeRaw`
              UPDATE session_charge SET void_reason = 'دلیل دیگر' WHERE id = ${chargeId}::uuid`,
          ),
        ).toBe('23001');
      });

      it('refuses a half-stated void', async () => {
        // Who, when and why move together. A withdrawn charge nobody can
        // attribute is not a record.
        expect(
          await sqlStateOf(
            harness.prisma.$executeRaw`
              UPDATE session_charge SET voided_at = transaction_timestamp()
               WHERE id = ${chargeId}::uuid`,
          ),
        ).toBe('23514');
      });

      it('refuses to rewrite an adjustment’s amount or its allocation', async () => {
        for (const statement of [
          harness.prisma
            .$executeRaw`UPDATE charge_adjustment SET amount_toman = 1 WHERE id = ${adjustmentId}::uuid`,
          harness.prisma
            .$executeRaw`UPDATE charge_adjustment SET therapist_discount_toman = 10000, clinic_discount_toman = 40000 WHERE id = ${adjustmentId}::uuid`,
          harness.prisma
            .$executeRaw`UPDATE charge_adjustment SET reason = 'دلیل دیگر' WHERE id = ${adjustmentId}::uuid`,
        ]) {
          expect(await sqlStateOf(statement)).toBe('23001');
        }
      });

      it('refuses DELETE and TRUNCATE on both tables', async () => {
        // Run WITHOUT the reset helper's trigger-disabling, which is the only
        // reason teardown can clear these tables at all.
        for (const statement of [
          harness.prisma
            .$executeRaw`DELETE FROM charge_adjustment WHERE id = ${adjustmentId}::uuid`,
          harness.prisma.$executeRaw`DELETE FROM session_charge WHERE id = ${chargeId}::uuid`,
          harness.prisma.$executeRawUnsafe('TRUNCATE charge_adjustment'),
          harness.prisma.$executeRawUnsafe('TRUNCATE session_charge CASCADE'),
        ]) {
          expect(await sqlStateOf(statement)).toBe('23001');
        }

        expect(await harness.prisma.sessionCharge.count()).toBe(1);
        expect(await harness.prisma.chargeAdjustment.count()).toBe(1);
      });
    });
  });
});
