import { CHILD_SEXES } from '@clinic/contracts';
import { uuidv7 } from '../src/common/uuid';
import { createHarness, resetDatabase, type Harness } from './harness';

/**
 * The hand-written half of the checkpoint A3 migration, pinned by name and then
 * attacked with raw SQL.
 *
 * `prisma migrate diff` sees tables, columns, indexes and foreign keys. It does
 * not see CHECK constraints, functions or triggers — so the objects doing the
 * privacy and integrity work here are exactly the ones drift detection would let
 * disappear silently.
 *
 * THE MOST IMPORTANT BLOCK IN THIS FILE IS THE RETENTION ONE. The accepted M9
 * rule is that intake content is ERASED IN PLACE after ninety days and a minimal
 * lifecycle row remains — so the row must refuse DELETE and TRUNCATE like every
 * other historical table here, AND an UPDATE that clears the purgeable columns
 * must succeed. Both halves are asserted, because getting either one wrong is
 * silent: without the triggers a mistaken predicate destroys history, and
 * without the clearing path the ninety-day promise is unkeepable.
 *
 * Everything here is synthetic.
 */
describe('website request schema objects', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
  });

  async function constraintNames(): Promise<string[]> {
    const rows = await harness.prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE contype = 'c' AND conrelid::regclass::text = 'website_request'
    `;
    return rows.map((row) => row.conname);
  }

  async function triggerNames(): Promise<string[]> {
    const rows = await harness.prisma.$queryRaw<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger
      WHERE NOT tgisinternal AND tgrelid::regclass::text = 'website_request'
    `;
    return rows.map((row) => row.tgname);
  }

  /**
   * Inserts past every service, guard, schema and controller in the
   * application. The question this file asks is not "does the service refuse
   * this?" but "could this row exist at all?".
   */
  function insert(overrides: Record<string, unknown> = {}): Promise<number> {
    const row = {
      id: uuidv7(),
      contact_name: 'سرپرست نمونه',
      contact_mobile: '09120000001',
      child_name: null as string | null,
      child_age_years: 6,
      child_sex: 'UNSPECIFIED',
      preferred_contact_time: null as string | null,
      note: null as string | null,
      consent_given: true,
      consent_version: '2026-08-27',
      submitter_fingerprint: null as string | null,
      dedupe_key: null as string | null,
      purged_at: null as string | null,
      ...overrides,
    };

    return harness.prisma.$executeRaw`
      INSERT INTO website_request (
        id, received_at, contact_name, contact_mobile, requested_service_id,
        child_name, child_age_years, child_sex, preferred_contact_time, note,
        consent_given, consent_version, consent_recorded_at,
        submitter_fingerprint, dedupe_key, purged_at
      ) VALUES (
        ${row.id}::uuid, transaction_timestamp(),
        ${row.contact_name}, ${row.contact_mobile}, NULL,
        ${row.child_name}, ${row.child_age_years}, ${row.child_sex}::child_sex,
        ${row.preferred_contact_time}::website_request_contact_time, ${row.note},
        ${row.consent_given}, ${row.consent_version}, transaction_timestamp(),
        ${row.submitter_fingerprint}, ${row.dedupe_key}, ${row.purged_at}::timestamptz
      )
    `;
  }

  describe('the inventory', () => {
    it('keeps every hand-written CHECK', async () => {
      const names = await constraintNames();

      for (const expected of [
        'website_request_contact_name_chk',
        'website_request_contact_mobile_chk',
        'website_request_child_name_chk',
        'website_request_child_age_chk',
        'website_request_note_chk',
        'website_request_consent_chk',
        'website_request_submitter_fingerprint_chk',
        'website_request_dedupe_key_chk',
        'website_request_purge_chk',
      ]) {
        expect(names).toContain(expected);
      }
    });

    it('keeps the immutability and append-only triggers', async () => {
      const names = await triggerNames();

      expect(names).toContain('website_request_immutable');
      expect(names).toContain('website_request_no_delete');
      expect(names).toContain('website_request_no_truncate');
    });

    it('keeps the two abuse-control indexes', async () => {
      const rows = await harness.prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes WHERE tablename = 'website_request'
      `;
      const names = rows.map((row) => row.indexname);

      expect(names).toContain('website_request_submitter_fingerprint_received_at_idx');
      expect(names).toContain('website_request_dedupe_key_received_at_idx');
    });
  });

  describe('the row survives, and the content does not', () => {
    // THE ACCEPTED M9 RETENTION MODEL, PINNED IN BOTH DIRECTIONS.
    //
    // The clinic promised the submitter it would not keep their NAME, their
    // TELEPHONE NUMBER and what they wrote. It did not promise to forget that a
    // request arrived. So the erasure is an UPDATE that clears the intake
    // columns, and the row itself is protected exactly as every other historical
    // table in this schema is.

    it('refuses a physical DELETE', async () => {
      await insert();

      await expect(
        harness.prisma
          .$executeRaw`DELETE FROM website_request WHERE contact_mobile = '09120000001'`,
      ).rejects.toThrow();

      const rows = await harness.prisma.$queryRaw<{ live: bigint }[]>`
        SELECT count(*) AS live FROM website_request
      `;
      expect(Number(rows[0]?.live ?? 0n)).toBe(1);
    });

    it('refuses a TRUNCATE', async () => {
      // Not optional, for the reason `audit_log`'s is not: TRUNCATE bypasses
      // row-level triggers entirely, so without this the DELETE guarantee above
      // would be one statement away from gone.
      await insert();

      await expect(harness.prisma.$executeRawUnsafe('TRUNCATE website_request')).rejects.toThrow();
    });

    it('uses the shared append-only function rather than a private one', async () => {
      const rows = await harness.prisma.$queryRaw<{ tgname: string }[]>`
        SELECT tgname FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgrelid::regclass::text = 'website_request'
          AND tgfoid = 'raise_append_only_violation'::regproc
        ORDER BY tgname
      `;

      expect(rows.map((row) => row.tgname)).toEqual([
        'website_request_no_delete',
        'website_request_no_truncate',
      ]);
    });

    it('lets the retention erasure clear every purgeable column in one UPDATE', async () => {
      // THIS IS THE STATEMENT A4's RETENTION RUN WILL MAKE. Nothing in A3 issues
      // it; this asserts that the table permits it, which is what A3 owes.
      await insert({
        child_name: 'کودک نمونه',
        preferred_contact_time: 'EVENING',
        note: 'متن نمونه.',
        submitter_fingerprint: 'a'.repeat(64),
        dedupe_key: 'b'.repeat(64),
      });

      const purged = await harness.prisma.$executeRaw`
        UPDATE website_request SET
          contact_name = NULL,
          contact_mobile = NULL,
          requested_service_id = NULL,
          child_name = NULL,
          child_age_years = NULL,
          child_sex = NULL,
          preferred_contact_time = NULL,
          note = NULL,
          submitter_fingerprint = NULL,
          dedupe_key = NULL,
          purged_at = transaction_timestamp()
        WHERE TRUE
      `;
      expect(purged).toBe(1);

      const rows = await harness.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT * FROM website_request
      `;
      const row = rows[0];

      // WHAT IS LEFT IS THE MINIMAL LIFECYCLE ROW: the id, the arrival, the
      // consent evidence, and the erasure's own instant. Nothing that says
      // anything about anybody.
      expect(row?.['id']).toBeTruthy();
      expect(row?.['received_at']).toBeTruthy();
      expect(row?.['consent_given']).toBe(true);
      expect(row?.['consent_version']).toBe('2026-08-27');
      expect(row?.['purged_at']).toBeTruthy();

      for (const column of [
        'contact_name',
        'contact_mobile',
        'requested_service_id',
        'child_name',
        'child_age_years',
        'child_sex',
        'preferred_contact_time',
        'note',
        'submitter_fingerprint',
        'dedupe_key',
      ]) {
        expect(row?.[column]).toBeNull();
      }
    });

    it('refuses a HALF-erased row, which is the failure that would look like success', async () => {
      await insert();

      // A retention run that cleared the name and left the telephone number.
      await expect(
        harness.prisma.$executeRaw`
          UPDATE website_request
          SET contact_name = NULL, purged_at = transaction_timestamp()
          WHERE TRUE
        `,
      ).rejects.toThrow();
    });

    it('refuses a live row with no content, and an erased row that still holds some', async () => {
      // `website_request_purge_chk`, from both sides. While `purged_at` is NULL
      // the four required columns are present — which is what keeps "required
      // means required" a database guarantee even though every intake column is
      // nullable.
      await expect(insert({ contact_name: null })).rejects.toThrow();
      await expect(insert({ contact_mobile: null })).rejects.toThrow();
      await expect(insert({ child_age_years: null })).rejects.toThrow();
      await expect(insert({ child_sex: null })).rejects.toThrow();

      await expect(
        insert({ purged_at: new Date().toISOString(), note: 'متن باقی‌مانده' }),
      ).rejects.toThrow();
    });

    it('writes the erasure instant once and never rewrites or clears it', async () => {
      // An erasure that could be un-declared would let the row claim the content
      // is still held when it is gone.
      await insert();
      await harness.prisma.$executeRaw`
        UPDATE website_request SET
          contact_name = NULL, contact_mobile = NULL, child_age_years = NULL,
          child_sex = NULL, purged_at = transaction_timestamp()
        WHERE TRUE
      `;

      await expect(
        harness.prisma.$executeRaw`UPDATE website_request SET purged_at = NULL WHERE TRUE`,
      ).rejects.toThrow();
      await expect(
        harness.prisma.$executeRaw`
          UPDATE website_request SET purged_at = transaction_timestamp() - interval '1 day'
          WHERE TRUE
        `,
      ).rejects.toThrow();
    });

    it('refuses to write content back into an erased row', async () => {
      await insert();
      await harness.prisma.$executeRaw`
        UPDATE website_request SET
          contact_name = NULL, contact_mobile = NULL, child_age_years = NULL,
          child_sex = NULL, purged_at = transaction_timestamp()
        WHERE TRUE
      `;

      await expect(
        harness.prisma.$executeRaw`UPDATE website_request SET contact_name = 'نام تازه' WHERE TRUE`,
      ).rejects.toThrow();
    });
  });

  describe('a request records what was said, and is never edited', () => {
    it('refuses to rewrite any intake or consent column', async () => {
      await insert();

      for (const statement of [
        harness.prisma.$executeRaw`UPDATE website_request SET contact_name = 'نام دیگر' WHERE TRUE`,
        harness.prisma
          .$executeRaw`UPDATE website_request SET contact_mobile = '09120000009' WHERE TRUE`,
        harness.prisma.$executeRaw`UPDATE website_request SET child_age_years = 9 WHERE TRUE`,
        harness.prisma
          .$executeRaw`UPDATE website_request SET child_sex = 'MALE'::child_sex WHERE TRUE`,
        harness.prisma.$executeRaw`UPDATE website_request SET note = 'متن دیگر' WHERE TRUE`,
        harness.prisma.$executeRaw`UPDATE website_request SET consent_given = FALSE WHERE TRUE`,
        harness.prisma.$executeRaw`UPDATE website_request SET consent_version = 'other' WHERE TRUE`,
        harness.prisma
          .$executeRaw`UPDATE website_request SET received_at = now() - interval '1 year' WHERE TRUE`,
      ]) {
        await expect(statement).rejects.toThrow();
      }
    });

    it('permits the abuse-control identifiers to be CLEARED and never rewritten', async () => {
      // They age out long before the request does, so a cleanup narrower than
      // the ninety-day erasure has to be able to null them on their own.
      // Rewriting one would be a way to move a request between submitters, so it
      // is refused.
      const fingerprint = 'a'.repeat(64);
      await insert({ submitter_fingerprint: fingerprint, dedupe_key: 'b'.repeat(64) });

      const cleared = await harness.prisma.$executeRaw`
        UPDATE website_request SET submitter_fingerprint = NULL, dedupe_key = NULL WHERE TRUE
      `;
      expect(cleared).toBe(1);

      await insert({ contact_mobile: '09120000002', submitter_fingerprint: fingerprint });
      await expect(
        harness.prisma.$executeRaw`
          UPDATE website_request SET submitter_fingerprint = ${'c'.repeat(64)}
          WHERE contact_mobile = '09120000002'
        `,
      ).rejects.toThrow();
    });
  });

  describe('the consent evidence cannot be faked at the database either', () => {
    it('refuses a row that records no consent', async () => {
      await expect(insert({ consent_given: false })).rejects.toThrow();
    });

    it('refuses a row with an empty or untrimmed consent version', async () => {
      await expect(insert({ consent_version: '' })).rejects.toThrow();
      await expect(insert({ consent_version: ' 2026-08-27 ' })).rejects.toThrow();
    });
  });

  describe('the abuse-control columns cannot hold a raw value', () => {
    it('refuses an IP address or a mobile number in either column', async () => {
      // The shape check is what stops a hand-written INSERT, a data fix or a
      // future service that forgot which value it was holding from writing the
      // very thing these columns exist not to hold.
      await expect(insert({ submitter_fingerprint: '203.0.113.10' })).rejects.toThrow();
      await expect(insert({ dedupe_key: '09120000001' })).rejects.toThrow();
      await expect(insert({ submitter_fingerprint: 'A'.repeat(64) })).rejects.toThrow();
      await expect(insert({ dedupe_key: 'a'.repeat(63) })).rejects.toThrow();
    });
  });

  describe('the intake columns', () => {
    it('refuses markup, untrimmed and empty text', async () => {
      await expect(insert({ contact_name: '<b>x</b>' })).rejects.toThrow();
      await expect(insert({ contact_name: ' نام ' })).rejects.toThrow();
      await expect(insert({ contact_name: '' })).rejects.toThrow();
      await expect(insert({ note: '<script>' })).rejects.toThrow();
      await expect(insert({ child_name: '' })).rejects.toThrow();
    });

    it('refuses a mobile number that is not in the canonical national form', async () => {
      await expect(insert({ contact_mobile: '+989120000001' })).rejects.toThrow();
      await expect(insert({ contact_mobile: '0812000000' })).rejects.toThrow();
    });

    it('accepts every value of the existing child-sex vocabulary and nothing else', async () => {
      expect([...CHILD_SEXES].sort()).toEqual(['FEMALE', 'MALE', 'UNSPECIFIED']);

      for (const [index, childSex] of CHILD_SEXES.entries()) {
        await expect(
          insert({ child_sex: childSex, contact_mobile: `0912000100${index}` }),
        ).resolves.toBe(1);
      }
    });

    it('bounds the age broadly and refuses only what is not an age', async () => {
      // A SANITY BOUND, NOT AN ELIGIBILITY RULE. Every value a person could
      // actually be is accepted here; the clinic decides who it can help in a
      // conversation, not in a CHECK constraint.
      for (const [index, age] of [0, 17, 18, 65, 120].entries()) {
        await expect(
          insert({ child_age_years: age, contact_mobile: `0912000200${index}` }),
        ).resolves.toBe(1);
      }

      await expect(insert({ child_age_years: -1 })).rejects.toThrow();
      await expect(insert({ child_age_years: 121 })).rejects.toThrow();
    });
  });

  describe('a request names no family and no child record', () => {
    it('has no column through which one could', async () => {
      // Structural rather than a rule somebody remembers. The conversion path
      // A4 owns will add its link deliberately.
      const rows = await harness.prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'website_request'
      `;
      const columns = rows.map((row) => row.column_name);

      expect(columns).not.toContain('family_id');
      expect(columns).not.toContain('child_id');
      expect(columns).not.toContain('guardian_id');
      expect(columns).not.toContain('appointment_id');
      // And no raw client metadata of any kind.
      expect(columns).not.toContain('ip');
      expect(columns).not.toContain('client_ip');
      expect(columns).not.toContain('user_agent');
    });
  });
});
