#!/usr/bin/env bash
# Milestone 10, checkpoint A3 — COPY THE MEDIA THE SNAPSHOT NAMES, WHILE THE
# FILES LOCK IS HELD.
#
# Run by backup.sql through `\!`, never by hand: the psql session that took the
# snapshot holds `pg_advisory_lock_shared(4919, 10)` (MEDIA_FILES_LOCK in
# apps/api/src/media/media-erasure.service.ts) from before the snapshot until
# it ends, and this runs inside that session. No media erasure can commit while
# the lock is held, so every file the snapshot refers to is still on disk when
# it is copied here. Environment: CLINIC_BACKUP_STAGE, MEDIA_STORAGE_DIR.

SCRIPT_NAME=backup
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_env CLINIC_BACKUP_STAGE MEDIA_STORAGE_DIR
stage="$CLINIC_BACKUP_STAGE"

step "Media referenced by the snapshot"
assert_media_keys_safe "$stage/manifest/media.sha256"
missing="$(awk '{print $2}' "$stage/manifest/media.sha256" | while IFS= read -r key; do
  [[ -f "$MEDIA_STORAGE_DIR/$key" ]] || printf '%s\n' "$key"
done)"
if [[ -n "$missing" ]]; then
  printf '%s\n' "$missing" | head -20 >&2
  die "$(wc -l <<< "$missing" | tr -d ' ') media file(s) the database refers to are missing from MEDIA_STORAGE_DIR (first 20 above). This backup would restore rows whose images are gone, so it was not written."
fi
if [[ -s "$stage/manifest/media.sha256" ]]; then
  awk '{print $2}' "$stage/manifest/media.sha256" > "$stage/media.list"
  tar -C "$MEDIA_STORAGE_DIR" -cf - -T "$stage/media.list" | tar -C "$stage/media" -xf -
  rm -f "$stage/media.list"
fi
check_media_against "$stage/media" "$stage/manifest/media.sha256" "copied media"
