#!/usr/bin/env bash
# Archive UPLOADS_DIR → tar.gz → chiffrement GPG → daily/

set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
load_config

: "${UPLOADS_DIR:?}"
[[ -d "$UPLOADS_DIR" ]] || die "UPLOADS_DIR introuvable : $UPLOADS_DIR"

dest_dir="$BACKUP_ROOT/uploads/daily"
mkdir -p "$dest_dir"
dest="$dest_dir/uploads-$(today).tar.gz.gpg"

log "Archive $UPLOADS_DIR → $dest"

# -C pour archiver sans inclure le chemin absolu.
tar -C "$(dirname "$UPLOADS_DIR")" -czf - "$(basename "$UPLOADS_DIR")" \
  | gpg_encrypt "$dest"

count=$(find "$UPLOADS_DIR" -type f | wc -l)
size=$(du -h "$dest" | awk '{print $1}')
log "OK ($count fichiers, $size)"

update_manifest uploads daily "$dest"
