#!/usr/bin/env bash
# Milestone 10, checkpoint A2 — THE ONLY THING THE CLINIC COMPUTER'S KEY CAN DO.
#
# Installed as a FORCED COMMAND on the server, in the collector login's
# ~/.ssh/authorized_keys (README, Backup and restore, The clinic collector):
#
#   restrict,command="env BACKUP_DESTINATION_DIR=<dir> BACKUP_STATUS_DIR=<dir> <repo>/scripts/backup/collector-serve.sh" ssh-ed25519 AAAA... clinic-collector
#
# `restrict` turns off port, agent and X11 forwarding and the terminal, and
# sshd runs THIS script whatever the client asked for; what it asked for
# arrives in SSH_ORIGINAL_COMMAND and is one of exactly three requests:
#
#   list            one line per archive: <name> <bytes> <sha256>
#   get <archive>   the archive's bytes on stdout
#   ack <archive>   "the clinic computer now holds <archive>, checked": written
#                   to BACKUP_STATUS_DIR/offsite-collection, which the API reads
#                   to warn the manager when the off-site copy is stale
#
# Anything else is refused. The login has no password, no database role, no
# read access to the media directory, and only group READ on the archives: it
# cannot delete or alter a backup even if this script were bypassed, because
# the directory is not writable by it. BACKUP_STATUS_DIR is the only place it
# can write.

set -euo pipefail
umask 027

refuse() {
  printf 'refused: %s\n' "$1" >&2
  exit 2
}

[[ -n "${BACKUP_DESTINATION_DIR:-}" && -d "$BACKUP_DESTINATION_DIR" ]] \
  || refuse 'the server is misconfigured (BACKUP_DESTINATION_DIR)'
[[ -n "${BACKUP_STATUS_DIR:-}" && -d "$BACKUP_STATUS_DIR" ]] \
  || refuse 'the server is misconfigured (BACKUP_STATUS_DIR)'

NAME='^clinic-backup-[0-9]{8}T[0-9]{6}Z\.tar\.gpg$'

# No shell parsing of the request, ever: split on spaces, check every word.
read -r -a request <<< "${SSH_ORIGINAL_COMMAND:-}"

# An archive this login may name: the exact generated shape, present, and
# already carrying its checksum (backup.sh writes the checksum first).
archive_arg() {
  [[ ${#request[@]} -eq 2 && "${request[1]}" =~ $NAME ]] || refuse "expected: ${request[0]} <archive name>"
  [[ -f "$BACKUP_DESTINATION_DIR/${request[1]}" && -f "$BACKUP_DESTINATION_DIR/${request[1]}.sha256" ]] \
    || refuse "no such archive on the server: ${request[1]}"
  printf '%s' "${request[1]}"
}

newest_archive() {
  local path newest=''
  for path in "$BACKUP_DESTINATION_DIR"/clinic-backup-*.tar.gpg; do
    [[ -f "$path" && -f "$path.sha256" ]] || continue
    newest="$(basename "$path")"
  done
  printf '%s' "$newest"
}

case "${request[0]:-}" in
  list)
    [[ ${#request[@]} -eq 1 ]] || refuse 'expected: list'
    for path in "$BACKUP_DESTINATION_DIR"/clinic-backup-*.tar.gpg; do
      [[ -f "$path" && -f "$path.sha256" ]] || continue
      name="$(basename "$path")"
      [[ "$name" =~ $NAME ]] || continue
      printf '%s %s %s\n' "$name" "$(wc -c < "$path" | tr -d ' ')" "$(awk '{print $1; exit}' "$path.sha256")"
    done
    ;;
  get)
    name="$(archive_arg)"
    exec cat -- "$BACKUP_DESTINATION_DIR/$name"
    ;;
  ack)
    name="$(archive_arg)"
    status="$BACKUP_STATUS_DIR/offsite-collection"
    {
      printf 'archive=%s\n' "$name"
      printf 'collected_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      printf 'newest_on_server=%s\n' "$(newest_archive)"
    } > "$status.tmp"
    chmod 0640 "$status.tmp"
    mv "$status.tmp" "$status"
    printf 'acknowledged %s\n' "$name"
    ;;
  *)
    refuse 'only "list", "get <archive>" and "ack <archive>" are allowed'
    ;;
esac
