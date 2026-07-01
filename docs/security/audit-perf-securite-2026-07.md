# Audit performance & sécurité — juillet 2026

Audit du code applicatif (backend Express/TS, frontend React 19, packages, infra)
mené le 2026-07-01 sur la branche `claude/performance-security-audit-vfixgj`.
Complète les audits antérieurs (revue de code, Playwright, VPS OVH de juin 2026 —
cf. [`remediation-vps-2026-06.md`](./remediation-vps-2026-06.md) et
[`todo.md`](./todo.md)). On ne re-signale pas ici ce qui est déjà couvert
(Helmet/CSP, JWT cookie HttpOnly, rate limiting login/register, révocation
`token_version`, path traversal `/api/uploads`, RGPD export/suppression, backups
3-2-1, pare-feu ufw, bind loopback, CrowdSec).

`pnpm audit --prod` : **aucune vulnérabilité connue** dans les dépendances de prod.

---

## État des correctifs (2026-07-01)

Correctifs appliqués sur cette branche (typecheck API+web OK, 587 tests verts) :

| # | Correctif | Fichier |
|---|-----------|---------|
| ✅ S1 | Refus du rattachement FranceConnect si l'email local n'est pas vérifié (anti pre-hijacking) | `routes/franceConnect.ts` |
| ✅ S2 | Garde anti-SSRF au point d'envoi Slack (`https://hooks.slack.com` uniquement) — défense en profondeur en plus de la validation à l'écriture | `services/aiAlerts.ts` |
| ✅ F1 | `useMemo` sur la value d'`AuthContext` + `useCallback` sur les handlers | `hooks/useAuth.tsx` |
| ✅ F3 | `React.memo` sur `MapLeaflet` et `PdfAnnotator` | `components/MapLeaflet.tsx`, `PdfAnnotator.tsx` |
| ✅ P1′ | Index partiel très sélectif sur les pièces « en vol » (remplace la reco GIN, voir ci-dessous) | `packages/db/src/migrate.ts` |

Ajustements après vérification dans le code (findings d'agent revus) :

- **P1 (index GIN sur `analyse_ia`/`extraction_ia`) — écarté.** Vérification faite :
  ces colonnes ne sont **jamais filtrées en WHERE**, seulement lues. Un index GIN
  serait du surcoût d'écriture sans bénéfice. Remplacé par un **index partiel**
  `WHERE archived_at IS NULL AND ocr_status IN ('pending','processing')` qui, lui,
  sert au sweep OCR et à l'expression `ocr_processing` de la liste des dossiers.
- **P4 (fusionner COUNT + SELECT) — non appliqué.** La requête de liste contient
  une sous-requête corrélée `ocr_processing` par ligne ; un `COUNT(*) OVER()`
  forcerait son évaluation sur **toutes** les lignes filtrées (pas seulement la
  page) → risque de régression. Le design deux-requêtes actuel est justifié.
- **P5 (N+1 cron OCR) — non appliqué.** La sélection est déjà **une seule requête**
  bornée à `LIMIT 50` ; la boucle ne traite que les dossiers réellement bloqués
  (rare) et la paralléliser risquerait des races de notification.
- **P3 (pagination `/dossiers/:id/pieces`) — différé.** La route renvoie un tableau
  consommé tel quel par le front ; changer le contrat nécessite une coordination
  front/back. Volume réel faible (quelques dizaines de pièces/dossier).

Reste à traiter (hors périmètre de ce commit) : **P2** (paralléliser `pdftoppm`),
**F2** (virtualisation `DossiersScreen`), **I1** (pin actions GitHub par SHA —
nécessite de résoudre les SHA des dépôts `actions/*`, hors scope de ce dépôt),
**S3** (rate limiting listes), **S4** (logs console).

---

## Synthèse — axes d'amélioration priorisés

| # | Axe | Type | Sévérité | Effort |
|---|-----|------|----------|--------|
| S1 | Pre-hijacking de compte via FranceConnect (rattachement par email non vérifié) | Sécurité | 🔴 Critique | 1-2 h |
| S2 | SSRF via webhook Slack configurable | Sécurité | 🟠 Haute | 30 min |
| P1 | Index GIN manquants sur colonnes JSONB `analyse_ia` / `extraction_ia` | Perf | 🟠 Haute | 15 min |
| P2 | `pdftoppm` séquentiel bloquant → timeouts nginx 60 s sur dépôt groupé | Perf | 🟠 Haute | 1-2 h |
| P3 | `GET /dossiers/:id/pieces` sans pagination + JSONB lourds | Perf | 🟠 Haute | 30 min |
| F1 | `AuthContext` value sans `useMemo` → cascade de re-renders | Perf front | 🟠 Haute | 15 min |
| F2 | `DossiersScreen` : 500 lignes en DOM sans virtualisation ni pagination | Perf front | 🟠 Haute | 2-3 h |
| P4 | Double requête COUNT + SELECT dans `GET /dossiers` | Perf | 🟡 Moyenne | 30 min |
| P5 | Cron OCR : N+1 (≈ 3000 requêtes/h) | Perf | 🟡 Moyenne | 30 min |
| F3 | `MapLeaflet` / `PdfAnnotator` sans `React.memo` | Perf front | 🟡 Moyenne | 30 min |
| I1 | Actions GitHub non pinnées par SHA | Sécurité CI | 🟡 Moyenne | 30 min |
| S3 | Pas de rate limiting par utilisateur sur les listes lourdes | Sécurité | 🟡 Moyenne | 30 min |
| P6 | Absence de verrou distribué sur les crons (bloquant si passage cluster) | Perf/robustesse | 🟡 Moyenne | 1 h |
| S4 | `console.error` en prod (fuite d'info d'implémentation) | Sécurité | 🟢 Basse | 30 min |
| I2 | Vérifier `client_max_body_size` nginx ≥ 300 Mo (limite API PLU) | Infra | 🟢 Basse | 10 min |

---

## 🔴 Sécurité — Critique

### S1 · Pre-hijacking de compte via FranceConnect

**Fichier** : `apps/api/src/routes/franceConnect.ts:164-181`

Le rattachement d'une identité FranceConnect à un compte local se fait **par
email, sans exiger que l'email local soit vérifié** (le code le documente
lui-même en `TODO[prod]`, lignes 147-150).

**Scénario d'exploitation (pré-hijacking)** :
1. L'attaquant crée un compte citoyen local avec l'email d'une future victime
   (`victime@example.com`) et **un mot de passe qu'il connaît**, sans vérifier
   l'email.
2. Plus tard, la victime se connecte via FranceConnect avec ce même email.
3. Ligne 166-180 : le `fc_sub` est rattaché au compte existant (celui de
   l'attaquant) et `email_verified_at` est renseigné d'office.
4. La victime utilise désormais un compte dont **l'attaquant garde le mot de
   passe** → il peut se reconnecter et lire les dossiers/pièces déposés par la
   victime.

**Recommandation** : lors du rattachement par email (étape 2 du
`findOrCreateUser`), n'accepter le lien **que si `byEmail.email_verified_at` est
déjà renseigné**. Sinon, refuser (ou forcer une revérification). Idéalement,
imposer la vérification d'email à toute inscription locale — c'est le vrai
correctif de fond mentionné dans le TODO.

---

## 🟠 Sécurité — Haute

### S2 · SSRF via webhook Slack

**Fichier** : `apps/api/src/services/aiAlerts.ts:32-46`

`postToSlack()` fait un `fetch()` direct vers `ai_alert_config.slack_webhook_url`,
une URL stockée en base et **configurable par un administrateur**, sans aucune
validation. Un admin (ou un compte admin compromis) peut pointer vers
`http://127.0.0.1:5432`, `http://169.254.169.254/latest/meta-data/`, ou un
service interne → scan de ports, exfiltration de métadonnées cloud, requêtes
vers des services loopback non exposés.

**Recommandation** : valider l'URL avant l'appel — exiger `https://`, restreindre
au domaine `hooks.slack.com`, et rejeter tout hôte résolvant vers une IP privée /
loopback / link-local. Une allowlist de domaine Slack est le plus simple et
suffisant ici.

### S3 · Rate limiting par utilisateur sur les listes lourdes

Les endpoints de liste authentifiés (`GET /api/mairie/dossiers`, listes de
pièces) n'ont pas de limiteur par utilisateur. Un compte agent compromis peut
scraper l'intégralité des données ou saturer la DB. Ajouter un limiteur global
par utilisateur (ex. 100 req / 5 min) sur les routes de liste coûteuses, en
complément des limiteurs existants sur login/IA.

---

## 🟠 Performance backend — Haute

### P1 · Index GIN manquants sur JSONB `analyse_ia` / `extraction_ia`

**Fichier** : `packages/db/src/schema/dossier_pieces_jointes.ts:14-18`

Ces colonnes JSONB sont filtrées/lues dans les parcours d'instruction et de
conformité, sans index GIN → scan séquentiel de `dossier_pieces_jointes` dès que
la table grossit.

```sql
CREATE INDEX IF NOT EXISTS idx_dpj_analyse_ia    ON dossier_pieces_jointes USING GIN (analyse_ia);
CREATE INDEX IF NOT EXISTS idx_dpj_extraction_ia ON dossier_pieces_jointes USING GIN (extraction_ia);
```

À ajouter dans `packages/db/src/migrate.ts`. Prévoir aussi un index partiel pour
le sweep OCR (voir P5) :

```sql
CREATE INDEX IF NOT EXISTS idx_dpj_active_ocr
  ON dossier_pieces_jointes (dossier_id, ocr_status)
  WHERE archived_at IS NULL;
```

### P2 · `pdftoppm` séquentiel bloquant → timeout nginx 60 s

**Fichier** : `apps/api/src/services/pieceSegmenter.ts:179-221`

`classifyByVision()` appelle `convertPdfPagesToPng()` (spawn `pdftoppm`, CPU-bound)
**batch par batch en série**. Un dépôt groupé de 40-60 pages = 6-10 conversions
séquentielles de 2-3 s chacune → 15-20 s bloqués avant même l'appel Mistral. Avec
plusieurs uploads simultanés, on dépasse le `proxy_read_timeout` nginx (60 s) →
502 et perte de l'upload.

**Recommandation** : paralléliser les batches (`Promise.all`) avec une
concurrence bornée, ou déporter `pdftoppm` sur un worker thread dédié (le pattern
`cpuOffload.ts` existe déjà pour bcrypt). À terme, basculer l'ingestion PLU/bundle
en mode asynchrone (202 + job id) plutôt que synchrone sous la requête HTTP.

### P3 · `GET /dossiers/:id/pieces` sans pagination

**Fichier** : `apps/api/src/routes/mairie/pieces.ts:63-81`

Retourne toutes les pièces d'un dossier (uploads + versions archivées) avec les
colonnes JSONB complètes `analyse_ia` / `extraction_ia`. Un dossier à 500 pièces
→ payload de plusieurs Mo. Ajouter `limit`/`offset` (défaut 50, max 200) et
n'inclure les JSONB volumineux que sur demande (`?full=1`), en exposant le total
via `X-Total-Count` comme sur `/dossiers`.

---

## 🟠 Performance frontend — Haute

### F1 · `AuthContext` value sans `useMemo`

**Fichier** : `apps/web/src/hooks/useAuth.tsx:127`

L'objet `value` du provider est recréé à chaque render de `AuthProvider` →
tous les consommateurs de `useAuth()` re-render (carte Leaflet, viewer PDF,
listes) même quand `user`/`loading` sont inchangés. L'envelopper dans un
`useMemo([user, loading, ...])`.

### F2 · `DossiersScreen` — 500 lignes sans virtualisation

**Fichier** : `apps/web/src/pages/mairie/DossiersScreen.tsx:82,292`

L'écran charge jusqu'à 500 dossiers (`limit: "500"`) et rend autant de `<tr>` en
DOM sans virtualisation → scroll saccadé, mémoire et CPU élevés, surtout sur
mobile. Passer à une pagination (50-100/page, backend) ou virtualiser
(`react-window`). Se combine avec P3/P4 côté API.

---

## 🟡 Performance backend — Moyenne

### P4 · Double requête COUNT + SELECT dans `GET /dossiers`

**Fichier** : `apps/api/src/routes/mairie/dossiers.ts:156-161`

La pagination fait deux requêtes qui rejouent les mêmes JOIN/filtres. Utiliser
`COUNT(*) OVER()` dans la requête paginée pour obtenir le total en une passe.

### P5 · Cron OCR — N+1

**Fichier** : `apps/api/src/jobs/scheduler.ts:168-190`

Le sweep chaque minute sélectionne 50 dossiers puis rappelle une requête DB par
dossier (`maybeNotifyDossierReady`) → ≈ 3000 requêtes/h sur ce seul job.
Regrouper en une requête (`SELECT DISTINCT dossier_id … LIMIT 50`) puis traiter en
`Promise.all`.

### P6 · Pas de verrou distribué sur les crons

**Fichier** : `ecosystem.config.cjs` (fork mono-instance) + `apps/api/src/jobs/scheduler.ts`

Le mode `fork`/`instances: 1` actuel rend le point inoffensif **aujourd'hui**,
mais tout passage en cluster ferait tourner chaque cron N fois en parallèle
(purge `audit_logs`, refresh PLU → double appel API IGN, races). Ajouter un
`pg_advisory_lock` autour des sections critiques avant d'envisager le clustering
(Palier 4 du durcissement).

---

## 🟡 Sécurité / Infra — Moyenne

### I1 · Actions GitHub non pinnées par SHA

**Fichier** : `.github/workflows/ci.yml`, `deploy.yml`

`actions/checkout@v5`, `actions/setup-node@v5`, `appleboy/ssh-action@v1.2.2` sont
référencées par tag mutable → risque de supply-chain si un tag est re-poussé.
Pinner par SHA complet (avec commentaire du tag lisible). Le reste de la CI est
solide (pnpm audit, typecheck, tests, build, concurrency).

---

## 🟢 Basse / hygiène

- **S4 · `console.error` en prod** — `apps/web/src` (MesDemandes.tsx:18,
  MesDocuments.tsx:69/81, RegulatoryDocViewer.tsx:61, MapLeaflet.tsx:285,
  MessageScreen.tsx:103/122) : fuite de détails d'implémentation dans la console.
  Router vers un logger conditionné `import.meta.env.DEV` ou Sentry.
- **F3 · `React.memo`** sur `MapLeaflet` (`components/MapLeaflet.tsx:60`) et
  `PdfAnnotator` (`components/PdfAnnotator.tsx:101`), + `useCallback` sur les props
  passées, pour éviter re-montage carte/PDF au re-render du parent.
- **I2 · nginx** — confirmer `client_max_body_size ≥ 300m` (aligné sur la limite
  body API PLU) ; config nginx non versionnée dans le repo.
- **Polling PLU 2.5 s** (`ReglementationScreen.tsx:97`) → 5-10 s ou SSE.
- **Multer `memoryStorage`** sur uploads pièces 60 Mo (`routes/mairie/pieces.ts`) :
  bufferise en RAM ; à streamer vers S3 si la concurrence d'upload monte.
- **`S3StorageProvider.getBuffer()`** (`services/storage.ts:217-230`) accumule en
  RAM : garder cet appel réservé aux workers en arrière-plan, jamais sur le chemin
  d'une requête HTTP (les routes de download utilisent déjà `getStream()`).

---

## Faux positifs écartés (vérifiés)

- **`rel="noreferrer"` sans `noopener`** (ParcelSynthese.tsx:85, SuperAdminApp) :
  `noreferrer` implique `noopener` dans tous les navigateurs modernes → pas de
  fuite `window.opener`. Sans impact.
- **`dangerouslySetInnerHTML` MairieCourrierScreen.tsx:560/571** : le HTML provient
  de `buildLetterBodyHtml()` qui passe déjà par `DOMPurify.sanitize()`. Sûr.
- **Tokens en localStorage** : seules des préférences UI non sensibles y sont
  stockées ; les JWT restent en cookie HttpOnly. Conforme.

---

## Points forts confirmés

Backend : hachage SHA-256 des tokens reset/activation, MFA TOTP chiffré AES-256-GCM,
vérif longueur `JWT_SECRET` au boot, healthcheck profond (`SELECT 1` + timeout),
`keepAliveTimeout` > nginx, compression gzip hors SSE, CSP stricte, CORS par
allowlist. Infra : backups 3-2-1 GPG + hors-site avec test de restauration
hebdomadaire, CrowdSec détection-puis-blocage avec garde anti-lockout, Sentry
fail-safe, migrations idempotentes. La base est saine ; les axes ci-dessus sont
du durcissement et de la préparation à la montée en charge, pas des correctifs
d'urgence — à l'exception de **S1 (critique)** et **S2 (haute)** qui méritent un
correctif rapide.
