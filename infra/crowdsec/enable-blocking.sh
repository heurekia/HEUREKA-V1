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

# Garde-fou anti-lockout. Le vrai risque d'auto-ban d'un admin nomade, c'est le
# brute-force SSH par mot de passe (scénario ssh-bf) depuis une nouvelle IP. Une
# whitelist n'est PAS requise si SSH est en clé only : on gate donc sur le bon
# critère (l'auth par mot de passe), pas sur la présence d'une whitelist.
if sshd -T 2>/dev/null | grep -qi '^passwordauthentication yes'; then
  log "ATTENTION : l'authentification SSH par mot de passe est ACTIVÉE."
  log "  → risque d'auto-ban (ssh-bf) depuis une IP non whitelistée."
  log "  Recommandé : passer SSH en clé only avant d'enforcer."
  log "  Secours quoi qu'il arrive : console KVM OVH (non filtrée) puis"
  log "    sudo cscli decisions delete --ip <ton-ip>"
  if [[ "${FORCE:-0}" != "1" ]]; then
    die "Abandon. Passer en clé only, ou forcer : sudo FORCE=1 ./enable-blocking.sh"
  fi
  log "FORCE=1 — on continue malgré l'auth par mot de passe."
else
  log "SSH par clé only (mot de passe désactivé) — OK pour enforcer."
fi

log "Installation du bouncer pare-feu (nftables)…"
apt-get install -y crowdsec-firewall-bouncer-nftables
systemctl enable --now crowdsec-firewall-bouncer

log "OK — blocage actif. Bouncer enregistré :"
cscli bouncers list
