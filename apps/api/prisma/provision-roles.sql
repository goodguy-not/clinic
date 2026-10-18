-- Milestone 10, checkpoint A1 — the two database roles, provisioned ONCE per
-- cluster and database by an administrator, BEFORE the first migration.
--
-- NOT A MIGRATION, deliberately. Roles are cluster-wide, carry passwords, and
-- are created by whoever administers PostgreSQL — not by the schema owner, which
-- holds no CREATEROLE. Migrations grant object privileges TO `clinic_runtime`
-- (20260925120000_m10_a1_runtime_role) and refuse to run if it does not exist.
--
-- Run with psql as a superuser or a CREATEROLE administrator:
--
--   psql -v database=<db> -v runtime_password=<secret> [-v owner_password=<secret>] \
--        -f provision-roles.sql
--
-- Passwords arrive as psql variables and are quoted with %L, so they are never
-- written into this file, a migration or the repository. Re-running is safe:
-- existing roles keep their identity and only have their password and
-- attributes re-asserted.
--
-- WHAT IT CREATES
--
--   clinic_owner    LOGIN, NOSUPERUSER. Owns the database and therefore every
--                   object the migrations create. Used ONLY by
--                   `prisma migrate deploy` (and, in tests, by the reset that
--                   truncates between tests). Created only when
--                   `owner_password` is given; an existing development database
--                   whose objects are already owned by another role keeps that
--                   role as its owner.
--   clinic_runtime  NOLOGIN. Holds exactly the table privileges the migrations
--                   grant it, and nothing else. No password, cannot sign in.
--   clinic_app      LOGIN, member of clinic_runtime. What the API server and
--                   the operator CLI connect as.
--   clinic_backup   LOGIN, member of pg_read_all_data and nothing else; every
--                   session read-only by default. What scripts/backup/backup.sh
--                   connects as (Milestone 10, checkpoint A2). Created only when
--                   `backup_password` is given. Granting a predefined role needs
--                   a superuser, or an administrator holding pg_read_all_data
--                   WITH ADMIN OPTION.

\set ON_ERROR_STOP on

\if :{?database}
\else
  \echo 'provision-roles.sql: -v database=<name> is required'
  \quit
\endif

\if :{?runtime_password}
\else
  \echo 'provision-roles.sql: -v runtime_password=<secret> is required'
  \quit
\endif

-- The owner, when this run is also creating the database.
\if :{?owner_password}
  SELECT format('CREATE ROLE clinic_owner LOGIN PASSWORD %L', :'owner_password')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clinic_owner') \gexec

  SELECT format(
    'ALTER ROLE clinic_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION '
    'NOBYPASSRLS PASSWORD %L',
    :'owner_password'
  ) \gexec

  SELECT format('CREATE DATABASE %I OWNER clinic_owner', :'database')
  WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'database') \gexec
\endif

-- The privilege holder. NOLOGIN, so it has no password to leak.
SELECT 'CREATE ROLE clinic_runtime NOLOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clinic_runtime') \gexec

ALTER ROLE clinic_runtime
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- The login the API and CLI use.
SELECT format('CREATE ROLE clinic_app LOGIN PASSWORD %L', :'runtime_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clinic_app') \gexec

SELECT format(
  'ALTER ROLE clinic_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION '
  'NOBYPASSRLS INHERIT PASSWORD %L',
  :'runtime_password'
) \gexec

GRANT clinic_runtime TO clinic_app;

-- Nobody but the owner and the runtime connects, and nobody but the owner
-- creates schemas or temporary tables. CONNECT is granted to the group so a
-- second login (a separately attributable CLI login, say) needs only
-- `GRANT clinic_runtime`.
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'database') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO clinic_runtime', :'database') \gexec

-- Milestone 10, checkpoint A2 — the backup login. READS EVERYTHING, WRITES
-- NOTHING, OWNS NOTHING. pg_read_all_data rather than per-table grants, so a
-- table added by a later migration is in the next backup without anybody
-- remembering to grant it; it confers SELECT and schema USAGE only, never
-- INSERT, UPDATE, DELETE, TRUNCATE or DDL. CONNECT is granted on this database,
-- whose PUBLIC CONNECT is revoked above. backup.sh refuses anything broader.
\if :{?backup_password}
  SELECT format('CREATE ROLE clinic_backup LOGIN PASSWORD %L', :'backup_password')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clinic_backup') \gexec

  SELECT format(
    'ALTER ROLE clinic_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION '
    'NOBYPASSRLS INHERIT PASSWORD %L',
    :'backup_password'
  ) \gexec

  ALTER ROLE clinic_backup SET default_transaction_read_only = on;
  GRANT pg_read_all_data TO clinic_backup;
  SELECT format('GRANT CONNECT ON DATABASE %I TO clinic_backup', :'database') \gexec
\endif
