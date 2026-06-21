#!/usr/bin/env bash
# Crée l'arborescence des sauvegardes locales.

set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
require_root
load_config

for cat in postgres uploads config; do
  for sub in daily weekly monthly; do
    install -d -m 700 "$BACKUP_ROOT/$cat/$sub"
  done
done
install -d -m 700 "$BACKUP_ROOT/manifests"
install -d -m 700 "$BACKUP_ROOT/logs"

log "Arborescence créée sous $BACKUP_ROOT"
