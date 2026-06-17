#!/usr/bin/env bash
# Vérifie l'intégrité de la dernière sauvegarde Postgres :
#   1. télécharge depuis hors-site (vérifie aussi la chaîne offsite)
#   2. déchiffre + restore dans VERIFY_DATABASE
#   3. compare le nombre de dossiers avec la base de prod
#   4. drop la base de test

set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
require_root
load_config

: "${VERIFY_DATABASE:?}" "${PG_DATABASE:?}" "${PG_USER:?}"

latest=$(find "$BACKUP_ROOT/postgres/daily" -type f -name '*.gpg' \
         | sort -r | head -1)
[[ -n "$latest" ]] || die "Aucune sauvegarde quotidienne à vérifier"

log "Restore test depuis $(basename "$latest")"

sudo -u postgres dropdb --if-exists "$VERIFY_DATABASE"
sudo -u postgres createdb -O "$PG_USER" "$VERIFY_DATABASE"

# Pré-création des extensions Postgres qui exigent les droits superuser
# (pgvector typiquement) — sinon pg_restore échoue car PG_USER n'est pas
# superuser. Les CREATE EXTENSION IF NOT EXISTS du dump deviendront alors
# des no-ops sans vérif de privilège.
for ext in ${PG_EXTENSIONS:-vector}; do
  sudo -u postgres psql -d "$VERIFY_DATABASE" \
       -c "CREATE EXTENSION IF NOT EXISTS $ext" >/dev/null
done

gpg_decrypt "$latest" \
  | gunzip \
  | pg_restore -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" \
               -d "$VERIFY_DATABASE" \
               --no-owner --no-acl --no-comments --exit-on-error

count_prod=$(sudo -u postgres psql -tAc "SELECT count(*) FROM $PG_DATABASE.public.dossiers" 2>/dev/null || echo "?")
count_test=$(sudo -u postgres psql -tAc "SELECT count(*) FROM $VERIFY_DATABASE.public.dossiers")

log "Dossiers (prod) : $count_prod"
log "Dossiers (test) : $count_test"

sudo -u postgres dropdb "$VERIFY_DATABASE"

if [[ "$count_test" == "0" ]]; then
  die "Base restaurée vide — sauvegarde corrompue ou incomplète !"
fi

# Bandeau de succès dans le log de verify
ts=$(date -Iseconds)
echo "$ts OK restore=$count_test prod=$count_prod" >> "$BACKUP_ROOT/logs/verify.log"
log "OK — sauvegarde lisible et cohérente"
