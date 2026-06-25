#!/usr/bin/env bash
# Active le BLOCAGE CrowdSec : installe le bouncer pare-feu (nftables).
#
# À lancer SEULEMENT après :
#   - avoir tourné en détection seule 24-48 h (install.sh) ;
#   - avoir complété la whitelist (IP bureau / VPN admin / monitoring) dans
#     /etc/crowdsec/parsers/s02-enrich/heureka-whitelists.yaml,
# faute de quoi risque de se bannir soi-même.

set -euo pipefail
log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2; }
die() { log "ERREUR: $*"; exit 1; }
[[ $EUID -eq 0 ]] || die "Ce script doit être lancé en root (ou via sudo)."

command -v cscli >/dev/null 2>&1 || die "Moteur absent — lancer ./install.sh d'abord."

# Garde-fou : refuser tant que la whitelist n'a pas été personnalisée.
WL=/etc/crowdsec/parsers/s02-enrich/heureka-whitelists.yaml
if grep -q 'A_COMPLETER' "$WL" 2>/dev/null; then
  die "Whitelist non complétée ($WL) : renseigner l'IP de l'équipe et retirer
       le marqueur A_COMPLETER avant d'activer le blocage."
fi

log "Installation du bouncer pare-feu (nftables)…"
apt-get install -y crowdsec-firewall-bouncer-nftables
systemctl enable --now crowdsec-firewall-bouncer

log "OK — blocage actif. Bouncer enregistré :"
cscli bouncers list
