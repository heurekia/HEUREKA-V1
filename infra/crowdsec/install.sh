#!/usr/bin/env bash
# Installe CrowdSec en mode DÉTECTION SEULE sur le VPS HEUREKA (OVH).
#
# Mode détection : le moteur analyse les logs nginx + SSH et calcule des
# décisions, mais RIEN n'est bloqué tant que le bouncer pare-feu n'est pas
# installé (cf. enable-blocking.sh). C'est l'étape sûre : on observe avant
# d'enforcer, sans risque de se couper l'accès.
#
# Idempotent : relançable sans casse.

set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2; }
die() { log "ERREUR: $*"; exit 1; }
[[ $EUID -eq 0 ]] || die "Ce script doit être lancé en root (ou via sudo)."

# 1. Dépôt officiel CrowdSec + moteur
if ! command -v cscli >/dev/null 2>&1; then
  log "Ajout du dépôt CrowdSec et installation du moteur…"
  curl -fsSL https://install.crowdsec.net | sh
  apt-get install -y crowdsec
else
  log "Moteur CrowdSec déjà présent — skip install paquet."
fi

# 2. Collections de détection. La collection 'linux' (SSH, syslog) est posée
#    par défaut ; on ajoute nginx + les scénarios CVE HTTP.
log "Mise à jour du hub et installation des collections…"
cscli hub update
cscli collections install crowdsecurity/nginx    || true
cscli collections install crowdsecurity/http-cve || true

# 3. Acquisition : on prend la main (source unique versionnée). On écarte
#    l'auto-détection du paquet pour éviter la double lecture des mêmes logs.
if [[ -f /etc/crowdsec/acquis.yaml ]]; then
  log "Mise de côté de l'acquisition auto-générée → acquis.yaml.dpkg-auto.bak"
  mv /etc/crowdsec/acquis.yaml /etc/crowdsec/acquis.yaml.dpkg-auto.bak
fi
install -d -m 755 /etc/crowdsec/acquis.d
install -m 644 "$HERE/acquis.yaml" /etc/crowdsec/acquis.d/heureka.yaml

# 4. Whitelist IP de confiance (anti auto-blocage). À COMPLÉTER avant d'enforcer.
install -d -m 755 /etc/crowdsec/parsers/s02-enrich
install -m 644 "$HERE/whitelists.yaml" \
  /etc/crowdsec/parsers/s02-enrich/heureka-whitelists.yaml

# 5. Démarrage / recharge
systemctl enable --now crowdsec
systemctl reload crowdsec 2>/dev/null || systemctl restart crowdsec

log "OK — CrowdSec installé en DÉTECTION SEULE (aucun blocage actif)."
log "Vérifier :   sudo cscli metrics   puis   sudo cscli alerts list"
log "Observer 24-48 h, compléter whitelists.yaml (IP équipe), puis lancer :"
log "   sudo ./enable-blocking.sh"
