# Durcissement production — audit de performance & plan

> Document vivant. Tient le fil de l'audit de performance et du durcissement de
> la plateforme en vue d'une montée en charge. Mis à jour **au fur et à mesure**
> de l'avancement (cf. § Journal d'avancement). Dernière mise à jour : Palier 2
> bundle tsx→node prêt + boot vérifié (reste l'activation pm2 sur le VPS).

## 1. Contexte & verdict

Audit de performance de l'ensemble du code (~92 K lignes : `apps/api` Express +
Drizzle/PostgreSQL, `apps/web` React/Vite, packages `db`/`ingestion`/
`regulatory-engine`/`shared`), en vue d'un déploiement en production.

**Verdict initial.** Socle d'ingénierie sérieux et honnête sur ses limites
(les commentaires du code assument explicitement le « mode pilote mono-
instance »). **Pas prêt pour une vraie charge** (plusieurs communes,
utilisateurs concurrents, multi-instances) sans durcissement ; **bon pour un
pilote mono-instance** une fois le Palier 0 traité. Ce n'est pas un audit
« tout rouge » : l'indexation DB des tables chaudes, le chemin géo/GPU, le RAG
(pgvector HNSW) et les sauvegardes 3-2-1 sont de bonne qualité.

## 2. Les 5 verrous transverses (diagnostic holistique)

1. **Architecture mono-instance par construction** — état en mémoire à chaque
   couche (file OCR, rate-limit, crons, caches module-level), mono-process sans
   clustering, VPS unique. C'est le plafond structurel ; tout scaling horizontal
   est bloqué tant que l'état n'est pas externalisé (Redis/Postgres).
2. **L'event-loop mono-thread est le goulot** — du CPU lourd synchrone (base64
   de buffers 30–60 Mo, rendu PDF `execFileSync`, clipping de polygones, parse
   JSON de bodies 300 Mo) gèle *tous* les utilisateurs, health-check inclus.
3. **Clients LLM sans garde-fou** — appels Mistral sans timeout ni retry, alors
   que le reste (géo/IGN) est ceinturé. Premier incident réseau = requête qui
   pend + indexation perdue.
4. **Travail lourd en synchrone *dans* la requête** — upload citoyen qui lance
   l'analyse LLM inline (30–60 s), `refreshPluZones` sur `/analyse`, etc.
   (migration partielle : le chemin comptoir a été déporté en file, pas le reste).
5. **Écart ops « à froid » (mûr) vs exécution runtime (immature)** — `tsx` en
   prod (pas de build JS), observabilité quasi nulle, healthcheck superficiel,
   dérive schéma Drizzle ↔ migration SQL.

## 3. Plan par paliers (ROI décroissant)

| Palier | Objectif | Risque | État |
|---|---|---|---|
| **0** | Garde-fous à faible risque (index, timeouts, rate-limit) | Faible | ✅ Fait |
| **1** | Sortir le travail lourd du cycle requête + transactions | Moyen | ✅ Fait (hors 1.3b mineur) |
| **2** | Exécution (build JS, fin du `tsx`) & observabilité | Moyen | ✅ `tsx`→`node` activé en prod ; healthcheck + logs (reste métriques/Sentry) |
| **3** | Frontend (code splitting, mémoïsation, cache données) | Faible | ✅ Fait (hors cache react-query, optionnel) |
| **4** | Scaling horizontal (Redis, clustering, Postgres séparé) | Élevé | ⏳ À faire |

## 4. Journal d'avancement

### Palier 0 — garde-fous ✅

| # | Chantier | Commit |
|---|---|---|
| 0.1 | Index DB chemins chauds (`zone_regulatory_rules(zone_id, validation_status)`, `instruction_events(dossier_id)`, `notifications(dossier_id)`, `calendar_events(dossier_id)`) | `perf(db): index sur les chemins chauds` |
| 0.2 | Timeout + retry borné sur **tous** les appels Mistral (helper `fetchWithRetry`) ; `streamAi` → timeout d'inactivité réarmé par chunk | `fix(ia): timeout + retry borné sur tous les appels Mistral` |
| 0.3 | Timeouts serveur HTTP explicites (keep-alive / headers / request) | `fix(api): timeouts serveur HTTP explicites` |
| 0.4 | Rate-limit (par utilisateur) sur upload/OCR, IA interactive, analyses | `feat(api): rate-limit sur les routes coûteuses` |

### Palier 1 — désynchroniser le lourd + transactions 🚧

| # | Chantier | État | Commit |
|---|---|---|---|
| 1.4 | N+1 du viewer réglementation → une requête `inArray` + regroupement | ✅ Fait | `perf(reglementation): supprime le N+1 du viewer réglementation` |
| 1.5 | Transactions sur émission de courrier (`pieceRequest`) et `applyDossierFacts` (+ batch des écritures) | ✅ Fait | `fix(courrier): émission … atomique` ; `fix(facts): applyDossierFacts atomique` |
| 1.2 | `refreshPluZones` hors du chemin `/analyse` (fond + service *stale*) | ✅ Fait | `perf(plu): stale-while-revalidate du contexte PLU` |
| 1.3 | CPU bloquant : `execFileSync`→async (rendu/extraction PDF) | ✅ Fait | `perf(pdf): rendu et extraction PDF asynchrones` |
| 1.3b | Offload base64/hash de gros buffers vers worker_threads + plafond de taille cumulée | ⏳ À faire (impact moindre) | |
| 1.1 | Upload citoyen → file OCR asynchrone (réponse 201 immédiate) — **BLOQUANT** | ✅ Fait | `perf(upload citoyen): analyse IA en arrière-plan` |
| 1.1b | Garde-fou « document hors-sujet » : blocage du dépôt si une pièce ne correspond pas à sa rubrique (serveur + wizard) | ✅ Fait | `feat(pieces): detectRubricMismatch` ; `feat(soumission): bloque le dépôt … hors-sujet` ; `feat(wizard citoyen): polling … hors-sujet` |

### Détail — Option 1 (upload citoyen async) + garde-fou hors-sujet

Choix validé avec l'utilisateur (cf. décision produit) : upload citoyen **non
bloquant** AVEC préservation/renforcement du blocage de soumission.

- **Async** : la route `/dossiers/:id/pieces/upload` persiste la pièce, ré-ouvre
  le dossier immédiatement, met l'analyse (Pixtral) en file (`pieceOcrQueue`,
  généralisée avec un hook `onSettled`) et répond `201` avec `ai_pending`. Le
  wizard interroge la pièce jusqu'au verdict (polling borné) puis affiche le
  score + l'éventuel hors-sujet.
- **Garde-fou hors-sujet** : `detectRubricMismatch` compare le type **détecté**
  par l'extraction IA au type **attendu** de la rubrique. Conservateur (familles
  texte/graphique, confiance ≥ seuil) pour éviter les faux positifs. Enforcement
  **serveur** sur `/soumettre` (422), **plus** blocage du bouton côté wizard.
  Le blocage existant sur les pièces obligatoires manquantes est conservé ;
  le verdict qualitatif (« À reprendre ») reste indicatif, comme avant.

### Palier 2 — exécution & observabilité 🚧

| # | Chantier | État | Commit |
|---|---|---|---|
| 2.1 | Healthcheck profond (`/api/health` → `SELECT 1`, 503 si DB KO) + `/api/health/live` | ✅ Fait | `feat(api): healthcheck profond` |
| 2.2 | Logs structurés (pino) + log de requêtes avec reqId (X-Request-Id) | ✅ Fait | `feat(api): logs structurés (pino)` |
| 2.3 | Métriques Prometheus (`/metrics`) | ⏸️ Reporté | — |
| 2.4 | Sentry (back + front) | ⏸️ Reporté | — |
| 2.5a | Refactor des chemins (`src/paths.ts`) — prérequis bundle | ✅ Fait | `refactor(api): centralise la résolution des chemins` |
| 2.5b | Bundle tsup + config pm2 `node` — **prêt + boot vérifié localement** | ✅ Fait (activation déploiement restante) | `build(api): bundle … tsup + config pm2 node` |
| 2.5c | Activation : bascule pm2 `tsx` → `node dist/index.js` sur le VPS | ✅ Fait (en prod, `/api/health` → 200) ; deploy.yml bascule sur `startOrReload ecosystem` | `fix(deploy): ecosystem … cwd racine` |

**2.3 / 2.4 — pourquoi reportés.** `prom-client` et `@sentry/node` v8+ tirent
tous deux `@opentelemetry/api`, qui est un **peer optionnel de drizzle-orm** : sa
présence crée une **2e instance de drizzle-orm** et casse le typage (mélange de
types `SQL` entre instances, cf. `scheduler.ts`). À reprendre avec une **dédup
explicite** de `@opentelemetry/api` (le fournir uniformément à tous les
consommateurs de drizzle-orm, ou figer une seule instance) **et** une validation
sur serveur (ces outils nécessitent un process qui tourne + un DSN Sentry).

**2.5 — état : bundle prêt et boot-vérifié ; reste l'activation déploiement.**
Les bloqueurs identifiés ont été levés :
1. ✅ **Résolutions de chemins** centralisées dans `src/paths.ts` (niveau `src/`,
   donc à la même profondeur que `dist/` une fois bundlé → invariantes), toutes
   surchargeables par env. Défauts identiques à l'existant (validé par le test
   CERFA qui lit le template via le nouveau chemin).
2. ✅ **Assets `src/data/`** : `DATA_DIR` (défaut `apps/api/src/data`, présent
   dans le dépôt déployé donc lisible même en bundle ; surchargeable).
3. ✅ **Packages workspace** : bundlés par `tsup` (`noExternal: [/@heureka-v1/]`),
   node_modules externes. `dist/index.js` ≈ 1,2 Mo.
4. ✅ **Build** : script `build` → `tsup` ; `ecosystem.config.cjs` versionné
   (pm2 → `node --enable-source-maps dist/index.js`, fork mono-instance).

**Vérifié localement** : `pnpm build` produit l'artefact ; `node dist/index.js`
démarre, écoute et répond (`/api/health/live` → 200). Les seuls échecs au boot
sont des ressources externes absentes en local (DB, poppler, creds), toutes
gérées.

**Reste (2.5c — accès déploiement requis)** : sur le VPS, `pnpm build` puis
`pm2 startOrReload ecosystem.config.cjs --update-env && pm2 save`, vérifier
`/api/health`, et remplacer dans `deploy.yml` la ligne
`pm2 restart heurekia-api` par `pm2 startOrReload ecosystem.config.cjs`. Tant que
ce n'est pas fait, pm2 lance toujours l'API via `tsx` (inchangé). NB : ne PAS
passer en `cluster`/multi-instances avant le Palier 4 (état in-memory).

### Palier 3 — frontend ✅ (hors cache react-query, optionnel)

| # | Chantier | État | Commit |
|---|---|---|---|
| 3.1 | Code splitting par portail/page (React.lazy + Suspense) + `manualChunks` | ✅ Fait | `perf(web): code splitting … manualChunks` |
| 3.2 | `DossiersScreen` : mémoïsation (useMemo) + fin du O(n²) + recompute hors filtre | ✅ Fait | `perf(web): DossiersScreen …` |
| 3.3 | Retrait de la dépendance morte `recharts` (-32 paquets) | ✅ Fait | `chore(web): retire … recharts` |
| 3.4 | Cache de données (TanStack Query / SWR) sur les lectures | ⏳ À faire (optionnel) | — |
| 3.5 | Découpage interne de `MairieApp` : 8 écrans en `lazy()` + `<Suspense>` | ✅ Fait | `perf(web): découpage interne de MairieApp …` |

**Impact mesuré (vite build).** Avant : un unique bundle de **2 541 Ko (693 Ko
gzip)** chargé sur tous les portails. Après : la landing www ne charge plus que
l'entrée + `vendor-react`/`vendor-router` + `PublicRouter` (~80–140 Ko gzip) ;
`SuperAdminApp` (303 Ko), `MairieApp` (632 Ko), Leaflet (150 Ko), pdfjs (341 Ko)
et tiptap (344 Ko) sont sortis du chargement initial et ne sont téléchargés que
par les routes/portails qui les utilisent (et après authentification pour les
espaces pro).

**Découpage interne de `MairieApp` (3.5).** L'espace mairie chargeait au login
ses 8 écrans d'un bloc (**632 Ko / 152 Ko gzip**, le plus gros chunk restant,
subi par chaque agent). Chaque écran passe en `lazy(() => import(...))` derrière
une frontière `<Suspense fallback={<PageLoader/>}>` placée sous la barre : la
coquille tombe à **140 Ko / 37 Ko gzip** (−76 %) et les écrans lourds ne se
chargent qu'à la navigation — `DossierDetailScreen` (~221 Ko) au clic sur un
dossier, `ParametresScreen` (~121 Ko, qui embarque réglementation + courrier)
sur `/parametres`. Deux imports morts retirés au passage (`ReglementationScreen`,
`TemplateManagerPanel`/`CommuneLetterheadPanel`).

## 5. Variables d'environnement introduites

| Variable | Défaut | Rôle |
|---|---|---|
| `MISTRAL_TIMEOUT_MS` | `60000` | Timeout par tentative des appels Mistral non-streaming |
| `MISTRAL_STREAM_IDLE_MS` | `45000` | Timeout d'inactivité du streaming SSE (réarmé par chunk) |
| `HTTP_KEEPALIVE_TIMEOUT_MS` | `65000` | `server.keepAliveTimeout` (> keepalive upstream nginx) |
| `HTTP_HEADERS_TIMEOUT_MS` | `66000` | `server.headersTimeout` (> keepAliveTimeout) |
| `HTTP_REQUEST_TIMEOUT_MS` | `300000` | `server.requestTimeout` (durée max d'une requête complète) |
| `RL_UPLOAD_MAX` / `RL_UPLOAD_WINDOW_MS` | `60` / `300000` | Quota upload/OCR de pièces (par utilisateur) |
| `RL_LLM_MAX` / `RL_LLM_WINDOW_MS` | `40` / `300000` | Quota IA interactive (assistant, structuration) |
| `RL_ANALYZE_MAX` / `RL_ANALYZE_WINDOW_MS` | `60` / `300000` | Quota analyses réglementaires |
| `RUBRIC_MISMATCH_MIN_CONFIDENCE` | `0.75` | Confiance min. sur le type détecté pour bloquer un dépôt « hors-sujet » |
| `LOG_LEVEL` | `info` (prod) / `debug` | Niveau du logger pino |
| `UPLOADS_DIR` | `apps/api/uploads` | Dossier des pièces déposées (stockage local) |
| `FRONTEND_DIST` | `apps/web/dist` | Build frontend servi par Express en fallback |
| `DATA_DIR` | `apps/api/src/data` | Assets de données (templates CERFA…) |

> ⚠️ Les rate-limiters et timeouts d'inactivité utilisent un **store en mémoire**
> (par process), cohérent avec le mono-instance. À externaliser en Redis au
> Palier 4 (multi-instances) — sinon les quotas deviennent contournables et les
> crons s'exécutent en double.
