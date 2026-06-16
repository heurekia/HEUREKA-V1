#!/usr/bin/env bash
# Réplique l'arborescence locale vers OVH Object Storage (S3 via rclone).
# Mode mirror : supprime aussi côté distant ce qui a été purgé localement.

set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
load_config

: "${RCLONE_REMOTE:?}" "${RCLONE_BUCKET:?}"

log "Sync $BACKUP_ROOT → $RCLONE_REMOTE:$RCLONE_BUCKET"

# --transfers 4 : prudent côté bande passante VPS.
# --checksum : compare via sha256 (les .gpg sont binaires, mtime peu fiable).
# --exclude logs/ : on garde les logs côté VPS uniquement.
rclone sync \
  "$BACKUP_ROOT" \
  "$RCLONE_REMOTE:$RCLONE_BUCKET" \
  --transfers 4 \
  --checksum \
  --exclude 'logs/**' \
  --log-file "$BACKUP_ROOT/logs/sync-$(today).log" \
  --log-level INFO

log "OK — copie hors-site à jour"
