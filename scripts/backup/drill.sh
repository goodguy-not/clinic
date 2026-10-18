#!/usr/bin/env bash
# Milestone 10, checkpoint A2 — THE RESTORE DRILL. SYNTHETIC DATA, DISPOSABLE
# CLUSTERS, NOTHING ELSE.
#
#   DRILL_SOURCE_ADMIN_URL=postgresql://<superuser>:<pw>@<host>:<port>/postgres \
#   DRILL_TARGET_ADMIN_URL=postgresql://<superuser>:<pw>@<host>:<port>/postgres \
#   DRILL_WORK_DIR=<empty scratch directory> \
#     scripts/backup/drill.sh
#
# Two DIFFERENT, THROWAWAY PostgreSQL clusters: the source is populated,
# backed up and then destroyed; the target starts with no clinic role and no
# clinic database, as a replacement server would. Requires `pnpm build` first.
#
#   build a clinic → back it up → the Windows collector fetches it → destroy the
#   server, its own backups included → restore the clinic computer's copy into
#   the fresh cluster → verify the database, the media, the public site and a
#   staff sign-in
#
# and, along the way, that each of these is refused loudly: a privileged backup
# login, a referenced image missing at backup time, every request the
# collector's key may not make, the wrong private key, a tampered archive, a
# PLANTED archive (correctly encrypted, unsigned or signed by another key), an
# archive missing a referenced image, an image lost after restore, and a
# restore over a database that is not empty. Needs PowerShell (pwsh or Windows
# PowerShell) for the collector.
#
# Every password and key here is generated for this run and discarded with
# DRILL_WORK_DIR. No real clinic data is used, or may be.

SCRIPT_NAME=drill
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_env DRILL_SOURCE_ADMIN_URL DRILL_TARGET_ADMIN_URL DRILL_WORK_DIR
require_cmd psql pg_dump pg_restore gpg tar sha256sum node curl od

DB=clinic_drill_ci
API_PORT="${DRILL_API_PORT:-3411}"
WEB_PORT="${DRILL_WEB_PORT:-3410}"
BACKUP="$BACKUP_LIB_DIR"
work="$DRILL_WORK_DIR"
if [[ -e "$work" && -n "$(ls -A "$work")" ]]; then
  die "DRILL_WORK_DIR must be empty or absent."
fi
mkdir -p "$work"/{destination,tmp,logs,keys}
work="$(cd "$work" && pwd)"

# Windows (Git Bash) runs a native node, which needs native paths.
native() { if command -v cygpath > /dev/null; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
secret() { od -An -N18 -tx1 /dev/urandom | tr -d ' \n'; }
url_on() { # admin-url role password
  local hostport="${1#*@}"
  printf 'postgresql://%s:%s@%s/%s' "$2" "$3" "${hostport%%/*}" "$DB"
}

pids=()
stop_apps() {
  local pid
  for pid in "${pids[@]}"; do kill "$pid" 2> /dev/null || true; done
  for pid in "${pids[@]}"; do wait "$pid" 2> /dev/null || true; done
  pids=()
}
trap stop_apps EXIT

# Something else answering on the port would pass every readiness check.
port_free() {
  ! curl -s -o /dev/null --max-time 2 "http://localhost:$1"     || die "port $1 is already in use; set DRILL_API_PORT / DRILL_WEB_PORT."
}

wait_for() { # url label
  local attempt
  for attempt in $(seq 1 90); do
    curl -sf -o /dev/null "$1" && return 0
    sleep 1
  done
  die "$2 did not become ready at $1 (logs in $work/logs)."
}

# The API, started against one environment.
start_api() { # label database-url media-dir
  local label="$1"
  port_free "$API_PORT"
  (cd "$work" && exec env DATABASE_URL="$2" MEDIA_STORAGE_DIR="$(native "$3")" \
    INTERNAL_API_KEY="$internal_key" API_PORT="$API_PORT" NODE_ENV=production \
    node "$(native "$REPO_ROOT/apps/api/dist/main.js")" > "$work/logs/api-$label.log" 2>&1) &
  pids+=($!)
  wait_for "http://localhost:$API_PORT/health" "the API ($label)"
  # Milestone 10, A3: the runbooks' readiness check — database reachable, media
  # directory writable — answered without a credential.
  curl -sf "http://localhost:$API_PORT/health/ready" | grep -q '"status":"ok"'     || die "the API ($label) is up but /health/ready does not report ready."
  ok "API running and ready against the $label environment"
}

# The web, built and started against the running API.
start_web() { # label
  local label="$1"
  port_free "$WEB_PORT"
  # The public listing pages are prerendered at build time and revalidated
  # every fifteen minutes, so the web is BUILT against the running API — as a
  # deployment onto a replacement server does — and nothing cached from an
  # earlier environment can stand in for this one's.
  local web_env=(env API_BASE_URL="http://localhost:$API_PORT"
    INTERNAL_API_KEY="$internal_key" SESSION_COOKIE_SECRET="$cookie_secret"
    DEPLOYMENT_MODE=non-production WEB_ALLOWED_ORIGINS="http://localhost:$WEB_PORT")
  rm -rf "$REPO_ROOT/apps/web/.next/cache"
  (cd "$REPO_ROOT/apps/web" && "${web_env[@]}" node node_modules/next/dist/bin/next build \
    > "$work/logs/web-build-$label.log" 2>&1) \
    || { tail -30 "$work/logs/web-build-$label.log"; die "the web build failed ($label)."; }
  (cd "$REPO_ROOT/apps/web" && exec "${web_env[@]}" \
    node node_modules/next/dist/bin/next start --port "$WEB_PORT" > "$work/logs/web-$label.log" 2>&1) &
  pids+=($!)
  wait_for "http://localhost:$WEB_PORT/api/health" "the web ($label)"
  ok "web built and running against the $label API"
}

site_check() {
  printf '%s\n' "$manager_password" | VERIFY_WEB_URL="http://localhost:$WEB_PORT" \
    VERIFY_STAFF_USERNAME=drill.manager VERIFY_MIN_PUBLIC_IMAGES=2 \
    node "$(native "$BACKUP/verify-site.mjs")"
}

# A command that must fail, and must say why. Its output is kept in the log.
expect_failure() { # label pattern command...
  local label="$1" pattern="$2" log
  shift 2
  log="$work/logs/refused-$(tr -c 'a-z0-9' '-' <<< "$label" | head -c 40).log"
  if "$@" > "$log" 2>&1; then
    cat "$log"
    die "NOT DETECTED: $label — the command succeeded."
  fi
  grep -Eq "$pattern" "$log" || { cat "$log"; die "$label failed, but not for the expected reason."; }
  ok "detected: $label"
  local reason
  reason="$(grep -E '^\[[a-z-]+\] FAILED|ERROR:' "$log" | head -1 || true)"
  say "         ${reason:-$(head -1 "$log")}"
}

prisma="$REPO_ROOT/apps/api/node_modules/.bin/prisma"
provision() { # admin-url owner-pw runtime-pw backup-pw
  psql_run -d "$1" -v database="$DB" -v owner_password="$2" -v runtime_password="$3" \
    -v backup_password="$4" -f "$REPO_ROOT/apps/api/prisma/provision-roles.sql" > /dev/null
}
assert_fresh() { # admin-url label
  local found
  found="$(psql_value "$1" "SELECT count(*) FROM pg_roles WHERE rolname LIKE 'clinic%'") $(psql_value "$1" "SELECT count(*) FROM pg_database WHERE datname = '$DB'")"
  [[ "$found" == '0 0' ]] || die "the $2 cluster is not fresh: it already has clinic roles or $DB."
}

internal_key="drill_internal_$(secret)"
cookie_secret="drill_cookie_$(secret)"
manager_password="Drill-$(secret)"

# ---------------------------------------------------------------------------
step "1. Source: a synthetic clinic"
assert_fresh "$DRILL_SOURCE_ADMIN_URL" source
assert_fresh "$DRILL_TARGET_ADMIN_URL" target
src_owner_pw="$(secret)"; src_app_pw="$(secret)"; src_backup_pw="$(secret)"
provision "$DRILL_SOURCE_ADMIN_URL" "$src_owner_pw" "$src_app_pw" "$src_backup_pw"
src_owner="$(url_on "$DRILL_SOURCE_ADMIN_URL" clinic_owner "$src_owner_pw")"
src_app="$(url_on "$DRILL_SOURCE_ADMIN_URL" clinic_app "$src_app_pw")"
src_backup="$(url_on "$DRILL_SOURCE_ADMIN_URL" clinic_backup "$src_backup_pw")"
(cd "$REPO_ROOT/apps/api" && DATABASE_URL="$src_owner" "$prisma" migrate deploy > "$work/logs/migrate-source.log" 2>&1) \
  || { cat "$work/logs/migrate-source.log"; die "migrations failed on the source."; }
ok "roles provisioned, migrations applied as clinic_owner"

src_media="$work/source-media"
mkdir -p "$src_media"
cli_env=(env DATABASE_URL="$src_app" MEDIA_STORAGE_DIR="$(native "$src_media")" INTERNAL_API_KEY="$internal_key" NODE_ENV=development)
temporary_password="$(cd "$work" && "${cli_env[@]}" node "$(native "$REPO_ROOT/apps/api/dist/cli/main.js")" \
  bootstrap-manager --username drill.manager --display-name 'Drill Manager' \
  | awk '/Temporary password/ {getline; gsub(/^ +| +$/, ""); print}')"
[[ -n "$temporary_password" ]] || die "bootstrap-manager printed no password."
(cd "$work" && "${cli_env[@]}" node "$(native "$REPO_ROOT/apps/api/dist/dev/main.js")" \
  --confirm --weeks 2 --families 6 --therapists 3 --run-tag drill > "$work/logs/seed.log" 2>&1) \
  || { cat "$work/logs/seed.log"; die "the synthetic seed failed."; }
ok "manager bootstrapped; synthetic families, appointments, charges and payments seeded"

start_api source "$src_app" "$src_media"
therapists="$(psql_value "$src_app" "SELECT string_agg(id::text, ',') FROM (SELECT id FROM therapist WHERE is_public ORDER BY id LIMIT 2) t")"
printf '%s\n%s\n' "$temporary_password" "$manager_password" | DRILL_API_URL="http://localhost:$API_PORT" \
  DRILL_INTERNAL_API_KEY="$internal_key" DRILL_MANAGER_USERNAME=drill.manager \
  DRILL_PUBLIC_THERAPISTS="$therapists" node "$(native "$BACKUP/drill-seed.mjs")"
say "  source media files on disk: $(find "$src_media" -type f | wc -l | tr -d ' ')"
start_web source

step "2. Source: the site check passes before anything happens"
site_check

# ---------------------------------------------------------------------------
step "3. Backup"
gpg_new_key() { # homedir name
  mkdir -p "$1"
  chmod 700 "$1"
  gpg --homedir "$1" --batch --quiet --pinentry-mode loopback --passphrase '' \
    --quick-gen-key "$2 (synthetic drill key) <drill@example.invalid>" default default never
}
primary_fpr() { # homedir
  gpg --homedir "$1" --batch --with-colons --list-secret-keys \
    | awk -F: '$1 == "sec" {p = 1; next} $1 == "fpr" && p {print $10; exit}'
}
# Keyrings live under a SHORT path: gpg-agent's socket path has a hard length
# limit that a deep scratch directory can exceed.
keyrings="$(mktemp -d /tmp/clinic-drill-gpg.XXXXXX)"
kill_agents() {
  local home
  for home in "$keyrings"/*; do gpgconf --homedir "$home" --kill all 2> /dev/null || true; done
  rm -rf "$keyrings"
}
trap 'stop_apps; kill_agents' EXIT
# The owner's key pair: the private half stays off the server.
operator_keys="$keyrings/operator"
gpg_new_key "$operator_keys" 'Clinic backup'
gpg --homedir "$operator_keys" --armor --export > "$work/keys/recipient.asc"
# The server's signing key: the private half stays ON the server, the public
# half goes off-server with the decryption key.
server_keys="$keyrings/server"
gpg_new_key "$server_keys" 'Clinic server signing'
gpg --homedir "$server_keys" --armor --export > "$work/keys/server-signing.asc"
# Somebody who is neither.
wrong_keys="$keyrings/stranger"
gpg_new_key "$wrong_keys" 'Somebody else'

# An archive past retention, to show pruning happens only after a success.
touch "$work/destination/clinic-backup-20200101T000000Z.tar.gpg"
backup_env=(env BACKUP_DATABASE_URL="$src_backup" MEDIA_STORAGE_DIR="$src_media"
  BACKUP_DESTINATION_DIR="$work/destination" BACKUP_RECIPIENT_KEY_FILE="$work/keys/recipient.asc"
  BACKUP_SIGNING_KEY_DIR="$server_keys" BACKUP_RETENTION_DAYS=30 BACKUP_WORK_DIR="$work/tmp")

expect_failure 'backup as the owner (not least privilege)' 'not a least-privilege backup role' \
  "${backup_env[@]}" BACKUP_DATABASE_URL="$src_owner" "$BACKUP/backup.sh"
expect_failure 'backup as the runtime login (can write)' 'not a least-privilege backup role' \
  "${backup_env[@]}" BACKUP_DATABASE_URL="$src_app" "$BACKUP/backup.sh"
victim="$(find "$src_media" -name 'master.*' -type f | head -1)"
mv "$victim" "$victim.away"
expect_failure 'backup while a referenced image is missing' 'missing from MEDIA_STORAGE_DIR' \
  "${backup_env[@]}" "$BACKUP/backup.sh"
mv "$victim.away" "$victim"
[[ "$(find "$work/destination" -name 'clinic-backup-2026*' | wc -l)" -eq 0 ]] \
  || die "a refused backup left an archive behind."
ok "no archive was written by any refused backup"

"${backup_env[@]}" "$BACKUP/backup.sh"
archive_name="$(cd "$work/destination" && ls clinic-backup-*.tar.gpg | tail -1)"
[[ -n "$archive_name" && "$archive_name" != clinic-backup-2020* ]] || die "no archive was produced."
[[ ! -e "$work/destination/clinic-backup-20200101T000000Z.tar.gpg" ]] || die "retention did not prune."
if tar -tf "$work/destination/$archive_name" > /dev/null 2>&1 || grep -aq 'PGDMP' "$work/destination/$archive_name"; then
  die "the archive is readable without the key."
fi
ok "the archive is not a readable tar and carries no plaintext dump header"

# ---------------------------------------------------------------------------
step "4. The clinic computer collects it"
# The server end is the real forced command. The transport is a stand-in for
# ssh that runs it locally: what sshd adds — the key, `restrict`, the forced
# command itself — is configuration, and README says exactly what to install.
status_dir="$work/status"
clinic_pc="$work/clinic-pc"
mkdir -p "$status_dir" "$clinic_pc"
cat > "$work/fake-ssh.sh" << SHIM
#!/usr/bin/env bash
export SSH_ORIGINAL_COMMAND="\${*: -1}" BACKUP_DESTINATION_DIR="$work/destination" BACKUP_STATUS_DIR="$status_dir"
exec bash "$BACKUP/collector-serve.sh"
SHIM
serve() { SSH_ORIGINAL_COMMAND="$1" BACKUP_DESTINATION_DIR="$work/destination" \
  BACKUP_STATUS_DIR="$status_dir" bash "$BACKUP/collector-serve.sh"; }

server_state() { (cd "$work/destination" && ls -la --time-style=+%s . && sha256sum -- *) | sha256sum; }
before="$(server_state)"
for request in 'rm -f *' 'get ../../etc/passwd' "get $archive_name; rm $archive_name" 'bash -i' \
  'get clinic-backup-20990101T000000Z.tar.gpg' 'ack' 'scp -f x'; do
  expect_failure "collector key asking for: $request" '^refused:' serve "$request"
done
[[ "$(server_state)" == "$before" ]] || die "a collector request changed the server's backups."
ok "the server's backups are byte-for-byte unchanged by every collector request"

if command -v pwsh > /dev/null; then powershell=pwsh; else powershell=powershell.exe; fi
command -v "$powershell" > /dev/null || die "PowerShell (pwsh) is required to run the Windows collector."
printf '{ "Destination": "%s", "RetentionDays": 30, "SshCommand": ["%s", "%s"] }\n' \
  "$(native "$clinic_pc")" "$(native "$(command -v bash)")" "$(native "$work/fake-ssh.sh")" > "$work/collector.json"
collect() {
  "$powershell" -NoProfile -NonInteractive -ExecutionPolicy Bypass \
    -File "$(native "$BACKUP/collector/collect-backups.ps1")" -ConfigPath "$(native "$work/collector.json")"
}
# A copy past retention on the clinic computer, and an interrupted download.
touch "$clinic_pc/clinic-backup-20200101T000000Z.tar.gpg"
head -c 777 /dev/urandom > "$clinic_pc/$archive_name.partial"
collect
collect
[[ ! -e "$clinic_pc/clinic-backup-20200101T000000Z.tar.gpg" ]] || die "the collector did not expire its own old copy."
[[ ! -e "$clinic_pc/$archive_name.partial" ]] || die "the collector left a partial download."
cmp -s "$clinic_pc/$archive_name" "$work/destination/$archive_name" || die "the collected copy differs from the server's."
grep -qx "archive=$archive_name" "$status_dir/offsite-collection" || die "the collection was not acknowledged."
ok "collected once, idempotent on the second run, interrupted download replaced, old copy expired"
say "  $(tr '\n' ' ' < "$status_dir/offsite-collection")"

# ---------------------------------------------------------------------------
step "5. Lose the server: database, roles, media AND its own backups"
stop_apps
psql_run -d "$DRILL_SOURCE_ADMIN_URL" -c "DROP DATABASE $DB WITH (FORCE)" \
  -c 'DROP ROLE clinic_app' -c 'DROP ROLE clinic_backup' -c 'DROP ROLE clinic_runtime' -c 'DROP ROLE clinic_owner'
rm -rf "$src_media" "$work/destination" "$server_keys"
archive="$clinic_pc/$archive_name"
ok "only the clinic computer's copy is left; restoring from it"

# ---------------------------------------------------------------------------
step "6. Fresh target: provisioned exactly as a new deployment"
dst_owner_pw="$(secret)"; dst_app_pw="$(secret)"; dst_backup_pw="$(secret)"
provision "$DRILL_TARGET_ADMIN_URL" "$dst_owner_pw" "$dst_app_pw" "$dst_backup_pw"
dst_owner="$(url_on "$DRILL_TARGET_ADMIN_URL" clinic_owner "$dst_owner_pw")"
dst_app="$(url_on "$DRILL_TARGET_ADMIN_URL" clinic_app "$dst_app_pw")"
dst_media="$work/restored-media"
restore_env=(env RESTORE_OWNER_DATABASE_URL="$dst_owner" RESTORE_RUNTIME_DATABASE_URL="$dst_app"
  MEDIA_STORAGE_DIR="$dst_media" RESTORE_WORK_DIR="$work/tmp" GNUPGHOME="$operator_keys"
  RESTORE_SIGNER_KEY_FILE="$work/keys/server-signing.asc")
ok "new roles with new passwords, empty $DB"

step "7. Broken and planted archives are refused before anything changes"
expect_failure 'restore with the wrong private key' 'could not decrypt' \
  "${restore_env[@]}" GNUPGHOME="$wrong_keys" "$BACKUP/restore.sh" "$archive"

tampered="$work/tmp/tampered.tar.gpg"
cp "$archive" "$tampered"
size="$(wc -c < "$tampered")"
printf '\xff\x00\xff\x00' | dd of="$tampered" bs=1 seek=$((size / 2)) conv=notrunc status=none
expect_failure 'restore of a damaged archive' 'could not decrypt' \
  "${restore_env[@]}" "$BACKUP/restore.sh" "$tampered"

# Planted archives: the real content, correctly encrypted to the owner's key,
# but not produced by the clinic's server.
genuine="$work/tmp/genuine"
mkdir -p "$genuine"
# gpg exits non-zero here only because the operator's keyring cannot check the
# server's signature; the content is checked by its FORMAT file instead.
gpg --homedir "$operator_keys" --batch --quiet --decrypt "$archive" 2> /dev/null \
  | tar -C "$genuine" -xf - || true
[[ -f "$genuine/FORMAT" ]] || die "could not unpack the genuine archive to build planted ones."
repack() { # output [signing homedir]
  local signing=(--homedir "$wrong_keys")
  [[ $# -eq 2 ]] && signing=(--homedir "$2" --local-user "$(primary_fpr "$2")" --sign)
  tar -C "$genuine" -cf - FORMAT manifest database.dump media \
    | gpg --batch --quiet --no-auto-check-trustdb --trust-model always "${signing[@]}" \
      --recipient-file "$work/keys/recipient.asc" --encrypt --output "$1"
}
repack "$work/tmp/planted-unsigned.tar.gpg"
expect_failure 'restore of a planted archive: encrypted to the owner, unsigned' 'not produced by the clinic.s server' \
  "${restore_env[@]}" "$BACKUP/restore.sh" "$work/tmp/planted-unsigned.tar.gpg"
repack "$work/tmp/planted-stranger.tar.gpg" "$wrong_keys"
expect_failure 'restore of a planted archive: encrypted to the owner, signed by another key' 'not produced by the clinic.s server' \
  "${restore_env[@]}" "$BACKUP/restore.sh" "$work/tmp/planted-stranger.tar.gpg"

# A server-signed archive that lost an image — signed here with a stand-in
# server key the restore is told to trust, since the real one died with the server.
gpg_new_key "$keyrings/server2" 'Clinic server signing'
gpg --homedir "$keyrings/server2" --armor --export > "$work/keys/server2-signing.asc"
rm -f "$(find "$genuine/media" -name 'master.*' -type f | head -1)"
repack "$work/tmp/holed.tar.gpg" "$keyrings/server2"
expect_failure 'restore of a signed archive missing a referenced image' 'archived media: 1 of [0-9]+ referenced media file' \
  "${restore_env[@]}" RESTORE_SIGNER_KEY_FILE="$work/keys/server2-signing.asc" "$BACKUP/restore.sh" "$work/tmp/holed.tar.gpg"
rm -rf "$genuine"

[[ "$(psql_value "$dst_owner" "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'")" == 0 ]] \
  || die "a refused restore changed the target database."
[[ ! -e "$dst_media" ]] || die "a refused restore created the media directory."
ok "target database still empty, media directory never created"

# ---------------------------------------------------------------------------
step "8. Restore, from the clinic computer's copy"
"${restore_env[@]}" "$BACKUP/restore.sh" "$archive"

step "9. Damage after restore is detected"
# Before the restored system takes any traffic: verify.sh compares records
# exactly, and the site check below signs in, which writes audit and session
# rows.
lost="$(find "$dst_media" -name 'w*.webp' -type f | head -1)"
mv "$lost" "$work/tmp/lost-file"
expect_failure 'verification with a restored image missing' 'restored media root: 1 of [0-9]+ referenced media file' \
  "${restore_env[@]}" "$BACKUP/verify.sh" "$archive"
mv "$work/tmp/lost-file" "$lost"

step "10. The restored system, running"
# Runbook step 6: re-apply every erasure the backup predates. The nightly jobs
# are safe to run at any time, and must all succeed on a fresh restore.
(cd "$work" && env DATABASE_URL="$dst_app" MEDIA_STORAGE_DIR="$(native "$dst_media")"   INTERNAL_API_KEY="$internal_key" NODE_ENV=production   node "$(native "$REPO_ROOT/apps/api/dist/cli/main.js")" run-jobs > "$work/logs/run-jobs.log" 2>&1)   || { cat "$work/logs/run-jobs.log"; die "the nightly jobs failed on the restored system."; }
[[ "$(grep -c ' SUCCEEDED' "$work/logs/run-jobs.log")" == 4 ]]   || { cat "$work/logs/run-jobs.log"; die "not every nightly job succeeded on the restored system."; }
ok "all four nightly jobs succeeded on the restored system"
start_api restored "$dst_app" "$dst_media"
start_web restored
site_check

# ---------------------------------------------------------------------------
step "11. A restore never merges into a live database"
expect_failure 'restore over a database that is not empty' 'the database is not empty' \
  "${restore_env[@]}" MEDIA_STORAGE_DIR="$work/tmp/unused-media" "$BACKUP/restore.sh" "$archive"

stop_apps
say ""
say "DRILL PASSED: backed up, collected off-site, lost the server, restored from the off-site copy into a fresh cluster and verified; every broken or planted case was refused."
