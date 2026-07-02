# Plan de remédiation — Audit VPS OVH (juin 2026)

Plan d'action priorisé pour les findings de l'audit infrastructure
(`audit-vps-2026-06-19.html`, méthode SSH lecture seule : 5 critiques · 9 hautes ·
5 moyennes). Chaque point renvoie au script `infra/` existant quand il y en a un,
sinon donne la commande.

> **Topologie visée** : VPS OVH unique, `app` (Node) + `nginx` + `PostgreSQL`
> colocalisés. nginx (TLS) est le SEUL point d'entrée public ; l'API et Postgres
> doivent n'écouter qu'en loopback. Anti-DDoS L3/L4 OVH (VAC) en amont, gratuit.

> **Déjà traité côté code** (branche `claude/security-audit-findings`) :
> le 🔴 « Bug SQL — 92 crashs (`dashboard.ts:177`) » est corrigé (colonne
> `commune` qualifiée). Rien à faire sur le VPS pour ce point : il partira au
> prochain déploiement du code.

---

## ⚠️ Séquence sûre (anti-lockout) — respecter cet ordre

Le pare-feu, le durcissement SSH et CrowdSec peuvent te **verrouiller hors du
VPS** si activés dans le désordre. Ordre recommandé :

1. **SSH par clé d'abord** (§P1-a) — avant de fermer quoi que ce soit.
2. **Pare-feu** en autorisant explicitement 22/80/443 (§P0-a).
3. **Bind loopback** de l'API (§P0-b) + reload nginx.
4. **CrowdSec en détection seule**, observer 24-48 h, puis **blocage** en dernier
   (§P1-a). `enable-blocking.sh` refuse d'ailleurs d'agir tant que l'auth SSH par
   mot de passe est active.

Filet de secours à toutes les étapes : la **console KVM/web OVH** (Espace client →
VPS → Console) passe hors pare-feu — tu gardes toujours un accès.

---

## 🔴 Priorité 0 — Critiques

### P0-a · Pare-feu désactivé → réactiver (ufw)

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp     # SSH — NE PAS oublier avant enable
sudo ufw allow 80/tcp     # HTTP (redirection nginx → 443)
sudo ufw allow 443/tcp    # HTTPS
sudo ufw enable
sudo ufw status verbose    # vérifier : 22/80/443 seulement
```

Le port de l'API (3001 par défaut) ne doit **pas** apparaître en autorisé.

### P0-b · Port API accessible publiquement → écoute loopback + nginx

Le code accepte désormais la variable `HOST` (défaut inchangé `0.0.0.0`).
Sur le VPS, forcer le loopback pour que l'API ne soit joignable que via nginx :

```bash
# Dans /home/ubuntu/heurekia/apps/api/.env
echo 'HOST=127.0.0.1' | sudo tee -a /home/ubuntu/heurekia/apps/api/.env

# Redémarrer l'app (PM2 ou systemd selon le déploiement)
pm2 restart heureka-api    # ou : sudo systemctl restart heureka-api

# Vérifier que l'API n'écoute plus que sur 127.0.0.1
sudo ss -ltnp | grep 3001   # doit afficher 127.0.0.1:3001, PAS 0.0.0.0:3001
```

Confirmer que l'upstream nginx pointe bien en loopback :

```bash
grep -R proxy_pass /etc/nginx/    # doit cibler http://127.0.0.1:3001
sudo nginx -t && sudo systemctl reload nginx
```

Test externe : `curl http://<IP_PUBLIQUE_VPS>:3001/` doit désormais **échouer**
(connexion refusée / timeout), et `https://app.heurekia.com/api/health` répondre.

### P0-c · Clés GPG des backups introuvables → backups inutilisables

Les sauvegardes sont chiffrées en **GPG symétrique** avec la passphrase
`/etc/heureka/backup.passphrase` (cf. `infra/backup/`). Si cette passphrase est
perdue **ou** n'existe qu'ici (pas de copie hors-VPS), les backups hors-site OVH
sont **irrécupérables en cas de perte serveur**.

```bash
# 1. La passphrase existe-t-elle sur le VPS ?
sudo test -f /etc/heureka/backup.passphrase && echo "présente" || echo "ABSENTE"

# 2a. ABSENTE → les backups déjà chiffrés avec l'ancienne clé sont probablement
#     perdus. En générer une nouvelle et refaire un cycle complet :
sudo install -m 700 -d /etc/heureka
sudo openssl rand -base64 32 | sudo tee /etc/heureka/backup.passphrase >/dev/null
sudo chmod 600 /etc/heureka/backup.passphrase

# 2b. PRÉSENTE → vérifier qu'une COPIE est bien dans le coffre équipe (Bitwarden).
#     C'est la seule copie qui permet de restaurer si le VPS entier est perdu.
sudo cat /etc/heureka/backup.passphrase   # → dupliquer dans Bitwarden

# 3. Valider qu'un backup se déchiffre et se restaure réellement (DB jetable) :
cd /home/ubuntu/heurekia/infra/backup
sudo ./backup-postgres.sh
sudo ./verify.sh            # restore test dans VERIFY_DATABASE
sudo ./list-backups.sh      # local + hors-site cohérents
```

> **Action non technique indispensable** : la passphrase DOIT vivre à deux
> endroits (VPS + Bitwarden). Sans la copie hors-VPS, la stratégie 3-2-1 est
> caduque. Cf. `infra/backup/README.md` §6 et `dossier-exploitation.md`.

### P0-d · Aucun monitoring applicatif → brancher Sentry + Prometheus

Le code expose **déjà** les points d'intégration ; il ne reste qu'à les câbler :

```bash
# Error tracking : Sentry (init conditionnel dans src/sentry.ts, no-op sans DSN)
echo 'SENTRY_DSN=https://<clé>@<org>.ingest.sentry.io/<projet>' \
  | sudo tee -a /home/ubuntu/heurekia/apps/api/.env

# Métriques : endpoint Prometheus /metrics déjà servi (protégé par METRICS_TOKEN)
echo 'METRICS_TOKEN=<token-aléatoire>' \
  | sudo tee -a /home/ubuntu/heurekia/apps/api/.env

pm2 restart heureka-api    # ou systemctl restart
```

Puis pointer un scrape Prometheus (ou l'agent OVH/Grafana Cloud) sur
`https://app.heurekia.com/metrics` avec le `METRICS_TOKEN`, et créer les alertes
de base (taux de 5xx, API down, disque, échec de backup).

---

## 🟠 Priorité 1 — Hautes

### P1-a · Brute-force SSH non bloqué + rate limiting nginx absent → CrowdSec

Tout est scripté dans `infra/crowdsec/` (éditeur 🇫🇷, souverain). Déploiement en
deux temps (détection → blocage), cf. `infra/crowdsec/README.md`.

```bash
# 0. D'ABORD : SSH en clé uniquement (parade n°1 anti-lockout)
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart ssh
# (garder une session ouverte + tester une NOUVELLE connexion par clé avant de fermer)

cd /home/ubuntu/heurekia && git fetch origin && git pull
cd infra/crowdsec

# 1. Détection seule (moteur + collections nginx/CVE/ssh) — rien n'est bloqué
sudo ./install.sh
sudo cscli metrics && sudo cscli collections list

# 2. Observer 24-48 h ce qui SERAIT bloqué
sudo cscli alerts list
sudo cscli decisions list

# 3. (option) whitelist d'une IP de sortie stable de l'équipe, puis reload
sudo $EDITOR /etc/crowdsec/parsers/s02-enrich/heureka-whitelists-local.yaml
sudo systemctl reload crowdsec

# 4. Activer le blocage (bouncer nftables) — en dernier
sudo ./enable-blocking.sh
sudo cscli bouncers list    # le pare-feu doit être "valid"
```

CrowdSec persiste le blocage **en amont de Node** (au pare-feu), là où
`express-rate-limit` (in-memory, mono-process) ne protège que l'application.

### P1-b · Aucun alerting / aucun error tracking

Couvert par P0-d (Sentry = error tracking) une fois le DSN posé. Pour l'alerting,
router les alertes Prometheus/Sentry vers un canal d'astreinte (email/Slack) :
au minimum **API down**, **taux de 5xx**, **échec du cron de backup**,
**espace disque**.

---

## ✅ Vérification post-remédiation

- [ ] `curl http://<IP_VPS>:3001/` échoue depuis l'extérieur ; `…/api/health` OK via nginx
- [ ] `sudo ufw status` : uniquement 22/80/443
- [ ] `sudo ss -ltnp` : API en `127.0.0.1:3001`, Postgres en `127.0.0.1:5432`
- [ ] `sudo ./verify.sh` (backup) : restore test vert ; passphrase dupliquée dans Bitwarden
- [ ] Sentry reçoit un événement de test ; `/metrics` scrapé
- [ ] `sudo cscli bouncers list` : bouncer pare-feu actif ; SSH en clé only
- [ ] Rejouer la suite Playwright (`playwright-rapport-securite`) :
      - T13 path traversal → inspecter le CORPS (doit être `index.html`, pas un fichier système)
      - T14b/c mot de passe faible → doit désormais être **rejeté** (fix déjà en prod côté code)

---

## Références

- `infra/backup/README.md` — installation & usage des sauvegardes (GPG, rclone OVH)
- `infra/crowdsec/README.md` — déploiement CrowdSec détaillé + anti-lockout
- `docs/security/dossier-exploitation.md` — procédures d'exploitation, RTO/RPO, incidents
- `docs/security/todo.md` §« Audit sécurité externe — juin 2026 » — triage des 3 rapports
