# Helpers partagés par tous les scripts de backup. Sourcer en début de script :
#   source "$(dirname "$0")/lib/common.sh"
#
# Ne pas exécuter directement.

set -euo pipefail

CONFIG_FILE="${BACKUP_CONFIG:-/etc/heureka/backup.env}"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2
}

die() {
  log "ERREUR: $*"
  exit 1
}

require_root() {
  if [[ $EUID -ne 0 ]]; then
    die "Ce script doit être lancé en root (ou via sudo)."
  fi
}

load_config() {
  [[ -r "$CONFIG_FILE" ]] || die "Config introuvable : $CONFIG_FILE (cf. backup.env.example)"
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"

  : "${BACKUP_ROOT:?BACKUP_ROOT manquant}"
  : "${GPG_PASSPHRASE_FILE:?GPG_PASSPHRASE_FILE manquant}"
  [[ -r "$GPG_PASSPHRASE_FILE" ]] || die "Passphrase GPG illisible : $GPG_PASSPHRASE_FILE"
}

# Date du jour au format ISO court (utilisé dans les noms de fichiers)
today() { date '+%Y-%m-%d'; }

# Chiffrement symétrique. Lit stdin, écrit dans le fichier passé en argument.
gpg_encrypt() {
  local out="$1"
  gpg --batch --yes --quiet \
      --cipher-algo "${GPG_CIPHER:-AES256}" \
      --passphrase-file "$GPG_PASSPHRASE_FILE" \
      --symmetric --output "$out"
}

# Déchiffrement. Lit le fichier passé en argument, écrit sur stdout.
gpg_decrypt() {
  local in="$1"
  gpg --batch --quiet \
      --passphrase-file "$GPG_PASSPHRASE_FILE" \
      --decrypt "$in"
}

# Calcule sha256 d'un fichier (hex, sans nom).
sha256_of() {
  sha256sum "$1" | awk '{print $1}'
}

# Met à jour manifests/latest.json avec une entrée pour le fichier produit.
# Args : <category> <subdir> <file>
# Exemple : update_manifest postgres daily /var/backups/heureka/postgres/daily/x.sql.gz.gpg
update_manifest() {
  local category="$1" subdir="$2" file="$3"
  local manifests_dir="$BACKUP_ROOT/manifests"
  local latest="$manifests_dir/latest.json"
  mkdir -p "$manifests_dir"
  [[ -s "$latest" ]] || echo '{}' > "$latest"

  local size sha created
  size=$(stat -c '%s' "$file")
  sha=$(sha256_of "$file")
  created=$(date -Iseconds)

  # Mise à jour atomique via fichier temp + mv. jq requis.
  local tmp
  tmp=$(mktemp)
  jq --arg cat "$category" \
     --arg sub "$subdir" \
     --arg path "$file" \
     --arg sha "$sha" \
     --argjson size "$size" \
     --arg created "$created" \
     '.[$cat][$sub] = { path: $path, sha256: $sha, size: $size, created_at: $created }' \
     "$latest" > "$tmp"
  mv "$tmp" "$latest"
}
