#!/usr/bin/env bash
# Installe le cron des sauvegardes dans /etc/cron.d/heureka-backup.

set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
require_root

here="$(cd "$(dirname "$0")" && pwd)"
dest=/etc/cron.d/heureka-backup

sed "s#__BACKUP_DIR__#$here#g" "$here/cron.template" > "$dest"
chmod 644 "$dest"
chown root:root "$dest"

log "Cron installé : $dest"
log "Lister les jobs : sudo crontab -l -u root ; ou cat $dest"
