#!/usr/bin/env bash
# Archive nginx + .env applicatif + dump PM2 (+ units systemd si présentes)
# → tar.gz → GPG → daily/

set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
load_config

: "${NGINX_CONF_DIR:?}" "${APP_ENV_FILE:?}"

dest_dir="$BACKUP_ROOT/config/daily"
mkdir -p "$dest_dir"
dest="$dest_dir/config-$(today).tar.gz.gpg"

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

# nginx
if [[ -d "$NGINX_CONF_DIR" ]]; then
  cp -a "$NGINX_CONF_DIR" "$stage/nginx"
else
  log "AVERTISSEMENT : $NGINX_CONF_DIR absent"
fi

# .env applicatif
if [[ -f "$APP_ENV_FILE" ]]; then
  install -d "$stage/app"
  cp "$APP_ENV_FILE" "$stage/app/.env"
else
  log "AVERTISSEMENT : $APP_ENV_FILE absent"
fi

# PM2 — dump.pm2 + ecosystem.config.* éventuel
install -d "$stage/pm2"
for pm2_user in ${PM2_USERS:-root}; do
  home=$(getent passwd "$pm2_user" | cut -d: -f6)
  src="$home/.pm2/dump.pm2"
  if [[ -f "$src" ]]; then
    cp "$src" "$stage/pm2/dump.pm2.$pm2_user"
    log "PM2 dump pour $pm2_user copié"
  fi
done
for eco in /opt/heureka/ecosystem.config.{js,cjs,json}; do
  [[ -f "$eco" ]] && cp "$eco" "$stage/pm2/"
done

# units systemd (optionnel — la plupart des déploiements PM2 n'en ont pas)
install -d "$stage/systemd"
for unit in ${SYSTEMD_UNITS:-}; do
  src="/etc/systemd/system/$unit"
  if [[ -f "$src" ]]; then
    cp "$src" "$stage/systemd/"
  fi
done

log "Archive config → $dest"
tar -C "$stage" -czf - . | gpg_encrypt "$dest"

size=$(du -h "$dest" | awk '{print $1}')
log "OK ($size)"

update_manifest config daily "$dest"
