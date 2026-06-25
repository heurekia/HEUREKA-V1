# Durcissement production — audit de performance & plan

> Document vivant. Tient le fil de l'audit de performance et du durcissement de
> la plateforme en vue d'une montée en charge. Mis à jour **au fur et à mesure**
> de l'avancement (cf. § Journal d'avancement). Dernière mise à jour : chantier 1.5.

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
| **1** | Sortir le travail lourd du cycle requête + transactions | Moyen | 🚧 En cours |
| **2** | Exécution (build JS, fin du `tsx`) & observabilité | Moyen | ⏳ À faire |
| **3** | Frontend (code splitting, mémoïsation, cache données) | Faible | ⏳ À faire |
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
| 1.2 | `refreshPluZones` hors du chemin `/analyse` (fond + service *stale*) | ⏳ À faire | |
| 1.3 | CPU bloquant : `execFileSync`→async, base64/hash hors event-loop, plafond de taille cumulée | ⏳ À faire | |
| 1.1 | Upload citoyen → file OCR asynchrone (réponse 201 immédiate) — **BLOQUANT** | ⏳ À faire | |

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

> ⚠️ Les rate-limiters et timeouts d'inactivité utilisent un **store en mémoire**
> (par process), cohérent avec le mono-instance. À externaliser en Redis au
> Palier 4 (multi-instances) — sinon les quotas deviennent contournables et les
> crons s'exécutent en double.
