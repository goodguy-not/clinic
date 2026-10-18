import { Prisma } from '@prisma/client';
import { AuditService } from '../src/audit/audit.service';
import { uuidv7 } from '../src/common/uuid';
import { createHarness, ownerPrisma, resetDatabase, seedUser, type Harness } from './harness';

/**
 * Milestone 10, checkpoint A1 — the runtime role, proved from the runtime role.
 *
 * Every statement here runs on `harness.prisma`: the API's own connection, as
 * `clinic_app`. Two things are pinned. The EXACT privilege matrix of
 * `clinic_runtime` — so a table added without a decision, or a grant widened in
 * passing, fails CI — and the REFUSALS that are the point of the matrix: no
 * DDL, no TRUNCATE, no switching a trigger or constraint off, no path to the
 * owner, and no write the domain forbids.
 *
 * The triggers are proved separately, as the owner, in each table's own schema
 * suite. Here the question is only what the runtime can reach.
 */

type Privilege = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';

const SI: Privilege[] = ['SELECT', 'INSERT'];
const SU: Privilege[] = ['SELECT', 'UPDATE'];
const SID: Privilege[] = ['SELECT', 'INSERT', 'DELETE'];
const SIU: Privilege[] = ['SELECT', 'INSERT', 'UPDATE'];
const SIUD: Privilege[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];

/**
 * The accepted matrix (migration 20260925120000_m10_a1_runtime_role). A new
 * table belongs here in the same change that creates it, with its reason.
 */
const EXPECTED_TABLE_PRIVILEGES: Record<string, Privilege[]> = {
  // Append-only: written once, never changed, never removed.
  audit_log: SI,
  settlement_period: SI,
  settlement_line: SI,

  // Structure created by migrations, edited in place, never inserted.
  clinic_public_profile: SU,
  clinic_content_entry: SU,
  // Milestone 10, checkpoint A3. One row per nightly job, created by the
  // migration; the runtime moves `last_succeeded_at` and nothing else.
  scheduled_job: SU,

  // Current configuration, replaced by delete-and-insert.
  therapist_service: SID,
  room_service: SID,
  service_duration: SID,
  therapist_availability: SID,
  therapist_availability_exception: SID,
  guardian: SID,

  // Transient workflow state, consumed and physically removed.
  registration_draft: SIUD,

  // Milestone 10, checkpoint A3. Prunable once long over — and ONLY then:
  // `user_session_prune_only_ended` refuses any other DELETE.
  user_session: SIUD,

  // Records with a lifecycle; historical columns guarded by their own triggers.
  app_user: SIU,
  therapist: SIU,
  service: SIU,
  room: SIU,
  tariff: SIU,
  family: SIU,
  child: SIU,
  // UPDATE only for `SELECT ... FOR UPDATE`; nothing changes a series row.
  appointment_series: SIU,
  appointment: SIU,
  appointment_participant: SIU,
  session_charge: SIU,
  charge_adjustment: SIU,
  payment: SIU,
  payment_promise: SIU,
  therapist_share_rule: SIU,
  session_settlement: SIU,
  public_article: SIU,
  public_testimonial: SIU,
  public_space: SIU,
  website_request: SIU,
  media_asset: SIU,
  media_attachment: SIU,
  // Milestone 10, checkpoint A3. Append-only but for the erasure of a
  // photograph that is due: `media_rendition_erasure_only` refuses every other
  // UPDATE, for the runtime and the owner alike.
  media_rendition: SIU,
};

/** Every table whose rows are history: the runtime may never remove one. */
const HISTORICAL_TABLES = Object.entries(EXPECTED_TABLE_PRIVILEGES)
  .filter(([, privileges]) => !privileges.includes('DELETE'))
  .map(([table]) => table);

const ALL_PRIVILEGES = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
] as const;

/** SQLSTATE 42501, insufficient_privilege: "permission denied" and "must be owner". */
async function expectRefused(harness: Harness, sql: string): Promise<void> {
  await expect(harness.prisma.$executeRawUnsafe(sql)).rejects.toMatchObject({
    meta: { code: '42501' },
  });
}

describe('runtime database role (real PostgreSQL)', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  describe('who the API is', () => {
    it('connects as a login that holds no cluster attribute and belongs only to clinic_runtime', async () => {
      const [role] = await harness.prisma.$queryRaw<
        {
          name: string;
          superuser: boolean;
          createrole: boolean;
          createdb: boolean;
          replication: boolean;
          bypassrls: boolean;
          memberships: string[];
        }[]
      >`
        SELECT r.rolname::text AS name, r.rolsuper AS superuser, r.rolcreaterole AS createrole,
               r.rolcreatedb AS createdb, r.rolreplication AS replication,
               r.rolbypassrls AS bypassrls,
               ARRAY(
                 SELECT g.rolname::text FROM pg_auth_members m
                 JOIN pg_roles g ON g.oid = m.roleid
                 WHERE m.member = r.oid ORDER BY 1
               ) AS memberships
        FROM pg_roles r WHERE r.rolname = current_user
      `;

      expect(role).toEqual({
        name: expect.any(String),
        superuser: false,
        createrole: false,
        createdb: false,
        replication: false,
        bypassrls: false,
        memberships: ['clinic_runtime'],
      });
    });

    it('is not the owner of anything, and cannot become whoever is', async () => {
      const rows = await harness.prisma.$queryRaw<{ owner: string; can_become: boolean }[]>`
        SELECT DISTINCT pg_get_userbyid(c.relowner) AS owner,
               pg_has_role(current_user, c.relowner, 'MEMBER') AS can_become
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
      `;

      expect(rows.length).toBeGreaterThan(0);

      for (const row of rows) {
        expect(row.can_become).toBe(false);
        await expectRefused(harness, `SET ROLE "${row.owner}"`);
      }
    });

    it('cannot grant itself a cluster attribute', async () => {
      await expectRefused(harness, 'ALTER ROLE clinic_runtime SUPERUSER');
      await expectRefused(harness, 'ALTER ROLE CURRENT_USER BYPASSRLS');
      await expectRefused(harness, 'GRANT pg_write_server_files TO CURRENT_USER');
    });
  });

  describe('the privilege matrix', () => {
    it('grants clinic_runtime exactly the accepted privileges on every table, and none on the migration history', async () => {
      const tables = await harness.prisma.$queryRaw<{ table: string; privileges: string[] }[]>`
        SELECT c.relname::text AS table,
               ARRAY(
                 SELECT p FROM unnest(${[...ALL_PRIVILEGES]}::text[]) AS p
                 WHERE has_table_privilege('clinic_runtime', c.oid, p)
               ) AS privileges
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
        ORDER BY 1
      `;

      const actual = Object.fromEntries(tables.map((row) => [row.table, row.privileges]));

      expect(actual).toEqual({ ...EXPECTED_TABLE_PRIVILEGES, _prisma_migrations: [] });
    });

    it('holds USAGE, and only USAGE, on the one sequence', async () => {
      const sequences = await harness.prisma.$queryRaw<
        { sequence: string; usage: boolean; select: boolean; update: boolean }[]
      >`
        SELECT c.relname::text AS sequence,
               has_sequence_privilege('clinic_runtime', c.oid, 'USAGE') AS usage,
               has_sequence_privilege('clinic_runtime', c.oid, 'SELECT') AS select,
               has_sequence_privilege('clinic_runtime', c.oid, 'UPDATE') AS update
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'S'
      `;

      expect(sequences).toEqual([
        { sequence: 'child_file_number_seq', usage: true, select: false, update: false },
      ]);
    });

    it('may use the schema but not create in it, nor in the database', async () => {
      const [facts] = await harness.prisma.$queryRaw<
        { usage: boolean; schemaCreate: boolean; databaseCreate: boolean; temp: boolean }[]
      >`
        SELECT has_schema_privilege('public', 'USAGE') AS usage,
               has_schema_privilege('public', 'CREATE') AS "schemaCreate",
               has_database_privilege(current_database(), 'CREATE') AS "databaseCreate",
               has_database_privilege(current_database(), 'TEMPORARY') AS temp
      `;

      expect(facts).toEqual({
        usage: true,
        schemaCreate: false,
        databaseCreate: false,
        temp: false,
      });
    });
  });

  describe('DDL is refused', () => {
    it.each([
      ['CREATE TABLE', 'CREATE TABLE public.intruder (id int)'],
      ['CREATE TEMP TABLE', 'CREATE TEMP TABLE intruder (id int)'],
      ['CREATE SCHEMA', 'CREATE SCHEMA intruder'],
      [
        'CREATE FUNCTION',
        'CREATE FUNCTION public.intruder() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$',
      ],
      [
        'CREATE OR REPLACE a trigger function',
        `CREATE OR REPLACE FUNCTION raise_append_only_violation() RETURNS trigger
           LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$`,
      ],
      ['DROP a trigger function', 'DROP FUNCTION raise_append_only_violation() CASCADE'],
      ['ALTER TABLE ADD COLUMN', 'ALTER TABLE payment ADD COLUMN intruder int'],
      ['ALTER TABLE RENAME', 'ALTER TABLE audit_log RENAME TO audit_log_old'],
      ['COMMENT ON TABLE', "COMMENT ON TABLE audit_log IS 'intruder'"],
      ['DROP TABLE', 'DROP TABLE audit_log'],
      ['DROP TABLE CASCADE', 'DROP TABLE session_charge CASCADE'],
      ['DROP SEQUENCE', 'DROP SEQUENCE child_file_number_seq'],
      ['DROP a migration row', 'DELETE FROM _prisma_migrations'],
      ['read the migration history', 'SELECT 1 FROM _prisma_migrations'],
    ])('refuses %s', async (_label, sql) => {
      await expectRefused(harness, sql);
    });
  });

  it('cannot widen its own grants: GRANT without the grant option changes nothing', async () => {
    // PostgreSQL does not raise here. A GRANT by a role holding no grant option
    // succeeds with the warning "no privileges were granted", so the evidence is
    // that the catalogue is unchanged afterwards, not an error.
    const acl = () => harness.prisma.$queryRaw<{ acl: string | null }[]>`
      SELECT relacl::text AS acl FROM pg_class WHERE oid = 'audit_log'::regclass
    `;
    const before = await acl();

    await harness.prisma.$executeRawUnsafe('GRANT ALL ON audit_log TO PUBLIC');
    await harness.prisma.$executeRawUnsafe('GRANT DELETE, TRUNCATE ON audit_log TO clinic_runtime');

    expect(await acl()).toEqual(before);

    const [after] = await harness.prisma.$queryRaw<{ del: boolean; trunc: boolean }[]>`
      SELECT has_table_privilege('clinic_runtime', 'audit_log', 'DELETE') AS del,
             has_table_privilege('clinic_runtime', 'audit_log', 'TRUNCATE') AS trunc
    `;
    expect(after).toEqual({ del: false, trunc: false });
  });

  describe('TRUNCATE is refused on every table', () => {
    it.each(Object.keys(EXPECTED_TABLE_PRIVILEGES))('refuses TRUNCATE %s', async (table) => {
      await expectRefused(harness, `TRUNCATE ${table} CASCADE`);
    });
  });

  describe('the protections cannot be switched off', () => {
    it('cannot disable any trigger on any table', async () => {
      const tables = await harness.prisma.$queryRaw<{ table: string }[]>`
        SELECT DISTINCT c.relname::text AS table
        FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND NOT t.tgisinternal
        ORDER BY 1
      `;

      expect(tables.length).toBeGreaterThan(20);

      for (const { table } of tables) {
        await expectRefused(harness, `ALTER TABLE ${table} DISABLE TRIGGER USER`);
        await expectRefused(harness, `ALTER TABLE ${table} DISABLE TRIGGER ALL`);
      }
    });

    it('cannot drop any trigger', async () => {
      const triggers = await harness.prisma.$queryRaw<{ table: string; trigger: string }[]>`
        SELECT c.relname::text AS table, t.tgname::text AS trigger
        FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND NOT t.tgisinternal
      `;

      for (const { table, trigger } of triggers) {
        await expectRefused(harness, `DROP TRIGGER "${trigger}" ON ${table}`);
      }
    });

    it('cannot drop or disable any CHECK, unique or foreign-key constraint', async () => {
      const constraints = await harness.prisma.$queryRaw<{ table: string; name: string }[]>`
        SELECT c.relname::text AS table, k.conname::text AS name
        FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND k.contype IN ('c', 'u', 'f', 'x')
      `;

      expect(constraints.length).toBeGreaterThan(50);

      for (const { table, name } of constraints) {
        await expectRefused(harness, `ALTER TABLE ${table} DROP CONSTRAINT "${name}"`);
      }

      await expectRefused(harness, 'ALTER TABLE payment ALTER COLUMN family_id DROP NOT NULL');
    });

    it('cannot turn triggers off for its session', async () => {
      await expectRefused(harness, 'SET session_replication_role = replica');
      await expectRefused(harness, 'SET LOCAL session_replication_role = replica');
    });

    it('cannot rewind the child file-number sequence', async () => {
      await expect(
        harness.prisma.$queryRawUnsafe("SELECT setval('child_file_number_seq', 1)"),
      ).rejects.toMatchObject({ meta: { code: '42501' } });
    });
  });

  describe('writes the domain forbids are refused by privilege', () => {
    it.each(HISTORICAL_TABLES)('refuses DELETE on %s', async (table) => {
      await expectRefused(harness, `DELETE FROM ${table}`);
    });

    it.each(['audit_log', 'settlement_period', 'settlement_line'])(
      'refuses UPDATE on append-only %s',
      async (table) => {
        await expectRefused(harness, `UPDATE ${table} SET id = id`);
      },
    );

    it.each(['clinic_public_profile', 'clinic_content_entry'])(
      'refuses INSERT on migration-created %s',
      async (table) => {
        await expectRefused(harness, `INSERT INTO ${table} DEFAULT VALUES`);
      },
    );

    it('refuses to erase a real audit row, which is still there afterwards', async () => {
      const user = await seedUser(harness);
      const audit = harness.app.get(AuditService);

      await harness.prisma.$transaction((tx) =>
        audit.record(
          tx,
          { actor: { type: 'SYSTEM' }, requestId: uuidv7(), clientIp: null, userAgent: null },
          { action: 'user.status_changed', entityType: 'app_user', entityId: user.id },
        ),
      );

      await expectRefused(harness, 'DELETE FROM audit_log');
      await expectRefused(harness, 'TRUNCATE audit_log');
      await expectRefused(harness, "UPDATE audit_log SET action = 'user.created'");

      expect(await harness.prisma.auditLog.count()).toBe(1);
    });
  });

  describe('a trigger still refuses what the privilege allows', () => {
    it('refuses a DELETE from the owner itself, so the trigger is not redundant', async () => {
      await seedUser(harness);

      await expect(ownerPrisma().$executeRaw(Prisma.sql`DELETE FROM app_user`)).rejects.toThrow(
        /protected|not permitted/i,
      );
    });

    // Milestone 10, checkpoint A3. The two privileges the nightly jobs added,
    // each narrowed by a trigger to the one act the job performs.
    it('refuses to DELETE a session that is still live, though DELETE is granted', async () => {
      const user = await seedUser(harness);
      const issued = await harness.prisma.$transaction((tx) =>
        harness.sessions.createSession(tx, user.id),
      );

      await expect(
        harness.prisma.$executeRaw`DELETE FROM user_session WHERE id = ${issued.sessionId}::uuid`,
      ).rejects.toThrow(/has not been over for thirty days/);

      const left = await harness.prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM user_session
      `;
      expect(left[0]?.n).toBe(1);
    });

    it('refuses every UPDATE of a rendition but an erasure that is due', async () => {
      // No rendition needs to exist for the trigger to be reached: a statement
      // matching none is refused by nobody, so the matching one is built by the
      // media suites. Here: the grant exists, and an ordinary rewrite of an
      // existing row cannot pass the trigger (see media-erasure.int-spec.ts).
      const granted = await harness.prisma.$queryRaw<{ ok: boolean }[]>`
        SELECT has_table_privilege('clinic_runtime', 'media_rendition', 'UPDATE') AS ok
      `;
      expect(granted[0]?.ok).toBe(true);

      const trigger = await harness.prisma.$queryRaw<{ enabled: string }[]>`
        SELECT tgenabled::text AS enabled FROM pg_trigger
        WHERE tgname = 'media_rendition_erasure_only'
          AND tgrelid = 'media_rendition'::regclass
      `;
      expect(trigger[0]?.enabled).toBe('O');
    });
  });
});
