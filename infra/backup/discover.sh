#!/usr/bin/env bash
# Détecte l'environnement local du VPS et suggère les valeurs à mettre
# dans backup.env. Lecture seule — n'écrit rien.

set -euo pipefail

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  ✓ %s\n' "$*"; }
warn() { printf '  ⚠ %s\n' "$*"; }
ko()   { printf '  ✗ %s\n' "$*"; }

bold "=== HEUREKA — découverte de l'environnement VPS ==="
echo

# ─── 1. PostgreSQL ──────────────────────────────────────────────────────────
bold "1. PostgreSQL"
if command -v psql >/dev/null 2>&1; then
  ok "psql installé : $(psql --version)"
else
  ko "psql introuvable — installer postgresql-client"
fi

if command -v pg_lsclusters >/dev/null 2>&1; then
  echo
  pg_lsclusters
else
  warn "pg_lsclusters indisponible (paquet postgresql-common)"
fi

if systemctl list-units --type=service --all 2>/dev/null | grep -q postgresql; then
  echo
  systemctl status postgresql --no-pager --lines=0 2>/dev/null | head -5 || true
fi

echo
echo "  Bases existantes (en tant qu'utilisateur 'postgres') :"
if sudo -u postgres psql -tAc 'SELECT datname FROM pg_database WHERE datistemplate = false;' 2>/dev/null; then
  :
else
  warn "Impossible de lister les bases (lancer en root ? postgres dispo ?)"
fi

# ─── 2. Application & uploads ───────────────────────────────────────────────
echo
bold "2. Application HEUREKA"
APP_CANDIDATES=(/opt/heureka /srv/heureka /home/heureka/app /var/www/heureka)
for d in "${APP_CANDIDATES[@]}"; do
  if [[ -d "$d" ]]; then
    ok "Dossier app détecté : $d"
    APP_FOUND="$d"
    break
  fi
done
[[ -z "${APP_FOUND:-}" ]] && warn "Aucun dossier app dans les emplacements usuels (${APP_CANDIDATES[*]})"

echo
echo "  Fichiers .env trouvés :"
find /opt /srv /home/heureka /var/www -maxdepth 5 -name '.env' -type f 2>/dev/null | head -10 | sed 's/^/    /'

echo
echo "  Recherche du dossier uploads :"
UPLOAD_CANDIDATES=(
  /var/lib/heureka/uploads
  /opt/heureka/apps/api/uploads
  /srv/heureka/apps/api/uploads
  /home/heureka/app/apps/api/uploads
)
for d in "${UPLOAD_CANDIDATES[@]}"; do
  if [[ -d "$d" ]]; then
    count=$(find "$d" -maxdepth 1 -type f | wc -l)
    size=$(du -sh "$d" 2>/dev/null | awk '{print $1}')
    ok "$d ($count fichiers, $size)"
  fi
done

# ─── 3. nginx & systemd ─────────────────────────────────────────────────────
echo
bold "3. nginx & systemd"
if [[ -d /etc/nginx ]]; then
  ok "/etc/nginx présent"
  ls /etc/nginx/sites-enabled 2>/dev/null | sed 's/^/    site: /'
else
  ko "/etc/nginx absent"
fi

echo
echo "  Processus PM2 :"
if command -v pm2 >/dev/null 2>&1; then
  pm2 list 2>/dev/null | sed 's/^/    /' | head -30
else
  warn "pm2 introuvable"
fi

echo
echo "  Units systemd heureka.* (le cas échéant) :"
systemctl list-units --type=service --all 'heureka*' 2>/dev/null | head -10 || true

# ─── 4. Outils requis ───────────────────────────────────────────────────────
echo
bold "4. Outils de sauvegarde"
for cmd in pg_dump pg_restore gpg rclone jq tar gzip sha256sum; do
  if command -v "$cmd" >/dev/null 2>&1; then
    ok "$cmd ($(command -v "$cmd"))"
  else
    ko "$cmd ABSENT"
  fi
done

# ─── 5. Espace disque ───────────────────────────────────────────────────────
echo
bold "5. Espace disque"
df -h / /var 2>/dev/null | sed 's/^/  /'

# ─── 6. rclone OVH ──────────────────────────────────────────────────────────
echo
bold "6. rclone — remote OVH"
if command -v rclone >/dev/null 2>&1; then
  if rclone listremotes 2>/dev/null | grep -q '^ovh-s3:$'; then
    ok "Remote 'ovh-s3' configuré"
    rclone about ovh-s3: 2>/dev/null | sed 's/^/    /' || warn "Pas d'info bucket (vérifier credentials)"
  else
    warn "Remote 'ovh-s3' à créer : sudo rclone config"
  fi
fi

echo
bold "=== Fin de la découverte ==="
echo "Reporter les valeurs détectées dans /etc/heureka/backup.env"
echo "(modèle : infra/backup/backup.env.example)"
