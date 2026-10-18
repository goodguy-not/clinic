#!/usr/bin/env bash
# Milestone 10, checkpoint A8 — RESTORE A BACKUP INTO A NEW DATABASE ON THIS SERVER.
#
#   sudo restore-on-server.sh <archive> <database> <media dir> <owner key file>
#
# docs/DEPLOYMENT_RUNBOOK.md, steps 17 and 18: the trial restore that proves the
# pre-upgrade backup before a migration, and the rollback that restores it. A
# wrapper around scripts/backup/restore.sh (README, Restoring) for a server
# installed by the runbook, so neither needs a password typed or a variable set:
#
# - <database> must not exist. It is created exactly as for a new deployment, by
#   provision-roles.sql, with the passwords already in /etc/clinic re-asserted
#   (nothing is rotated, no environment file changes).
# - <media dir> must not exist. It is created for clinic-api, as the API's own.
# - restore.sh runs as clinic-api, from the LIVE release (/srv/clinic), which
#   must be the release that took the backup: verify.sh refuses any other.
# - <owner key file> is the owner's PRIVATE backup key (gpg --export-secret-keys),
#   brought to the server in memory (/dev/shm, runbook 17.1). It is imported into a
#   keyring made for this run, also in /dev/shm, so neither the key nor the keyring
#   is ever written to the server's disk; both are removed on exit, success or
#   failure. Its passphrase is asked once (read from standard input when that is
#   not a terminal) and handed to that keyring's agent only.
# - The archive's signature is checked against this server's own signing key:
#   the archive was made here minutes or hours ago, by the same key.
#
# It never renames, drops or overwrites anything. Setting the live database and
# media aside for a rollback is the operator's own, separate step.

set -euo pipefail
umask 0027
cd /

die() {
  printf 'restore-on-server: %s\n' "$*" >&2
  exit 1
}

[[ $# -eq 4 ]] || die "usage: restore-on-server.sh <archive> <database> <media dir> <owner key file>"
archive="$1" database="$2" media="$3" owner_key="$4"
[[ $EUID -eq 0 ]] || die "run as root (sudo)."

live=/srv/clinic
etc=/etc/clinic
restore="$live/scripts/backup/restore.sh"
[[ -x "$restore" ]] || die "$restore not found: is /srv/clinic the release that took the backup?"
[[ -f "$archive" ]] || die "no archive at $archive."
[[ -f "$owner_key" ]] || die "no key file at $owner_key."
[[ "$database" =~ ^[a-z_][a-z0-9_]*$ ]] || die "database: lower-case letters, digits and _ only."
[[ "$media" == /* ]] || die "media dir: an absolute path."
[[ ! -e "$media" ]] || die "$media already exists; the restore needs a new directory."

# Each URL's parts, from the environment files the install wrote (step 7).
parse_url() { # file variable prefix
  local line
  line="$(grep -E "^$2=" "$1" | tail -n 1)" || die "$2 is not set in $1."
  [[ "${line#*=}" =~ ^postgresql://([^:/@]+):([^@]+)@([^/]+)/([^?]+) ]] \
    || die "$2 in $1 is not a postgresql://user:password@host:port/database URL."
  printf -v "${3}_user" '%s' "${BASH_REMATCH[1]}"
  printf -v "${3}_password" '%s' "${BASH_REMATCH[2]}"
  printf -v "${3}_host" '%s' "${BASH_REMATCH[3]}"
}
parse_url "$etc/migrate.env" DATABASE_URL owner
parse_url "$etc/api.env" DATABASE_URL app
parse_url "$etc/backup.env" BACKUP_DATABASE_URL backup
# shellcheck disable=SC2154 # set by parse_url
[[ "$owner_user $app_user $backup_user" == 'clinic_owner clinic_app clinic_backup' ]] \
  || die "unexpected logins in /etc/clinic: $owner_user, $app_user, $backup_user."
signing_dir="$(sed -n 's/^BACKUP_SIGNING_KEY_DIR=//p' "$etc/backup.env" | tail -n 1)"
[[ -n "$signing_dir" ]] || die "BACKUP_SIGNING_KEY_DIR is not set in $etc/backup.env."

as_postgres() { runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 -d postgres "$@"; }
[[ -z "$(as_postgres -At -c "SELECT 1 FROM pg_database WHERE datname = '$database'")" ]] \
  || die "database $database already exists; the restore needs a new one."

# The archive and the database dump are large and go to disk; the private key
# and the keyring holding it go to memory only.
[[ "$(findmnt -n -o FSTYPE --target /dev/shm 2> /dev/null)" == tmpfs ]] \
  || die "/dev/shm is not a memory file system; the owner's key must not touch the disk."
work="$(mktemp -d /var/tmp/clinic-restore.XXXXXX)"
gnupg="$(mktemp -d /dev/shm/clinic-restore-gnupg.XXXXXX)"
cleanup() {
  runuser -u clinic-api -- gpgconf --homedir "$gnupg" --kill all 2> /dev/null || true
  rm -rf "$work" "$gnupg"
}
trap cleanup EXIT
chown clinic-api:clinic-api "$work" "$gnupg"
chmod 0700 "$work" "$gnupg"
as_api() { runuser -u clinic-api -- env GNUPGHOME="$gnupg" HOME="$work" "$@"; }

echo "== The archive and the keys"
copy="$work/$(basename "$archive")"
install -o clinic-api -g clinic-api -m 0600 "$archive" "$copy"
install -o clinic-api -g clinic-api -m 0600 "$owner_key" "$gnupg/owner-key.asc"
runuser -u clinic-backup -- gpg --homedir "$signing_dir" --batch --armor --export > "$work/signer.asc"
chown clinic-api:clinic-api "$work/signer.asc"
grep -q 'BEGIN PGP PUBLIC KEY BLOCK' "$work/signer.asc" || die "no signing key in $signing_dir."

echo allow-preset-passphrase > "$gnupg/gpg-agent.conf"
chown clinic-api:clinic-api "$gnupg/gpg-agent.conf"
as_api gpg --batch --quiet --import "$gnupg/owner-key.asc" 2> /dev/null \
  || die "could not import $owner_key."
rm -f "$gnupg/owner-key.asc"
mapfile -t keygrips < <(as_api gpg --batch --with-colons --with-keygrip --list-secret-keys \
  | awk -F: '$1 == "grp" { print $10 }')
[[ ${#keygrips[@]} -gt 0 ]] || die "$owner_key holds no private key."

# Asked once; the agent made for this run keeps it until the cleanup stops it.
if [[ -t 0 ]]; then
  read -rsp "Passphrase of the owner's backup key (Enter if it has none): " passphrase
  echo
else
  IFS= read -r passphrase || true
fi
as_api gpgconf --launch gpg-agent
preset="$(gpgconf --list-dirs libexecdir)/gpg-preset-passphrase"
for grip in "${keygrips[@]}"; do
  printf '%s' "$passphrase" | as_api "$preset" --preset "$grip" \
    || die "the key's agent refused the passphrase."
done
unset passphrase

# Decrypt once, discarding the output: a wrong passphrase or key stops here,
# before a database or directory is created. (gpg's exit status also reports
# the signature it cannot check without the signing key; restore.sh checks that.)
as_api gpg --batch --quiet --status-file "$work/decrypt.status" --output /dev/null \
  --decrypt "$copy" 2> /dev/null || true
grep -q '^\[GNUPG:\] DECRYPTION_OKAY' "$work/decrypt.status" \
  || die "the archive does not decrypt with this key and passphrase. Nothing was changed."
echo "ok: the archive decrypts"

echo "== New, empty database $database, as for a new deployment"
# shellcheck disable=SC2154 # set by parse_url
as_postgres -v database="$database" -v owner_password="$owner_password" \
  -v runtime_password="$app_password" -v backup_password="$backup_password" \
  -f "$live/apps/api/prisma/provision-roles.sql"
install -d -o clinic-api -g clinic-api -m 2750 "$media"
echo "ok: $database, $media"

echo "== Restore and verify, as clinic-api, with $(readlink -f "$live")"
# shellcheck disable=SC2154 # set by parse_url
if ! RESTORE_OWNER_DATABASE_URL="postgresql://$owner_user:$owner_password@$owner_host/$database" \
  RESTORE_RUNTIME_DATABASE_URL="postgresql://$app_user:$app_password@$app_host/$database" \
  MEDIA_STORAGE_DIR="$media" RESTORE_SIGNER_KEY_FILE="$work/signer.asc" \
  RESTORE_WORK_DIR="$work" GNUPGHOME="$gnupg" HOME="$work" CHECKPOINT_DISABLE=1 \
  setpriv --reuid=clinic-api --regid=clinic-api --init-groups -- "$restore" "$copy"; then
  die "the restore failed (above). Discard the target before trying again: sudo -u postgres dropdb $database && sudo rm -rf $media"
fi

# A live release older than A8 restores the media with the archive's private
# modes; the backup user reads the media through the API's group.
chmod -R u=rwX,g=rX,o= "$media"
echo "ok: $media readable by clinic-api's group, for the nightly backup"
