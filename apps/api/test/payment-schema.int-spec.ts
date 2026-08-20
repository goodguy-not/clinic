import { uuidv7 } from '../src/common/uuid';
import { createHarness, resetDatabase, type Harness } from './harness';
import { sqlStateOf } from './ledger-support';
import {
  cancelPromise,
  clinicDay,
  fulfilPromise,
  insertPayment,
  insertPromise,
  reschedulePromise,
  seedAnotherFamily,
  seedPayingFamily,
  voidPayment,
  type PaymentFixture,
} from './payment-support';

/**
 * Pins the hand-written half of the Milestone 6 migration, and proves it.
 *
 * `prisma migrate diff` compares the datamodel with the database and sees
 * tables, columns, ordinary indexes and foreign keys. It does not see CHECK
 * constraints or triggers — so the objects that make this a payment record
 * rather than a set of rows are exactly the ones drift detection would let
 * disappear silently. This asserts each one exists by name AND that it refuses
 * what it exists to refuse.
 *
 * Every rejection is attempted with RAW SQL, deliberately. There is no payment
 * service in this checkpoint, so a test going through one would prove nothing;
 * and the claim being made is that these rules hold against a repair script and
 * a psql session too, not only against the code that has not been written yet.
 *
 * It also pins the checkpoint's SCOPE: two tables, no allocation, no stored
 * balance or credit, no settlement, and no `follow_up_date`.
 */
describe('payment schema objects', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  const M6_TABLES = ['payment', 'payment_promise'];

  describe('the catalogue', () => {
    it('creates exactly the two approved tables', async () => {
      const rows = await harness.prisma.$queryRaw<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name ~ '(payment|promise)'
      `;

      expect(rows.map((row) => row.table_name).sort()).toEqual([...M6_TABLES].sort());
    });

    it('creates no allocation, balance, credit, invoice or opening table', async () => {
      // Each was refused by name on 2026-08-15. A table matching this pattern
      // would be state stored before its rules were approved — and
      // `payment_allocation` in particular is the one this milestone argued
      // hardest against. Money in is still never allocated to a charge: what a
      // family owes is derived from rows on every read, and there is no stored
      // balance, credit or opening figure anywhere.
      //
      // THE THREE SETTLEMENT TABLES ARE THE PERMITTED MATCHES, and their arrival
      // is what this assertion was waiting for rather than a breach of it.
      // Milestone 6 deferred settlement to Milestone 8; checkpoint C3 approved
      // `session_settlement` — what a THERAPIST earned from a session, rather
      // than anything about a family's money — and checkpoint C6 approved
      // `settlement_period` and `settlement_line`, the closed period and the
      // immutable facts it materialised. Every other name in the pattern is
      // still refused, and NONE of the three is a payout, a payable or a
      // receivable: this milestone records no money leaving the clinic.
      const rows = await harness.prisma.$queryRaw<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name ~ '(allocation|balance|credit|invoice|settlement|opening)'
      `;

      expect(rows.map((row) => row.table_name).sort()).toEqual([
        'session_settlement',
        'settlement_line',
        'settlement_period',
      ]);
    });

    it('carries no share, percentage, balance, credit or allocation column', async () => {
      // Therapist settlement is Milestone 8. A percentage column here would be a
      // settlement rule inferred before it was approved, which CLAUDE.md forbids
      // outright.
      const rows = await harness.prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('payment', 'payment_promise')
          AND (column_name ~ '(share|percent|settlement|balance|credit|allocation|invoice)')
      `;

      expect(rows).toEqual([]);
    });

    it('stores no follow-up date and no pending or prepayment flag', async () => {
      // `follow_up_date` was removed from Milestone 6 because its semantics were
      // never approved; `isPrepayment` because intent is not observable at the
      // counter and the money is identical either way (DECISION_LOG, 2026-08-15).
      const rows = await harness.prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('payment', 'payment_promise')
          AND (column_name ~ '(follow|pending|prepay)')
      `;

      expect(rows).toEqual([]);
    });

    it('gives the payment no status column, because void is the whole lifecycle', async () => {
      // CONFIRMED then VOIDED, spelled the way `session_charge` spells it. A
      // status enum beside the void triple would be a second account of one
      // fact, and the two can disagree.
      const rows = await harness.prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'payment' AND column_name = 'status'
      `;

      expect(rows).toEqual([]);
    });

    it('stores every amount as BIGINT integer toman, and nothing as a decimal', async () => {
      const rows = await harness.prisma.$queryRaw<{ column_name: string; data_type: string }[]>`
        SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('payment', 'payment_promise')
          AND column_name LIKE '%toman%'
      `;

      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.column_name).toBe('amount_toman');
        expect(row.data_type).toBe('bigint');
      }
    });

    it('stores both business days as DATE, not as a timestamp', async () => {
      // `received_on` and `due_on` are clinic calendar days, so the day a
      // payment belongs to never depends on the reader's timezone.
      const rows = await harness.prisma.$queryRaw<{ column_name: string; data_type: string }[]>`
        SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name IN ('received_on', 'due_on')
        ORDER BY column_name
      `;

      expect(rows).toEqual([
        { column_name: 'due_on', data_type: 'date' },
        { column_name: 'received_on', data_type: 'date' },
      ]);
    });

    it('admits exactly three payment methods and four promise states', async () => {
      const methods = await harness.prisma.$queryRaw<{ label: string }[]>`
        SELECT e.enumlabel AS label
        FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'payment_method'
      `;

      // No CHEQUE, whose lifecycle nothing here models, and no OTHER, which is
      // the value no report can say anything about (DECISION_LOG, 2026-08-15).
      expect(methods.map((row) => row.label).sort()).toEqual(['CARD', 'CASH', 'TRANSFER']);

      const states = await harness.prisma.$queryRaw<{ label: string }[]>`
        SELECT e.enumlabel AS label
        FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'payment_promise_status'
      `;

      // MISSED IS NOT HERE. It is an OPEN promise whose due date has passed,
      // derived on read and never stored.
      expect(states.map((row) => row.label).sort()).toEqual([
        'CANCELLED',
        'FULFILLED',
        'OPEN',
        'RESCHEDULED',
      ]);
      expect(states.map((row) => row.label)).not.toContain('MISSED');
      expect(states.map((row) => row.label)).not.toContain('PENDING');
    });

    it('holds every hand-written CHECK constraint', async () => {
      const rows = await harness.prisma.$queryRaw<{ conname: string }[]>`
        SELECT conname FROM pg_constraint
        WHERE contype = 'c'
          AND conrelid::regclass::text IN ('payment', 'payment_promise')
      `;

      expect(rows.map((row) => row.conname).sort()).toEqual(
        [
          'payment_amount_bounds_chk',
          'payment_reference_chk',
          'payment_note_chk',
          'payment_void_consistency_chk',
          'payment_promise_amount_bounds_chk',
          'payment_promise_note_chk',
          'payment_promise_resolution_chk',
          'payment_promise_resolution_reason_chk',
          'payment_promise_fulfilment_link_chk',
          'payment_promise_reschedule_link_chk',
        ].sort(),
      );
    });

    it('holds the two composite foreign keys that prove the family match', async () => {
      const rows = await harness.prisma.$queryRaw<{ conname: string; definition: string }[]>`
        SELECT conname, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE contype = 'f' AND conrelid::regclass::text = 'payment_promise'
      `;

      const byName = new Map(rows.map((row) => [row.conname, row.definition]));

      expect(byName.get('payment_promise_fulfilling_payment_id_family_id_fkey')).toMatch(
        /FOREIGN KEY \(fulfilling_payment_id, family_id\) REFERENCES payment\(id, family_id\)/,
      );
      expect(byName.get('payment_promise_rescheduled_to_promise_id_family_id_fkey')).toMatch(
        /FOREIGN KEY \(rescheduled_to_promise_id, family_id\) REFERENCES payment_promise\(id, family_id\)/,
      );

      // Every relation refuses a delete. Financial rows are voided, never
      // removed, and neither is anything they name.
      for (const definition of byName.values()) expect(definition).toContain('ON DELETE RESTRICT');
    });

    it('makes both links unique, so no payment or successor is used twice', async () => {
      const rows = await harness.prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
        SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'payment_promise'
      `;

      const byName = new Map(rows.map((row) => [row.indexname, row.indexdef]));

      expect(byName.get('payment_promise_fulfilling_payment_id_key')).toMatch(/UNIQUE/);
      expect(byName.get('payment_promise_rescheduled_to_promise_id_key')).toMatch(/UNIQUE/);
      // The target of the self-referencing composite key, which asserts no new
      // uniqueness: `id` is the primary key already.
      expect(byName.get('payment_promise_id_family_id_key')).toMatch(/UNIQUE/);
      // The derived overdue list, which is the only reason MISSED needs no
      // column.
      expect(byName.get('payment_promise_status_due_on_idx')).toMatch(/status, due_on/);
    });

    it('indexes a family’s payments by the day the money arrived', async () => {
      const rows = await harness.prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
        SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'payment'
      `;

      const byName = new Map(rows.map((row) => [row.indexname, row.indexdef]));

      expect(byName.get('payment_family_id_received_on_idx')).toMatch(/family_id, received_on/);
      expect(byName.get('payment_id_family_id_key')).toMatch(/UNIQUE/);
    });

    it('holds the four support functions, each in the public schema', async () => {
      const rows = await harness.prisma.$queryRaw<{ proname: string }[]>`
        SELECT p.proname
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('enforce_payment_received_on',
                            'enforce_payment_immutability',
                            'enforce_payment_promise_born_open',
                            'enforce_payment_promise_transition')
      `;

      expect(rows.map((row) => row.proname).sort()).toEqual([
        'enforce_payment_immutability',
        'enforce_payment_promise_born_open',
        'enforce_payment_promise_transition',
        'enforce_payment_received_on',
      ]);
    });

    it('protects both tables with exactly the nine approved triggers', async () => {
      const rows = await harness.prisma.$queryRaw<{ tgname: string }[]>`
        SELECT tgname FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgrelid::regclass::text IN ('payment', 'payment_promise')
      `;

      expect(rows.map((row) => row.tgname).sort()).toEqual(
        [
          'payment_enforce_born_active',
          'payment_enforce_immutability',
          'payment_enforce_received_on',
          'payment_no_delete',
          'payment_no_truncate',
          'payment_promise_enforce_born_open',
          'payment_promise_enforce_transition',
          'payment_promise_no_delete',
          'payment_promise_no_truncate',
        ].sort(),
      );
    });

    it('reuses the Milestone 1 and 5 shared functions rather than cloning them', async () => {
      // A rule refused by one function everywhere cannot drift between tables.
      const rows = await harness.prisma.$queryRaw<{ tgname: string; proname: string }[]>`
        SELECT t.tgname, p.proname
        FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE NOT t.tgisinternal
          AND t.tgrelid::regclass::text IN ('payment', 'payment_promise')
          AND p.proname IN ('raise_append_only_violation', 'enforce_financial_row_born_active')
      `;

      const byTrigger = new Map(rows.map((row) => [row.tgname, row.proname]));

      expect(byTrigger.get('payment_enforce_born_active')).toBe(
        'enforce_financial_row_born_active',
      );
      expect(byTrigger.get('payment_no_delete')).toBe('raise_append_only_violation');
      expect(byTrigger.get('payment_no_truncate')).toBe('raise_append_only_violation');
      expect(byTrigger.get('payment_promise_no_delete')).toBe('raise_append_only_violation');
      expect(byTrigger.get('payment_promise_no_truncate')).toBe('raise_append_only_violation');
    });
  });

  describe('what the database refuses', () => {
    let fixture: PaymentFixture;

    beforeEach(async () => {
      await resetDatabase(harness.prisma);
      fixture = await seedPayingFamily(harness);
    });

    describe('a payment’s money', () => {
      it('accepts an ordinary payment', async () => {
        await insertPayment(harness, fixture);

        expect(await harness.prisma.payment.count()).toBe(1);
      });

      it('refuses zero, a negative amount and one past the fat-finger ceiling', async () => {
        // Strictly positive, unlike a charge, which may legitimately be zero
        // when the session was genuinely complimentary. There is no payment of
        // nothing, and a refund is not a negative payment.
        for (const amountToman of ['0', '-1', '1000000001']) {
          expect(await sqlStateOf(insertPayment(harness, fixture, { amountToman }))).toBe('23514');
        }

        await insertPayment(harness, fixture, { amountToman: '1000000000' });
        expect(await harness.prisma.payment.count()).toBe(1);
      });

      it('accepts each approved method and refuses any other value', async () => {
        for (const method of ['CASH', 'CARD', 'TRANSFER'] as const) {
          await insertPayment(harness, fixture, { method });
        }

        expect(await harness.prisma.payment.count()).toBe(3);

        // 22P02, invalid_text_representation: the enum has no such label, so a
        // cheque cannot be recorded even by a caller that decides to try.
        expect(
          await sqlStateOf(
            harness.prisma.$executeRaw`
              INSERT INTO payment (
                id, family_id, amount_toman, method, received_on,
                created_at, created_by_user_id
              ) VALUES (
                ${uuidv7()}::uuid, ${fixture.familyId}::uuid, 1000::bigint,
                'CHEQUE'::payment_method, clinic_date(),
                transaction_timestamp(), ${fixture.managerId}::uuid
              )`,
          ),
        ).toBe('22P02');
      });

      it('normalises an optional reference and note, or refuses them', async () => {
        await insertPayment(harness, fixture, { reference: 'TRX-0001', note: 'یادداشت آزمایشی' });
        expect(await harness.prisma.payment.count()).toBe(1);

        for (const reference of ['   ', ' TRX-0001', 'x'.repeat(41)]) {
          expect(await sqlStateOf(insertPayment(harness, fixture, { reference }))).toBe('23514');
        }

        expect(await sqlStateOf(insertPayment(harness, fixture, { note: '   ' }))).toBe('23514');
      });

      it('bounds the reference at the identifier length, not the name length', async () => {
        // 40, matching `legacy_paper_file_number` — the other short identifier an
        // operator transcribes from somewhere else. Long enough for a terminal
        // trace, a transfer id or a 26-character IBAN.
        await insertPayment(harness, fixture, { reference: 'x'.repeat(40) });
        await insertPayment(harness, fixture, { reference: 'IR820540102680020817909002' });

        expect(await harness.prisma.payment.count()).toBe(2);
        expect(
          await sqlStateOf(insertPayment(harness, fixture, { reference: 'x'.repeat(41) })),
        ).toBe('23514');
      });

      it('bounds the note at the note length every other table uses', async () => {
        // 2000, exactly as `family_note_chk`, `child_note_chk` and
        // `appointment_note_chk` do. Same kind of value, same limit.
        await insertPayment(harness, fixture, { note: 'ی'.repeat(2000) });

        expect(await sqlStateOf(insertPayment(harness, fixture, { note: 'ی'.repeat(2001) }))).toBe(
          '23514',
        );
      });

      it('refuses a payment naming a family that does not exist', async () => {
        expect(await sqlStateOf(insertPayment(harness, fixture, { familyId: uuidv7() }))).toBe(
          '23503',
        );
      });
    });

    describe('the business day the money arrived', () => {
      it('accepts a back-dated payment, with no age limit', async () => {
        // Money that arrived on Thursday and is entered on Saturday arrived on
        // Thursday. Refusing that would push the clinic to enter a false date.
        await insertPayment(harness, fixture, { receivedOn: await clinicDay(harness, -1) });
        await insertPayment(harness, fixture, { receivedOn: await clinicDay(harness, -400) });
        await insertPayment(harness, fixture, { receivedOn: '2020-01-01' });

        expect(await harness.prisma.payment.count()).toBe(3);
      });

      it('accepts today and refuses tomorrow', async () => {
        await insertPayment(harness, fixture, { receivedOn: await clinicDay(harness, 0) });

        // A future receipt records money that does not exist yet. That is a
        // promise, and `payment_promise` already models one.
        expect(
          await sqlStateOf(
            insertPayment(harness, fixture, { receivedOn: await clinicDay(harness, 1) }),
          ),
        ).toBe('23514');

        expect(
          await sqlStateOf(
            insertPayment(harness, fixture, { receivedOn: await clinicDay(harness, 365) }),
          ),
        ).toBe('23514');

        expect(await harness.prisma.payment.count()).toBe(1);
      });

      it('compares against the CLINIC’s day, not the session’s', async () => {
        // The proof that `clinic_date()` and not `CURRENT_DATE` is the
        // authority: with the session pushed to a timezone a day behind Tehran,
        // a payment dated the clinic's today is still accepted.
        await harness.prisma.$executeRawUnsafe("SET LOCAL TIME ZONE 'Pacific/Niue'");

        try {
          await insertPayment(harness, fixture, { receivedOn: await clinicDay(harness, 0) });
          expect(await harness.prisma.payment.count()).toBe(1);
        } finally {
          await harness.prisma.$executeRawUnsafe('RESET TIME ZONE');
        }
      });
    });

    describe('a payment’s lifecycle', () => {
      it('refuses a payment that is born voided', async () => {
        // Voiding is a decision an actor makes about a record that exists, and
        // it is always a second statement.
        expect(await sqlStateOf(insertPayment(harness, fixture, { voided: true }))).toBe('23001');
        expect(await harness.prisma.payment.count()).toBe(0);
      });

      it('permits exactly one void transition and refuses to reverse or revise it', async () => {
        const paymentId = await insertPayment(harness, fixture);
        await voidPayment(harness, fixture, paymentId);

        expect(
          await sqlStateOf(
            harness.prisma.$executeRaw`
              UPDATE payment SET voided_at = NULL, voided_by_user_id = NULL,
                     void_reason = NULL WHERE id = ${paymentId}::uuid`,
          ),
        ).toBe('23001');

        expect(
          await sqlStateOf(
            harness.prisma.$executeRaw`
              UPDATE payment SET void_reason = 'دلیل دیگر' WHERE id = ${paymentId}::uuid`,
          ),
        ).toBe('23001');
      });

      it('refuses a half-stated void', async () => {
        const paymentId = await insertPayment(harness, fixture);

        expect(
          await sqlStateOf(
            harness.prisma.$executeRaw`
              UPDATE payment SET voided_at = transaction_timestamp()
               WHERE id = ${paymentId}::uuid`,
          ),
        ).toBe('23514');
      });

      it('refuses to rewrite any finalized payment fact', async () => {
        const paymentId = await insertPayment(harness, fixture, {
          reference: 'TRX-0001',
          note: 'یادداشت آزمایشی',
        });

        for (const statement of [
          harness.prisma
            .$executeRaw`UPDATE payment SET amount_toman = 1 WHERE id = ${paymentId}::uuid`,
          harness.prisma
            .$executeRaw`UPDATE payment SET method = 'CARD' WHERE id = ${paymentId}::uuid`,
          harness.prisma
            .$executeRaw`UPDATE payment SET received_on = '2020-01-01' WHERE id = ${paymentId}::uuid`,
          harness.prisma
            .$executeRaw`UPDATE payment SET reference = 'TRX-0002' WHERE id = ${paymentId}::uuid`,
          harness.prisma
            .$executeRaw`UPDATE payment SET note = 'یادداشت دیگر' WHERE id = ${paymentId}::uuid`,
          harness.prisma
            .$executeRaw`UPDATE payment SET created_at = transaction_timestamp() WHERE id = ${paymentId}::uuid`,
        ]) {
          expect(await sqlStateOf(statement)).toBe('23001');
        }
      });

      it('refuses DELETE and TRUNCATE on the payment table', async () => {
        // Run WITHOUT the reset helper's trigger-disabling, which is the only
        // reason teardown can clear this table at all.
        const paymentId = await insertPayment(harness, fixture);

        for (const statement of [
          harness.prisma.$executeRaw`DELETE FROM payment WHERE id = ${paymentId}::uuid`,
          harness.prisma.$executeRawUnsafe('TRUNCATE payment CASCADE'),
        ]) {
          expect(await sqlStateOf(statement)).toBe('23001');
        }

        expect(await harness.prisma.payment.count()).toBe(1);
      });
    });

    describe('a promise’s creation', () => {
      it('accepts a promise due today or in the future', async () => {
        await insertPromise(harness, fixture, { dueOn: await clinicDay(harness, 0) });
        await insertPromise(harness, fixture, { dueOn: await clinicDay(harness, 30) });

        expect(await harness.prisma.paymentPromise.count()).toBe(2);
      });

      it('accepts an INITIAL promise with a past due date', async () => {
        // A promise made last week and entered today is a real fact. It is OPEN
        // and reads immediately as derived MISSED; there is no arbitrary limit
        // on how old the date may be.
        const promiseId = await insertPromise(harness, fixture, {
          dueOn: await clinicDay(harness, -90),
        });

        const row = await harness.prisma.paymentPromise.findUniqueOrThrow({
          where: { id: promiseId },
        });

        expect(row.status).toBe('OPEN');
        expect(row.resolvedAt).toBeNull();
      });

      it('refuses zero, a negative amount and one past the ceiling', async () => {
        for (const amountToman of ['0', '-1', '1000000001']) {
          expect(await sqlStateOf(insertPromise(harness, fixture, { amountToman }))).toBe('23514');
        }
      });

      it('refuses a promise that is born terminal, in every terminal state', async () => {
        // The hole this closes: `enforce_payment_promise_transition` is the ONLY
        // place the fulfilment invariants are checked, and it runs on UPDATE. A
        // row born FULFILLED would walk straight past it — a fulfilment nobody
        // performed, against a payment nothing validated.
        const paymentId = await insertPayment(harness, fixture);

        expect(
          await sqlStateOf(
            insertPromise(harness, fixture, {
              status: 'FULFILLED',
              fulfillingPaymentId: paymentId,
            }),
          ),
        ).toBe('23001');

        expect(await sqlStateOf(insertPromise(harness, fixture, { status: 'CANCELLED' }))).toBe(
          '23001',
        );

        const successorId = await insertPromise(harness, fixture);
        expect(
          await sqlStateOf(
            insertPromise(harness, fixture, {
              status: 'RESCHEDULED',
              rescheduledToPromiseId: successorId,
            }),
          ),
        ).toBe('23001');

        expect(await harness.prisma.paymentPromise.count()).toBe(1);
      });

      it('refuses an OPEN promise that already names a payment or a successor', async () => {
        // The biconditionals, from the other side: a payment linked to a promise
        // that is not fulfilled is evidence for nothing.
        const paymentId = await insertPayment(harness, fixture);

        expect(
          await sqlStateOf(
            insertPromise(harness, fixture, { status: 'OPEN', fulfillingPaymentId: paymentId }),
          ),
        ).toBe('23514');
      });
    });

    describe('fulfilment', () => {
      let promiseId: string;

      beforeEach(async () => {
        promiseId = await insertPromise(harness, fixture, { amountToman: '250000' });
      });

      it('accepts a confirmed payment of the promised amount, or more', async () => {
        const paymentId = await insertPayment(harness, fixture, { amountToman: '250000' });
        await fulfilPromise(harness, fixture, promiseId, paymentId);

        const row = await harness.prisma.paymentPromise.findUniqueOrThrow({
          where: { id: promiseId },
        });

        expect(row.status).toBe('FULFILLED');
        expect(row.fulfillingPaymentId).toBe(paymentId);
        expect(row.resolvedAt).not.toBeNull();
        expect(row.resolvedByUserId).toBe(fixture.managerId);

        // The amount and due date the promise was made with are untouched: the
        // promise still says what was promised.
        expect(row.amountToman).toBe(250000n);
      });

      it('accepts a payment LARGER than the promise, with no remainder recorded', async () => {
        // The surplus is visible as derived credit, not as a partial-fulfilment
        // row against this promise (DECISION_LOG, 2026-08-15).
        const paymentId = await insertPayment(harness, fixture, { amountToman: '400000' });
        await fulfilPromise(harness, fixture, promiseId, paymentId);

        expect(
          (await harness.prisma.paymentPromise.findUniqueOrThrow({ where: { id: promiseId } }))
            .status,
        ).toBe('FULFILLED');
      });

      it('refuses a payment smaller than the promise', async () => {
        // There is no partial fulfilment. A family paying in instalments
        // reschedules or cancels instead.
        const paymentId = await insertPayment(harness, fixture, { amountToman: '249999' });

        expect(await sqlStateOf(fulfilPromise(harness, fixture, promiseId, paymentId))).toBe(
          '23514',
        );
        expect(
          (await harness.prisma.paymentPromise.findUniqueOrThrow({ where: { id: promiseId } }))
            .status,
        ).toBe('OPEN');
      });

      it('refuses a voided payment', async () => {
        // A voided payment is money the clinic says it never received. It cannot
        // be evidence that a promise was kept.
        const paymentId = await insertPayment(harness, fixture, { amountToman: '250000' });
        await voidPayment(harness, fixture, paymentId);

        expect(await sqlStateOf(fulfilPromise(harness, fixture, promiseId, paymentId))).toBe(
          '23001',
        );
      });

      it('refuses a payment belonging to another family', async () => {
        // 23503, from `payment_promise_fulfilling_payment_id_family_id_fkey`.
        // The pair does not exist, so one family's promise can never be settled
        // with another family's money.
        const otherFamilyId = await seedAnotherFamily(harness, fixture);
        const foreignPayment = await insertPayment(harness, fixture, {
          familyId: otherFamilyId,
          amountToman: '250000',
        });

        expect(await sqlStateOf(fulfilPromise(harness, fixture, promiseId, foreignPayment))).toBe(
          '23503',
        );
      });

      it('refuses a payment that does not exist', async () => {
        expect(await sqlStateOf(fulfilPromise(harness, fixture, promiseId, uuidv7()))).toBe(
          '23503',
        );
      });

      it('lets one payment fulfil at most one promise', async () => {
        // 23505, unique_violation, from
        // `payment_promise_fulfilling_payment_id_key`. A payment cannot be spent
        // twice as proof, which is what keeps the evidence unambiguous without
        // the allocation table this milestone refused.
        const paymentId = await insertPayment(harness, fixture, { amountToman: '400000' });
        const second = await insertPromise(harness, fixture, { amountToman: '250000' });

        await fulfilPromise(harness, fixture, promiseId, paymentId);

        expect(await sqlStateOf(fulfilPromise(harness, fixture, second, paymentId))).toBe('23505');
        expect(
          (await harness.prisma.paymentPromise.findUniqueOrThrow({ where: { id: second } })).status,
        ).toBe('OPEN');
      });
    });

    describe('rescheduling', () => {
      let originalId: string;

      beforeEach(async () => {
        originalId = await insertPromise(harness, fixture, {
          amountToman: '250000',
          dueOn: await clinicDay(harness, -7),
        });
      });

      it('preserves the original and points it at its successor', async () => {
        const successorId = await insertPromise(harness, fixture, {
          amountToman: '250000',
          dueOn: await clinicDay(harness, 14),
        });

        await reschedulePromise(
          harness,
          fixture,
          originalId,
          successorId,
          'خانواده مهلت بیشتری خواست',
        );

        const original = await harness.prisma.paymentPromise.findUniqueOrThrow({
          where: { id: originalId },
        });

        // BOTH SURVIVE, and the old one keeps its own overdue due date. That is
        // what "rescheduling preserves old due-date history" means structurally.
        expect(original.status).toBe('RESCHEDULED');
        expect(original.rescheduledToPromiseId).toBe(successorId);
        expect(original.dueOn.toISOString().slice(0, 10)).toBe(await clinicDay(harness, -7));
        expect(original.amountToman).toBe(250000n);

        // AND THE WHOLE RESOLUTION, on the promise itself: why, by whom, and
        // when. Not in an audit row somebody has to go and find.
        expect(original.resolutionReason).toBe('خانواده مهلت بیشتری خواست');
        expect(original.resolvedByUserId).toBe(fixture.managerId);
        expect(original.resolvedAt).not.toBeNull();

        expect(
          (await harness.prisma.paymentPromise.findUniqueOrThrow({ where: { id: successorId } }))
            .status,
        ).toBe('OPEN');
      });

      it('accepts a successor due today', async () => {
        const successorId = await insertPromise(harness, fixture, {
          dueOn: await clinicDay(harness, 0),
        });

        await reschedulePromise(harness, fixture, originalId, successorId);
        expect(await harness.prisma.paymentPromise.count({ where: { status: 'OPEN' } })).toBe(1);
      });

      it('refuses a successor already overdue at the moment it is agreed', async () => {
        // The one date rule an initial promise does not have. Rescheduling is a
        // new intention agreed NOW, and an intention already overdue records
        // nothing.
        const successorId = await insertPromise(harness, fixture, {
          dueOn: await clinicDay(harness, -1),
        });

        expect(await sqlStateOf(reschedulePromise(harness, fixture, originalId, successorId))).toBe(
          '23514',
        );
        expect(
          (await harness.prisma.paymentPromise.findUniqueOrThrow({ where: { id: originalId } }))
            .status,
        ).toBe('OPEN');
      });

      it('refuses a successor belonging to another family', async () => {
        const otherFamilyId = await seedAnotherFamily(harness, fixture);
        const foreignSuccessor = await insertPromise(harness, fixture, {
          familyId: otherFamilyId,
          dueOn: await clinicDay(harness, 14),
        });

        expect(
          await sqlStateOf(reschedulePromise(harness, fixture, originalId, foreignSuccessor)),
        ).toBe('23503');
      });

      it('refuses a successor that has already ended', async () => {
        const successorId = await insertPromise(harness, fixture, {
          dueOn: await clinicDay(harness, 14),
        });
        await cancelPromise(harness, fixture, successorId);

        expect(await sqlStateOf(reschedulePromise(harness, fixture, originalId, successorId))).toBe(
          '23001',
        );
      });

      it('refuses a promise as its own successor', async () => {
        expect(await sqlStateOf(reschedulePromise(harness, fixture, originalId, originalId))).toBe(
          '23514',
        );
      });

      it('lets a successor succeed at most one promise', async () => {
        const other = await insertPromise(harness, fixture, {
          dueOn: await clinicDay(harness, -3),
        });
        const successorId = await insertPromise(harness, fixture, {
          dueOn: await clinicDay(harness, 14),
        });

        await reschedulePromise(harness, fixture, originalId, successorId);

        expect(await sqlStateOf(reschedulePromise(harness, fixture, other, successorId))).toBe(
          '23505',
        );
      });

      it('refuses a RESCHEDULED status with no successor named', async () => {
        expect(
          await sqlStateOf(
            harness.prisma.$executeRaw`
              UPDATE payment_promise
                 SET status = 'RESCHEDULED',
                     resolved_at = transaction_timestamp(),
                     resolved_by_user_id = ${fixture.managerId}::uuid,
                     resolution_reason = 'تغییر زمان آزمایشی'
               WHERE id = ${originalId}::uuid`,
          ),
        ).toBe('23514');
      });

      it('refuses a successor named by a promise that is not RESCHEDULED', async () => {
        // The biconditional from the other side. A link with no reschedule
        // behind it is a chain edge nothing in the domain put there.
        const successorId = await insertPromise(harness, fixture, {
          dueOn: await clinicDay(harness, 14),
        });

        expect(
          await sqlStateOf(
            harness.prisma.$executeRaw`
              UPDATE payment_promise
                 SET status = 'CANCELLED',
                     rescheduled_to_promise_id = ${successorId}::uuid,
                     resolved_at = transaction_timestamp(),
                     resolved_by_user_id = ${fixture.managerId}::uuid,
                     resolution_reason = 'لغو آزمایشی'
               WHERE id = ${originalId}::uuid`,
          ),
        ).toBe('23514');
      });
    });

    /**
     * The forward-link model, held to the standard the back-reference model was
     * offered as an alternative to: a raw caller with a psql session must not be
     * able to write a reschedule history that reads as nonsense.
     *
     * Each case below names the single object that refuses it. None of them
     * needs a recursive walk or a temporal assumption.
     */
    describe('the reschedule chain, against a raw caller', () => {
      let originalId: string;
      let successorId: string;

      beforeEach(async () => {
        originalId = await insertPromise(harness, fixture, {
          dueOn: await clinicDay(harness, -7),
        });
        successorId = await insertPromise(harness, fixture, {
          dueOn: await clinicDay(harness, 14),
        });
      });

      it('refuses a successor that predates the promise it supersedes', async () => {
        // BACKWARDS CHAINS. `successorId` was created after `originalId`, so the
        // legitimate direction works; the reverse is a history that runs
        // backwards through time and is refused even though both rows are OPEN,
        // same-family and otherwise eligible.
        const laterDue = await insertPromise(harness, fixture, {
          dueOn: await clinicDay(harness, 21),
        });

        await reschedulePromise(harness, fixture, originalId, laterDue);

        const olderPromise = await insertPromise(harness, fixture, {
          dueOn: await clinicDay(harness, 30),
        });
        const newerPromise = await insertPromise(harness, fixture, {
          dueOn: await clinicDay(harness, 30),
        });

        // newer -> older is refused; older -> newer is exactly the same two rows
        // the right way round, and is accepted.
        expect(
          await sqlStateOf(reschedulePromise(harness, fixture, newerPromise, olderPromise)),
        ).toBe('23514');

        await reschedulePromise(harness, fixture, olderPromise, newerPromise);
        expect(
          (await harness.prisma.paymentPromise.findUniqueOrThrow({ where: { id: olderPromise } }))
            .rescheduledToPromiseId,
        ).toBe(newerPromise);
      });

      it('makes a two-step cycle unreachable', async () => {
        // A -> B, then B -> A. The second is refused because A is RESCHEDULED
        // and a successor must be OPEN — which is the whole cycle argument at
        // every depth, not only at two.
        await reschedulePromise(harness, fixture, originalId, successorId);

        expect(await sqlStateOf(reschedulePromise(harness, fixture, successorId, originalId))).toBe(
          '23001',
        );
      });

      it('lets a chain extend forward as many times as the clinic needs', async () => {
        // The legitimate shape: each link ends one promise and opens the next,
        // and every earlier row keeps saying exactly what it said.
        const second = await insertPromise(harness, fixture, {
          dueOn: await clinicDay(harness, 21),
        });
        const third = await insertPromise(harness, fixture, {
          dueOn: await clinicDay(harness, 28),
        });

        await reschedulePromise(harness, fixture, originalId, successorId, 'مهلت اول');
        await reschedulePromise(harness, fixture, successorId, second, 'مهلت دوم');
        await reschedulePromise(harness, fixture, second, third, 'مهلت سوم');

        const chain = await harness.prisma.paymentPromise.findMany({
          where: { id: { in: [originalId, successorId, second, third] } },
          orderBy: { createdAt: 'asc' },
        });

        expect(chain.map((row) => row.status)).toEqual([
          'RESCHEDULED',
          'RESCHEDULED',
          'RESCHEDULED',
          'OPEN',
        ]);
        expect(chain.map((row) => row.resolutionReason)).toEqual([
          'مهلت اول',
          'مهلت دوم',
          'مهلت سوم',
          null,
        ]);
        expect(chain.map((row) => row.rescheduledToPromiseId)).toEqual([
          successorId,
          second,
          third,
          null,
        ]);
      });

      it('refuses to repoint, clear or rewrite the link once the promise has ended', async () => {
        const rival = await insertPromise(harness, fixture, {
          dueOn: await clinicDay(harness, 21),
        });

        await reschedulePromise(harness, fixture, originalId, successorId);

        for (const statement of [
          harness.prisma.$executeRaw`
            UPDATE payment_promise SET rescheduled_to_promise_id = ${rival}::uuid
             WHERE id = ${originalId}::uuid`,
          harness.prisma.$executeRaw`
            UPDATE payment_promise SET rescheduled_to_promise_id = NULL, status = 'CANCELLED'
             WHERE id = ${originalId}::uuid`,
          harness.prisma.$executeRaw`
            UPDATE payment_promise SET status = 'OPEN', rescheduled_to_promise_id = NULL,
                   resolved_at = NULL, resolved_by_user_id = NULL, resolution_reason = NULL
             WHERE id = ${originalId}::uuid`,
        ]) {
          expect(await sqlStateOf(statement)).toBe('23001');
        }

        // Untouched.
        const original = await harness.prisma.paymentPromise.findUniqueOrThrow({
          where: { id: originalId },
        });
        expect(original.rescheduledToPromiseId).toBe(successorId);
        expect(original.status).toBe('RESCHEDULED');
      });

      it('refuses to rewrite the successor’s own history while it stands', async () => {
        await reschedulePromise(harness, fixture, originalId, successorId);

        for (const statement of [
          harness.prisma
            .$executeRaw`UPDATE payment_promise SET amount_toman = 1 WHERE id = ${successorId}::uuid`,
          harness.prisma
            .$executeRaw`UPDATE payment_promise SET due_on = '2020-01-01' WHERE id = ${successorId}::uuid`,
          harness.prisma
            .$executeRaw`UPDATE payment_promise SET created_at = transaction_timestamp() WHERE id = ${successorId}::uuid`,
        ]) {
          expect(await sqlStateOf(statement)).toBe('23001');
        }
      });

      it('refuses to delete either end of a chain', async () => {
        await reschedulePromise(harness, fixture, originalId, successorId);

        for (const statement of [
          harness.prisma.$executeRaw`DELETE FROM payment_promise WHERE id = ${successorId}::uuid`,
          harness.prisma.$executeRaw`DELETE FROM payment_promise WHERE id = ${originalId}::uuid`,
        ]) {
          expect(await sqlStateOf(statement)).toBe('23001');
        }

        expect(await harness.prisma.paymentPromise.count()).toBe(2);
      });
    });

    /**
     * Why a promise ended, kept on the promise.
     *
     * Rescheduling and cancelling are explicit historical resolutions, and the
     * reason for one is part of the promise's own record — not a fact that lives
     * only in an audit payload somebody has to go and look for.
     */
    describe('the resolution reason', () => {
      let promiseId: string;

      beforeEach(async () => {
        promiseId = await insertPromise(harness, fixture, {
          amountToman: '250000',
          dueOn: await clinicDay(harness, -7),
        });
      });

      it('refuses a reschedule with no reason', async () => {
        const successorId = await insertPromise(harness, fixture, {
          dueOn: await clinicDay(harness, 14),
        });

        expect(
          await sqlStateOf(reschedulePromise(harness, fixture, promiseId, successorId, null)),
        ).toBe('23514');
        expect(
          (await harness.prisma.paymentPromise.findUniqueOrThrow({ where: { id: promiseId } }))
            .status,
        ).toBe('OPEN');
      });

      it('refuses a cancellation with no reason', async () => {
        // A promise abandoned with no explanation is exactly what CLAUDE.md
        // forbids of a correction.
        expect(await sqlStateOf(cancelPromise(harness, fixture, promiseId, null))).toBe('23514');
        expect(
          (await harness.prisma.paymentPromise.findUniqueOrThrow({ where: { id: promiseId } }))
            .status,
        ).toBe('OPEN');
      });

      it('refuses a blank, padded or oversized reason', async () => {
        for (const reason of ['', '   ', ' دلیل آزمایشی', 'ی'.repeat(501)]) {
          expect(await sqlStateOf(cancelPromise(harness, fixture, promiseId, reason))).toBe(
            '23514',
          );
        }

        // 500 exactly, the length every other reason in this schema carries.
        await cancelPromise(harness, fixture, promiseId, 'ی'.repeat(500));
        expect(
          (await harness.prisma.paymentPromise.findUniqueOrThrow({ where: { id: promiseId } }))
            .status,
        ).toBe('CANCELLED');
      });

      it('needs no reason for a promise that was simply kept', async () => {
        // FULFILLED is the promise doing what it said; the linked payment is the
        // explanation. A reason is permitted and never demanded.
        const kept = await insertPromise(harness, fixture, { amountToman: '100000' });
        await fulfilPromise(
          harness,
          fixture,
          kept,
          await insertPayment(harness, fixture, { amountToman: '100000' }),
        );

        const row = await harness.prisma.paymentPromise.findUniqueOrThrow({ where: { id: kept } });
        expect(row.status).toBe('FULFILLED');
        expect(row.resolutionReason).toBeNull();

        const alsoKept = await insertPromise(harness, fixture, { amountToman: '100000' });
        await fulfilPromise(
          harness,
          fixture,
          alsoKept,
          await insertPayment(harness, fixture, { amountToman: '100000' }),
          'پرداخت نقدی در محل',
        );

        expect(
          (await harness.prisma.paymentPromise.findUniqueOrThrow({ where: { id: alsoKept } }))
            .resolutionReason,
        ).toBe('پرداخت نقدی در محل');
      });

      it('refuses a reason on a promise that has not ended', async () => {
        // Nothing has been decided yet, so there is nothing to explain.
        expect(
          await sqlStateOf(insertPromise(harness, fixture, { resolutionReason: 'دلیل زودهنگام' })),
        ).toBe('23514');

        expect(
          await sqlStateOf(
            harness.prisma.$executeRaw`
              UPDATE payment_promise SET resolution_reason = 'دلیل زودهنگام'
               WHERE id = ${promiseId}::uuid`,
          ),
        ).toBe('23514');
      });

      it('refuses to change the reason after the promise has ended', async () => {
        await cancelPromise(harness, fixture, promiseId, 'دلیل اصلی');

        for (const statement of [
          harness.prisma.$executeRaw`
            UPDATE payment_promise SET resolution_reason = 'دلیل دیگر'
             WHERE id = ${promiseId}::uuid`,
          harness.prisma.$executeRaw`
            UPDATE payment_promise SET resolution_reason = NULL WHERE id = ${promiseId}::uuid`,
          harness.prisma.$executeRaw`
            UPDATE payment_promise SET resolved_by_user_id = ${fixture.managerId}::uuid,
                   resolution_reason = 'دلیل دیگر'
             WHERE id = ${promiseId}::uuid`,
        ]) {
          expect(await sqlStateOf(statement)).toBe('23001');
        }

        expect(
          (await harness.prisma.paymentPromise.findUniqueOrThrow({ where: { id: promiseId } }))
            .resolutionReason,
        ).toBe('دلیل اصلی');
      });

      it('keeps the reason beside its actor and instant, never one without the others', async () => {
        expect(
          await sqlStateOf(
            harness.prisma.$executeRaw`
              UPDATE payment_promise
                 SET status = 'CANCELLED', resolution_reason = 'دلیل بی‌صاحب'
               WHERE id = ${promiseId}::uuid`,
          ),
        ).toBe('23514');

        expect(
          await sqlStateOf(
            harness.prisma.$executeRaw`
              UPDATE payment_promise
                 SET status = 'CANCELLED', resolved_at = transaction_timestamp(),
                     resolution_reason = 'دلیل بی‌صاحب'
               WHERE id = ${promiseId}::uuid`,
          ),
        ).toBe('23514');
      });
    });

    describe('a promise’s history', () => {
      let promiseId: string;

      beforeEach(async () => {
        promiseId = await insertPromise(harness, fixture, {
          amountToman: '250000',
          note: 'یادداشت آزمایشی',
        });
      });

      it('refuses to rewrite the amount, due date, family, note or provenance', async () => {
        for (const statement of [
          harness.prisma
            .$executeRaw`UPDATE payment_promise SET amount_toman = 1 WHERE id = ${promiseId}::uuid`,
          harness.prisma
            .$executeRaw`UPDATE payment_promise SET due_on = '2030-01-01' WHERE id = ${promiseId}::uuid`,
          harness.prisma
            .$executeRaw`UPDATE payment_promise SET note = 'یادداشت دیگر' WHERE id = ${promiseId}::uuid`,
          harness.prisma
            .$executeRaw`UPDATE payment_promise SET created_at = transaction_timestamp() WHERE id = ${promiseId}::uuid`,
        ]) {
          expect(await sqlStateOf(statement)).toBe('23001');
        }
      });

      it('refuses to move a promise to another family', async () => {
        const otherFamilyId = await seedAnotherFamily(harness, fixture);

        expect(
          await sqlStateOf(
            harness.prisma.$executeRaw`
              UPDATE payment_promise SET family_id = ${otherFamilyId}::uuid
               WHERE id = ${promiseId}::uuid`,
          ),
        ).toBe('23001');
      });

      it('refuses a terminal promise a second transition, from every terminal state', async () => {
        const cancelled = await insertPromise(harness, fixture);
        await cancelPromise(harness, fixture, cancelled);

        // Not to another terminal state...
        expect(
          await sqlStateOf(
            fulfilPromise(
              harness,
              fixture,
              cancelled,
              await insertPayment(harness, fixture, { amountToman: '400000' }),
            ),
          ),
        ).toBe('23001');

        // ...and not back to OPEN.
        expect(
          await sqlStateOf(
            harness.prisma.$executeRaw`
              UPDATE payment_promise
                 SET status = 'OPEN', resolved_at = NULL, resolved_by_user_id = NULL
               WHERE id = ${cancelled}::uuid`,
          ),
        ).toBe('23001');

        const fulfilled = await insertPromise(harness, fixture, { amountToman: '100000' });
        await fulfilPromise(
          harness,
          fixture,
          fulfilled,
          await insertPayment(harness, fixture, { amountToman: '100000' }),
        );

        expect(await sqlStateOf(cancelPromise(harness, fixture, fulfilled))).toBe('23001');
      });

      it('refuses a terminal state with no actor or no instant', async () => {
        // Who and when move together, exactly as they do on a void.
        expect(
          await sqlStateOf(
            harness.prisma.$executeRaw`
              UPDATE payment_promise SET status = 'CANCELLED' WHERE id = ${promiseId}::uuid`,
          ),
        ).toBe('23514');
      });

      it('refuses DELETE and TRUNCATE on the promise table', async () => {
        for (const statement of [
          harness.prisma.$executeRaw`DELETE FROM payment_promise WHERE id = ${promiseId}::uuid`,
          harness.prisma.$executeRawUnsafe('TRUNCATE payment_promise CASCADE'),
        ]) {
          expect(await sqlStateOf(statement)).toBe('23001');
        }

        expect(await harness.prisma.paymentPromise.count()).toBe(1);
      });
    });
  });
});
