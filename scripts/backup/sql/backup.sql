-- Milestone 10, checkpoint A2 — ONE SNAPSHOT, READ TWICE.
--
-- Run by backup.sh, never by hand. It takes the files lock, opens one
-- REPEATABLE READ transaction,
-- exports its snapshot, runs pg_dump INSIDE that snapshot (`\!`), then writes
-- the manifest from the same snapshot. So the row counts, the checksums and the
-- list of media files the rows refer to describe exactly the database that is
-- in the dump — not the database a moment later.
--
-- Requires psql 16 or later (SHELL_ERROR). Variables: meta_file, tables_file,
-- sequences_file, schema_file, media_file. Environment: BACKUP_DATABASE_URL and
-- CLINIC_BACKUP_DUMP_FILE, read by the pg_dump that `\!` starts.

\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on
\pset footer off

-- --- least privilege, refused rather than assumed ---------------------------
--
-- The backup login must be able to read everything and change nothing. A
-- connection that could write, own, create or become the owner or the runtime
-- is refused before anything is read.
SELECT format(
  $raise$DO $body$ BEGIN RAISE EXCEPTION %L USING HINT = %L; END $body$$raise$,
  format(
    'BACKUP_DATABASE_URL connects as %s, which is not a least-privilege backup role: %s',
    current_user,
    string_agg(problem, '; ')
  ),
  'Connect as clinic_backup (README, Backup and restore). Provision it with provision-roles.sql -v backup_password=...'
)
FROM (
  SELECT 'it is a superuser' AS problem
  FROM pg_roles WHERE rolname = current_user AND rolsuper
  UNION ALL
  SELECT 'it may create roles or databases, replicate or bypass row security'
  FROM pg_roles
  WHERE rolname = current_user AND (rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)
  UNION ALL
  SELECT 'it owns the database'
  FROM pg_database WHERE datname = current_database() AND pg_has_role(datdba, 'MEMBER')
  UNION ALL
  SELECT format('it can become %s', rolname)
  FROM pg_roles
  WHERE rolname IN ('clinic_owner', 'clinic_runtime') AND pg_has_role(current_user, oid, 'MEMBER')
  UNION ALL
  SELECT format('it owns %s object(s) in public', count(*))
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND pg_has_role(c.relowner, 'MEMBER')
  HAVING count(*) > 0
  UNION ALL
  SELECT format('it may write to %s table(s)', count(*))
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
    AND has_table_privilege(c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  HAVING count(*) > 0
  UNION ALL
  SELECT 'it may create objects in schema public'
  WHERE has_schema_privilege('public', 'CREATE')
  UNION ALL
  SELECT 'it may create temporary tables'
  WHERE has_database_privilege(current_database(), 'TEMPORARY')
) problems
HAVING count(*) > 0
\gexec

-- --- the files lock (Milestone 10, checkpoint A3) ----------------------------
--
-- SHARED, SESSION-LEVEL, TAKEN BEFORE THE SNAPSHOT AND HELD UNTIL THIS SESSION
-- ENDS — after copy-media.sh below has copied the last file. A media erasure
-- takes the same lock EXCLUSIVELY before it changes a row
-- (MEDIA_FILES_LOCK, apps/api/src/media/media-erasure.service.ts), so none can
-- commit while this backup could still need the files its snapshot names. If
-- an erasure is committing right now, this waits the few milliseconds it takes.
-- The two-key form is a lock space nothing else in the application uses.
SELECT pg_advisory_lock_shared(4919, 10) \gset

-- --- the snapshot ------------------------------------------------------------
BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY;

SELECT pg_export_snapshot() AS snapshot \gset
\setenv CLINIC_BACKUP_SNAPSHOT :snapshot

\! pg_dump --snapshot="$CLINIC_BACKUP_SNAPSHOT" --format=custom --dbname="$BACKUP_DATABASE_URL" --file="$CLINIC_BACKUP_DUMP_FILE"
\if :SHELL_ERROR
  DO $$ BEGIN RAISE EXCEPTION 'pg_dump failed; see its message above. Nothing was written to the destination.'; END $$;
\endif

\ir manifest.sql

\o :meta_file
SELECT 'format|clinic-backup/1'
UNION ALL SELECT 'snapshot_taken_at|' || to_char(transaction_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
UNION ALL SELECT 'database|' || current_database()
UNION ALL SELECT 'server_version|' || current_setting('server_version')
UNION ALL SELECT 'backup_role|' || current_user
UNION ALL SELECT 'migrations_applied|' || count(*)
  FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
UNION ALL SELECT 'latest_migration|' || coalesce(max(migration_name), '')
  FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
\o

COMMIT;

-- --- the media, still under the files lock ----------------------------------
\! bash "$CLINIC_BACKUP_COPY_MEDIA"
\if :SHELL_ERROR
  DO $$ BEGIN RAISE EXCEPTION 'the media could not be copied; see the message above. Nothing was written to the destination.'; END $$;
\endif
