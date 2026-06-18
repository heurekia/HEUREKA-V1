# Document technique HEUREKA V1

| Champ | Valeur |
|-------|--------|
| Version | 1.1 |
| Date | 17 juin 2026 |
| Périmètre | Backend `apps/api`, frontend `apps/web`, packages `db` / `ingestion` / `regulatory-engine` / `shared` |
| Lecteurs cibles | DSI, DPD, équipe technique, auditeurs sécurité |
| Changements 1.0 → 1.1 | Bascule embeddings Voyage AI → Mistral (souveraineté), script `reindex-rag`, archivage des pièces remplacées (versionnage), évaluation IA groupée par emplacement (`analyzePieceGroup`), table `legal_mentions_misses` + file d'attente admin « Articles manquants », menu contextuel ligne dossier, correctif workflow `incomplet → pre_instruction` |

> Document de synthèse couvrant l'architecture, les tables de la base, les appels externes, les briques fonctionnelles, la redirection des fronts, les tâches planifiées, les pipelines de traitement, la sécurité, les tests, la CI/CD, l'observabilité, le multi-tenant, l'IA et le workflow métier. Compagnon de `docs/plan-deploiement.md` (roadmap souveraineté) et de `docs/security/*` (registre RGPD, AIPD, conformité DSI).

### Sommaire

1. Vue d'ensemble
2. Topologie monorepo
3. Base de données (38 tables Drizzle)
4. Appels externes (15 services)
5. Briques fonctionnelles
6. Redirection des fronts
7. Tâches planifiées (cron)
8. Traitement — Pipelines
9. Sécurité
10. Variables d'environnement
11. Déploiement & exploitation
12. Tests & qualité
13. CI/CD (GitHub Actions, VPS OVH + PM2)
14. Observabilité & exploitation (logs, monitoring, SLO, runbook)
15. Schéma d'architecture & ERD
16. Multi-tenant & isolation par commune
17. Modèle d'erreurs API & frontend
18. Gestion d'état frontend
19. Accessibilité
20. SEO & métadonnées
21. IA : MODEL_MAP, pricing & benchmark
22. Workflow métier — Machine d'états
23. Internationalisation
24. Licences
25. Setup environnement de développement
26. Points d'attention & dette technique
27. Journal des évolutions

---

## 1. Vue d'ensemble

HEUREKA est une plateforme d'instruction des autorisations d'urbanisme (PC, DP, PA, PD, CU, PCMI…) à destination des collectivités territoriales et de leurs pétitionnaires. Elle se compose :

- d'un **front citoyen** (dépôt et suivi de dossier) servi sous `www.heurekia.com`,
- d'un **front mairie / instructeur / admin** servi sous `app.heurekia.com`,
- d'une **API REST Node.js / Express** qui orchestre la base PostgreSQL, le stockage objet, le LLM d'analyse, les API métiers IGN / Légifrance et les emails transactionnels.

| Couche | Stack | Localisation |
|---|---|---|
| Hébergement (actuel) | **VPS OVH 🇫🇷** (Postgres + nginx + Node sur la même machine) | Bascule effectuée (juin 2026). Cf. `docs/plan-deploiement.md` Phase 2 et `docs/security/dossier-exploitation.md`. |
| Base de données | PostgreSQL + extension `pgvector` | Installé localement sur le VPS, accès via `DATABASE_URL` (loopback `127.0.0.1:5432`) |
| Stockage des pièces | Disque local du VPS OVH (persistant) | Sauvegardes chiffrées vers OVH Object Storage (cf. `infra/backup/`) ; abstraction S3 prête si bascule conteneur ultérieure |
| LLM | Mistral La Plateforme — Pixtral Large / Pixtral 12B / Mistral Large / Mistral Small | Datacenters Mistral AI SAS 🇫🇷 Paris |
| Email transactionnel | Resend | Migration prévue → Brevo 🇫🇷 (Phase 3.1) |
| Cartographie | data.geopf.fr (IGN) + CartoCDN (fond) + Leaflet côté front | IGN 🇫🇷, CartoCDN 🇺🇸 (retrait planifié Phase 3.2) |
| Référentiels publics | data.gouv.fr (BAN), geo.api.gouv.fr, IGN GPU/Cadastre, RNB, Géorisques | France 🇫🇷 |
| Code légal | PISTE / Légifrance (DILA) | France 🇫🇷 (OAuth2) |
| Embeddings RAG | Mistral — `mistral-embed` (1024 dim) | Datacenters Mistral AI SAS 🇫🇷 Paris (mutualisé avec l'inférence LLM) |

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
| Migrations | `packages/db/migrations/` générées par `drizzle-kit`, jouées par `pnpm --filter @heureka-v1/db migrate` lors du déploiement sur le VPS |
| Connexion | `DATABASE_URL` (PostgreSQL connection string, loopback `127.0.0.1:5432` sur le VPS) |
| Sauvegardes | ✅ Scripts `infra/backup/` — `pg_dump` quotidien chiffré GPG, miroir OVH Object Storage 🇫🇷, rétention 7j/4sem/6mois, verify hebdo automatique. Procédure complète : [`dossier-exploitation.md`](./security/dossier-exploitation.md). |
| Schémas | 38 fichiers TypeScript dans `packages/db/src/schema/` |

### 3.2 Localisation / stockage des données par catégorie

| Famille | Localisation physique | Politique de rétention | Sensibilité RGPD |
|---|---|---|---|
| Données métier (dossiers, pièces, décisions) | PostgreSQL sur **VPS OVH 🇫🇷** | 10 ans à compter de la décision (archives départementales) | Données nominatives, mission d'intérêt public art. 6-1-e |
| Comptes utilisateurs | PostgreSQL 🇫🇷 | Vie du compte + 3 ans inactivité | Identifiants + mots de passe (bcrypt) |
| Fichiers binaires (PDF, photos) | Disque local du VPS OVH 🇫🇷 (`UPLOADS_DIR`, persistant) ; sauvegardes chiffrées → OVH Object Storage 🇫🇷 | Idem dossier (10 ans) ; brouillon > 180 jours purgé | Pièces justificatives, potentiellement nominatives |
| Audit logs | PostgreSQL 🇫🇷, index dédié pour la purge | 12 mois (CCSC §4.14) — purge auto quotidienne | Traçabilité légale, IP, user-agent |
| `ai_usage_events` | PostgreSQL 🇫🇷 | Vie du dossier (empreinte SHA-256, pas le contenu) | Aucune PII : on stocke uniquement le hash |
| Embeddings RAG (`document_segments`) | PostgreSQL + pgvector 🇫🇷 | Vie du document source | Donnée publique (PLU, OAP, PPRI) |
| Cache IGN GPU | PostgreSQL 🇫🇷 | TTL 30 jours, rafraîchi par cron 03h00 | Donnée publique |

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
| `dossier_pieces_jointes` | `dossier_pieces_jointes.ts` | Fichiers déposés (PDF, plans, photos) | `dossier_id` FK cascade · `url` (chemin local ou clé S3) · `type` (MIME) · `taille` · `code_piece` (PC1, PLAN, PHOTO…) · `analyse_ia` jsonb · `extraction_ia` jsonb · `instructeur_status` (valide/rejete/complement_demande) · `instructeur_note` · **`ai_processed` bool** · **`archived_at` / `archived_by_piece_id`** (versionnage : ancienne pièce archivée — jamais supprimée — quand le pétitionnaire en redépose une nouvelle pour le même emplacement après une demande de complément) |
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
| `regulatory_documents` | `regulatoryDocuments.ts` | OAP, PPRI, PEB, schémas couleurs |
| `external_services` | `externalServices.ts` | Services consultés (DDE, SDIS, STAP, archéo…) |
| `service_communes` | `serviceCommunes.ts` | Affectation service ↔ commune |

#### 3.3.6 Cache & RAG

| Table | Fichier | Rôle |
|---|---|---|
| `gpu_parcel_cache` | `gpuCache.ts` | Cache IGN GPU (TTL 30 j) — documents, zone_urba, prescriptions, SUP surfacique/linéaire, générateurs, `hit_count` |
| `document_segments` | `documentSegments.ts` | Indexation RAG — `id` `{insee}_{doc}_{code}`, `doc_type` (plu-reglement / oap / ppri), `embedding vector(1024)`, indexes sur `insee`, `doc_type`, `parent_code` |
| `document_segment_annotations` | `documentSegmentAnnotations.ts` | Annotations humaines (correction / validation / flag) |
| `legal_mentions` | `legalMentions.ts` | Cache Légifrance — `code_key` (CU/CCH/CE), `article_num`, `texte_html`, `source_url`, `date_retrieved` |
| `legal_mentions_misses` | `legalMentionsMisses.ts` | File d'attente admin pour les articles introuvables : à chaque clic citoyen/instructeur sur une référence absente du cache et non récupérable via Légifrance (renumérotation, faute de frappe), on incrémente `miss_count`. L'admin tranche depuis « Configuration » : `resolution = "created"` (création via Légifrance) ou `"dismissed"` (référence non pertinente). Index unique `(code_key, article_ref)` pour la déduplication. |
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
| **Mistral (embeddings)** | 🇫🇷 | `https://api.mistral.ai/v1/embeddings` (modèle `mistral-embed`, 1024 dim) | Bearer | Génération embeddings RAG pour `document_segments`. Même clé que l'inférence LLM. | `MISTRAL_API_KEY` | `packages/ingestion/src/db/embedder.ts` |
| **S3-compatible (OVH Object Storage en priorité, Cellar / Scaleway / AWS S3 compatibles)** | 🇫🇷 | `S3_ENDPOINT` | Access key | Stockage objet pièces jointes — codé, activable au besoin (aujourd'hui : `STORAGE_PROVIDER=local` sur le VPS, sauvegardes via `infra/backup/`) | `STORAGE_PROVIDER`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | `apps/api/src/services/storage.ts` |
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
| Workflow | `src/services/dossierWorkflow.ts`, `instructionDelays.ts`, `absenceDelegation.ts` | Transitions, calcul délais, gestion délégations. Spécificité : `autoReopenAfterCitizenUpload` ne déclenche plus la bascule `incomplet → pre_instruction` quand un courrier `pieces_complementaires` est ouvert — la transition est portée par `POST /api/dossiers/:id/resoumettre`, qui vérifie en plus que toutes les pièces réclamées ont bien été redéposées (fix 17/06/2026). |
| Archivage pièces | `src/services/pieceArchive.ts` | `archivePreviousComplementDemande()` — quand le pétitionnaire redépose une pièce dans un emplacement où l'instructeur avait demandé un complément, l'ancienne version est archivée (`archived_at` + `archived_by_piece_id`). Identification de l'emplacement par `code_piece` (canonique) ou par le préfixe slot du nom de fichier (convention `${slot} - ${file}`). Trace journalisée via `instruction_events.type = "piece_archivee_par_complement"`. |
| Cron | `src/jobs/scheduler.ts` | Voir §7 |
| Scripts ops | `src/scripts/reindex-rag.ts` | Voir §11.1. Ré-indexation pgvector après changement d'embedder (Voyage → Mistral). |

### 5.2 `apps/web` — Frontend React

React 19.1 + Vite 6 + React Router 7 + Tailwind 3 + Leaflet + Recharts + TipTap (éditeur courriers) + DOMPurify (sanitisation HTML). Auth basée sur cookie `HttpOnly` (le front ne manipule jamais le JWT en JS).

### 5.3 `packages/db`

Schémas Drizzle (38 fichiers), migrations SQL générées (`drizzle-kit`), client `postgres` 3.4.5, exports types. Migrations jouées lors du déploiement sur le VPS via `pnpm --filter @heureka-v1/db migrate` (cf. workflow GitHub Actions `deploy.yml`).

### 5.4 `packages/ingestion`

CLI `pnpm --filter @heureka-v1/ingestion ingest` :
1. Parsing PDF (PDFKit / `unpdf`), découpage en segments métier.
2. Optionnel `--rules` : structuration articles via Pixtral Large → insert `zone_regulatory_rules` en `validation_status = 'brouillon'` (validation humaine obligatoire avant consommation par le moteur).
3. Optionnel `--load` : embeddings `mistral-embed` → `document_segments` (pgvector).
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
- `/admin/configuration` — section **« Articles manquants »** : liste les références d'articles cliquées par les utilisateurs mais introuvables (cache + Légifrance KO) ; chaque ligne propose **« Créer via Légifrance »** (retry de l'API et insertion dans `legal_mentions`) ou **« Ignorer »** (`resolution = "dismissed"`). Persisté dans `legal_mentions_misses`.

### 6.6 Routes service externe (`app/service/...`)

- `/service/consultations`
- `/service/messagerie`

### 6.7 Garde-fous

`apps/web/src/router/guards.tsx` : `ProtectedRoute` (require auth + rôle), `PublicOnlyRoute` (login redirige si déjà connecté). Côté API, **le middleware `enforceDossierAccess`** garantit qu'un agent mairie ne voit que les dossiers de ses communes (cf. `user_communes`).

---

## 7. Tâches planifiées (cron)

Implémentation : `apps/api/src/jobs/scheduler.ts` via `node-cron` 4.2.1, démarré en in-process au boot de l'API. **Pas de queue répartie** : aujourd'hui l'API tourne en instance unique sur le VPS OVH (PM2), donc pas de doublon possible. Le jour où on scale horizontalement, il faudra extraire ces tâches dans un scheduler dédié (cron Linux + lock Postgres, ou job queue type BullMQ).

| Horaire | Tâche | Description | Variable de paramétrage |
|---|---|---|---|
| **02h00** quotidien | Purge `audit_logs` | Supprime les lignes plus anciennes que le seuil. Conformité CCSC §4.14 et RGPD art. 5.1.e (limitation de la conservation). | `AUDIT_LOG_RETENTION_MONTHS` (défaut **12**) |
| **02h30** quotidien | Purge brouillons | Supprime les `dossiers` en statut `brouillon` inactifs depuis N jours **+ fichiers physiques associés** (via `StorageProvider.deleteMany`). | `DRAFT_DOSSIER_RETENTION_DAYS` (défaut **180**) |
| **03h00** quotidien | Rafraîchissement cache PLU | Pour chaque commune dont `plu_zones_cached_at` > 30 j, recharge `communes.plu_zones_geojson` depuis l'API IGN GPU. | `PLU_REFRESH_AFTER_MS` |
| **04h00** quotidien | Redirection absences | Réassigne les dossiers en attente d'instructeurs absents (cf. `user_absences` + `user_delegations`) vers leur délégué. | — |

Tous les logs sont préfixés `[cron]` (visibles via `pm2 logs heurekia-api` ou `journalctl -u heurekia-api` sur le VPS).

---

## 8. Traitement — Pipelines

### 8.1 Dépôt d'un dossier citoyen

1. Wizard 8 étapes (`NouvelleDemandeWizard.tsx`) : type de demande → parcelle → infos CERFA → pièces → **consentement IA** → validation.
2. `POST /api/dossiers/classify` → classification de la procédure (type + articles applicables + alertes) via Mistral (`purpose=procedure_explain`).
3. Pour chaque pièce : `POST /api/dossiers/:id/pieces/upload` (multipart, 20 MB max). Si `dossiers.ai_consent = true` :
   - PDF → PNG (1ʳᵉ page) via `pdftoppm` (paquet `poppler-utils`).
   - Sanitisation : nom de fichier nettoyé de l'identité ; masquage des 4 derniers chiffres de la parcelle.
   - **Évaluation groupée par emplacement** (depuis 17/06/2026) : `analyzePieceGroup()` regroupe tous les fichiers d'un même `code_piece` (ex. PC5 — Plan des façades : 4 PDF de façades Nord/Sud/Est/Ouest) et les envoie en **un seul appel Pixtral** avec consigne d'évaluer l'ensemble. Évite les faux négatifs « façade Sud manquante » alors qu'elle figure sur un autre PDF du lot. Le résultat est ensuite répliqué sur chaque pièce du groupe.
   - Sinon, appel unitaire Pixtral Large (`purpose=piece_analyze`) → score Conforme / Acceptable / Problématique + explication.
   - Stockage : `dossier_pieces_jointes.analyse_ia`, marqueur `ai_processed = true`, hash SHA-256 dans `ai_usage_events.file_hash`.
   - **Archivage de version** : si l'emplacement contient déjà des pièces en `instructeur_status = "complement_demande"`, `archivePreviousComplementDemande()` bascule les anciennes versions en archive (`archived_at` + `archived_by_piece_id`). Identification par `code_piece` ou par préfixe slot. Trace via `instruction_events`. Les pièces archivées sont exclues de la complétude, de la conformité, de l'auto-bascule de statut et de `dossier_facts`.
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
3. Embeddings `mistral-embed` → `document_segments` (pgvector).
4. Validation humaine côté mairie/admin → bascule `validation_status = 'valide'` → consommé par le moteur.

### 8.4 Garde-fous IA

- **Décision humaine obligatoire** (art. 22 RGPD) : aucun finding n'est appliqué automatiquement, l'instructeur tranche via `instructor_decision` (accepted / corrected / ignored).
- **Coût** : seuils par appel et journaliers (`ai_alert_config`), alerte Slack au dépassement, page admin Coûts IA pour audit.
- **Dégradation gracieuse** : indisponibilité Mistral → la pièce reste déposable, l'analyse est marquée indisponible, l'instructeur travaille sans assistance IA.
- **Évaluation collective des slots multi-fichiers** : `pieceAnalyzer.analyzePieceGroup()` envoie tous les fichiers d'un même slot dans le même prompt avec la consigne explicite « évaluer comme un ENSEMBLE ». Réduit drastiquement les faux négatifs « pièce manquante » sur les emplacements à plusieurs vues (façades, photos d'insertion). `dossierConformity.ts` regroupe par `code_piece` en amont et mappe le résultat à chaque fichier.

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
| Crypto | `JWT_SECRET` | `/home/ubuntu/heurekia/apps/api/.env` sur le VPS (mode 600) ; secrets GitHub Actions pour le déploiement |
| Base | `DATABASE_URL` | Idem (loopback Postgres local sur le VPS) |
| LLM | `MISTRAL_API_KEY` | Idem |
| Code légal | `PISTE_CLIENT_ID`, `PISTE_CLIENT_SECRET` | Idem |
| Email | `RESEND_API_KEY` (→ `BREVO_API_KEY`) | Idem |
| Stockage objet (si activé) | `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_BUCKET` | Idem |
| Sauvegardes | `GPG_PASSPHRASE_FILE` (cf. `/etc/heureka/backup.env`), credentials rclone OVH | `/etc/heureka/` mode 700 root |
| RAG | `MISTRAL_API_KEY` (mutualisée avec l'inférence LLM) | `/home/ubuntu/heurekia/apps/api/.env` |

Aucun secret n'est commit. `.env.example` documente les clés sans valeur. Le fichier `.env` du VPS et `/etc/heureka/backup.env` sont en mode 600 (root) et inclus dans `backup-config.sh` pour la sauvegarde.

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
| Hébergement France | ✅ VPS OVH 🇫🇷 + sauvegardes OVH Object Storage 🇫🇷 | `plan-deploiement.md` §2, `dossier-exploitation.md` |
| Certificat SSL OV | ⚠️ Let's Encrypt (DV) → CertEurope OV Phase 3.3 | Annexe Technique n°2 §4.9 |
| Sauvegardes 3-2-1 documentées | ✅ Scripts `infra/backup/` + `dossier-exploitation.md` | CCSC §11.6 |
| Dossier d'Exploitation | ✅ Livré | `dossier-exploitation.md` |
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
- `docs/plan-deploiement.md` — feuille de route souveraineté (Mistral + VPS OVH livrés ; restent Brevo / IGN / certificat OV / SecNumCloud optionnel).
- `docs/security/dossier-exploitation.md` — procédures d'exploitation (hébergement, sauvegardes, restauration, mise à jour, incidents).

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
| _(VOYAGE_API_KEY supprimée — embeddings via `MISTRAL_API_KEY`)_ | — | — | — |
| `FRONTEND_URL` | non | `https://app.heurekia.com` | URL base |
| `FRONTEND_URLS` | non | `FRONTEND_URL` | Whitelist CORS |
| `STORAGE_PROVIDER` | non | `local` | `local` ou `s3` |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | oui si `s3` | — | Stockage objet |
| `AUDIT_LOG_RETENTION_MONTHS` | non | `12` | Purge audit |
| `DRAFT_DOSSIER_RETENTION_DAYS` | non | `180` | Purge brouillons |
| `PLU_REFRESH_AFTER_MS` | non | 30 j | Cache PLU |

---

## 11. Déploiement & exploitation

### 11.1 Scripts d'exploitation one-shot

| Script | Commande | Quand l'exécuter | Détail |
|---|---|---|---|
| **`reindex-rag.ts`** | `pnpm --filter @heureka-v1/api reindex-rag [--dry-run] [--commune <INSEE>] [--only-failed]` | Après changement d'embedder (Voyage → Mistral, juin 2026) ou après upgrade `mistral-embed`. **Étape obligatoire** : les vecteurs Voyage et Mistral vivent dans des espaces différents, les distances cosinus cross-provider sont incohérentes — sans cette passe, la recherche RAG retourne du bruit. | Itère sur `regulatory_documents`, ré-appelle `indexCommuneDocument()` (idempotent : purge les anciens segments par `source_id` avant ré-insertion). Options : `--dry-run` (inventaire seul, aucune écriture) ; `--commune <INSEE>` (bascule progressive PoC) ; `--only-failed` (rejouer les rows en `indexing_status = "indexing_error"` après un pic de rate-limit Mistral). Procédure complète (sauvegarde préalable, coût indicatif, statuts attendus) : [`dossier-exploitation.md`](./security/dossier-exploitation.md) §8.1. |

### 11.2 Infrastructure

| Élément | Valeur |
|---|---|
| Hébergement actuel | **VPS OVH 🇫🇷** (Ubuntu LTS) |
| Stack runtime | Node 20 + pnpm, `poppler-utils` (`pdftoppm`) installés via `apt` |
| Process | `node --import tsx apps/api/src/index.ts` lancé par `systemd` (`heureka-api.service`) |
| Pre-deploy | Migrations Drizzle (`pnpm --filter @heureka-v1/db migrate`) via le workflow `.github/workflows/deploy.yml` |
| Frontend | Build Vite → fichiers statiques servis par nginx |
| Reverse proxy | nginx (TLS Let's Encrypt via certbot, gzip, headers Helmet en frontal applicatif) |
| Health check | `GET /api/health` (sonde monitoring externe, p.ex. Updown.io) |
| Logs | `journalctl -u heureka-api` (rotation systemd) |
| Sauvegardes | Cron `infra/backup/` — Postgres + uploads + config → OVH Object Storage. Cf. [`dossier-exploitation.md`](./security/dossier-exploitation.md). |
| Monitoring | À étendre (Sentry envisagé), alertes Slack pour coûts IA |
| Scaling | Instance unique aujourd'hui (cron in-process). Horizontalisation conditionnée à un scheduler externe et à un stockage objet partagé. |
| Cible souveraineté | ✅ Atteinte (OVH 🇫🇷 + Mistral 🇫🇷). Reste Brevo (email) et certificat OV — cf. `plan-deploiement.md`. |

---

## 12. Tests & qualité

### 12.1 Stack de test

- **Framework** : Vitest (config dans `apps/api/vitest.config.ts`, `packages/ingestion/vitest.config.ts`).
- **Couverture actuelle** : **30 fichiers de tests** (`*.test.ts`), majoritairement unitaires.
- **TypeScript strict** : `tsc --noEmit` joué en CI sur `apps/api` et `apps/web`.

### 12.2 Périmètre testé

| Zone | Fichiers de tests notables |
|---|---|
| Services API | `pieceAnalyzer.test.ts`, `pieceRequest.test.ts`, `dossierWorkflow.test.ts`, `cerfaPcmiFiller.test.ts`, `buildability.test.ts`, `zoneRules.test.ts`, `classificationEngine.test.ts`, `parcelAnalysis.test.ts`, `audit.test.ts`, `dossierFacts.test.ts`, `jsonExtract.test.ts`, `documentationEngine.test.ts`, `dossierConformity.test.ts`, `storage.test.ts` |
| Moteur réglementaire | `regulatory-engine/orchestrator/runEvaluation.test.ts`, `applicability/engine.test.ts`, et un fichier par évaluateur métier : `recul_voie`, `stationnement`, `hauteur`, `emprise`, … |
| Ingestion | Tests Vitest dans `packages/ingestion/` (parsing PDF, structuration LLM mockée) |

### 12.3 Stratégie de mocking

- Appels Mistral et PISTE **mockés** via `vi.mock()` — pas de tokens consommés en CI.
- Drizzle ORM : tests de services purs avec données injectées (pas de PostgreSQL en CI).
- Tests d'intégration end-to-end : à étendre (manque actuellement de tests « API → base réelle »).

### 12.4 Commandes

```bash
pnpm install --frozen-lockfile
cd apps/api && pnpm test               # tests unitaires API
cd apps/web && pnpm typecheck          # typecheck strict front
pnpm --filter @heureka-v1/regulatory-engine test
```

---

## 13. CI/CD

### 13.1 GitHub Actions

Deux workflows dans `.github/workflows/` :

#### 13.1.1 `ci.yml` — Validation à chaque PR / push sur `main`

| Job | Description |
|---|---|
| **security-audit** | `pnpm audit --prod` (exclut les `devDependencies` — vulnérabilités drizzle-kit/esbuild non bloquantes en dev) |
| **typecheck** | `tsc --noEmit` sur `apps/api` puis `apps/web` |
| **tests** | `pnpm test` côté API (Vitest) |
| **build** | `vite build` (web) + `tsc` (api) — garantit qu'un build casserait pas en prod |

Runtime : Node 22, pnpm cache activé.

#### 13.1.2 `deploy.yml` — Déploiement production

- **Cible réelle** : **VPS OVH 🇫🇷** via SSH + PM2 (cf. `plan-deploiement.md` §2 et `dossier-exploitation.md`).
- **Déclencheurs** : push sur `main`, ou dispatch manuel.
- **Concurrency group** `deploy-production` avec `cancel-in-progress: true` (un déploiement en chasse un autre).
- **Étapes** sur le VPS :
  1. `git fetch origin main && git reset --hard origin/main`
  2. `pnpm install --frozen-lockfile`
  3. `pnpm build`
  4. `pnpm --filter @heureka-v1/db migrate` (best-effort, `|| true`)
  5. `pm2 restart heurekia-api --update-env && pm2 save`
  6. **Healthcheck actif** : `curl https://app.heurekia.com/api/health` toutes les 3 s × 20 tentatives (60 s max). Si KO → `pm2 logs --lines 50` et exit 1.
- **Secrets GH Actions** : `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_PORT`.

### 13.2 État réel vs documenté

> ✅ Alignement effectué (juin 2026, v3 du plan) : `plan-deploiement.md` reflète désormais l'hébergement VPS OVH + PM2 actuellement en prod. Reste à l'état "à venir" : bascule email Brevo et certificat SSL OV.

### 13.3 Conventions & qualité de code

| Outil | Configuration |
|---|---|
| **Prettier** 3.8.1 | Formatage (config à la racine) |
| **TypeScript** 5.9.2 strict | `tsconfig.base.json` partagé |
| **ESLint** | À vérifier (non détecté en racine) — recommandation : ajouter |
| **Husky / lint-staged** | Non configurés — recommandation : pre-commit hook `pnpm test` + Prettier |

### 13.4 Stratégie de release

- **Trunk-based** : `main` est la branche déployable.
- **PR review** obligatoire avant merge (process GitHub, pas de protection branch configurée visible).
- **Hotfix** : commit direct sur `main` → déploiement auto (le workflow `deploy.yml` se déclenche).
- **Rollback** : `git revert` + push sur `main` → re-déploiement. Pas de mécanisme de blue-green ou de bascule de version (PM2 redémarre en place).

---

## 14. Observabilité & exploitation

### 14.1 Logs

- **Format actuel** : `console.log` / `console.error` non structuré, préfixé par contexte (`[cron]`, `[shutdown]`, `[aiUsage]`, etc.).
- **Captés par PM2** sur le VPS, accessibles via `pm2 logs heurekia-api`.
- **Recommandation tech** : passer à un logger structuré (pino) avec :
  - request-id par requête HTTP,
  - redaction automatique des champs sensibles (`password`, `token`, `Authorization`),
  - niveaux (`debug` / `info` / `warn` / `error`),
  - sortie JSON pour ingestion outil tiers.

### 14.2 Monitoring & alerting

| Domaine | État actuel | Cible recommandée |
|---|---|---|
| Erreurs applicatives | `console.error` only | **Sentry** (mentionné dans `plan-deploiement.md`) — frontend + backend, source maps en prod |
| Métriques applicatives | Aucune | Métriques Prometheus / OpenTelemetry exposées sur `/metrics`, scrapping Grafana |
| Disponibilité externe | Healthcheck GH Actions post-deploy uniquement | Uptime monitor (UptimeRobot / Better Stack) sur `/api/health` |
| Coûts IA | ✅ Alertes Slack par appel + journalier (`ai_alert_config`) | OK |
| Quotas Mistral / PISTE | Aucun suivi | Alerter sur quota approaching depuis headers de réponse |

### 14.3 SLO / SLA cibles (à formaliser)

| Indicateur | Cible suggérée |
|---|---|
| Disponibilité API | 99,5 % hors fenêtres de maintenance (~3 h 30 / mois) |
| Latence p95 API (hors IA) | < 500 ms |
| Latence p95 analyse IA pièce | < 30 s (Pixtral Large + PDF→PNG) |
| RPO (perte max accepté) | 24 h (backup quotidien) |
| RTO (temps de restauration) | 4 h |

### 14.4 Runbook — Procédures d'incident

| Incident | Symptômes | Action |
|---|---|---|
| **Mistral indisponible** | 503 / timeout sur `api.mistral.ai` ; tous les `purpose=*` échouent | Dégradation gracieuse automatique côté wizard (analyse marquée indisponible). Si > 1 h : message d'information sur le bandeau. Pas de fallback Anthropic (chemins retirés). |
| **IGN GPU 503** | `/api/mairie/parcelle/:parcelle` lent ou KO | Cache `gpu_parcel_cache` 30 j absorbe. Si cache vide pour la parcelle : afficher message et bouton « réessayer ». Aucune action ops requise (SLA IGN faible connu). |
| **PostgreSQL saturé** | Latence requêtes élevée, erreurs `too many connections` | Vérifier pool Drizzle (`postgres` driver). Scaler le VPS (RAM / `shared_buffers` Postgres). Identifier requêtes lentes via `pg_stat_statements`. |
| **Stockage objet indisponible (si activé)** | Upload pièce KO | `StorageProvider` remonte l'erreur — le citoyen voit un message. Vérifier credentials OVH Object Storage et statut du conteneur dans la console OVH. Fallback : repasser temporairement `STORAGE_PROVIDER=local`. |
| **Disque VPS plein** | Uploads et sauvegardes échouent | Vérifier `df -h /var`. Purger les anciennes sauvegardes via `rotate.sh` ou réduire `RETENTION_*`. Vérifier la rotation des logs PM2 et nginx. |
| **Quota Mistral atteint** | 429 sur Mistral | Alerte Slack `daily_threshold_eur` déjà déclenchée en amont. Lever quota côté console Mistral, ou bridage temporaire des `purpose` non critiques. |
| **PISTE token expiré** | 401 sur articles légaux | Le client refresh automatiquement. Si KO persistant : régénérer le couple `PISTE_CLIENT_ID/SECRET` dans la console PISTE. |
| **Déploiement healthcheck KO** | GH Action `deploy.yml` exit 1 | `pm2 logs heurekia-api --lines 100` sur le VPS, `pm2 restart`, vérifier `DATABASE_URL` & migrations. |
| **Cron raté** | Pas de log `[cron]` dans la fenêtre attendue | Vérifier que le process API est up (PM2). Forcer la purge manuellement via script ad-hoc. |
| **Compte verrouillé / rate-limit citoyen** | Login refusé `429 Too Many Requests` | Attendre la fenêtre (10/15 min). Admin peut effacer la clé IP côté `express-rate-limit` (in-memory : suffit de redémarrer le process). |

### 14.5 Backup & restore

✅ Politique 3-2-1 livrée et documentée — voir [`docs/security/dossier-exploitation.md`](./security/dossier-exploitation.md).

| Élément | Politique en place | Référence |
|---|---|---|
| PostgreSQL | `pg_dump -Fc` quotidien 02:00, gzip + GPG AES-256, miroir OVH Object Storage 03:00, rétention 7j/4sem/6mois | `infra/backup/backup-postgres.sh`, `rotate.sh` |
| Fichiers uploads | `tar.gz` quotidien 02:15, même chaîne de chiffrement et de rétention | `infra/backup/backup-uploads.sh` |
| Config (nginx, `.env`, PM2 dump, units systemd) | Snapshot hebdomadaire | `infra/backup/backup-config.sh` |
| Vérification automatique | Restore test hebdomadaire dans une base jetable, log `verify.log` | `infra/backup/verify.sh` |
| Code & secrets | Code dans GitHub ; secrets dans `.env` mode 600 sur le VPS, sauvegardés via `backup-config.sh` ; passphrase GPG dupliquée dans le coffre Bitwarden de l'équipe | — |
| RPO / RTO | 24 h / 4 h | `document-technique.md` §17 |

---

## 15. Schéma d'architecture & ERD

### 15.1 Flux d'une requête citoyen typique

```
┌─────────────┐  HTTPS+cookie  ┌──────────────┐
│ Navigateur  │ ─────────────► │  apps/web    │
│ www.…       │                │  React SPA   │
└─────────────┘                └──────┬───────┘
                                       │ fetch /api/...
                                       ▼
                              ┌──────────────────┐
                              │  apps/api        │
                              │  Express + JWT   │
                              └─┬────────┬───────┘
                                │        │
        ┌───────────────────────┘        └──────────────────────┐
        │                                                       │
        ▼                                                       ▼
┌──────────────┐    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ PostgreSQL   │    │ Mistral 🇫🇷 │  │ IGN / BAN /  │  │ Disque VPS   │
│ + pgvector   │    │ Pixtral      │  │ Légifrance / │  │ (uploads) +  │
│ (sur VPS)    │    │              │  │ Géorisques   │  │ OVH OS (bkp) │
└──────────────┘    └──────────────┘  └──────────────┘  └──────────────┘
```

### 15.2 ERD simplifié — dossier d'urbanisme

```
users ──┐                                              ┌── decisions
        │                                              │      └── decision_events
        ├──< dossiers ──┬──< dossier_pieces_jointes    │
        │       │       │                              │
        │       │       ├──< dossier_messages          │
        │       │       │                              │
        │       │       ├──< dossier_facts ────────────┘
        │       │       │
        │       │       ├──< dossier_courriers
        │       │       │
        │       │       ├──< dossier_consultations >── external_services
        │       │       │
        │       │       ├──< instruction_events
        │       │       │
        │       │       └──< regulatory_analyses ──< regulatory_findings ──> zone_regulatory_rules
        │       │
        │       └──> communes ──< zones ──< zone_regulatory_rules
        │                  │
        │                  ├──< regulatory_documents
        │                  ├──< signataires
        │                  └──> epci
        │
        ├──< user_communes >── communes
        ├──< user_absences
        ├──< user_delegations
        ├──< user_availability
        ├──< audit_logs       (FK SET NULL)
        ├──< ai_usage_events  (FK SET NULL)
        └──< notifications
```

### 15.3 Indexes & performance

Indexes confirmés :
- `users.email` unique.
- `dossiers.numero` unique.
- `dossier_facts (dossier_id, key) WHERE superseded_at IS NULL` — index unique partiel (garantit un seul fait actif par clé).
- `document_segments` : indexes sur `insee`, `doc_type`, `parent_code` (et un IVFFlat sur `embedding` pour pgvector — à vérifier en migration).
- `audit_logs` : index sur `created_at` pour la purge cron rapide.

À auditer :
- Index sur `dossiers.user_id`, `dossiers.instructeur_id`, `dossiers.commune_insee` (filtres fréquents en list mairie).
- Index sur `dossier_pieces_jointes.dossier_id`, `dossier_messages.dossier_id`.
- Stratégie de pagination : keyset (`created_at < cursor`) plutôt qu'offset pour les listes longues.

### 15.4 Migrations Drizzle

```bash
# Dev : générer la migration SQL
cd packages/db && pnpm drizzle-kit generate

# Revue manuelle du fichier SQL produit (impératif sur migrations destructives)
git diff packages/db/migrations/

# Application (auto via le step `pnpm --filter @heureka-v1/db migrate` du workflow deploy.yml)
pnpm --filter @heureka-v1/db migrate
```

Règles :
- Migrations **idempotentes** (utilisation systématique de `IF NOT EXISTS`).
- Migrations destructives (`DROP COLUMN`, `DROP TABLE`) : précédées d'une migration de neutralisation déployée 1 release plus tôt.
- Aucune rétro-action automatique : `drizzle-kit migrate` joue les fichiers manquants dans l'ordre.

---

## 16. Multi-tenant & isolation par commune

HEUREKA est **multi-tenant logique** : une seule base, plusieurs collectivités, isolation par contrôle d'accès applicatif.

### 16.1 Mécanismes d'isolation

| Couche | Mécanisme |
|---|---|
| Authentification | `users.commune_insee` (mono) + `user_communes` (multi-affectation pour mutualisations EPCI) |
| Routes mairie | Middleware `enforceDossierAccess` : refuse `dossier_id` si la `commune_insee` du dossier n'est pas dans les communes de l'agent |
| Listes | Chaque `GET /api/mairie/dossiers` filtre côté SQL par `commune_insee IN (...)` |
| Données ref (PLU, signataires, courrier templates) | Cloisonnées par `commune_id` |
| Stockage S3 | Préfixe par `commune_insee/dossier_id/` (à confirmer dans `storage.ts`) |
| Admin global | Rôle `admin` (HEUREKIA SAS) — accès cross-commune pour exploitation |

### 16.2 Mutualisation EPCI

- `dossiers.instruction_mutualisee` (sur la commune) permet l'instruction par un service mutualisé d'EPCI.
- `epci` + `epci_id` sur `communes` permettent de regrouper logiquement.

### 16.3 Risques résiduels

- **Cross-tenant data leak** : risque structurel d'une base partagée. Atténué par revue de code sur les routes mairie, mais une vulnérabilité oubliée exposerait tous les tenants. Recommandation à terme : audit pen-test ciblé sur l'isolation.

---

## 17. Modèle d'erreurs API & frontend

### 17.1 Format de réponse erreur

```json
{
  "error": {
    "code": "DOSSIER_NOT_FOUND" | "VALIDATION_ERROR" | "FORBIDDEN" | ...,
    "message": "Message lisible côté utilisateur",
    "details": { ... }   // Optionnel (issues Zod, etc.)
  }
}
```

Status HTTP : 400 (validation), 401 (non authentifié), 403 (rôle/scope), 404 (introuvable), 409 (conflit workflow), 429 (rate-limit), 500 (erreur serveur).

### 17.2 Côté front

- **Error Boundary React** englobe les routes pour capturer les exceptions de rendu.
- **Toasts** affichent les `error.message` côté formulaires.
- **Pages d'erreur dédiées** : 404, 403 (accès refusé), 500 (incident).

### 17.3 Versioning API

- **Pas de préfixe `/v1`** actuellement — l'API est consommée uniquement par le front interne, le couplage est fort.
- En cas d'ouverture future (mobile / partenaires), prévoir un versioning `/api/v1/...` et une politique de breaking changes documentée.

---

## 18. Gestion d'état frontend

### 18.1 Stack

- **Pas de state manager dédié** (ni Redux, ni Zustand, ni TanStack Query, ni SWR).
- État global : **React Context** (`useAuth`, etc.).
- État local : `useState` / `useReducer`.
- Fetch : `fetch()` natif encapsulé dans des hooks custom (`hooks/`).
- Cache HTTP : reposera sur les headers du navigateur (pas de cache applicatif).

### 18.2 Trade-offs

- **Pro** : stack légère, pas de boilerplate, courbe d'apprentissage faible.
- **Contre** : pas de cache requête côté client → certaines pages rechargent les mêmes données. **Recommandation** : intégrer TanStack Query (`@tanstack/react-query`) sur les listes les plus consultées (dashboard, list dossiers mairie).

### 18.3 Bundle & performance

- **Build Vite 6** avec code splitting automatique par route (React Router 7 lazy routes — à confirmer).
- **Lazy loading** : à vérifier sur les pages mairie lourdes (carte Leaflet, éditeur TipTap).
- **Recommandation** : `vite build --report` + audit Lighthouse régulier.

---

## 19. Accessibilité

| Standard | État | Action |
|---|---|---|
| **RGAA niveau AA** (obligation légale collectivités) | ⚠️ **Non audité** | Audit avec axe-core ou Tanaguru |
| Navigation clavier | À vérifier composant par composant | Tests manuels + Storybook a11y |
| Contraste | Tailwind palette utilisée — à vérifier au cas par cas | Lint avec `@tailwindcss/forms` + audit |
| Attributs ARIA | Présents par défaut (`lucide-react`, `tiptap`) — à compléter sur composants custom | Revue UX |
| Lecteur d'écran | Non testé | Test NVDA / VoiceOver |

> Annexe Technique n°2 §4.7 + §2.1 de la DSI Tours : **AA exigé** avant mise en production officielle.

---

## 20. SEO & métadonnées

- **`react-helmet-async`** pour `<title>` et meta par page.
- **Pas de SSR** : SPA pure Vite → SEO limité côté `www.heurekia.com`.
- **Recommandation** : ajouter `sitemap.xml` et `robots.txt` côté `www`, désindexer `app.heurekia.com` (`X-Robots-Tag: noindex`).

---

## 21. IA : MODEL_MAP, pricing & benchmark

### 21.1 MODEL_MAP (résolution abstraite → modèle)

`apps/api/src/services/aiUsage.ts` :

```ts
const MODEL_MAP: Record<string, string> = {
  "ai-fast":  "pixtral-large-latest",   // À repointer vers pixtral-12b post-benchmark si F1 ≥ 0,80
  "ai-smart": "pixtral-large-latest",
};
```

Les services métier déclarent un usage abstrait (`ai-fast` / `ai-smart`) ; on résout vers le modèle Mistral réel. Permet de re-tuner sans toucher au code applicatif.

### 21.2 Pricing Mistral (EUR par million de tokens)

| Modèle | Input | Output | Usage typique |
|---|---|---|---|
| `pixtral-12b-2409` | 0,15 | 0,15 | Tâches simples (à valider via benchmark) |
| `pixtral-large-latest` | 2,00 | 6,00 | **Tout actuellement** (vision PDF/photos) |
| `mistral-large-latest` | 1,80 | 5,40 | Tâches textuelles complexes |
| `mistral-small-latest` | 0,20 | 0,60 | Classification, extraction simple |

Source : `MISTRAL_PRICING` dans `aiUsage.ts`. Facturation EUR natif (pas de conversion USD).

### 21.3 Budget IA projeté

Volume cible : **1 000 pièces / mois × ~3 appels Pixtral Large** (analyse + extract + verdicts) = **~3 000 appels / mois**.

| Hypothèse | Coût mensuel |
|---|---|
| 1 500 tokens input + 500 tokens output par appel × 3 000 | (1 500 × 2 + 500 × 6) / 1M × 3 000 = **~18 € / mois** |
| Si pic à 5 000 appels | ~30 € / mois |
| Si on bascule `ai-fast` vers Pixtral 12B (50 % du volume) | **~10 € / mois** |

À comparer avec : ~50 €/mois historique Anthropic Claude (cf. `plan-deploiement.md`).

### 21.4 Benchmark LLM

- **Harnais** : `packages/ingestion/src/benchmark/cli.ts` (commande `pnpm --filter @heureka-v1/ingestion benchmark:llm`).
- **Fixtures** : 15-30 pièces anonymisées dans `packages/ingestion/benchmark-fixtures/pieces/` + `manifest.json` (vérités-terrain).
- **Métriques** : F1, precision, recall, latence par modèle.
- **Critères de décision** :
  - F1 Pixtral Large ≥ 0,80 ⇒ confirmation Mistral, documenter au DPD.
  - F1 Pixtral 12B ≥ 0,80 sur `ai-fast` ⇒ repointer pour économie ×10.
  - F1 < 0,75 ⇒ itération prompts, ou bascule Mistral Medium 3 vision (à venir).

### 21.5 Versioning des prompts

- **Pas de versioning explicite** des prompts aujourd'hui (in-code, `pieceAnalyzer.ts` / `pieceExtractor.ts`).
- Traçabilité partielle via `ai_usage_events.model` (modèle utilisé au moment de l'appel).
- **Recommandation** : extraire les prompts dans un fichier dédié versionné (ex: `prompts/v1/piece_analyze.md`) et stocker le `prompt_version` dans `ai_usage_events` pour reproduire un résultat *a posteriori*.

---

## 22. Workflow métier — Machine d'états

### 22.1 Cycle de vie d'un dossier

```
       (citoyen crée)
            │
            ▼
       ┌─────────┐ (purge auto > 180 j) ┌─────────┐
       │BROUILLON│ ────────────────────▶│ SUPPRIMÉ│
       └────┬────┘                      └─────────┘
            │ soumettre
            ▼
       ┌─────────┐
       │  SOUMIS │
       └────┬────┘
            │ assignation instructeur
            ▼
       ┌────────────────┐
       │PRE_INSTRUCTION │
       └────┬───────┬───┘
            │       │ pièces manquantes → courrier
            │       ▼
            │  ┌──────────┐  citoyen complète
            │  │INCOMPLET │ ─────────────────▶ SOUMIS
            │  └──────────┘
            ▼
       ┌──────────────┐
       │EN_INSTRUCTION│
       └────┬─────────┘
            │ décision rédigée
            ▼
       ┌──────────────────┐
       │DECISION_EN_COURS │
       └────┬─────────────┘
            │ signature
            ▼
       ┌────────────┬─────────┬──────────────────────┐
       │  ACCEPTÉ   │ REFUSÉ  │ ACCORD_PRESCRIPTION  │
       └────────────┴─────────┴──────────────────────┘
```

### 22.2 Délais légaux (Code de l'urbanisme)

| Type | Délai d'instruction de base | Majorations possibles |
|---|---|---|
| Déclaration préalable (DP) | 1 mois | +1 mois (ABF, secteur protégé) |
| Permis de construire maison individuelle (PCMI) | 2 mois | +1 mois (ABF), +2 mois (ZPPAUP/SUP) |
| Permis de construire (PC) | 3 mois | +1 à +6 mois selon consultations |
| Permis d'aménager (PA) | 3 mois | +1 à +5 mois |
| Certificat d'urbanisme (CU) — opérationnel | 2 mois | — |
| Permis de démolir (PD) | 2 mois | +1 mois (ABF) |

Calcul dans `apps/api/src/services/instructionDelays.ts`. Le statut **tacite** (`dossiers.is_tacite = true`) est positionné par le moteur si la date limite est dépassée sans décision.

### 22.3 Workflow de signature

```
brouillon ──▶ soumis_signature ──▶ signé ──▶ notifié ──▶ archivé
                     │
                     └─▶ revision_necessaire (motif_refus_signature)
```

- `signataires` : table des maires/adjoints habilités par commune.
- `decision_events` : journal d'audit (créé, soumis, signé, refusé, notifié).
- Signature électronique : à formaliser (actuellement signature manuscrite scannée stockée sur le profil signataire).

---

## 23. Internationalisation

- **Français uniquement** actuellement (plateforme strictement francilienne).
- Pas d'`i18n` framework (`react-intl`, `i18next`) côté front.
- Tous les strings en dur dans les composants.
- **Recommandation** : à laisser en l'état tant que le périmètre reste France métropolitaine.

---

## 24. Licences

| Élément | Licence |
|---|---|
| Code HEUREKA V1 | À formaliser (propriétaire HEUREKIA SAS) |
| Dépendances npm | Audit `pnpm licenses list` recommandé en CI |
| `legal_mentions` (cache Légifrance) | **Licence Ouverte Etalab v2.0** — re-publication autorisée |
| Données IGN GPU | Licence Ouverte Etalab v2.0 |
| Données BAN | Licence Ouverte Etalab v2.0 |

---

## 25. Setup environnement de développement

```bash
# Pré-requis : Node 22, pnpm 9+, PostgreSQL 15+ avec pgvector, poppler-utils

# 1. Clone & install
git clone <repo>
cd HEUREKA-V1
pnpm install

# 2. Copier .env
cp apps/api/.env.example apps/api/.env
# Éditer : DATABASE_URL, JWT_SECRET, MISTRAL_API_KEY, PISTE_*

# 3. Base de données
createdb heureka_dev
psql heureka_dev -c "CREATE EXTENSION vector;"
pnpm --filter @heureka-v1/db migrate

# 4. Seeds (articles légaux, commune de test)
pnpm --filter @heureka-v1/api seed:legal-articles

# 5. Démarrer
pnpm --filter @heureka-v1/api dev   # API sur :3001
pnpm --filter @heureka-v1/web dev   # Web sur :5173
```

### 25.1 Variables minimales pour dev local

| Variable | Valeur dev |
|---|---|
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/heureka_dev` |
| `JWT_SECRET` | n'importe quelle chaîne aléatoire |
| `MISTRAL_API_KEY` | clé Mistral perso (compte free tier) |
| `STORAGE_PROVIDER` | `local` |
| `NODE_ENV` | `development` |

---

## 26. Points d'attention & dette technique

1. **SSO Entra ID** (DSI Tours) : à arbitrer (agents seulement ou citoyens inclus ?). Impact architectural majeur si étendu aux citoyens.
2. **Stockage S3** : migration en cours (Phase 1). Cohabitation `local`/`s3` à gérer pendant la transition (champ `dossier_pieces_jointes.url`).
3. **Scheduler in-process** : à externaliser le jour où on scale horizontalement, pour éviter doublons d'exécution.
4. _Bascule Voyage AI (US) → Mistral (`mistral-embed`, 🇫🇷)_ : effectuée. Plus de sous-traitant US sur le périmètre embeddings ; un seul DPA fournisseur IA à maintenir.
5. **CartoCDN** : à retirer (Phase 3.2) au profit du WMTS IGN pour cohérence souveraineté + CSP.
6. **`pnpm audit`** : à intégrer en CI (GitHub Actions).
7. **Accessibilité RGAA AA** : audit non réalisé.
8. **Export CSV/JSON dossiers** (interface mairie) : non implémenté (Annexe Technique DSI n°2 §4.15).
9. **DPA Mistral AI** : à signer pour finaliser la conformité (cf. `dpa-mistral-checklist.md`).

---

## 27. Journal des évolutions

### v1.1 — 17 juin 2026

| Domaine | Évolution | Sections impactées | Commit |
|---|---|---|---|
| **Souveraineté RAG** | Bascule embeddings Voyage AI (US) → Mistral `mistral-embed` (FR, 1024 dim, schéma pgvector inchangé). Suppression du paramètre `input_type` (Voyage avait un dual-space document/query, pas Mistral). `MISTRAL_API_KEY` mutualisée avec l'inférence LLM, **suppression de `VOYAGE_API_KEY`**. Un seul DPA fournisseur IA à maintenir. | §1, §3.3.6, §4, §5.4, §8.3, §9.8, §10, §26 | `e96db27` |
| **Ré-indexation pgvector** | Script ops `reindex-rag.ts` idempotent — passe obligatoire après la bascule d'embedder (vecteurs Voyage et Mistral non comparables). Options `--dry-run`, `--commune <INSEE>`, `--only-failed`. Procédure ops dans `dossier-exploitation.md` §8.1. | §5.1, §11.1 | `7c5c704` |
| **Versionnage des pièces** | `pieceArchive.ts` + colonnes `archived_at` / `archived_by_piece_id` sur `dossier_pieces_jointes`. Quand le pétitionnaire redépose une pièce dans un emplacement en `complement_demande`, les anciennes versions sont archivées (jamais supprimées — RGPD / auditabilité). Identification par `code_piece` ou préfixe slot. Exclusion des archivées : complétude, conformité, auto-bascule, `dossier_facts`. | §3.3.2, §5.1, §8.1 | `cc40cc4` |
| **UI pièces** | Liste mairie organisée en sections dépliantes (À examiner / Compléments demandés / Acceptées / Refusées), regroupement par rubrique conservé à l'intérieur. Affichage des versions précédentes à la demande. | (front, hors périmètre doc tech détaillé) | `cc40cc4` |
| **Évaluation IA groupée** | `analyzePieceGroup()` : tous les fichiers d'un même slot envoyés dans le même prompt Pixtral avec consigne « évaluer comme un ENSEMBLE ». Élimine les faux négatifs sur les slots multi-vues (PC5 façades, photos d'insertion). Mapping résultat → chaque fichier du lot via `dossierConformity.ts`. | §8.1, §8.4 | `07b5ae3` |
| **Identification par slot** | Front citoyen + mairie + wizard de dépôt : badge de code (PC5, DP2…) et regroupement par emplacement, annexes libres en dernier, tri obligatoires → facultatives dans le wizard. | (front) | `07b5ae3` |
| **Articles légaux** | Élargissement `linkifyArticles` (suffixes `b)`, `2°` capturés en fin de chaîne, le `\b` échouait après `)` ou `°`). Couvre désormais la pop-up délai et les verdicts règlementaires. Nouvelle table `legal_mentions_misses` (unique `(code_key, article_ref)`) qui collecte chaque référence introuvable. Section admin **« Articles manquants »** dans `/admin/configuration` avec actions **Créer via Légifrance** / **Ignorer**. | §3.3.6, §6.5 | `9860518` |
| **Menu contextuel dossier** | Kebab de chaque ligne de la liste mairie : **Copier le N° de dossier** (les cellules sont cliquables → impossible de sélectionner le texte à la souris) et **Désassigner l'instructeur** (superviseur uniquement, si un instructeur est assigné). | (front) | `014ffbe` |
| **Délai d'instruction** | Suppression du bouton « Recalculer le délai » (l'enregistrement de la date de complétude déclenche déjà le recalcul backend, doublon). | (front) | `42d3fbe` |
| **Workflow `pieces_complementaires`** | Fix : `autoReopenAfterCitizenUpload` ne bascule plus en `pre_instruction` lorsqu'un courrier `pieces_complementaires` est actif — la transition est portée par `POST /api/dossiers/:id/resoumettre`, qui contrôle aussi que toutes les pièces réclamées ont été redéposées. Avant correctif : « Le dossier n'est pas en attente de pièces complémentaires » au clic sur « Transmettre les compléments » après le 1ᵉʳ upload (DOS-MQ7UGCKZ-F6E9C9). | §5.1 | `538a0e0` |

### v1.0 — 16 juin 2026

| Domaine | Évolution | Sections impactées | Commit |
|---|---|---|---|
| **Création** | Document initial — base de données (38 tables), appels externes, briques fonctionnelles, redirection des fronts, cron, pipelines, sécurité. | §1 → §11 | `b785ddb` |
| **Enrichissement** | 15 sections supplémentaires (tests Vitest, CI/CD GitHub Actions, observabilité, ERD, multi-tenant, modèle d'erreurs, gestion d'état, accessibilité, SEO, MODEL_MAP IA, machine d'états dossier, i18n, licences, setup dev, dette technique). | §12 → §26 | `c60f8bf` |

---

*Fin du document.*
