#!/usr/bin/env bash
# Liste les sauvegardes disponibles côté VPS et côté OVH Object Storage.

set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
load_config

bold() { printf '\033[1m%s\033[0m\n' "$*"; }

bold "=== Sauvegardes locales — $BACKUP_ROOT ==="
for cat in postgres uploads config; do
  for sub in daily weekly monthly; do
    dir="$BACKUP_ROOT/$cat/$sub"
    [[ -d "$dir" ]] || continue
    files=$(find "$dir" -maxdepth 1 -type f | sort)
    if [[ -n "$files" ]]; then
      echo
      printf '  \033[36m%s/%s\033[0m\n' "$cat" "$sub"
      while IFS= read -r f; do
        size=$(du -h "$f" | awk '{print $1}')
        date=$(date -r "$f" '+%Y-%m-%d %H:%M')
        printf '    %s  %6s  %s\n' "$date" "$size" "$(basename "$f")"
      done <<< "$files"
    fi
  done
done

echo
bold "=== Manifest le plus récent ==="
manifest="$BACKUP_ROOT/manifests/latest.json"
if [[ -s "$manifest" ]]; then
  jq . "$manifest"
else
  echo "  (aucun)"
fi

echo
bold "=== Hors-site — $RCLONE_REMOTE:$RCLONE_BUCKET ==="
if command -v rclone >/dev/null 2>&1 \
   && rclone listremotes 2>/dev/null | grep -q "^${RCLONE_REMOTE}:$"; then
  rclone lsl "$RCLONE_REMOTE:$RCLONE_BUCKET" 2>/dev/null \
    | sort -k2,3 \
    | awk '{printf "  %-10s  %s %s  %s\n", $1, $2, $3, $4}'
else
  echo "  (rclone remote '$RCLONE_REMOTE' indisponible)"
fi
