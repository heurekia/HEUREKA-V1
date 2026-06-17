# Sauvegardes HEUREKA — VPS OVH

Process complet 3-2-1 (3 copies, 2 supports, 1 hors-site) pour PostgreSQL,
fichiers déposés (`uploads/`) et configuration serveur (nginx, `.env`, systemd).

La documentation opérationnelle complète (procédures pas-à-pas, RTO/RPO,
test de restauration, escalade incident) vit dans
[`docs/security/dossier-exploitation.md`](../../docs/security/dossier-exploitation.md).
Ce README couvre uniquement l'installation et l'usage quotidien des scripts.

## 1. Installation initiale (une seule fois sur le VPS)

```bash
# 1. Cloner le repo et se placer ici
cd /home/ubuntu/heurekia/infra/backup

# 2. Découvrir l'environnement local (Postgres, uploads, app)
sudo ./discover.sh

# 3. Copier et compléter la conf à partir des valeurs détectées
sudo cp backup.env.example /etc/heureka/backup.env
sudo chmod 600 /etc/heureka/backup.env
sudo $EDITOR /etc/heureka/backup.env

# 4. Générer la passphrase GPG (32 octets aléatoires) et la dupliquer
#    dans Bitwarden / le coffre de l'équipe technique.
sudo install -m 700 -d /etc/heureka
sudo openssl rand -base64 32 | sudo tee /etc/heureka/backup.passphrase >/dev/null
sudo chmod 600 /etc/heureka/backup.passphrase

# 5. Configurer rclone pour OVH Object Storage (interactive)
sudo rclone config   # créer un remote nommé "ovh-s3" — type s3, provider Other,
                     # endpoint s3.gra.io.cloud.ovh.net (ou sbg / rbx)

# 6. Préparer l'arborescence locale
sudo ./install.sh

# 7. Installer le cron
sudo ./install-cron.sh
```

## 2. Usage quotidien

```bash
# Lister les sauvegardes (local + hors-site)
sudo ./list-backups.sh

# Forcer une sauvegarde immédiate (ex. avant migration)
sudo ./backup-postgres.sh
sudo ./backup-uploads.sh

# Restaurer Postgres à une date donnée (interactif)
sudo ./restore-postgres.sh

# Restaurer les uploads
sudo ./restore-uploads.sh

# Vérifier l'intégrité d'une sauvegarde (restore test dans DB jetable)
sudo ./verify.sh
```

## 3. Dupliquer une sauvegarde vers un autre environnement

```bash
# Vers un poste de dev (depuis le poste de dev)
rclone copy ovh-s3:heureka-backups/postgres/daily/heureka-2026-06-16.sql.gz.gpg ./
gpg --decrypt --batch --passphrase-file ./passphrase \
  heureka-2026-06-16.sql.gz.gpg | gunzip | pg_restore -d heureka_dev
```

La procédure complète est dans le Dossier d'Exploitation.

## 4. Arborescence

```
/var/backups/heureka/
├── postgres/
│   ├── daily/    (7 derniers jours)
│   ├── weekly/   (4 dernières semaines)
│   └── monthly/  (6 derniers mois)
├── uploads/      (même structure)
├── config/       (même structure)
└── manifests/
    └── latest.json   ← index lisible : nom, sha256, taille, date
```

## 5. Cible hors-site

OVH Object Storage (S3 Swift), bucket `heureka-backups`, région Gravelines (GRA)
par défaut. Configurer via `rclone config` ; le remote doit s'appeler `ovh-s3`.

## 6. Sécurité

- Tous les artefacts sont chiffrés **GPG symétrique** avant écriture sur disque
  et avant envoi hors-site.
- La passphrase est stockée dans `/etc/heureka/backup.passphrase` (mode 600,
  root only) **et** dans le coffre de l'équipe (Bitwarden) — c'est la seule
  copie qui permet de restaurer si le VPS est entièrement perdu.
- `backup.env` contient des secrets (host DB, credentials rclone si en clair) :
  mode 600, jamais commité.
