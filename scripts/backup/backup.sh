#!/usr/bin/env bash
# Milestone 10, checkpoint A2 — ONE BACKUP: THE DATABASE AND ITS MEDIA, AS A PAIR.
#
#   scripts/backup/backup.sh
#
# Configuration is environment only; nothing about where, when or how long is
# decided in code (README, Backup and restore):
#
#   BACKUP_DATABASE_URL        the clinic_backup login (read-only). Required.
#   MEDIA_STORAGE_DIR          the API's media root. Required.
#   BACKUP_DESTINATION_DIR     an existing directory the archive is written to.
#   BACKUP_RECIPIENT_KEY_FILE  the OpenPGP PUBLIC key archives are encrypted to.
#   BACKUP_SIGNING_KEY_DIR     a GnuPG home holding exactly one secret key: this
#                              server's SIGNING key. Every archive is signed with
#                              it, and restore refuses one that is not.
#   BACKUP_RETENTION_DAYS      archives in the destination older than this are
#                              removed after a successful backup. Required, no
#                              default: the owner decides it.
#   BACKUP_WORK_DIR            optional; where the plaintext staging directory
#                              is made (default: $TMPDIR or /tmp). Removed on exit.
#
# WHY THE PAIR IS CONSISTENT. The database is read first, in one snapshot, and
# the manifest lists every media file the snapshot's rows refer to. The API
# writes a file (write-then-rename) BEFORE the row that names it commits, so
# every file the snapshot refers to already existed when it was taken. The only
# code that deletes a stored file — the nightly media erasure (Milestone 10,
# A3) — must first take an advisory lock this backup holds SHARED from before
# the snapshot until the last file is copied (backup.sql, copy-media.sh), so
# nothing the snapshot names can disappear while it is being copied, and an
# erasure never breaks a backup. That is then CHECKED, not assumed: each referenced
# file is copied and its SHA-256 compared with the hash in its row, and a
# missing or altered file stops the backup before anything is written.
# Only referenced files are archived; a file no committed row names (a failed or
# in-flight upload) is not part of any restorable state.
#
# WHAT LEAVES THE SERVER is one file, signed by this server and encrypted to
# the owner's public key. The server holds no DECRYPTION key, so it cannot read
# its own backups — nor can anyone who takes them from the destination. It does
# hold its own signing key, and restore refuses any archive that key did not
# sign: a correctly encrypted file planted among the backups is not a backup.

SCRIPT_NAME=backup
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_env BACKUP_DATABASE_URL MEDIA_STORAGE_DIR BACKUP_DESTINATION_DIR \
  BACKUP_RECIPIENT_KEY_FILE BACKUP_RETENTION_DAYS BACKUP_SIGNING_KEY_DIR
require_cmd psql pg_dump gpg tar sha256sum awk

[[ "$BACKUP_RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]] \
  || die "BACKUP_RETENTION_DAYS must be a whole number of days, 1 or more."
[[ -d "$MEDIA_STORAGE_DIR" ]] || die "MEDIA_STORAGE_DIR is not a directory."
# Not created here: a mistyped mount point would otherwise quietly fill the
# server's own disk with backups that never left it.
[[ -d "$BACKUP_DESTINATION_DIR" && -w "$BACKUP_DESTINATION_DIR" ]] \
  || die "BACKUP_DESTINATION_DIR must be an existing, writable directory."
[[ -r "$BACKUP_RECIPIENT_KEY_FILE" ]] || die "BACKUP_RECIPIENT_KEY_FILE is not readable."
[[ -d "$BACKUP_SIGNING_KEY_DIR" ]] || die "BACKUP_SIGNING_KEY_DIR is not a directory."

stage="$(mktemp -d "${BACKUP_WORK_DIR:-${TMPDIR:-/tmp}}/clinic-backup.XXXXXX")"
partial=''
cleanup() {
  rm -rf "$stage"
  [[ -z "$partial" ]] || rm -f "$partial"
}
trap cleanup EXIT
assert_no_space "$stage"
mkdir -p "$stage/manifest" "$stage/media" "$stage/gnupg"

step "Encryption key"
# A throwaway keyring: the operator's own is never read or changed.
fingerprints="$(gpg --homedir "$stage/gnupg" --batch --with-colons --show-keys \
  "$BACKUP_RECIPIENT_KEY_FILE" 2> /dev/null | awk -F: '$1 == "fpr" {print $10; exit}')"
[[ -n "$fingerprints" ]] || die "BACKUP_RECIPIENT_KEY_FILE holds no OpenPGP public key."
gpg --homedir "$stage/gnupg" --batch --with-colons --show-keys "$BACKUP_RECIPIENT_KEY_FILE" \
  2> /dev/null | awk -F: '$1 == "sec" || $1 == "ssb" {found = 1} END {exit !found}' \
  && die "BACKUP_RECIPIENT_KEY_FILE contains a PRIVATE key. Only the public key belongs on the server."
ok "archives are encrypted to key $fingerprints"
signer="$(gpg --homedir "$BACKUP_SIGNING_KEY_DIR" --batch --with-colons --list-secret-keys 2> /dev/null \
  | awk -F: '$1 == "sec" {primary = 1; next} $1 == "fpr" && primary {print $10; primary = 0}')"
signers="$(wc -w <<< "$signer" | tr -d ' ')"
[[ "$signers" == 1 ]] || die "BACKUP_SIGNING_KEY_DIR must hold exactly one secret key (found $signers)."
ok "archives are signed by this server's key $signer"

step "Database snapshot"
check_client_version "$BACKUP_DATABASE_URL"
export BACKUP_DATABASE_URL
export CLINIC_BACKUP_DUMP_FILE="$stage/database.dump"
# The media copy runs INSIDE the psql session below (copy-media.sh), because
# that session holds the files lock a media erasure must take first.
export CLINIC_BACKUP_STAGE="$stage"
export CLINIC_BACKUP_COPY_MEDIA="$BACKUP_LIB_DIR/copy-media.sh"
export MEDIA_STORAGE_DIR
psql_run -d "$BACKUP_DATABASE_URL" \
  -v meta_file="$stage/manifest/meta.txt" \
  -v tables_file="$stage/manifest/tables.txt" \
  -v sequences_file="$stage/manifest/sequences.txt" \
  -v schema_file="$stage/manifest/schema.txt" \
  -v media_file="$stage/manifest/media.sha256" \
  -f "$BACKUP_SQL_DIR/backup.sql" || die "the database or its media could not be read (see above). Nothing was written."
[[ -s "$CLINIC_BACKUP_DUMP_FILE" ]] || die "pg_dump produced no output. Nothing was written."
ok "dumped $(meta_value "$stage" database) as $(meta_value "$stage" backup_role) at $(meta_value "$stage" snapshot_taken_at)"
ok "$(wc -l < "$stage/manifest/tables.txt" | tr -d ' ') tables, $(awk -F'|' '{s += $2} END {print s + 0}' "$stage/manifest/tables.txt") rows, latest migration $(meta_value "$stage" latest_migration)"

media_bytes="$(du -sk "$stage/media" | awk '{print $1}')"

{
  printf 'pg_dump_version|%s\n' "$(pg_dump --version)"
  printf 'recipient_key|%s\n' "$fingerprints"
  printf 'signing_key|%s\n' "$signer"
  printf 'media_files|%s\n' "$(wc -l < "$stage/manifest/media.sha256" | tr -d ' ')"
} >> "$stage/manifest/meta.txt"
printf '%s\n' "$BACKUP_FORMAT" > "$stage/FORMAT"

step "Encrypted archive"
name="clinic-backup-$(date -u +%Y%m%dT%H%M%SZ).tar.gpg"
target="$BACKUP_DESTINATION_DIR/$name"
[[ ! -e "$target" ]] || die "$target already exists."
partial="$target.partial"
tar -C "$stage" -cf - FORMAT manifest database.dump media \
  | gpg --homedir "$BACKUP_SIGNING_KEY_DIR" --batch --yes --quiet --trust-model always \
    --local-user "$signer" --recipient-file "$BACKUP_RECIPIENT_KEY_FILE" --compress-algo none \
    --sign --encrypt --output "$partial" \
  || die "signing or encryption failed. Nothing was written."
# Group-readable, so the collector's login (whose group owns the directory) can
# read — never write — what it collects. The checksum is in place before the
# archive appears under its final name, so a collector listing mid-write sees
# either nothing or both.
printf '%s  %s\n' "$(sha256sum < "$partial" | awk '{print $1}')" "$name" > "$target.sha256"
chmod 0640 "$partial" "$target.sha256"
mv "$partial" "$target"
partial=''
ok "$target ($(du -k "$target" | awk '{print $1}') KiB; media ${media_bytes} KiB before encryption)"

step "Retention: removing archives older than $BACKUP_RETENTION_DAYS day(s)"
cutoff="$(date -u -d "-$BACKUP_RETENTION_DAYS days" +%Y%m%dT%H%M%SZ)"
removed=0
for old in "$BACKUP_DESTINATION_DIR"/clinic-backup-*.tar.gpg; do
  [[ -e "$old" ]] || continue
  stamp="$(basename "$old" .tar.gpg)"
  stamp="${stamp#clinic-backup-}"
  [[ "$stamp" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || continue
  if [[ "$old" != "$target" && "$stamp" < "$cutoff" ]]; then
    rm -f "$old" "$old.sha256"
    removed=$((removed + 1))
    say "  removed $(basename "$old")"
  fi
done
ok "$removed removed"

say ""
say "BACKUP COMPLETE: $target"
