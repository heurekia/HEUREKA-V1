#!/usr/bin/env bash
# Restauration interactive du dossier uploads depuis une sauvegarde.
# Restaure dans un dossier de STAGING ; à l'opérateur de basculer après check.

set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
require_root
load_config

: "${UPLOADS_DIR:?}"

src=""
case "${1:-}" in
  "")
    mapfile -t files < <(find "$BACKUP_ROOT/uploads" -type f -name '*.gpg' | sort -r)
    [[ ${#files[@]} -eq 0 ]] && die "Aucune sauvegarde locale. Utiliser --remote ?"
    echo "Sauvegardes locales :"
    for i in "${!files[@]}"; do
      printf '  [%d] %s\n' "$i" "${files[$i]#$BACKUP_ROOT/}"
    done
    read -rp "Numéro à restaurer : " idx
    src="${files[$idx]}"
    ;;
  --remote)
    remote_path="${2:?Chemin relatif requis (ex: daily/uploads-2026-06-16.tar.gz.gpg)}"
    src="/tmp/$(basename "$remote_path")"
    rclone copy "$RCLONE_REMOTE:$RCLONE_BUCKET/uploads/$remote_path" /tmp/
    ;;
  *)
    src="$1"
    ;;
esac

[[ -f "$src" ]] || die "Fichier absent : $src"

staging="${UPLOADS_DIR}_restore_$(date '+%Y%m%d_%H%M%S')"
install -d -m 700 "$staging"
log "Restauration → staging $staging"

gpg_decrypt "$src" | tar -C "$staging" -xzf -

count=$(find "$staging" -type f | wc -l)
log "Restauré : $count fichiers"
echo
echo "  Pour BASCULER en prod (DESTRUCTIF) :"
echo "    mv $UPLOADS_DIR ${UPLOADS_DIR}.old.$(date '+%Y%m%d_%H%M%S')"
echo "    mv $staging/$(basename "$UPLOADS_DIR") $UPLOADS_DIR"
echo "    pm2 restart heurekia-api"
