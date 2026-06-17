#!/usr/bin/env bash
# Dump Postgres → gzip → chiffrement GPG → daily/

set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
load_config

: "${PG_DATABASE:?}" "${PG_USER:?}" "${PG_HOST:?}" "${PG_PORT:?}"

dest_dir="$BACKUP_ROOT/postgres/daily"
mkdir -p "$dest_dir"
dest="$dest_dir/heureka-$(today).sql.gz.gpg"

log "Dump $PG_DATABASE → $dest"

# Exclut les extensions superuser-only (pgvector typiquement). Elles seront
# pré-créées au restore par verify.sh / restore-postgres.sh comme user
# postgres, ce qui évite les erreurs "permission denied" et "must be owner".
exclude_args=()
for ext in ${PG_EXTENSIONS:-vector}; do
  exclude_args+=(--exclude-extension="$ext")
done

# pg_dump en format custom (-Fc) : plus compact et permet le restore sélectif.
# Le mot de passe est lu depuis ~/.pgpass (mode 600) — voir backup.env.example.
PGPASSWORD="${PGPASSWORD:-}" \
  pg_dump \
    -h "$PG_HOST" -p "$PG_PORT" \
    -U "$PG_USER" -d "$PG_DATABASE" \
    -Fc --no-owner --no-acl \
    "${exclude_args[@]}" \
  | gzip -9 \
  | gpg_encrypt "$dest"

size=$(du -h "$dest" | awk '{print $1}')
log "OK ($size)"

update_manifest postgres daily "$dest"
