#!/usr/bin/env bash
# Milestone 10, checkpoint A2 — IS THE RESTORED SYSTEM WHOLE?
#
#   scripts/backup/verify.sh <archive>
#
# Run automatically at the end of restore.sh, and runnable again against the
# same archive UNTIL THE RESTORED SYSTEM TAKES ITS FIRST REQUEST: records are
# compared exactly, and the first sign-in writes audit and session rows. Every
# check compares the restored environment with what the archive says the
# source was; any difference stops with a non-zero exit and names what differs.
#
#   RESTORE_OWNER_DATABASE_URL    clinic_owner on the restored database.
#   RESTORE_RUNTIME_DATABASE_URL  clinic_app on the restored database.
#   MEDIA_STORAGE_DIR             the restored media root.
#   RESTORE_SIGNER_KEY_FILE       the clinic server's PUBLIC signing key, kept
#                                 off-server; an archive it did not sign is refused.
#   GNUPGHOME                     optional; the keyring holding the private key.
#
# The live-site half — published images render, a colleague can sign in — needs
# the API and web running and is scripts/backup/verify-site.mjs.

SCRIPT_NAME=verify
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_env RESTORE_OWNER_DATABASE_URL RESTORE_RUNTIME_DATABASE_URL MEDIA_STORAGE_DIR
require_cmd psql gpg tar sha256sum diff

owner_url="$RESTORE_OWNER_DATABASE_URL"
runtime_url="$RESTORE_RUNTIME_DATABASE_URL"

# restore.sh hands over the archive it already unpacked.
if [[ -n "${CLINIC_RESTORE_STAGE:-}" ]]; then
  stage="$CLINIC_RESTORE_STAGE"
  work="$(mktemp -d "${RESTORE_WORK_DIR:-${TMPDIR:-/tmp}}/clinic-verify.XXXXXX")"
  trap 'rm -rf "$work"' EXIT
else
  [[ $# -eq 1 ]] || die "usage: verify.sh <archive>"
  work="$(mktemp -d "${RESTORE_WORK_DIR:-${TMPDIR:-/tmp}}/clinic-verify.XXXXXX")"
  trap 'rm -rf "$work"' EXIT
  step "Unpacking $1"
  unpack_archive "$1" "$work"
  stage="$work/content"
fi

say ""
say "Backup: $(meta_value "$stage" database) at $(meta_value "$stage" snapshot_taken_at), latest migration $(meta_value "$stage" latest_migration)"

step "1/4 Migrations"
prisma="$REPO_ROOT/apps/api/node_modules/.bin/prisma"
[[ -x "$prisma" ]] || die "prisma CLI not found at $prisma. Run pnpm install for the release that took this backup."
if ! (cd "$REPO_ROOT/apps/api" && DATABASE_URL="$owner_url" "$prisma" migrate status > "$work/migrate-status.txt" 2>&1); then
  cat "$work/migrate-status.txt" >&2
  die "migrations are not in sync with this checkout. Restore with the release whose latest migration is $(meta_value "$stage" latest_migration), verify, and only then upgrade."
fi
grep -q 'Database schema is up to date' "$work/migrate-status.txt" \
  || die "prisma migrate status did not report an up-to-date schema: $(cat "$work/migrate-status.txt")"
ok "prisma migrate status: every migration in this checkout is applied, none failed"
if ! (cd "$REPO_ROOT/apps/api" && DATABASE_URL="$owner_url" "$prisma" migrate diff \
  --from-schema-datamodel prisma/schema.prisma --to-schema-datasource prisma/schema.prisma \
  --exit-code > "$work/migrate-diff.txt" 2>&1); then
  cat "$work/migrate-diff.txt" >&2
  die "the restored schema has drifted from prisma/schema.prisma."
fi
ok "prisma migrate diff: no drift from schema.prisma"

step "2/4 Records, and the schema that protects them"
compare_manifest "$owner_url" "$stage" "$work/restored"

step "3/4 Media files"
# The list comes from the restored database's own rows (compared with the
# backup's above), and every file it names must be on disk with its hash.
[[ -d "$MEDIA_STORAGE_DIR" ]] || die "MEDIA_STORAGE_DIR does not exist."
assert_media_keys_safe "$work/restored/media.sha256"
check_media_against "$MEDIA_STORAGE_DIR" "$work/restored/media.sha256" "restored media root"
# The backup user reads the media through the API's group (README, Setting up
# the server); media only its owner can read would fail the next backup.
private="$(find "$MEDIA_STORAGE_DIR" \( -type d ! -perm -g=rx \) -o \( -type f ! -perm -g=r \) | head -n 5 || true)"
[[ -z "$private" ]] || die "media not readable by its group, so the next backup would fail: $private"
ok "media readable by its group, as the nightly backup needs"

step "4/4 Database protections, exercised (Milestone 10, checkpoint A1)"
problems="$(psql_value "$owner_url" "
SELECT coalesce(string_agg(problem, '; '), '') FROM (
  SELECT format('%s is owned by %s, not the database owner', c.relname, pg_get_userbyid(c.relowner)) AS problem
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_database d ON d.datname = current_database()
  WHERE n.nspname = 'public' AND c.relowner <> d.datdba
  UNION ALL
  SELECT 'the database owner is a superuser' FROM pg_database d JOIN pg_roles r ON r.oid = d.datdba
  WHERE d.datname = current_database() AND r.rolsuper
  UNION ALL
  SELECT 'role clinic_runtime is missing' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clinic_runtime')
  UNION ALL
  SELECT 'clinic_runtime can log in or holds a cluster attribute' FROM pg_roles
  WHERE rolname = 'clinic_runtime'
    AND (rolcanlogin OR rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)
  UNION ALL
  SELECT 'clinic_runtime can become the database owner' FROM pg_database d
  WHERE d.datname = current_database() AND pg_has_role('clinic_runtime', d.datdba, 'MEMBER')
  UNION ALL
  SELECT 'clinic_runtime holds privileges on _prisma_migrations'
  WHERE has_table_privilege('clinic_runtime', '_prisma_migrations', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
) p")"
[[ -z "$problems" ]] || die "role invariants broken: $problems"
ok "every object owned by the non-superuser database owner; clinic_runtime cannot log in, owns nothing, cannot become the owner"

owner_role="$(psql_value "$owner_url" "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()")"
runtime_user="$(psql_value "$runtime_url" "SELECT current_user || '|' || pg_has_role(current_user, 'clinic_runtime', 'MEMBER')")"
[[ "$runtime_user" == *'|true' ]] || die "RESTORE_RUNTIME_DATABASE_URL does not connect as a member of clinic_runtime."
[[ "${runtime_user%|*}" != "$owner_role" ]] || die "RESTORE_RUNTIME_DATABASE_URL connects as the owner."

# Each is attempted from the API's own login inside a transaction that is
# rolled back, and each must be refused by PostgreSQL.
refused() {
  local label="$1" sql="$2" pattern="$3" output
  if output="$(psql_run -d "$runtime_url" -c "BEGIN; $sql; ROLLBACK;" 2>&1)"; then
    die "the runtime login was ALLOWED to $label."
  fi
  grep -Eq "$pattern" <<< "$output" || die "$label failed for an unexpected reason: $output"
  ok "runtime refused: $label"
}
refused 'TRUNCATE the audit log' 'TRUNCATE audit_log' 'permission denied'
refused 'DELETE a payment' 'DELETE FROM payment' 'permission denied'
refused 'DELETE a session charge' 'DELETE FROM session_charge' 'permission denied'
refused 'disable the payment triggers' 'ALTER TABLE payment DISABLE TRIGGER ALL' 'must be owner'
refused 'switch triggers off for the session' 'SET session_replication_role = replica' 'permission denied'
refused "become $owner_role" "SET ROLE $owner_role" 'permission denied'
refused 'create a table' 'CREATE TABLE restore_probe (id int)' 'permission denied'
refused 'rewrite the migration history' 'DELETE FROM _prisma_migrations' 'permission denied'
psql_value "$runtime_url" 'SELECT count(*) FROM audit_log' > /dev/null \
  || die "the runtime login cannot read the audit log."
ok "runtime can read what the API reads"

# The owner holds the privilege, so what refuses it here is the table's own
# trigger — the protection a privilege cannot switch off.
if [[ "$(psql_value "$owner_url" 'SELECT count(*) > 0 FROM audit_log')" == 't' ]]; then
  if output="$(psql_run -d "$owner_url" -c 'BEGIN; DELETE FROM audit_log WHERE id = (SELECT id FROM audit_log LIMIT 1); ROLLBACK;' 2>&1)"; then
    die "the audit log's no-delete trigger did not fire after restore."
  fi
  grep -q 'is protected' <<< "$output" || die "audit-log delete failed for an unexpected reason: $output"
  ok "owner refused by trigger: DELETE from the audit log"
fi

say ""
say "RESTORE VERIFIED: migrations in sync, records and checksums match, triggers, constraints and grants identical, every referenced media file present, protections hold."
