-- Milestone 10, checkpoint A2 — WHAT A BACKUP CLAIMS, AND WHAT A RESTORE MUST MATCH.
--
-- Included by backup.sql (inside the snapshot pg_dump reads) and by verify.sh
-- (against a restored database), so both sides are computed by the same text.
-- Requires psql variables tables_file, sequences_file, schema_file and
-- media_file.
--
-- A table's checksum is the md5 of its rows' md5s in byte order: independent
-- of physical row order, sensitive to every column of every row. Row text
-- depends on TimeZone, DateStyle, IntervalStyle and extra_float_digits, so
-- lib.sh pins all four for every psql and pg_dump it starts.
--
-- `_prisma_migrations` is included on purpose: the migration history is part of
-- what has to come back.

\pset format unaligned
\pset tuples_only on
\pset fieldsep '|'
\pset footer off

\o :tables_file
SELECT format(
  'SELECT %L, count(*), md5(coalesce(string_agg(md5(t::text), %L ORDER BY md5(t::text) COLLATE "C"), %L)) FROM %I.%I AS t',
  c.relname, '', '', n.nspname, c.relname
)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname COLLATE "C"
\gexec

\o :sequences_file
SELECT format('SELECT %L, last_value, is_called FROM %I.%I', c.relname, n.nspname, c.relname)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'S'
ORDER BY c.relname COLLATE "C"
\gexec

-- The protections, as catalogue facts rather than as pg_dump text: PostgreSQL
-- re-parses a restored CHECK and prints it with different parentheses, so text
-- would differ where nothing does. Every trigger with its enabled state, every
-- constraint, index and function (body digest, volatility, pinned settings),
-- and every privilege held by anybody but a table's owner. Owners and grantors
-- are left out on purpose: a restore is owned by whoever restores it.
\o :schema_file
SELECT kind || '|' || detail
FROM (
  SELECT 'trigger' AS kind, format('%s|%s|%s|%s', c.relname, t.tgname, t.tgenabled, p.proname) AS detail
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_proc p ON p.oid = t.tgfoid
  WHERE n.nspname = 'public' AND NOT t.tgisinternal
  UNION ALL
  SELECT 'constraint', format('%s|%s|%s|%s', c.relname, k.conname, k.contype, k.convalidated)
  FROM pg_constraint k
  JOIN pg_class c ON c.oid = k.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
  UNION ALL
  SELECT 'index', format('%s|%s|%s', c.relname, i.relname, x.indisunique)
  FROM pg_index x
  JOIN pg_class i ON i.oid = x.indexrelid
  JOIN pg_class c ON c.oid = x.indrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
  UNION ALL
  SELECT 'function', format('%s(%s)|%s|%s|%s|%s',
    p.proname, pg_get_function_identity_arguments(p.oid), p.provolatile, p.prosecdef,
    coalesce(array_to_string(p.proconfig, ','), ''), md5(p.prosrc))
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  UNION ALL
  SELECT 'grant', format('%s|%s|%s',
    c.relname, CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, a.privilege_type)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(c.relacl) a
  WHERE n.nspname = 'public' AND a.grantee <> c.relowner
  UNION ALL
  SELECT 'schema-grant', format('%s|%s|%s',
    n.nspname, CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, a.privilege_type)
  FROM pg_namespace n
  CROSS JOIN LATERAL aclexplode(n.nspacl) a
  WHERE n.nspname = 'public' AND a.grantee <> n.nspowner
) facts
ORDER BY kind || '|' || detail COLLATE "C";

-- Every stored file a row refers to, in `sha256sum --check` format. A purged
-- file (bytes_purged_at set, key NULL) is not referred to and is not listed.
\o :media_file
SELECT hash || '  ' || storage_key
FROM (
  SELECT master_content_hash AS hash, master_storage_key AS storage_key
  FROM media_asset
  WHERE master_storage_key IS NOT NULL
  UNION ALL
  SELECT content_hash, storage_key
  FROM media_rendition
  WHERE storage_key IS NOT NULL
) referenced
ORDER BY storage_key COLLATE "C";

\o
