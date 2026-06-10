# Plan de déploiement HEUREKA — Production et souveraineté européenne

| Champ | Valeur |
|-------|--------|
| Version | 1.0 |
| Date | Juin 2026 |
| Auteur | Équipe technique HEUREKIA |
| Statut | En cours d'exécution (Phase 0/1) |

## 1. Contexte et objectif

HEUREKA est actuellement hébergé sur **Railway** (PaaS américain sur AWS) avec analyse IA via **Anthropic AWS Bedrock Francfort**. La conformité RGPD est atteinte (niveau 2 = données en UE, sous-traitants US sous DPA + SCC). Plusieurs DSI clientes — en particulier Tours Métropole — peuvent demander un niveau de souveraineté supérieur (niveau 3 = entreprises européennes).

Ce plan décrit la migration progressive vers une stack pleinement européenne, **sans interruption de service**, avec des phases indépendantes qu'on peut activer ou suspendre selon les arbitrages DSI / DPD / budget.

## 2. État actuel (Niveau 2)

| Brique | Fournisseur | Société | Données |
|---|---|---|---|
| Hébergement app + DB | Railway (sur AWS) | 🇺🇸 | 🇪🇺 Irlande |
| LLM | Anthropic via Bedrock | 🇺🇸 | 🇪🇺 Francfort |
| Email transactionnel | Resend | 🇺🇸 | 🇪🇺/🇺🇸 |
| Stockage fichiers | Disque local Railway | éphémère | 🇪🇺 |
| Fond de carte | CartoCDN | 🇺🇸 | n/a |
| Recherche d'adresses | data.gouv.fr | 🇫🇷 | 🇫🇷 |
| Cadastre / PLU | data.geopf.fr | 🇫🇷 | 🇫🇷 |
| Certificat SSL | Let's Encrypt (DV) | 🇺🇸 nonprofit | n/a |

## 3. État cible (Niveau 3a — pragmatique)

| Brique | Fournisseur cible | Société |
|---|---|---|
| Hébergement app + DB | Clever Cloud | 🇫🇷 Paris/Nantes |
| Stockage fichiers | Cellar (Clever Cloud, S3-compatible) | 🇫🇷 |
| LLM | Anthropic Bedrock UE OU Mistral La Plateforme (selon benchmark) | 🇺🇸/🇪🇺 ou 🇫🇷 |
| Email transactionnel | Brevo (ex-Sendinblue) | 🇫🇷 |
| Fond de carte | IGN data.geopf.fr/wmts | 🇫🇷 |
| Certificat SSL | CertEurope OV | 🇫🇷 |

État cible alternatif (Niveau 3b — SecNumCloud) traité en **Phase 7 (optionnelle)**.

---

## 4. Phases détaillées

### Phase 0 — Stabilisation Bedrock (en cours, ~1 jour)

**Objectif** : confirmer que l'analyse IA via Bedrock Francfort fonctionne de bout en bout.

**Pré-requis** :
- ✅ Compte AWS créé, IAM user `heureka-bedrock-prod` avec policy `HeurekaBedrockInvoke`
- ✅ Variables Railway : `AI_PROVIDER=bedrock`, `AWS_REGION=eu-central-1`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- ✅ Correction `BEDROCK_MODEL_MAP` (commit `c43f8ea`)
- ✅ Logging explicite des erreurs `analyzePiece` / `extractPiece` (commit `a5094d9`)

**Critère de validation** :
- 1 dépôt de pièce test → bandeau de score `Conforme/Acceptable/...` affiché dans le wizard
- Ligne `[aiUsage] 🇪🇺 Fournisseur d'inférence : AWS Bedrock` au boot Railway
- Entrée `ai_usage_events` avec `cost_eur > 0` et `file_hash` non null

**Rollback** : retirer `AI_PROVIDER=bedrock` dans Railway → l'app retombe sur Anthropic API directe (US). Aucun risque applicatif.

**Garde-fou facturation** : budget AWS 100 €/mois avec alerte à 50 % et 80 %.

---

### Phase 1 — Stockage objet S3-compatible (2-3 jours)

**Objectif** : décorréler le stockage des fichiers déposés de l'hébergeur applicatif. Pré-requis à toute migration ultérieure.

**Pourquoi maintenant** : Railway et tous les PaaS modernes (Clever, Render, Fly) utilisent des disques éphémères. Aujourd'hui les PDF uploadés vivent sur le disque local du container Railway → ils seraient perdus à un redéploiement / migration.

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

**Provisionnement** :
- Compte Clever Cloud créé.
- Add-on **Cellar** activé (sans dépendre de migration applicative — Cellar est juste un endpoint S3 utilisable depuis n'importe où, y compris Railway).

**Critères de validation** :
- 121 tests API passent + nouveaux tests sur l'abstraction
- Upload depuis le wizard → fichier visible dans Cellar
- Suppression de compte → fichier supprimé de Cellar
- Téléchargement par instructeur → URL signée valide 15 min

**Rollback** : `STORAGE_PROVIDER=local` → retour au disque local Railway. Les anciens fichiers (avant migration) restent sur disque, les nouveaux sur Cellar — gérer la cohabitation pendant la transition via le champ `url` de chaque pièce.

---

### Phase 2 — Migration Railway → Clever Cloud (1-2 jours)

**Objectif** : sortir l'hébergement applicatif + base de données d'une société américaine.

**Tâches** :
1. **Création app Clever Cloud** :
   - 1 app **Node.js** pour `apps/api`
   - 1 app **Node.js + static** pour `apps/web` (build Vite → servi par Express ou par CDN)
   - 1 add-on **PostgreSQL** (taille `XS` à `S` selon volume — démarrer XS, scaler ensuite)
   - Cellar déjà en place depuis Phase 1
2. **Migration PostgreSQL** :
   - `pg_dump` depuis Railway → `pg_restore` sur Clever Cloud (downtime ~10-30 min selon volume)
   - Vérifier que l'extension `pgvector` est activée sur l'instance Clever (sinon contacter le support, c'est dispo)
3. **Variables d'environnement** : recopier toutes les variables Railway dans Clever Cloud (`JWT_SECRET`, `DATABASE_URL` → fournie par l'add-on, `AI_PROVIDER`, `AWS_*`, `MISTRAL_API_KEY` si applicable, `S3_*` Cellar, `RESEND_API_KEY` ou `BREVO_API_KEY`).
4. **Cron jobs** : `node-cron` continue de tourner dans le process API — pas de changement nécessaire. Optionnellement basculer vers le scheduler natif Clever Cloud pour la résilience.
5. **DNS** : repointer `app.heurekia.com` (CNAME) vers Clever Cloud. TTL bas (300s) à mettre 24h avant pour rollback rapide.
6. **Bascule** : déploiement Clever Cloud en parallèle de Railway, vérification du fonctionnement → bascule DNS → surveillance 24h → arrêt Railway.

**Critères de validation** :
- Toutes les routes API répondent identiquement (smoke test : login, list dossiers, upload pièce, decision)
- Cron logs visibles dans Clever (`[cron] Scheduled jobs started …`)
- Stockage Cellar opérationnel
- Aucune erreur dans Sentry/logs pendant 24h post-bascule

**Rollback** : repointer le DNS sur Railway. La base PostgreSQL Railway reste en place pendant 1 semaine au cas où.

**Budget** :
- Clever Cloud app API : `S` (~25 €/mois)
- Clever Cloud app Web (ou CDN) : `XS` (~10 €/mois)
- PostgreSQL add-on `XS` (~15 €/mois)
- Cellar : ~5 €/mois (premiers 25 Go inclus)
- **Total : ~55 €/mois**, vs ~30-50 €/mois Railway. Léger surcoût acceptable pour la souveraineté.

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

**Pourquoi** : Annexe Technique n°2 §4.9 de la DSI Tours demande un certificat OV (Organization Validation) minimum, vs DV (Domain Validation) actuellement fourni gratuitement par Let's Encrypt via Railway/Clever.

**Tâches** :
1. Commander un certificat OV chez CertEurope ou GlobalSign (FR) — délai ~3 jours ouvrés, ~150 €/an.
2. Procédure de validation (vérification de l'organisation = HEUREKIA SAS via Kbis + appel téléphonique).
3. Installation sur Clever Cloud : upload du certificat dans la console (Console Clever → app → Domain names → Custom SSL certificate).
4. Vérification : `curl -vI https://app.heurekia.com 2>&1 | grep -i "issued\|organization"` doit montrer CertEurope.

**Effort** : 2 jours élapsés (dont 1 jour d'attente validation).

---

### Phase 4 — Benchmark LLM + décision Mistral (1 semaine)

**Objectif** : décider si on bascule l'analyse IA d'Anthropic Bedrock à Mistral La Plateforme (🇫🇷), ou si on reste sur Bedrock UE (suffisant pour la majorité des collectivités).

**Pré-requis** :
- Compte Mistral La Plateforme + `MISTRAL_API_KEY`
- 15 à 30 pièces réelles **anonymisées** déposées dans `packages/ingestion/benchmark-fixtures/pieces/`
- `manifest.json` complété avec les vérités-terrain (cf. README du dossier)

**Exécution** :
```bash
ANTHROPIC_API_KEY=...
MISTRAL_API_KEY=...
pnpm --filter @heureka-v1/ingestion benchmark:llm \
  --providers anthropic,mistral \
  --out docs/security/benchmark-llm-resultats-2026-06.md
```

**Critères de décision** (cf. `docs/security/benchmark-llm.md`) :
- Si **F1 Pixtral ≥ 80 % du F1 Claude** sur les fixtures → bascule recommandée vers Mistral.
- Si **F1 Pixtral < 80 % du F1 Claude** → rester sur Bedrock UE et documenter le choix au DPD avec le rapport de benchmark.

**Si bascule Mistral** :
1. Ajouter un provider `MistralProvider` côté production (déjà implémenté côté benchmark, à porter dans `aiUsage.ts` selon le même switch que Bedrock).
2. Adapter les prompts si nécessaire (Pixtral peut être plus rigide sur la sortie JSON).
3. Convertir les PDF en PNG côté serveur (Pixtral n'accepte pas le PDF nativement → utiliser `unpdf` déjà présent dans les dépendances).
4. Mettre à jour `BEDROCK_MODEL_MAP` → `LLM_PROVIDER=mistral` + `MISTRAL_MODEL=pixtral-large-latest`.
5. Mettre à jour le bandeau de consentement citoyen + politique de confidentialité + registre art. 30 + AIPD pour refléter le changement de sous-traitant.

---

### Phase 5 — Finalisation DPA + signatures juridiques

**Objectif** : verrouiller juridiquement les sous-traitants choisis.

**Selon décision Phase 4** :

**Si Anthropic Bedrock retenu** :
- Signer le DPA Anthropic (procédure dans `docs/security/dpa-anthropic-checklist.md`)
- Activer le Zero Data Retention contractuellement
- Documenter le Transfer Impact Assessment (TIA) post-Schrems II

**Si Mistral retenu** :
- Signer le DPA Mistral (formulaire standard)
- Confirmer la localisation 🇫🇷 Paris des datacenters
- Aucun TIA nécessaire (pas de transfert hors UE)
- Mettre à jour la fiche n°2 du registre art. 30

**Dans tous les cas** :
- DPA Brevo
- DPA Clever Cloud
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
- Sortie complète de Clever Cloud (qui n'est pas SecNumCloud).
- **Coût × 5 à × 10** vs niveau 3a (GPU H100 dédié ~3-5 k€/mois).
- **Effort** : 1 à 3 mois de migration + maintenance opérationnelle continue (mises à jour modèles, monitoring, etc.).

**Recommandation** : à n'engager **que sur appel d'offres formel** d'une collectivité qui le justifie. Le ROI est défavorable autrement.

---

## 5. Calendrier global

```
Sem 1  │ [Phase 0] Stabilisation Bedrock ✓
       │ [Phase 1] Stockage objet S3 — refactor + tests
Sem 2  │ [Phase 1] Migration des fichiers existants vers Cellar
       │ [Phase 3] Brevo (email) — 1/2 j
       │ [Phase 3] IGN (carto) — 1/2 j
Sem 3  │ [Phase 2] Provisionnement Clever Cloud + PostgreSQL
       │ [Phase 2] Bascule DNS + surveillance 48h
       │ [Phase 3] Commande certificat OV CertEurope
Sem 4  │ [Phase 4] Benchmark LLM (fixtures + Mistral)
       │ [Phase 3] Installation cert OV
Sem 5  │ [Phase 5] Signatures DPA (Anthropic OU Mistral, Brevo, Clever)
Sem 6+ │ [Phase 6] AIPD signée + registre déposé par chaque commune
       │ — Production officielle —
Après  │ [Phase 7] SecNumCloud si demandé
```

## 6. Budget mensuel projeté

| Stack | Avant (Railway) | Pendant migration | Après (Clever) | SecNumCloud (optionnel) |
|---|---|---|---|---|
| Hébergement + DB | ~40 € | ~80 € (double-run) | ~55 € | ~500 € |
| Stockage fichiers | inclus | ~5 € | ~5 € | inclus |
| LLM (volume 1k pièces/mois) | ~50 € (Anthropic direct) | ~50 € (Bedrock) | 50-120 € (Bedrock ou Mistral) | 3-5 k€ (GPU dédié) |
| Email | ~20 € (Resend) | ~20 € | ~15 € (Brevo) | ~15 € |
| SSL | gratuit (Let's Encrypt) | gratuit | ~12 €/mois (OV CertEurope) | ~12 € |
| **Total** | **~110 €** | **~155 €** | **~140 €** | **~3,5-5,5 k€** |

## 7. Risques principaux et mitigations

| Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|
| Indisponibilité Bedrock (Phase 0) | Faible | Moyen | Dégradation gracieuse : skip analyse, instructeur prévient |
| Perte de fichiers pendant migration vers Cellar (Phase 1) | Faible | Élevé | Script `migrate-uploads-to-s3` idempotent + vérification d'intégrité par taille avant suppression |
| Downtime PostgreSQL pendant dump/restore (Phase 2) | Certaine | Faible | Fenêtre de maintenance annoncée (créneau nuit), durée ~15-30 min |
| Qualité Mistral insuffisante (Phase 4) | Modérée | Faible | Décision rationnelle basée sur le benchmark, fallback Bedrock |
| Refus DPD d'une commune (Phase 6) | Faible | Bloquant local | AIPD pré-rédigée argumentée + démonstration en visio |
| Évolution de la doctrine étatique vers SecNumCloud obligatoire | Modérée à 2-3 ans | Élevé | Architecture déjà préparée (LLM derrière abstraction, stockage S3 portable, app dockerisable) |

## 8. Décisions ouvertes — à arbitrer

| Sujet | Pour | Quand |
|---|---|---|
| Validation Phase 0 (Bedrock fonctionnel) | Toi | Maintenant |
| Lancement Phase 1 (stockage S3) | Toi | Sous 48h |
| Critère de décision LLM (seuil F1 Mistral) | Toi + DPD collectivité | Avant Phase 4 |
| Fournisseur SSL OV (CertEurope vs GlobalSign FR) | Toi | Sous 1 semaine |
| Engagement Phase 7 (SecNumCloud) | DSI cliente | Sur demande formelle uniquement |
| Designation du DPD HEUREKIA SAS officiel | Toi (interne) | Avant la prod officielle |

## 9. Critères de mise en production officielle

La plateforme est **officiellement déployable en production pour les communes** lorsque :

- ✅ Phase 0 : Bedrock fonctionnel et stable depuis 7 jours
- ✅ Phase 1 : fichiers sur Cellar, anciens fichiers migrés
- ✅ Phase 2 : Clever Cloud + PostgreSQL stables depuis 7 jours
- ✅ Phase 3 : Brevo + IGN + SSL OV en place
- ✅ Phase 5 : DPA signé avec le LLM retenu (Anthropic OU Mistral)
- ✅ Phase 6 : AIPD signée par au moins la première commune cliente
- ✅ Page admin Conformité affiche ≥ 90 % des mesures en "Actif"
- ✅ Le benchmark LLM est documenté et joint à l'AIPD

Tant que ces conditions ne sont pas remplies, la plateforme reste en **mode pilote** auprès de communes volontaires informées explicitement du statut.
