#!/usr/bin/env bash
# Promotion daily → weekly (dimanche) → monthly (1er du mois) + purge
# selon RETENTION_*. Idempotent : peut tourner plusieurs fois par jour.

set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
load_config

: "${RETENTION_DAILY:=7}" "${RETENTION_WEEKLY:=4}" "${RETENTION_MONTHLY:=6}"

dow=$(date '+%u')   # 1..7, 7 = dimanche
dom=$(date '+%d')   # 01..31

promote_if() {
  local category="$1" src_dir="$2" dst_dir="$3" cond="$4"
  if [[ "$cond" == "yes" ]]; then
    local latest
    latest=$(find "$src_dir" -maxdepth 1 -type f -printf '%T@ %p\n' \
             | sort -nr | head -1 | awk '{print $2}')
    if [[ -n "$latest" ]]; then
      cp -p "$latest" "$dst_dir/"
      log "Promotion [$category] $(basename "$latest") → $(basename "$dst_dir")/"
    fi
  fi
}

prune() {
  local dir="$1" keep="$2"
  # Conserve les `keep` plus récents, supprime le reste.
  find "$dir" -maxdepth 1 -type f -printf '%T@ %p\n' \
    | sort -nr \
    | awk -v k="$keep" 'NR > k {print $2}' \
    | xargs -r rm -v
}

for cat in postgres uploads config; do
  base="$BACKUP_ROOT/$cat"

  # Dimanche : copie le dernier daily vers weekly
  [[ "$dow" == "7" ]] && promote_if "$cat" "$base/daily" "$base/weekly" yes

  # 1er du mois : copie le dernier weekly vers monthly
  [[ "$dom" == "01" ]] && promote_if "$cat" "$base/weekly" "$base/monthly" yes

  prune "$base/daily"   "$RETENTION_DAILY"   2>/dev/null || true
  prune "$base/weekly"  "$RETENTION_WEEKLY"  2>/dev/null || true
  prune "$base/monthly" "$RETENTION_MONTHLY" 2>/dev/null || true
done

log "Rotation terminée"
