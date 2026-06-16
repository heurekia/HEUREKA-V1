# Plan de déploiement HEUREKA — Production et souveraineté européenne

| Champ | Valeur |
|-------|--------|
| Version | 3.0 (post-bascule VPS OVH) |
| Date | Juin 2026 |
| Auteur | Équipe technique HEUREKIA |
| Statut | LLM 🇫🇷 livré (PR #117). Hébergement 🇫🇷 livré (VPS OVH). Stockage objet, email, certificat OV : restent à traiter. |

## 1. Contexte et objectif

HEUREKA est désormais hébergé sur un **VPS OVH 🇫🇷** (PostgreSQL + nginx + Node sur la même machine), avec analyse IA via **Mistral La Plateforme** (Pixtral Large, datacenters France) et sauvegardes 3-2-1 vers **OVH Object Storage** (cf. [`docs/security/dossier-exploitation.md`](./security/dossier-exploitation.md)). Les briques LLM et hébergement sont entièrement souveraines 🇫🇷.

Restent à traiter pour une stack 100 % souveraine : email transactionnel (Brevo), certificat SSL OV, fond de carte (IGN).

Ce plan décrit la suite de la migration, avec des phases indépendantes qu'on peut activer ou suspendre selon les arbitrages DSI / DPD / budget. L'historique des phases déjà livrées (Phase 0 LLM, Phase 1 stockage objet, Phase 2 bascule hébergement) est conservé à titre de référence.

## 2. État actuel (post-bascule OVH, juin 2026)

| Brique | Fournisseur | Société | Données |
|---|---|---|---|
| **Hébergement app + DB** | **VPS OVH** | **🇫🇷** | **🇫🇷** |
| **Sauvegardes** | **OVH Object Storage** (S3, GRA) | **🇫🇷** | **🇫🇷** |
| **LLM** | **Mistral La Plateforme** | **🇫🇷 Paris** | **🇫🇷 France** |
| Email transactionnel | Resend | 🇺🇸 | 🇪🇺/🇺🇸 |
| Stockage fichiers (PDF déposés) | Disque local du VPS OVH | 🇫🇷 | 🇫🇷 |
| Fond de carte | CartoCDN | 🇺🇸 | n/a |
| Recherche d'adresses | data.gouv.fr | 🇫🇷 | 🇫🇷 |
| Cadastre / PLU | data.geopf.fr | 🇫🇷 | 🇫🇷 |
| Certificat SSL | Let's Encrypt (DV) via certbot/nginx | 🇺🇸 nonprofit | n/a |

## 3. État cible (Niveau 3a — pragmatique)

| Brique | Fournisseur cible | Société |
|---|---|---|
| Hébergement app + DB | ✅ VPS OVH | 🇫🇷 Gravelines |
| Stockage fichiers | VPS OVH (volume) ou OVH Object Storage si volumétrie le justifie | 🇫🇷 |
| Sauvegardes hors-site | ✅ OVH Object Storage (S3) | 🇫🇷 |
| LLM | ✅ Mistral La Plateforme | 🇫🇷 Paris |
| Email transactionnel | Brevo (ex-Sendinblue) | 🇫🇷 |
| Fond de carte | IGN data.geopf.fr/wmts | 🇫🇷 |
| Certificat SSL | CertEurope OV | 🇫🇷 |

État cible alternatif (Niveau 3b — SecNumCloud) traité en **Phase 7 (optionnelle)**.

---

## 4. Phases détaillées

### Phase 0 — Bascule LLM vers Mistral La Plateforme ✅ LIVRÉ (PR #117)

**Objectif initial** (annulé) : stabiliser Bedrock UE.
**Décision juin 2026** : on saute Bedrock UE et on bascule directement sur Mistral La Plateforme (Paris). Raisons : Pixtral indispensable pour la vision, indisponible sur Bedrock ; souveraineté française réelle (Mistral SAS Paris, droit français) plutôt que UE-via-AWS.

**Statut** :
- ✅ Refonte `aiUsage.ts` Mistral-only — `callAi()` + `streamAi()` + tracking `ai_usage_events`
- ✅ Portage des 8 call sites (citoyen + mairie + scripts CLI)
- ✅ Suppression `@anthropic-ai/sdk` + `@anthropic-ai/bedrock-sdk` + chemins Bedrock
- ✅ Variable d'environnement `MISTRAL_API_KEY` déployée sur le VPS
- ✅ Variables `ANTHROPIC_*`, `AWS_*` (pour l'IA), `AI_PROVIDER`, `AI_USD_TO_EUR` retirées

**Critère de validation** :
- 1 dépôt de pièce test → bandeau de score `Conforme/Acceptable/…` affiché dans le wizard
- Ligne `[aiUsage] 🇫🇷 Fournisseur d'inférence : Mistral La Plateforme (fr-paris)` au boot du service
- Entrée `ai_usage_events` avec `model = pixtral-large-latest`, `cost_eur > 0`, `file_hash` non null
- Conversion automatique PDF → PNG via `pdftoppm` (paquet `poppler-utils` installé sur le VPS)

**Rollback** : non. Les chemins Anthropic sont supprimés. En cas de panne Mistral prolongée, désactivation de l'analyse IA côté wizard (équivalent au cas où le pétitionnaire refuse l'analyse).

**Garde-fou facturation** : seuils par appel et journalier dans `ai_alert_config` (page admin Coûts IA), alerte Slack.

---

### Phase 1 — Stockage objet S3-compatible ✅ CODÉ (activable à la demande)

**Statut** : l'abstraction `StorageProvider` (local | S3) est codée et testée dans `apps/api/src/services/storage.ts`. Sur le VPS OVH actuel, on tourne en `STORAGE_PROVIDER=local` car le disque du VPS est persistant. La bascule vers OVH Object Storage (via le même code) reste un simple changement de variables d'env, à activer si la volumétrie ou la stratégie de redondance le justifie.

**Pourquoi cette abstraction reste utile** : les sauvegardes du dossier uploads sont gérées par `infra/backup/backup-uploads.sh` (snapshot quotidien + miroir OVH Object Storage). Mais en cas de croissance forte des dépôts (> 50 Go) ou de besoin de servir les fichiers depuis plusieurs VPS, la bascule sur S3 deviendra rentable.

**Tâches techniques** :
1. Ajouter `@aws-sdk/client-s3` + `multer-s3` aux dépendances de `apps/api`.
2. Créer `apps/api/src/services/storage.ts` — abstraction `StorageProvider` avec deux implémentations : `LocalStorage` (actuel) et `S3Storage` (Cellar / Scaleway / OVH OS / AWS S3 — tous compatibles S3).
3. Switch d'env `STORAGE_PROVIDER=local|s3` + variables `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
4. Refactor des 3 points qui touchent le disque :
   - `routes/dossiers.ts` upload (multer.diskStorage → multer-s3)
   - `routes/dossiers.ts` lecture/streaming (signed URL)
   - `routes/dossiers.ts` suppression pièce
   - `routes/auth.ts` DELETE /me (suppression bulk)
   - `jobs/scheduler.ts` purge brouillons (suppression bulk)
   - `services/pieceAnalyzer.ts` + `pieceExtractor.ts` (lecture du buffer pour envoi à l'IA — passage par signed URL ou `getObject`)
5. Tests unitaires sur l'abstraction.
6. Migration des fichiers existants en prod : script `scripts/migrate-uploads-to-s3.ts` qui parcourt `dossier_pieces_jointes`, lit chaque fichier local, l'upload sur S3, met à jour l'URL en base.

**Provisionnement à effectuer le jour de la bascule** :
- Conteneur OVH Object Storage `heureka-uploads` (séparé du conteneur de sauvegardes `heureka-backups`).
- Clé S3 dédiée (write pour le VPS de prod, scope conteneur uniquement).

**Critères de validation (le jour où on active)** :
- 121 tests API passent + tests sur l'abstraction
- Upload depuis le wizard → fichier visible dans le conteneur OVH
- Suppression de compte → fichier supprimé du conteneur
- Téléchargement par instructeur → URL signée valide 15 min
- Script `scripts/migrate-uploads-to-s3.ts` exécuté pour les fichiers historiques

**Rollback** : `STORAGE_PROVIDER=local` → retour au disque local du VPS. Les anciens fichiers (avant migration) restent sur disque, les nouveaux sur S3 — gérer la cohabitation pendant la transition via le champ `url` de chaque pièce.

---

### Phase 2 — Migration vers hébergement français ✅ LIVRÉ (VPS OVH)

**Décision finale** : choix d'un **VPS OVH** plutôt que Clever Cloud. Raisons :
- Souveraineté équivalente (OVH 🇫🇷, datacenters Gravelines / Strasbourg / Roubaix).
- Coût maîtrisé (~10-20 €/mois pour le VPS d'entrée de gamme vs ~55 €/mois Clever).
- Disque persistant → le stockage des PDF déposés peut rester en `local` (cf. Phase 1) sans surcoût immédiat.
- Contrepartie : on récupère la responsabilité de l'OS, des mises à jour, des sauvegardes — d'où la création du [Dossier d'Exploitation](./security/dossier-exploitation.md) et des scripts `infra/backup/`.

**Stack en place** :
- 1 VPS OVH (Ubuntu LTS)
- nginx (reverse proxy + TLS Let's Encrypt via certbot)
- PostgreSQL installé localement, accédé en `127.0.0.1`
- API Node lancée via systemd (`heureka-api.service`)
- Frontend Vite buildé et servi par nginx
- Sauvegardes 3-2-1 chiffrées GPG vers OVH Object Storage (cf. `infra/backup/`)

**Variables d'environnement déployées** : `JWT_SECRET`, `DATABASE_URL`, `MISTRAL_API_KEY`, `RESEND_API_KEY` (en attente de bascule Brevo), `PISTE_CLIENT_ID/SECRET`, `VOYAGE_API_KEY`. Stockées dans `/opt/heureka/apps/api/.env` (mode 600, propriétaire root).

**Budget effectif** :
- VPS OVH `VPS Comfort` (4 vCPU, 8 Go RAM, 160 Go SSD) : ~12 €/mois
- OVH Object Storage (sauvegardes ≤ 100 Go) : ~3 €/mois
- **Total : ~15 €/mois** (vs ~30-50 €/mois Railway et ~55 €/mois Clever Cloud envisagé).

**Procédure de mise à jour applicative** : voir [`dossier-exploitation.md`](./security/dossier-exploitation.md) §8.

**Rollback** : non — Railway a été arrêté. La base de données Railway a été dumpée et stockée sur le coffre froid de l'équipe avant arrêt.

---

### Phase 3 — Sous-traitants annexes (3-4 jours, en parallèle de Phase 2)

#### 3.1 Email transactionnel → Brevo (🇫🇷)

**Tâches** :
1. Créer compte Brevo, récupérer API key.
2. Refactor `apps/api/src/services/mailer.ts` : remplacer le client `resend` par `@getbrevo/brevo` ou `axios` direct sur l'API REST Brevo.
3. Recopier les templates d'activation, reset password, notifications.
4. Variables env : `BREVO_API_KEY` au lieu de `RESEND_API_KEY`.
5. Tests : déclencher 1 reset password, vérifier réception.
6. Mettre à jour la fiche n°3 du registre + politique de confidentialité (Brevo remplace Resend dans le tableau des sous-traitants).

**Effort** : 1/2 journée.

#### 3.2 Fond de carte → IGN (🇫🇷)

**Tâches** :
1. Dans la CSP (`apps/api/src/app.ts` Helmet) : retirer `https://*.basemaps.cartocdn.com`, garder `https://data.geopf.fr` (déjà présent).
2. Dans le code carto (frontend, `MapLeaflet.tsx`) : remplacer l'URL des tuiles CartoDB par une couche WMTS IGN (par exemple `https://data.geopf.fr/wmts?...&layer=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2`).
3. Tester sur quelques zooms / régions, vérifier la lisibilité du style cartographique.

**Effort** : 1/2 journée.

#### 3.3 Certificat SSL OV → CertEurope (🇫🇷)

**Pourquoi** : Annexe Technique n°2 §4.9 de la DSI Tours demande un certificat OV (Organization Validation) minimum, vs DV (Domain Validation) actuellement fourni gratuitement par Let's Encrypt via certbot sur le VPS.

**Tâches** :
1. Commander un certificat OV chez CertEurope ou GlobalSign (FR) — délai ~3 jours ouvrés, ~150 €/an.
2. Procédure de validation (vérification de l'organisation = HEUREKIA SAS via Kbis + appel téléphonique).
3. Installation sur le VPS : copier `fullchain.pem` et `privkey.pem` dans `/etc/nginx/ssl/`, mettre à jour le bloc `server` nginx (directives `ssl_certificate` / `ssl_certificate_key`), `nginx -t && systemctl reload nginx`. Désactiver le renouvellement Let's Encrypt sur ce domaine.
4. Vérification : `curl -vI https://app.heurekia.com 2>&1 | grep -i "issued\|organization"` doit montrer CertEurope.

**Effort** : 2 jours élapsés (dont 1 jour d'attente validation).

---

### Phase 4 — Benchmark de validation Mistral (1 semaine, post-livraison)

**Objectif** (mis à jour) : la bascule Mistral est déjà livrée. Cette phase devient une **phase de validation a posteriori** sur des fixtures réelles, pour confirmer que Pixtral Large tient les seuils de qualité et de coût attendus, et pour potentiellement descendre certains usages vers Pixtral 12B (économies de coût).

**Pré-requis** :
- ✅ `MISTRAL_API_KEY` déployée (VPS OVH + dev)
- 15 à 30 pièces réelles **anonymisées** dans `packages/ingestion/benchmark-fixtures/pieces/`
- `manifest.json` complété avec les vérités-terrain (cf. `RUN-BENCHMARK.md`)

**Exécution** :
```bash
MISTRAL_API_KEY=...
pnpm --filter @heureka-v1/ingestion benchmark:llm \
  --mistral-models pixtral-large,pixtral-12b \
  --out docs/security/benchmark-llm-resultats-2026-06.md
```

**Critères de décision** :
- Si **F1 Pixtral Large ≥ 0,80** sur les fixtures → décision Mistral confirmée, documenter au DPD avec le rapport.
- Si **F1 Pixtral Large < 0,75** → escalade : itérer sur les prompts, ré-évaluer le choix de modèle (Mistral Medium 3 vision quand disponible).
- Si **F1 Pixtral 12B ≥ 0,80** sur les usages simples (`ai-fast`) → repointer `ai-fast` vers Pixtral 12B dans `MODEL_MAP` (économies x10 sur ces appels).

---

### Phase 5 — Finalisation DPA + signatures juridiques

**Objectif** : verrouiller juridiquement les sous-traitants.

**LLM (décidé)** :
- ✅ Mistral La Plateforme retenu (cf. Phase 0)
- [ ] Signer le DPA Mistral AI (procédure dans `docs/security/dpa-mistral-checklist.md`)
- [x] Localisation 🇫🇷 Paris des datacenters confirmée
- [x] Aucun TIA nécessaire (pas de transfert hors UE)
- [x] Fiche n°2 du registre art. 30 mise à jour

**Autres sous-traitants** :
- DPA Brevo
- DPA OVH (hébergement VPS + Object Storage)
- DPA CertEurope (si OV)

**Effort** : 1-3 semaines élapsées (dépend de la réactivité des fournisseurs commerciaux).

---

### Phase 6 — AIPD signée + Registre art. 30 finalisé

**Objectif** : verrouiller juridiquement le traitement côté collectivité.

**Tâches** (à faire avec chaque commune cliente, **avant** mise en production officielle) :
1. La collectivité complète les `[À COMPLÉTER]` du registre des traitements (`docs/security/registre-traitements.md`).
2. Le DPD de la collectivité valide l'AIPD (`docs/security/aipd.md`) — section "Avis du DPD" à signer.
3. Le responsable de traitement (maire / président EPCI) signe la décision de mise en œuvre.
4. Inscription du traitement au registre interne de la collectivité.
5. Notification CNIL si applicable (rarement nécessaire pour ce type de traitement, mais à vérifier au cas par cas).

**Effort** : à la charge de la collectivité (HEUREKIA fournit l'assistance via les documents pré-remplis).

---

### Phase 7 — SecNumCloud (optionnelle, 1-3 mois)

**À déclencher UNIQUEMENT si** la DSI Tours Métropole (ou une future DSI cliente) exige formellement la qualification SecNumCloud (label ANSSI) dans son cahier des charges.

**Conséquences** :
- Migration vers **3DS Outscale** (🇫🇷, Dassault Systèmes, SecNumCloud qualifié).
- LLM auto-hébergé : **Mistral / Llama Vision sur GPU Outscale**, prompts et infra à maintenir en interne.
- Email : **Tipimail** (en cours qualification HDS) ou self-hosted.
- Sortie du VPS OVH standard (qui n'est pas SecNumCloud — seule l'offre OVH "Hosted Private Cloud SecNumCloud" l'est, plus chère).
- **Coût × 5 à × 10** vs niveau 3a (GPU H100 dédié ~3-5 k€/mois).
- **Effort** : 1 à 3 mois de migration + maintenance opérationnelle continue (mises à jour modèles, monitoring, etc.).

**Recommandation** : à n'engager **que sur appel d'offres formel** d'une collectivité qui le justifie. Le ROI est défavorable autrement.

---

## 5. Calendrier global

```
Sem 1  │ [Phase 0] Bascule LLM Mistral La Plateforme ✓ (PR #117)
Sem 2  │ [Phase 1] Stockage objet S3 — code livré (activable)
Sem 3  │ [Phase 2] Bascule Railway → VPS OVH ✓
       │ [Sauvegardes] Scripts infra/backup + Dossier d'Exploitation ✓
Sem 4  │ [Phase 3] Brevo (email) — 1/2 j
       │ [Phase 3] IGN (carto) — 1/2 j
       │ [Phase 3] Commande certificat OV CertEurope
Sem 5  │ [Phase 4] Benchmark de validation Mistral (fixtures réelles)
       │ [Phase 3] Installation cert OV
Sem 6  │ [Phase 5] Signatures DPA (Mistral, Brevo, OVH)
Sem 7+ │ [Phase 6] AIPD signée + registre déposé par chaque commune
       │ — Production officielle —
Après  │ [Phase 7] SecNumCloud si demandé
```

## 6. Budget mensuel projeté

| Stack | Avant (Railway) | Aujourd'hui (VPS OVH) | Après Brevo + OV | SecNumCloud (optionnel) |
|---|---|---|---|---|
| Hébergement + DB | ~40 € | ~12 € (VPS Comfort) | ~12 € | ~500 € |
| Stockage fichiers + sauvegardes | inclus | ~3 € (Object Storage) | ~3 € | inclus |
| LLM (volume 1k pièces/mois) | ~50 € (Anthropic direct, historique) | ~30-60 € (Mistral Pixtral Large) | ~30-60 € | 3-5 k€ (GPU dédié) |
| Email | ~20 € (Resend) | ~20 € (Resend) | ~15 € (Brevo) | ~15 € |
| SSL | gratuit (Let's Encrypt) | gratuit (Let's Encrypt) | ~12 €/mois (OV CertEurope) | ~12 € |
| **Total** | **~110 €** | **~65-95 €** | **~72-102 €** | **~3,5-5,5 k€** |

## 7. Risques principaux et mitigations

| Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|
| Indisponibilité Mistral La Plateforme | Faible | Moyen | Dégradation gracieuse : skip analyse, instructeur prévient |
| Perte de fichiers lors d'une future bascule vers OVH Object Storage | Faible | Élevé | Script `migrate-uploads-to-s3` idempotent + vérification d'intégrité par taille avant suppression |
| Perte du VPS (incident OVH, erreur ops) | Faible | Élevé | Sauvegardes 3-2-1 chiffrées vers OVH Object Storage (RPO 24 h / RTO 4 h) — cf. `docs/security/dossier-exploitation.md` |
| Qualité Pixtral Large insuffisante sur certains cas (Phase 4 validation) | Modérée | Faible | Itération sur les prompts, bascule vers Mistral Medium 3 vision quand disponible, ou Llama Vision via Scaleway en dernier recours |
| Refus DPD d'une commune (Phase 6) | Faible | Bloquant local | AIPD pré-rédigée argumentée + démonstration en visio |
| Évolution de la doctrine étatique vers SecNumCloud obligatoire | Modérée à 2-3 ans | Élevé | Architecture déjà préparée (LLM derrière abstraction, stockage S3 portable, app dockerisable) |

## 8. Décisions ouvertes — à arbitrer

| Sujet | Pour | Quand |
|---|---|---|
| Validation Phase 0 (Mistral fonctionnel en prod) | Toi | ✅ Fait (PR #117) |
| Activation Phase 1 (stockage objet OVH OS) | Toi | À déclencher si volumétrie uploads > 50 Go ou besoin multi-VPS |
| Seuil F1 de validation Mistral | Toi + DPD collectivité | Avant Phase 4 (benchmark) |
| Fournisseur SSL OV (CertEurope vs GlobalSign FR) | Toi | Sous 1 semaine |
| Engagement Phase 7 (SecNumCloud) | DSI cliente | Sur demande formelle uniquement |
| Designation du DPD HEUREKIA SAS officiel | Toi (interne) | Avant la prod officielle |

## 9. Critères de mise en production officielle

La plateforme est **officiellement déployable en production pour les communes** lorsque :

- ✅ Phase 0 : Mistral La Plateforme fonctionnel et stable depuis 7 jours
- ✅ Phase 1 : abstraction stockage objet codée et testée (activation S3 OVH différée tant que la volumétrie ne le justifie pas)
- ✅ Phase 2 : VPS OVH (Postgres + nginx + PM2) + sauvegardes 3-2-1 vers OVH Object Storage, stables depuis 7 jours
- ⚠️ Phase 3 : Brevo + IGN + SSL OV en place
- ✅ Phase 5 : DPA Mistral AI signé
- ✅ Phase 6 : AIPD signée par au moins la première commune cliente
- ✅ Page admin Conformité affiche ≥ 90 % des mesures en "Actif"
- ✅ Le benchmark LLM est documenté et joint à l'AIPD

Tant que ces conditions ne sont pas remplies, la plateforme reste en **mode pilote** auprès de communes volontaires informées explicitement du statut.
