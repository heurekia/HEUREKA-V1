#!/usr/bin/env bash
# Restauration interactive de PostgreSQL depuis une sauvegarde.
#
# Usage :
#   sudo ./restore-postgres.sh                 # menu interactif
#   sudo ./restore-postgres.sh <fichier.gpg>   # fichier explicite
#   sudo ./restore-postgres.sh --remote daily/heureka-2026-06-16.sql.gz.gpg
#                                              # télécharge depuis OVH d'abord
#
# Restaure dans une base TEMPORAIRE puis échange avec la prod après validation.
# Ne touche pas la base de production tant que l'opérateur ne confirme pas.

set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
require_root
load_config

: "${PG_DATABASE:?}" "${PG_USER:?}" "${PG_HOST:?}" "${PG_PORT:?}"

src=""
case "${1:-}" in
  "")
    # Menu : on liste les fichiers locaux
    mapfile -t files < <(find "$BACKUP_ROOT/postgres" -type f -name '*.gpg' | sort -r)
    [[ ${#files[@]} -eq 0 ]] && die "Aucune sauvegarde locale. Utiliser --remote ?"
    echo "Sauvegardes locales :"
    for i in "${!files[@]}"; do
      printf '  [%d] %s\n' "$i" "${files[$i]#$BACKUP_ROOT/}"
    done
    read -rp "Numéro à restaurer : " idx
    src="${files[$idx]}"
    ;;
  --remote)
    remote_path="${2:?Chemin relatif requis (ex: daily/heureka-2026-06-16.sql.gz.gpg)}"
    src="/tmp/$(basename "$remote_path")"
    log "Téléchargement depuis $RCLONE_REMOTE..."
    rclone copy "$RCLONE_REMOTE:$RCLONE_BUCKET/postgres/$remote_path" /tmp/
    ;;
  *)
    src="$1"
    ;;
esac

[[ -f "$src" ]] || die "Fichier absent : $src"

target_db="${PG_DATABASE}_restore_$(date '+%Y%m%d_%H%M%S')"
log "Restauration → base temporaire '$target_db'"

sudo -u postgres createdb -O "$PG_USER" "$target_db"

gpg_decrypt "$src" \
  | gunzip \
  | pg_restore -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" \
               -d "$target_db" --no-owner --no-acl --exit-on-error

log "Restauration terminée dans '$target_db'"
echo
echo "  Pour vérifier :"
echo "    psql -h $PG_HOST -U $PG_USER -d $target_db -c 'SELECT count(*) FROM dossiers;'"
echo
echo "  Pour BASCULER en prod (DESTRUCTIF) :"
echo "    sudo -u postgres psql -c \"ALTER DATABASE $PG_DATABASE RENAME TO ${PG_DATABASE}_old_$(date '+%Y%m%d');\""
echo "    sudo -u postgres psql -c \"ALTER DATABASE $target_db RENAME TO $PG_DATABASE;\""
echo
echo "  Pour jeter (rollback) :"
echo "    sudo -u postgres dropdb $target_db"
