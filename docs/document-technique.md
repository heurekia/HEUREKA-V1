# Document technique HEUREKA V1

| Champ | Valeur |
|-------|--------|
| Version | 1.0 |
| Date | Juin 2026 |
| Périmètre | Backend `apps/api`, frontend `apps/web`, packages `db` / `ingestion` / `regulatory-engine` / `shared` |
| Lecteurs cibles | DSI, DPD, équipe technique, auditeurs sécurité |

> Document de synthèse couvrant l'architecture, les tables de la base, les appels externes, les briques fonctionnelles, la redirection des fronts, les tâches planifiées, les pipelines de traitement et les aspects sécurité. Compagnon de `docs/plan-deploiement.md` (roadmap souveraineté) et de `docs/security/*` (registre RGPD, AIPD, conformité DSI).

---

## 1. Vue d'ensemble

HEUREKA est une plateforme d'instruction des autorisations d'urbanisme (PC, DP, PA, PD, CU, PCMI…) à destination des collectivités territoriales et de leurs pétitionnaires. Elle se compose :

- d'un **front citoyen** (dépôt et suivi de dossier) servi sous `www.heurekia.com`,
- d'un **front mairie / instructeur / admin** servi sous `app.heurekia.com`,
- d'une **API REST Node.js / Express** qui orchestre la base PostgreSQL, le stockage objet, le LLM d'analyse, les API métiers IGN / Légifrance et les emails transactionnels.

| Couche | Stack | Localisation |
|---|---|---|
| Hébergement (actuel) | Railway sur AWS eu-west-1 (Irlande 🇪🇺) | Migration prévue → Clever Cloud 🇫🇷 (`docs/plan-deploiement.md` Phase 2) |
| Base de données | PostgreSQL + extension `pgvector` | Add-on Railway, port standard, accès via `DATABASE_URL` |
| Stockage des pièces | Disque local Railway (éphémère) | Migration prévue → Cellar S3-compatible 🇫🇷 (Phase 1) |
| LLM | Mistral La Plateforme — Pixtral Large / Pixtral 12B / Mistral Large / Mistral Small | Datacenters Mistral AI SAS 🇫🇷 Paris |
| Email transactionnel | Resend | Migration prévue → Brevo 🇫🇷 (Phase 3.1) |
| Cartographie | data.geopf.fr (IGN) + CartoCDN (fond) + Leaflet côté front | IGN 🇫🇷, CartoCDN 🇺🇸 (retrait planifié Phase 3.2) |
| Référentiels publics | data.gouv.fr (BAN), geo.api.gouv.fr, IGN GPU/Cadastre, RNB, Géorisques | France 🇫🇷 |
| Code légal | PISTE / Légifrance (DILA) | France 🇫🇷 (OAuth2) |
| Embeddings RAG | Voyage AI — `voyage-3` (1024 dim) | États-Unis (à requalifier si SecNumCloud) |

---

## 2. Topologie monorepo

```
HEUREKA-V1/
├── apps/
│   ├── api/                       Backend Express + cron + intégrations
│   └── web/                       Frontend React 19 / Vite / React Router 7
├── packages/
│   ├── db/                        Schémas Drizzle, migrations, client PG
│   ├── ingestion/                 CLI d'ingestion PLU (PDF → règles + RAG)
│   ├── regulatory-engine/         Moteur de conformité (faits × règles → findings)
│   └── shared/                    Types métier transverses
├── docs/
│   ├── plan-deploiement.md        Roadmap souveraineté
│   ├── document-technique.md      (ce document)
│   ├── reglementation/            Exemples PLU annotés (Ballan-Miré)
│   └── security/                  AIPD, registre art. 30, DPA, conformité DSI
├── Procfile                       node --import tsx apps/api/src/index.ts
├── railway.json                   pre-deploy = migrations, health = /api/health
├── nixpacks.toml                  Node 20, pnpm, poppler-utils (pdftoppm)
├── pnpm-workspace.yaml            apps/* packages/*
└── tsconfig.base.json
```

---

## 3. Base de données

### 3.1 Caractéristiques générales

| Élément | Valeur |
|---|---|
| SGBD | PostgreSQL 15+ |
| Extension | `pgvector` (embeddings 1024 dim pour le RAG) |
| ORM | Drizzle ORM 0.45.2 (typage strict, requêtes paramétrées → pas d'injection SQL) |
| Migrations | `packages/db/migrations/` générées par `drizzle-kit`, jouées au pre-deploy Railway |
| Connexion | `DATABASE_URL` (PostgreSQL connection string) |
| Sauvegardes | Backups automatiques fournis par Railway / Clever Cloud (à formaliser CCSC §11.6) |
| Schémas | 38 fichiers TypeScript dans `packages/db/src/schema/` |

### 3.2 Localisation / stockage des données par catégorie

| Famille | Localisation physique | Politique de rétention | Sensibilité RGPD |
|---|---|---|---|
| Données métier (dossiers, pièces, décisions) | PostgreSQL 🇪🇺 (Railway eu-west-1, futur Clever Cloud 🇫🇷) | 10 ans à compter de la décision (archives départementales) | Données nominatives, mission d'intérêt public art. 6-1-e |
| Comptes utilisateurs | PostgreSQL 🇪🇺 | Vie du compte + 3 ans inactivité | Identifiants + mots de passe (bcrypt) |
| Fichiers binaires (PDF, photos) | Disque local Railway (actuel) → Cellar S3 🇫🇷 (cible Phase 1) | Idem dossier (10 ans) ; brouillon > 180 jours purgé | Pièces justificatives, potentiellement nominatives |
| Audit logs | PostgreSQL 🇪🇺, index dédié pour la purge | 12 mois (CCSC §4.14) — purge auto quotidienne | Traçabilité légale, IP, user-agent |
| `ai_usage_events` | PostgreSQL 🇪🇺 | Vie du dossier (empreinte SHA-256, pas le contenu) | Aucune PII : on stocke uniquement le hash |
| Embeddings RAG (`document_segments`) | PostgreSQL + pgvector 🇪🇺 | Vie du document source | Donnée publique (PLU, OAP, PPRI) |
| Cache IGN GPU | PostgreSQL 🇪🇺 | TTL 30 jours, rafraîchi par cron 03h00 | Donnée publique |

### 3.3 Tables — Inventaire détaillé

> Toutes les tables sont déclarées dans `packages/db/src/schema/*.ts`. PK = clé primaire. FK = clé étrangère. *cascade* = `ON DELETE CASCADE`. *set null* = `ON DELETE SET NULL`.

#### 3.3.1 Identité & authentification

| Table | Fichier schéma | Rôle | Colonnes notables |
|---|---|---|---|
| `users` | `users.ts` | Comptes (citoyen, mairie, instructeur, admin, service_externe) | `id` uuid PK · `email` unique · `password_hash` (bcrypt cost 10) · `role` enum · `commune`, `commune_insee` · `role_config_id` FK · `service_id` FK |
| `password_tokens` | `passwordTokens.ts` | Tokens reset / activation à usage unique | `token` PK · `user_id` FK · `expires_at` |
| `role_permissions` | `rolePermissions.ts` | Rôles personnalisés par commune | `name` unique · `base_role` · `permissions` jsonb · `is_system` bool |
| `user_communes` | `userCommunes.ts` | Affectation multi-commune d'un agent | `user_id` FK · `commune_id` FK |
| `user_absences` | `userAbsences.ts` | Périodes d'absence d'un instructeur | `user_id`, `start_date`, `end_date` |
| `user_delegations` | `userDelegations.ts` | Délégation pendant absence | `from_user_id`, `to_user_id`, `start_date`, `end_date` |
| `user_availability` | `userAvailability.ts` | Créneaux de disponibilité | `user_id`, `day_of_week`, `start_time`, `end_time` |

#### 3.3.2 Cœur métier — Dossiers d'urbanisme

| Table | Fichier schéma | Rôle | Colonnes notables |
|---|---|---|---|
| `dossiers` | `dossiers.ts` | Dossier d'instruction (PC, DP, PCMI, PA, PD, CU, …) | `numero` unique · `type` enum (9 val.) · `status` enum (brouillon → soumis → pre_instruction → incomplet → en_instruction → decision_en_cours → accepte/refuse/accord_prescription) · `user_id` citoyen · `instructeur_id` · `parcelle`, `adresse`, `commune`, `code_postal`, `surface_plancher` · `metadata` jsonb · `date_depot`, `date_completude`, `date_limite_instruction`, `date_delivrance` · `is_tacite` bool · `conformite_analysis` jsonb · `conformite_status` · **`ai_consent` bool + `ai_consent_at`** (consentement RGPD analyse IA) |
| `dossier_pieces_jointes` | `dossier_pieces_jointes.ts` | Fichiers déposés (PDF, plans, photos) | `dossier_id` FK cascade · `url` (chemin local ou clé S3) · `type` (MIME) · `taille` · `code_piece` (PC1, PLAN, PHOTO…) · `analyse_ia` jsonb · `extraction_ia` jsonb · `instructeur_status` (valide/rejete/complement_demande) · `instructeur_note` · **`ai_processed` bool** |
| `dossier_messages` | `dossier_messages.ts` | Fils citoyen↔mairie + mairie↔service | `dossier_id` FK · `consultation_id` FK (scope service) · `from_role` (citoyen/mairie/service) · `content` html · `parent_id` (réponses imbriquées) · `mentions` jsonb · `read_at` |
| `dossier_facts` | `dossier_facts.ts` | **Source unique de vérité des faits d'instruction** | `dossier_id` · `key` (ex `surface_construct`, `hauteur_max`) · `value` jsonb · `unit` · `source` enum (`citizen_declaration` / `document_extraction` / `instructor_entry` / `external_data`) · `confidence` 0-1 · `validated_by` · `superseded_at` (NULL ⇒ actif) · **index unique partiel `(dossier_id, key) WHERE superseded_at IS NULL`** |
| `instruction_events` | `instruction_events.ts` | Journal d'événements (timeline) | `type` (status_change, piece_uploaded, …) · `metadata` jsonb |
| `dossier_courriers` | `dossierCourriers.ts` | Courriers d'instruction émis (snapshot figé) | `type` (pieces_complementaires / refus / non_opposition / majoration_delai / notification_decision / general) · `body_snapshot` html · `pieces_jointes_ids` jsonb · `articles_cites` jsonb · `delivery_method` (print/email/ar) |
| `dossier_consultations` | `dossierConsultations.ts` | Consultations services (ABF/STAP, SDIS, DDT, archéo…) | `service_name`, `service_type` · `external_service_id` FK · `status` (en_attente/avis_recu/non_requis/refuse) · `favorable` bool · `avis` text |

#### 3.3.3 Décision & signature

| Table | Fichier | Rôle |
|---|---|---|
| `decisions` | `decisions.ts` | Arrêté de décision (`acceptation` / `refus` / `accord_prescription`) — workflow `brouillon` → `soumis_signature` → `signe` → `notifie` → `archive` |
| `decision_events` | `decisionEvents.ts` | Journal du cycle de signature |
| `signataires` | `signataires.ts` | Maires / adjoints habilités à signer pour une commune |
| `courrierTemplates` | `courrierTemplates.ts` | Modèles de courrier paramétrables par commune |
| `calendar_events` | `calendar_events.ts` | Rendez-vous instructeurs |

#### 3.3.4 Analyse réglementaire (moteur)

| Table | Fichier | Rôle |
|---|---|---|
| `regulatory_analyses` | `regulatory_analyses.ts` | Run du moteur sur un dossier — `engine_version`, `ruleset_version`, `context_snapshot` jsonb, `status` (running/done/failed/obsolete) |
| `regulatory_findings` | `regulatory_findings.ts` | Constat unitaire — `topic` (hauteur, retrait, couleur…), `status` (conforme/non_conforme/incertain/non_applicable), `severity` (bloquant/prescription/alerte/info), `legal_basis` jsonb, `facts_used` jsonb, `rule_id` FK, **`instructor_decision`** (accepted/corrected/ignored) — garantit l'art. 22 RGPD |

#### 3.3.5 Référentiels PLU & territoriaux

| Table | Fichier | Rôle |
|---|---|---|
| `communes` | `communes.ts` | Collectivité — letterhead, logo, signature image, tampon, `plu_zones_geojson` cache, `epci_id` FK |
| `epci` | `epci.ts` | Intercommunalités (CC/CA/MPM) |
| `zones` | `zones.ts` | Zones PLU (UA, UB, N, A…) — `geometry` jsonb, `status` (draft/active) |
| `zone_regulatory_rules` | `zone_regulatory_rules.ts` | Articles structurés — `article_number`, `topic`, `value_min/max/exact`, `unit`, `cases` jsonb (cas conditionnels), `applies_if` jsonb, `citizen_title` / `citizen_summary`, **`validation_status`** (brouillon ⇒ par défaut, *safe-by-default*) |
| `commune_documents` | `communeDocuments.ts` | OAP, PPRI, PEB, schémas couleurs |
| `external_services` | `externalServices.ts` | Services consultés (DDE, SDIS, STAP, archéo…) |
| `service_communes` | `serviceCommunes.ts` | Affectation service ↔ commune |

#### 3.3.6 Cache & RAG

| Table | Fichier | Rôle |
|---|---|---|
| `gpu_parcel_cache` | `gpuCache.ts` | Cache IGN GPU (TTL 30 j) — documents, zone_urba, prescriptions, SUP surfacique/linéaire, générateurs, `hit_count` |
| `document_segments` | `documentSegments.ts` | Indexation RAG — `id` `{insee}_{doc}_{code}`, `doc_type` (plu-reglement / oap / ppri), `embedding vector(1024)`, indexes sur `insee`, `doc_type`, `parent_code` |
| `document_segment_annotations` | `documentSegmentAnnotations.ts` | Annotations humaines (correction / validation / flag) |
| `legal_mentions` | `legalMentions.ts` | Cache Légifrance — `code_key` (CU/CCH/CE), `article_num`, `texte_html`, `source_url`, `date_retrieved` |
| `documentation_favoris` | `documentationFavoris.ts` | Favoris d'articles légaux par utilisateur |

#### 3.3.7 Conformité, audit & IA

| Table | Fichier | Rôle |
|---|---|---|
| **`audit_logs`** | `auditLogs.ts` | Traçabilité (CCSC §4.14, RGPD art. 5.1.e) — `user_id` (FK set null), `email`, `role` (snapshot), `action` (login/logout/login_failed/create_dossier/upload_piece/submit_dossier/change_status…), `target_type`, `target_id`, `metadata` jsonb, `ip`, `user_agent`. **Purge auto 12 mois**. |
| **`ai_usage_events`** | `aiUsageEvents.ts` | Tracking coûts + RGPD inférence IA — `purpose` (piece_analyze / piece_extract / rule_verdicts / procedure_explain / plu_zone_detect / plu_rule_extract / plu_article_structure / plu_zone_structure), `model`, `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `cost_eur`, `duration_ms`, **`file_hash` SHA-256** (jamais le contenu) |
| `ai_alert_config` | `aiAlertConfig.ts` | Singleton id=1 — `slack_webhook_url`, `per_call_threshold_eur`, `daily_threshold_eur`, `daily_last_notified_at` |
| `notifications` | `notifications.ts` | Notifications in-app — `type`, `title`, `message`, `is_read` |

---

## 4. Appels externes

| Service | Localisation | Endpoint | Auth | Usage | Variables d'env | Fichier appelant |
|---|---|---|---|---|---|---|
| **Mistral La Plateforme** | 🇫🇷 Paris | `https://api.mistral.ai/v1/chat/completions` | Bearer `MISTRAL_API_KEY` | Analyse pièce, extraction CERFA, verdict règles, structuration articles PLU. Modèles : `pixtral-large-latest` (vision), `pixtral-12b-2409`, `mistral-large-latest`, `mistral-small-latest` | `MISTRAL_API_KEY` (obligatoire) · `MISTRAL_API_BASE` | `apps/api/src/services/aiUsage.ts` · `packages/ingestion/src/structure/mistral-llm.ts` |
| **PISTE / Légifrance** | 🇫🇷 DILA | `https://(sandbox-)api.piste.gouv.fr/dila/legifrance/lf-engine-app/consult/...` | OAuth2 client credentials | Récupération articles CU / CCH / CE pour citations dans courriers et findings (cache `legal_mentions`) | `PISTE_CLIENT_ID`, `PISTE_CLIENT_SECRET`, `PISTE_API_BASE_URL`, `PISTE_OAUTH_URL` | `apps/api/src/services/legifrance.ts` · `pisteClient.ts` |
| **IGN GPU (Géoportail Urbanisme)** | 🇫🇷 IGN | `https://apicarto.ign.fr/api/gpu/{document, zone-urba, municipality, prescription-surf, info-surf, assiette-sup-s, assiette-sup-l, generateur-sup-s}` | Aucune | Récupération PLU/SUP/zonage d'une parcelle. **Cache `gpu_parcel_cache` 30 j** car SLA faible (503 fréquents) | — | `apps/api/src/services/parcelAnalysis.ts` |
| **IGN Cadastre** | 🇫🇷 | `https://apicarto.ign.fr/api/cadastre/parcelle` | Aucune | Géométrie & infos parcelle (INSEE, section, numéro, lon/lat) | — | `parcelAnalysis.ts` |
| **API Adresse (BAN, data.gouv.fr)** | 🇫🇷 | `https://api-adresse.data.gouv.fr/search/` · `https://plateforme.adresse.data.gouv.fr/lookup/{banId}` | Aucune | Autocomplétion adresse pétitionnaire, résolution `banId` | — | `parcelAnalysis.ts` |
| **geo.api.gouv.fr** | 🇫🇷 | `/communes?lat=…&lon=…` · `/communes?code={insee}` | Aucune | Résolution commune par coordonnées ou INSEE | — | `parcelAnalysis.ts` |
| **RNB (bâti national)** | 🇫🇷 | `https://rnb-api.beta.gouv.fr/api/alpha/buildings/?cle_interop_ban={banId}` | Aucune | Données bâtiment (étages, année construction) | — | `parcelAnalysis.ts` |
| **Géorisques** | 🇫🇷 BRGM | `https://georisques.gouv.fr/api/v1/gaspar/alea?latlon=…&code_insee=…` | Aucune | Aléas (inondation, séisme, cavités, mouvement terrain) | — | `parcelAnalysis.ts` |
| **Nominatim (OSM)** | 🇩🇪 | `https://nominatim.openstreetmap.org/search?…` | Aucune | Fallback géocodage adresse | — | `parcelAnalysis.ts` |
| **data.geopf.fr (IGN Open Data)** | 🇫🇷 | `/wmts` (tuiles) · `/wfs` | Aucune | Fond de carte Leaflet, requêtes spatiales. **Whitelisté CSP** | — | Front `MapLeaflet.tsx` |
| **Resend** | 🇺🇸 | `https://api.resend.com/emails` | Bearer `RESEND_API_KEY` | Email transactionnel (activation, reset, notifications). **À remplacer par Brevo Phase 3.1** | `RESEND_API_KEY`, `SMTP_FROM` | `apps/api/src/services/mailer.ts` |
| **Voyage AI (embeddings)** | 🇺🇸 | `https://api.voyageai.com/v1/embeddings` (modèle `voyage-3`, 1024 dim) | Bearer | Génération embeddings RAG pour `document_segments` | `VOYAGE_API_KEY` | `packages/ingestion/src/db/embedder.ts` |
| **S3-compatible (Cellar / Scaleway / OVH OS)** | 🇫🇷 (cible) | `S3_ENDPOINT` | Access key | Stockage objet pièces jointes (cible Phase 1) | `STORAGE_PROVIDER`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | `apps/api/src/services/storage.ts` |
| **CartoCDN** | 🇺🇸 | `https://*.basemaps.cartocdn.com` | — | Fond de carte (à retirer Phase 3.2 au profit IGN WMTS) | — | Front `MapLeaflet.tsx` |
| **Slack (webhook)** | 🇺🇸 | URL en base (`ai_alert_config.slack_webhook_url`) | Token dans l'URL | Alertes coût IA (par appel / journalier) | — | `apps/api/src/services/aiAlerts.ts` |

---

## 5. Briques fonctionnelles

### 5.1 `apps/api` — Backend Express

Responsabilités : authentification, routing métier, orchestration des intégrations LLM/PISTE/IGN, abstraction stockage, cron, audit. Démarrage `apps/api/src/index.ts` → `app.ts` (Helmet, CORS, rate-limit, routes) → `startScheduledJobs()`.

| Module | Chemin | Rôle |
|---|---|---|
| Routes auth | `src/routes/auth.ts` | register / login / logout / me / export RGPD / DELETE compte / reset password / activation |
| Routes citoyen | `src/routes/dossiers.ts` | CRUD dossier brouillon, upload pièce, soumettre, messages, événements |
| Routes mairie | `src/routes/mairie/*.ts` | Dossiers, pièces, conformité, parcelle, réglementation, courriers, conversations, consultations, instructeurs, communes, dashboard, admin |
| Routes décision | `src/routes/decisions.ts` | Création, soumission signature, signature, notification |
| Routes publiques | `src/routes/public.ts` | Analyse parcelle anonyme (rate-limit 10/min/IP), articles légaux |
| Uploads sécurisés | `src/routes/uploads.ts` | GET/DELETE `/api/uploads/:key` (stream, pas de redirection signée vers S3) |
| Service IA | `src/services/aiUsage.ts` | `callAi()`, `streamAi()`, résolution modèle, pricing, tracking `ai_usage_events` |
| Analyseurs IA | `src/services/pieceAnalyzer.ts`, `pieceExtractor.ts` | Pré-traitement PDF→PNG (`pdftoppm`), sanitisation nom fichier, masquage parcelle, prompt Pixtral |
| Légifrance | `src/services/legifrance.ts`, `pisteClient.ts` | OAuth2, cache `legal_mentions` (licence Etalab v2.0) |
| Géo / parcelle | `src/services/parcelAnalysis.ts` | Aggrégation IGN GPU + cadastre + BAN + RNB + Géorisques |
| Moteur conformité | `src/services/dossierConformity.ts` + `packages/regulatory-engine` | Application des `zone_regulatory_rules` validées aux `dossier_facts`, génération `regulatory_findings` |
| Storage | `src/services/storage.ts` | Abstraction `StorageProvider` (`local` ou `s3`) |
| Mailer | `src/services/mailer.ts` | Resend (→ Brevo) |
| Audit | `src/services/audit.ts` + `src/middlewares/auditMutations.ts` | Capture mutations vers `audit_logs` |
| Notifications | `src/services/notify.ts` | In-app + email |
| Workflow | `src/services/dossierWorkflow.ts`, `instructionDelays.ts`, `absenceDelegation.ts` | Transitions, calcul délais, gestion délégations |
| Cron | `src/jobs/scheduler.ts` | Voir §7 |

### 5.2 `apps/web` — Frontend React

React 19.1 + Vite 6 + React Router 7 + Tailwind 3 + Leaflet + Recharts + TipTap (éditeur courriers) + DOMPurify (sanitisation HTML). Auth basée sur cookie `HttpOnly` (le front ne manipule jamais le JWT en JS).

### 5.3 `packages/db`

Schémas Drizzle (38 fichiers), migrations SQL générées (`drizzle-kit`), client `postgres` 3.4.5, exports types. Migrations jouées au pre-deploy Railway (`railway.json`).

### 5.4 `packages/ingestion`

CLI `pnpm --filter @heureka-v1/ingestion ingest` :
1. Parsing PDF (PDFKit / `unpdf`), découpage en segments métier.
2. Optionnel `--rules` : structuration articles via Pixtral Large → insert `zone_regulatory_rules` en `validation_status = 'brouillon'` (validation humaine obligatoire avant consommation par le moteur).
3. Optionnel `--load` : embeddings `voyage-3` → `document_segments` (pgvector).
4. Sous-module `benchmark/` : harnais comparatif LLM (cf. `docs/security/benchmark-llm.md`).

### 5.5 `packages/regulatory-engine`

Moteur de conformité piloté par les faits. Entrée : `RegulatoryContext` (zone PLU + `dossier_facts` actifs + applicabilité). Sortie : liste de `Finding` typés. Pluggable côté citoyen (mode pré-vérification) et mairie (mode instruction). Versionné via `engine_version` et `ruleset_version` (traçabilité d'audit).

### 5.6 `packages/shared`

Types métier transverses (`WorkflowError`, `legalArticlesCatalog`).

---

## 6. Redirection des fronts

### 6.1 Routage par sous-domaine

`apps/web/src/router/HostRouter.tsx` aiguille selon `window.location.hostname` :

| Sous-domaine | Public attendu | Espace |
|---|---|---|
| `www.heurekia.com` | Citoyens, presse, documentation publique | Pages publiques (login citoyen, mentions légales, politique de confidentialité) + espace citoyen authentifié |
| `app.heurekia.com` | Agents (mairie, instructeur, admin), services externes | Espace mairie, admin, service externe |

Le cookie JWT est segmenté par sous-domaine (`token_app` vs `token_www`) pour éviter qu'une fuite d'un espace contamine l'autre.

### 6.2 Routes publiques (`www`)

- `/` → `/login`
- `/login` — connexion citoyen
- `/activer-compte?token=…`
- `/reset-password?token=…`
- `/mentions-legales`
- `/politique-confidentialite`

### 6.3 Routes citoyen (authentifié)

- `/dashboard`, `/mes-demandes`, `/mes-documents`, `/messagerie`, `/centre-aide`, `/profil`
- `/dossier/:id`
- `/nouvelle-demande-wizard` (8 étapes ; **étape 7 = consentement IA explicite** ; le refus désactive l'analyse mais n'empêche pas le dépôt)

### 6.4 Routes mairie (`app/mairie/...`)

- `/mairie/login`, `/mairie/dashboard`
- `/mairie/dossiers`, `/mairie/dossiers/:id`
- `/mairie/carte` (Leaflet PLU + parcelles)
- `/mairie/calendrier`
- `/mairie/messagerie`, `/mairie/messagerie-services`
- `/mairie/statistiques`
- `/mairie/parametres/{utilisateurs, documents, integrations, notifications, workflow}`
- `/mairie/infos-perso`
- `/mairie/signatures` (file d'attente signataires)

### 6.5 Routes admin (`app/admin/...`)

- `/admin/dashboard`, `/admin/communes`, `/admin/utilisateurs`
- `/admin/logs` (consultation `audit_logs`)
- `/admin/conformite` (taux de mesures actives — objectif ≥ 90 % avant production officielle)
- `/admin/ai-costs` (coûts IA, alertes Slack)

### 6.6 Routes service externe (`app/service/...`)

- `/service/consultations`
- `/service/messagerie`

### 6.7 Garde-fous

`apps/web/src/router/guards.tsx` : `ProtectedRoute` (require auth + rôle), `PublicOnlyRoute` (login redirige si déjà connecté). Côté API, **le middleware `enforceDossierAccess`** garantit qu'un agent mairie ne voit que les dossiers de ses communes (cf. `user_communes`).

---

## 7. Tâches planifiées (cron)

Implémentation : `apps/api/src/jobs/scheduler.ts` via `node-cron` 4.2.1, démarré en in-process au boot de l'API. **Pas de queue répartie** : si plusieurs instances API tournent en parallèle, la même tâche pourrait s'exécuter en doublon → à transformer en scheduler natif Clever Cloud le jour où on scale horizontalement (cf. plan de déploiement Phase 2).

| Horaire | Tâche | Description | Variable de paramétrage |
|---|---|---|---|
| **02h00** quotidien | Purge `audit_logs` | Supprime les lignes plus anciennes que le seuil. Conformité CCSC §4.14 et RGPD art. 5.1.e (limitation de la conservation). | `AUDIT_LOG_RETENTION_MONTHS` (défaut **12**) |
| **02h30** quotidien | Purge brouillons | Supprime les `dossiers` en statut `brouillon` inactifs depuis N jours **+ fichiers physiques associés** (via `StorageProvider.deleteMany`). | `DRAFT_DOSSIER_RETENTION_DAYS` (défaut **180**) |
| **03h00** quotidien | Rafraîchissement cache PLU | Pour chaque commune dont `plu_zones_cached_at` > 30 j, recharge `communes.plu_zones_geojson` depuis l'API IGN GPU. | `PLU_REFRESH_AFTER_MS` |
| **04h00** quotidien | Redirection absences | Réassigne les dossiers en attente d'instructeurs absents (cf. `user_absences` + `user_delegations`) vers leur délégué. | — |

Tous les logs sont préfixés `[cron]` (visibles dans `railway logs` / Clever Cloud).

---

## 8. Traitement — Pipelines

### 8.1 Dépôt d'un dossier citoyen

1. Wizard 8 étapes (`NouvelleDemandeWizard.tsx`) : type de demande → parcelle → infos CERFA → pièces → **consentement IA** → validation.
2. `POST /api/dossiers/classify` → classification de la procédure (type + articles applicables + alertes) via Mistral (`purpose=procedure_explain`).
3. Pour chaque pièce : `POST /api/dossiers/:id/pieces/upload` (multipart, 20 MB max). Si `dossiers.ai_consent = true` :
   - PDF → PNG (1ʳᵉ page) via `pdftoppm` (paquet `poppler-utils`).
   - Sanitisation : nom de fichier nettoyé de l'identité ; masquage des 4 derniers chiffres de la parcelle.
   - Appel Pixtral Large (`purpose=piece_analyze`) → score Conforme / Acceptable / Problématique + explication.
   - Stockage : `dossier_pieces_jointes.analyse_ia`, marqueur `ai_processed = true`, hash SHA-256 dans `ai_usage_events.file_hash`.
4. `POST /api/dossiers/:id/soumettre` → transition `brouillon` → `soumis`, calcul `date_limite_instruction`, notifications mairie.

### 8.2 Instruction mairie

1. Pré-instruction : vérification complétude (`GET /api/dossiers/:id/completude`) ; émission d'un courrier `pieces_complementaires` si manquements.
2. Extraction structurée (CERFA) : `pieceExtractor.ts` → Pixtral (`purpose=piece_extract`) → insertion `dossier_facts` (source `document_extraction`).
3. Analyse parcelle : agrégat IGN GPU + cadastre + BAN + RNB + Géorisques (cache 30 j).
4. **Analyse de conformité** (`packages/regulatory-engine`) :
   - Récupère les faits actifs (`dossier_facts WHERE superseded_at IS NULL`).
   - Récupère les règles de la zone (`zone_regulatory_rules WHERE validation_status = 'valide'`).
   - Pour chaque règle applicable, appelle Mistral (`purpose=rule_verdicts`) avec faits + texte de règle + exceptions.
   - Insert `regulatory_analyses` + `regulatory_findings` (status, severity, legal_basis, citizen_summary).
5. Consultations services externes (DDE, SDIS, STAP, archéo…) : `dossier_consultations` + fil de messagerie dédié (`consultation_id`).
6. Décision : brouillon `decisions` → soumission signature → signature par un `signataires` autorisé → notification citoyen → archivage.

### 8.3 Ingestion PLU (offline, CLI)

```bash
pnpm --filter @heureka-v1/ingestion ingest \
  --file plu-ballan-mire.pdf \
  --adapter plu-reglement \
  --insee 37018 \
  --commune "Ballan-Miré" \
  --rules --load
```

1. Parsing PDF, segmentation logique (zone → article).
2. Pixtral Large structure chaque article → `zone_regulatory_rules` en **`validation_status = 'brouillon'`** (safe-by-default).
3. Embeddings `voyage-3` → `document_segments` (pgvector).
4. Validation humaine côté mairie/admin → bascule `validation_status = 'valide'` → consommé par le moteur.

### 8.4 Garde-fous IA

- **Décision humaine obligatoire** (art. 22 RGPD) : aucun finding n'est appliqué automatiquement, l'instructeur tranche via `instructor_decision` (accepted / corrected / ignored).
- **Coût** : seuils par appel et journaliers (`ai_alert_config`), alerte Slack au dépassement, page admin Coûts IA pour audit.
- **Dégradation gracieuse** : indisponibilité Mistral → la pièce reste déposable, l'analyse est marquée indisponible, l'instructeur travaille sans assistance IA.

---

## 9. Sécurité

### 9.1 Authentification

| Mécanisme | Détail | Source |
|---|---|---|
| JWT HS256 | Secret `JWT_SECRET`, durée 7 jours, claim `userId` + `role` | `apps/api/src/middlewares/auth.ts` |
| Cookie `HttpOnly; Secure; SameSite=Strict` | Token stocké en cookie, **jamais en `localStorage`** — protège du XSS | `auth.ts` |
| Cookies dédoublés par sous-domaine | `token_app` (mairie/admin) vs `token_www` (citoyen) | `HostRouter.tsx` + `auth.ts` |
| Bearer header | Fallback pour clients CLI / tests | `auth.ts` |
| bcrypt cost 10 | Hash mot de passe + dummy hash en login pour timing-safe | `auth.ts` |
| Tokens à usage unique | Activation et reset (table `password_tokens` avec `expires_at`) | `passwordTokens.ts` |
| RBAC | `requireRole(...)` + `role_permissions` (rôles custom par commune) | `auth.ts` |
| Scope dossier | `enforceDossierAccess` middleware : un agent ne voit que ses communes (`user_communes`) | `middlewares/dossierAccess.ts` |

### 9.2 Rate-limiting (`express-rate-limit`)

| Endpoint | Limite |
|---|---|
| `POST /api/auth/login` | 10 / 15 min par IP+email |
| `POST /api/auth/register` | 5 / heure / IP |
| `POST /api/auth/forgot-password` | 5 / 15 min / IP |
| `POST /api/auth/activate` | 10 / 15 min / IP |
| `GET /api/public/analyse(-parcelle)` | 10 / min / IP |

### 9.3 Transport & headers

```http
Strict-Transport-Security: max-age=15552000
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https://data.geopf.fr https://*.basemaps.cartocdn.com https://*.tile.openstreetmap.org;
  connect-src 'self' https://data.geopf.fr https://api-adresse.data.gouv.fr https://geo.api.gouv.fr;
  font-src 'self';
  frame-ancestors 'none';
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

Helmet, CORS whitelist `FRONTEND_URLS`, compression gzip, body JSON limité à 50 MB, multipart pièce limité à 20 MB.

### 9.4 Validation & anti-injection

- Schémas Zod 3.24 sur tous les POST/PATCH.
- Drizzle ORM ⇒ requêtes paramétrées (pas d'injection SQL possible).
- HTML rich-text (courriers, messages) sanitizé via **DOMPurify** côté front avant envoi.
- Uploads : extensions et MIME contrôlés, scan d'antivirus à prévoir Phase 2+.

### 9.5 Audit & traçabilité

- Table `audit_logs` : `user_id` (FK `SET NULL` pour préserver après suppression de compte), `email`, `role` (snapshot), `action`, `target_*`, `metadata` jsonb (route, method, diff), `ip`, `user_agent`.
- Actions tracées : `login`, `login_failed`, `logout`, `register`, `data_export`, `account_deleted`, `password_change`, `account_activated`, `password_reset`, `create_dossier`, `upload_piece`, `submit_dossier`, `change_status`, `validate_finding`, `sign_decision`, etc.
- **Purge automatique 12 mois** (cron 02h00).
- Index dédié pour la purge performante.
- Page admin `/admin/logs` pour consultation.

### 9.6 RGPD — Droits des personnes

| Droit | Implémentation |
|---|---|
| Art. 13 (information) | `MentionsLegales.tsx` + `PolitiqueConfidentialite.tsx` (publics) + bandeau IA à l'étape 7 du wizard |
| Art. 15 (accès) | `GET /api/auth/me/export` (JSON : profil, dossiers, pièces, messages, consentement IA, journal `ai_usage_events`, `audit_logs`) |
| Art. 17 (effacement) | `DELETE /api/auth/me` avec confirmation mot de passe + suppression physique des fichiers (`StorageProvider.deleteMany`) |
| Art. 20 (portabilité) | Même endpoint que l'art. 15 (format JSON ouvert) |
| Art. 21 (opposition) | Case à cocher analyse IA décochable depuis le profil (`dossiers.ai_consent`) |
| Art. 22 (décision automatisée) | Aucun finding appliqué sans validation humaine (`regulatory_findings.instructor_decision`) |

### 9.7 RGPD — Minimisation pour la sous-traitance IA

- `sanitizePieceName` retire l'identité du nom de fichier d'origine.
- `maskParcelle` masque les 4 derniers caractères du numéro de parcelle.
- Aucun nom / prénom / email / adresse n'est transmis au LLM.
- Trace `ai_usage_events.file_hash` : empreinte SHA-256 de la pièce envoyée, jamais le contenu.
- Inférence en France (Mistral AI SAS Paris) → **art. 44 RGPD non engagé**, aucun TIA requis.
- DPA Mistral en cours de signature (`docs/security/dpa-mistral-checklist.md`).

### 9.8 Secrets

| Catégorie | Variables | Stockage |
|---|---|---|
| Crypto | `JWT_SECRET` | Variables Railway (chiffrées) |
| Base | `DATABASE_URL` | Add-on PostgreSQL → variable injectée |
| LLM | `MISTRAL_API_KEY` | Variables Railway |
| Code légal | `PISTE_CLIENT_ID`, `PISTE_CLIENT_SECRET` | Variables Railway |
| Email | `RESEND_API_KEY` (→ `BREVO_API_KEY`) | Variables Railway |
| Stockage | `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Variables Railway |
| RAG | `VOYAGE_API_KEY` | Variables Railway |

Aucun secret n'est commit. `.env.example` documente les clés sans valeur.

### 9.9 Conformité DSI Tours Métropole (synthèse)

| Exigence | État | Référence |
|---|---|---|
| HTTPS forcé + HSTS | ✅ | Helmet |
| Headers sécurité (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) | ✅ | Helmet |
| JWT en cookie HttpOnly (vs localStorage) | ✅ | `auth.ts` |
| bcrypt mots de passe | ✅ | `auth.ts` |
| Drizzle ORM (anti-injection) | ✅ | `packages/db` |
| Traçabilité connexions 12 mois | ✅ | `audit_logs` + cron purge |
| security.txt | ✅ | `/.well-known/security.txt` (`apps/web/public/`) |
| RGPD : export, suppression, mentions, confidentialité | ✅ | Profil + endpoints `/me/*` |
| IA : consentement, minimisation, traçabilité, décision humaine | ✅ | Wizard step 7, `aiUsage.ts`, `ai_usage_events`, `regulatory_findings.instructor_decision` |
| Inférence IA hébergée en France | ✅ | Mistral La Plateforme (Paris) |
| SSO Microsoft Entra ID | ⚠️ À clarifier avec DSI | Annexe Technique n°2 §3.6 + §4.5 |
| Hébergement France | ⚠️ Migration Clever Cloud planifiée Phase 2 | `plan-deploiement.md` |
| Certificat SSL OV | ⚠️ Let's Encrypt (DV) → CertEurope OV Phase 3.3 | Annexe Technique n°2 §4.9 |
| Sauvegardes 3-2-1 documentées | ⚠️ À formaliser dans Dossier d'Exploitation | CCSC §11.6 |
| Audit dépendances (`pnpm audit` en CI) | ⚠️ À intégrer en CI | CCSC §5 |
| Accessibilité RGAA AA | ⚠️ Non audité | Annexe Technique n°2 §4.7 |
| Export CSV/JSON dossiers (interface mairie) | ⚠️ Non implémenté | Annexe Technique n°2 §4.15 |

### 9.10 Documents conformité disponibles

- `docs/security/architecture.md` — mécanismes en place.
- `docs/security/conformite-dsi.md` — analyse d'impact des 5 documents DSI Tours.
- `docs/security/registre-traitements.md` — fiches art. 30 RGPD.
- `docs/security/aipd.md` — Analyse d'impact sur la protection des données.
- `docs/security/dpa-mistral-checklist.md` — checklist signature DPA Mistral.
- `docs/security/benchmark-llm.md` — méthodologie comparaison LLM.
- `docs/security/todo.md` — TODOs sécurité par priorité.
- `docs/plan-deploiement.md` — feuille de route souveraineté (Mistral livré, S3 / Clever Cloud / Brevo / IGN / OV / SecNumCloud).

---

## 10. Variables d'environnement (synthèse)

| Variable | Obligatoire | Défaut | Usage |
|---|---|---|---|
| `PORT` | non | `3001` | Port Express |
| `NODE_ENV` | recommandé | `development` | Active `Secure` cookies |
| `DATABASE_URL` | **oui** | — | PostgreSQL |
| `JWT_SECRET` | **oui** | — | Signature JWT |
| `MISTRAL_API_KEY` | **oui** | — | Inférence IA |
| `MISTRAL_API_BASE` | non | `https://api.mistral.ai/v1` | Override Mistral |
| `PISTE_CLIENT_ID` | oui (prod) | — | OAuth Légifrance |
| `PISTE_CLIENT_SECRET` | oui (prod) | — | OAuth Légifrance |
| `PISTE_API_BASE_URL` | non | sandbox | API PISTE |
| `PISTE_OAUTH_URL` | non | sandbox | OAuth PISTE |
| `RESEND_API_KEY` | oui (prod) | — | Email (→ `BREVO_API_KEY`) |
| `SMTP_FROM` | non | `Heurekia <notifications@mail.heurekia.com>` | Adresse expéditeur |
| `VOYAGE_API_KEY` | oui (ingestion) | — | Embeddings RAG |
| `FRONTEND_URL` | non | `https://app.heurekia.com` | URL base |
| `FRONTEND_URLS` | non | `FRONTEND_URL` | Whitelist CORS |
| `STORAGE_PROVIDER` | non | `local` | `local` ou `s3` |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | oui si `s3` | — | Stockage objet |
| `AUDIT_LOG_RETENTION_MONTHS` | non | `12` | Purge audit |
| `DRAFT_DOSSIER_RETENTION_DAYS` | non | `180` | Purge brouillons |
| `PLU_REFRESH_AFTER_MS` | non | 30 j | Cache PLU |

---

## 11. Déploiement & exploitation

| Élément | Valeur |
|---|---|
| PaaS actuel | Railway (sur AWS eu-west-1) |
| Build | Nixpacks — Node 20, pnpm, `poppler-utils` (`pdftoppm`) |
| Process | `node --import tsx apps/api/src/index.ts` (Procfile) |
| Pre-deploy | Migrations Drizzle (`railway.json`) |
| Health check | `GET /api/health` (timeout 30 s) |
| Logs | stdout (Railway / Clever Cloud) |
| Monitoring | À étendre (Sentry envisagé), alertes Slack pour coûts IA |
| Scaling | Instance unique aujourd'hui (cron in-process). Horizontalisation conditionnée à un scheduler externe (Clever Cloud Scheduler) |
| Cible souveraineté | Clever Cloud 🇫🇷 (Node + PostgreSQL + Cellar S3) — cf. `plan-deploiement.md` |

---

## 12. Points d'attention & dette technique

1. **SSO Entra ID** (DSI Tours) : à arbitrer (agents seulement ou citoyens inclus ?). Impact architectural majeur si étendu aux citoyens.
2. **Stockage S3** : migration en cours (Phase 1). Cohabitation `local`/`s3` à gérer pendant la transition (champ `dossier_pieces_jointes.url`).
3. **Scheduler in-process** : à externaliser le jour où on scale horizontalement, pour éviter doublons d'exécution.
4. **Voyage AI (embeddings)** : sous-traitant américain — à requalifier si exigence SecNumCloud (Phase 7).
5. **CartoCDN** : à retirer (Phase 3.2) au profit du WMTS IGN pour cohérence souveraineté + CSP.
6. **`pnpm audit`** : à intégrer en CI (GitHub Actions).
7. **Accessibilité RGAA AA** : audit non réalisé.
8. **Export CSV/JSON dossiers** (interface mairie) : non implémenté (Annexe Technique DSI n°2 §4.15).
9. **DPA Mistral AI** : à signer pour finaliser la conformité (cf. `dpa-mistral-checklist.md`).

---

*Fin du document.*
