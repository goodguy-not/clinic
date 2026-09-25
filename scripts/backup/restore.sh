#!/usr/bin/env bash
# Milestone 10, checkpoint A2 — RESTORE ONE ARCHIVE INTO AN EMPTY ENVIRONMENT.
#
#   scripts/backup/restore.sh <archive>
#
# Follow README, Backup and restore: roles and an empty database are provisioned
# first with provision-roles.sql, exactly as for a new deployment.
#
#   RESTORE_OWNER_DATABASE_URL    clinic_owner on the new, EMPTY database.
#   RESTORE_RUNTIME_DATABASE_URL  clinic_app on the same database.
#   MEDIA_STORAGE_DIR             the new media root: absent or empty.
#   RESTORE_SIGNER_KEY_FILE       the clinic server's PUBLIC signing key, kept
#                                 off-server; an archive it did not sign is refused.
#   GNUPGHOME                     optional; the keyring holding the private key.
#   RESTORE_WORK_DIR              optional; where the plaintext staging
#                                 directory is made. Removed on exit.
#
# It refuses a database that holds anything and a media directory that holds
# anything, so it cannot merge into or overwrite a live system. It decrypts and
# checks the whole archive BEFORE changing either. The database is restored in
# one transaction: it arrives complete or not at all. Then verify.sh runs.
# Any failure after the database step means: discard this target and start
# again from an empty one.

SCRIPT_NAME=restore
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[[ $# -eq 1 ]] || die "usage: restore.sh <archive>"
archive="$1"
require_env RESTORE_OWNER_DATABASE_URL RESTORE_RUNTIME_DATABASE_URL MEDIA_STORAGE_DIR RESTORE_SIGNER_KEY_FILE
require_cmd psql pg_dump pg_restore gpg tar sha256sum

owner_url="$RESTORE_OWNER_DATABASE_URL"

step "Target"
check_client_version "$owner_url"
problems="$(psql_value "$owner_url" "
SELECT coalesce(string_agg(problem, '; '), '') FROM (
  SELECT 'this login is a superuser; restore as the database owner (clinic_owner)' AS problem
  FROM pg_roles WHERE rolname = current_user AND rolsuper
  UNION ALL
  SELECT format('this login (%s) does not own the database; %s does', current_user, pg_get_userbyid(datdba))
  FROM pg_database WHERE datname = current_database() AND datdba <> (SELECT oid FROM pg_roles WHERE rolname = current_user)
  UNION ALL
  SELECT format('the database is not empty: %s object(s) in schema public', count(*))
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
  HAVING count(*) > 0
  UNION ALL
  SELECT format('the database is not empty: extension %s is installed', extname)
  FROM pg_extension WHERE extname <> 'plpgsql'
  UNION ALL
  SELECT 'role clinic_runtime does not exist; run provision-roles.sql first'
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clinic_runtime')
) p")"
[[ -z "$problems" ]] || die "refusing to restore: $problems."
ok "empty database $(psql_value "$owner_url" 'SELECT current_database()'), owned by $(psql_value "$owner_url" 'SELECT current_user')"
psql_value "$RESTORE_RUNTIME_DATABASE_URL" 'SELECT 1' > /dev/null \
  || die "RESTORE_RUNTIME_DATABASE_URL cannot connect."

if [[ -e "$MEDIA_STORAGE_DIR" ]]; then
  [[ -d "$MEDIA_STORAGE_DIR" ]] || die "MEDIA_STORAGE_DIR exists and is not a directory."
  [[ -z "$(ls -A "$MEDIA_STORAGE_DIR")" ]] || die "refusing to restore: MEDIA_STORAGE_DIR is not empty."
fi
ok "empty media root $MEDIA_STORAGE_DIR"

stage="$(mktemp -d "${RESTORE_WORK_DIR:-${TMPDIR:-/tmp}}/clinic-restore.XXXXXX")"
trap 'rm -rf "$stage"' EXIT

step "Decrypting and checking $archive"
unpack_archive "$archive" "$stage"
content="$stage/content"
say "  backup of $(meta_value "$content" database) taken at $(meta_value "$content" snapshot_taken_at)"
say "  latest migration $(meta_value "$content" latest_migration), $(meta_value "$content" media_files) media file(s)"
check_media_against "$content/media" "$content/manifest/media.sha256" "archived media"

step "Database"
# --no-owner: every object is created by, and therefore owned by, the login
# restoring it — clinic_owner. GRANTs are kept, so clinic_runtime gets back
# exactly the privileges it had. Triggers are created after the data is loaded,
# as pg_dump orders them, so loading history does not trip the no-insert and
# immutability triggers that guard it afterwards.
pg_restore --no-owner --exit-on-error --single-transaction \
  --dbname="$owner_url" "$content/database.dump" \
  || die "pg_restore failed (above). The transaction was rolled back; the database is still empty."
ok "restored in one transaction"

step "Media"
mkdir -p "$MEDIA_STORAGE_DIR"
tar -C "$content/media" -cf - . | tar -C "$MEDIA_STORAGE_DIR" -xf -
ok "copied $(meta_value "$content" media_files) file(s) into $MEDIA_STORAGE_DIR"

say ""
say "Restore complete. Verifying."
CLINIC_RESTORE_STAGE="$content" "$BACKUP_LIB_DIR/verify.sh"
