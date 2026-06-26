# Protection périmétrique HEUREKA — CrowdSec (VPS OVH)

CrowdSec (IPS open-source, **éditeur 🇫🇷 — CrowdSec SAS, Paris**) analyse les
logs nginx + SSH du VPS et bannit au pare-feu (nftables) les IP au comportement
malveillant : brute-force sur `/api/auth/login`, scan, tentatives d'exploitation
de CVE, bots agressifs.

Il **complète** (sans les remplacer) :

- l'anti-DDoS **L3/L4 OVH (VAC)**, gratuit et automatique, qui couvre le
  volumétrique réseau — hors périmètre CrowdSec ;
- le `express-rate-limit` applicatif (in-memory, mono-process, remis à zéro à
  chaque redémarrage) : CrowdSec persiste le blocage **en amont de Node**, au
  pare-feu, donc l'attaquant n'atteint plus l'application.

La documentation d'exploitation (procédures courantes, incident, contrôle
mensuel) vit dans
[`docs/security/dossier-exploitation.md`](../../docs/security/dossier-exploitation.md)
section 11. Ce README couvre l'installation et l'usage des scripts.

## 0. Modèle de déploiement (détection → blocage)

Détection et blocage sont **découplés**, ce qui permet un déploiement sûr en
deux temps :

```
   Internet
      │
      ▼  (anti-DDoS L3/L4 OVH VAC, en amont)
   ┌──────────────┐     lit       ┌───────────────┐
   │    nginx     │─ access.log ──►│   CrowdSec    │  ← moteur (détection)
   │   (TLS)      │   auth.log     │   (cscli)     │
   └──────────────┘                └───────┬───────┘
      │                                    │ décision
      ▼                                    ▼
   Node API                        nftables (bouncer) ── bloque l'IP
                                    └─ installé en 2e temps (enforcement)
```

1. **`install.sh`** pose le moteur + les collections → **détection seule**,
   rien n'est bloqué. On observe.
2. On **complète la whitelist** (IP de l'équipe) puis **`enable-blocking.sh`**
   pose le bouncer pare-feu → **blocage actif**.

## 1. Installation — étape par étape (sur le VPS)

```bash
# 0. Récupérer les scripts (le repo est déjà cloné sur le VPS)
cd /home/ubuntu/heurekia
git fetch origin && git pull
cd infra/crowdsec

# 1. Détection seule : moteur + collections nginx/CVE + acquisition + whitelist.
#    Aucun blocage à ce stade.
sudo ./install.sh

# 2. Vérifier que l'acquisition tourne et lit bien les logs nginx + syslog
sudo cscli metrics            # colonnes "Acquisition" : lignes lues > 0
sudo cscli collections list   # crowdsecurity/nginx, http-cve, linux présents

# 3. Observer 24-48 h. Regarder ce qui SERAIT bloqué (rien ne l'est encore) :
sudo cscli alerts list        # détections
sudo cscli decisions list     # décisions calculées

# 4. (Recommandé) Passer SSH en clé only — la vraie protection contre l'auto-ban
#    d'un admin nomade (cf. « Ne pas se faire bannir » plus bas).
#    Optionnel : ajouter une IP de SORTIE STABLE (VPN/bureau) dans la whitelist
#    locale (non versionnée), puis recharger.
sudo $EDITOR /etc/crowdsec/parsers/s02-enrich/heureka-whitelists-local.yaml
sudo systemctl reload crowdsec

# 5. Activer le blocage (installe le bouncer nftables). Le script refuse de
#    tourner si l'auth SSH par mot de passe est encore active (anti-lockout) ;
#    forcer si besoin : sudo FORCE=1 ./enable-blocking.sh
sudo ./enable-blocking.sh

# 6. Confirmer que le bouncer est enregistré et actif
sudo cscli bouncers list      # le pare-feu doit apparaître "valid"
```

### Ne pas se faire bannir (admin nomade)

CrowdSec bannit un **comportement** (brute-force, scan, CVE), pas une IP
inconnue : travailler depuis des lieux/IP différents ne déclenche rien tant que
ton trafic est normal. Les deux seuls risques d'auto-ban, et leurs parades :

1. **Brute-force SSH** (mauvais mot de passe / mauvaise clé en boucle).
   → **SSH en clé only** (`PasswordAuthentication no` dans `sshd_config`) : une
   clé acceptée ne génère aucune ligne d'échec, `ssh-bf` ne se déclenche jamais
   pour toi, **où que tu sois**. Parade n°1 ; `enable-blocking.sh` refuse
   d'ailleurs d'enforcer tant que l'auth par mot de passe est active.
   → Repli si tu gardes le mot de passe : `sudo cscli simulation enable
   crowdsecurity/ssh-bf` (détecte mais ne bannit pas).
2. **Échecs de login répétés** sur `admin.heurekia.com` → ne pas insister, et de
   toute façon c'est récupérable (ci-dessous).

**Filet de secours — un ban n'est jamais fatal.** La **console KVM/web OVH**
(Espace client → VPS → Console) passe hors pare-feu nftables : tu t'y connectes
toujours, même banni, et tu lèves le ban :

```bash
sudo cscli decisions delete --ip <ton-ip>   # ou --all en cas de panique
```

**Whitelist stable (optionnel).** Pour une whitelist qui te suit partout : route
ton admin par une **IP de sortie fixe** (VPN à IP dédiée ou bastion) et mets
cette unique `/32` dans le fichier local `heureka-whitelists-local.yaml`. Évite
les IP résidentielles dynamiques (IPv4 FAI ou IPv6 privacy extension) : elles
changent vite et la whitelist devient caduque.

## 2. Tester que ça marche

```bash
# Simuler une IP hostile (NON whitelistée) puis la lever :
sudo cscli decisions add --ip 203.0.113.200 --duration 5m --reason "test manuel"
sudo cscli decisions list                     # l'IP apparaît, type ban
sudo nft list ruleset | grep -A2 crowdsec     # présente dans le set nftables
sudo cscli decisions delete --ip 203.0.113.200

# Vérifier qu'une IP de confiance N'EST PAS bannissable :
sudo cscli decisions add --ip 127.0.0.1 --duration 5m --reason "test"
# → la whitelist au niveau parser ne bloque pas un ajout MANUEL ; la whitelist
#   protège des détections automatiques. Pour valider la whitelist auto, voir
#   `cscli explain` ci-dessous.
sudo cscli decisions delete --ip 127.0.0.1
```

Inspecter le cheminement d'une requête dans les parsers/scénarios :

```bash
sudo cscli explain --file /var/log/nginx/access.log --type nginx | tail -30
```

## 3. Usage quotidien

```bash
sudo cscli decisions list                 # qui est banni en ce moment
sudo cscli decisions delete --ip <ip>     # lever un faux positif
sudo cscli alerts list                    # historique des détections
sudo cscli metrics                        # santé : acquisition, scénarios
sudo cscli bouncers list                  # le pare-feu doit être vu récemment
sudo cscli hub list                       # collections à jour (pas de ⚠ tainted)
```

Mise à jour des règles de détection :

```bash
sudo cscli hub update && sudo cscli hub upgrade
sudo systemctl reload crowdsec
```

## 4. Console (optionnel, gratuit)

Tableau de bord web pour visualiser alertes et décisions. Inscription gratuite,
puis sur le VPS :

```bash
sudo cscli console enroll <clé-d-enrôlement>
```

Ce qui est partagé avec l'API centrale = **métadonnées sur les IP attaquantes**
(IP, scénario, horodatage) ; **jamais** de données pétitionnaire ni de contenu
de requête. En retour : la **blocklist communautaire** (IP déjà hostiles
ailleurs, bloquées de façon proactive). Pour un **zéro-partage** strict, ne pas
enrôler : la détection + le blocage locaux fonctionnent quand même, on perd
seulement la blocklist communautaire.

## 5. WAF inline (AppSec) — Phase 2, optionnelle

Le moteur ci-dessus est **comportemental / réputationnel** (il bannit des IP).
Pour un filtrage **inline par signature** (type ModSecurity / OWASP CRS), ajouter
le composant AppSec. Plus puissant mais **plus de pièces mobiles** (nécessite le
bouncer nginx Lua), à n'activer qu'après avoir stabilisé la Phase 1.

```bash
# Collections de virtual-patching (dérivées d'OWASP CRS) + règles génériques
sudo cscli collections install crowdsecurity/appsec-virtual-patching
sudo cscli collections install crowdsecurity/appsec-generic-rules
```

Acquisition AppSec (`/etc/crowdsec/acquis.d/heureka-appsec.yaml`) :

```yaml
appsec_config: crowdsecurity/appsec-default
listen_addr: 127.0.0.1:7422
name: heureka-appsec
source: appsec
labels:
  type: appsec
```

Puis installer le **bouncer nginx** (`crowdsec-nginx-bouncer`) et le pointer
sur `127.0.0.1:7422` en mode AppSec (il transfère chaque requête au moteur pour
inspection avant de la laisser passer). Détail : doc CrowdSec « AppSec / nginx
remediation ». Démarrer en `appsec_config` mode `DetectOnly` avant de passer en
`Active`, même logique d'observation que la Phase 1.

## 6. Souveraineté & RGPD

- **Éditeur français** (CrowdSec SAS, Paris) — cohérent avec la stratégie de
  souveraineté du [`plan-deploiement.md`](../../docs/plan-deploiement.md).
- **Aucune donnée pétitionnaire** ne quitte le VPS : CrowdSec lit des logs
  techniques (IP, URL, code HTTP), pas les corps de requête ni les fichiers.
- En mode enrôlé, seules des **métadonnées d'IP attaquantes** sont mutualisées ;
  mode hors-ligne possible pour zéro partage (cf. §4).
- Pas de nouveau sous-traitant qui voit les données des usagers → **pas de DPA
  ni de TIA requis** au sens art. 28/44 RGPD (contrairement à un proxy type
  Cloudflare qui terminerait le TLS).

## 7. Fichiers de ce dossier

| Fichier | Rôle |
|---|---|
| `install.sh` | Pose le moteur + collections + acquisition + whitelists (détection seule) |
| `enable-blocking.sh` | Installe le bouncer nftables (active le blocage) |
| `acquis.yaml` | Sources de logs analysées (nginx + auth.log) |
| `whitelists.yaml` | Base versionnée (loopback only) — **jamais d'IP perso ici** |
| `whitelists.local.example.yaml` | Modèle de whitelist locale (IP équipe) à déposer côté VPS, non versionné |
