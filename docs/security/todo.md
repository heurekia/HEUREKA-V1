# Chantiers sécurité — TODO

## ✅ Terminé

- [x] Helmet — headers HTTP (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy)
- [x] Migration JWT localStorage → cookie HttpOnly/Secure/SameSite=Strict
- [x] Table `audit_logs` — traçabilité login/logout/échecs
- [x] `/.well-known/security.txt`
- [x] Compression gzip
- [x] Cache headers longs sur assets hashés

## 🔴 À faire — Critique

- [ ] **Clarifier SSO Azure AD avec DSI** — l'obligation s'applique-t-elle aux agents uniquement ?
  - Si oui : intégrer `@azure/msal-node` pour les rôles mairie/instructeur/admin
  - Si tous : refonte architecturale majeure
- [x] **Hébergement souverain** — Migration Railway → **VPS OVH 🇫🇷** effectuée (juin 2026). Postgres + nginx + app sur le VPS, sauvegardes vers OVH Object Storage.

## 🟠 À faire — Important

- [x] **RGPD** — Suppression de compte (endpoint + cascade DB) — `DELETE /auth/me` → `eraseCitizenAccount` (fichiers + cascade DB, art. 17)
- [x] **RGPD** — Export données personnelles (JSON pour le citoyen) — `GET /auth/me/export` (profil + dossiers + pièces + messages + événements IA + journal d'audit, art. 15/20)
- [x] **RGPD** — Page mentions légales + politique de confidentialité — `pages/public/MentionsLegales.tsx` + `PolitiqueConfidentialite.tsx` (liées dans le pied de page)
- [x] **RGPD** — Contact DPD — `dpd@heurekia.com` exposé dans la politique de confidentialité (liée au pied de page) et sur la page Profil citoyen
- [x] **Purge audit_logs** — cronjob quotidien 02:00, supprime les entrées > 12 mois
- [x] **pnpm audit** — job `security-audit` (`pnpm audit --prod`) dans `.github/workflows/ci.yml`
- [x] **Sauvegardes 3-2-1** — Scripts `infra/backup/` (pg_dump + tar uploads + mirror OVH Object Storage), rétention 7j/4sem/6mois, vérification hebdo automatique. Politique documentée dans [`dossier-exploitation.md`](./dossier-exploitation.md).

## 🟡 À faire — Moyen

- [ ] **RGAA** — Audit accessibilité avec axe-core, corriger niveau AA minimum
- [ ] **Certificat OV** — Négocier avec DSI ou acquérir un certificat OV (DigiCert, Sectigo)
- [x] **Export CSV dossiers** — Interface mairie : `routes/mairie/dossiers.ts` + bouton dans `DossiersScreen.tsx`
- [x] **Rate limiting** — `express-rate-limit` sur `/auth/login` (10/15 min par IP+email) et `/register` (5/h) — confirmé live par le test Playwright T01 (429 à la 11ᵉ tentative)

## 📄 À produire — Documents

- [ ] **DTC** — Dossier Technique de Conception (architecture, flux, config serveur)
- [ ] **PAS** — Plan d'Assurance Sécurité (remplir le modèle de l'Annexe Technique n°3)
- [x] **Dossier d'Exploitation** — [`docs/security/dossier-exploitation.md`](./dossier-exploitation.md) (backup, restore, mise à jour, gestion incidents)
- [ ] **Cahier de Recette** — Scénarios de test, critères d'acceptance

## Notes

- `JWT_SECRET` doit être une chaîne aléatoire forte (≥ 32 caractères) en production — ne jamais laisser la valeur par défaut `dev-secret-change-me`
- Renouveler le `security.txt` avant la date d'expiration (actuellement 2027-01-01)

## 🔍 Audit sécurité externe — juin 2026

Triage des 3 rapports (revue de code / Playwright / VPS OVH) croisés avec l'état
du code au 2026-07-01.

### Déjà couvert (corrigé APRÈS l'audit du 18-19 juin — cf. PR #375 mergée le 25/06)

- **Validation mot de passe `/register`** (finding « faille live » / Playwright T14b-c) :
  `registerSchema.password = strongPassword` (12 car. + majuscule + minuscule +
  chiffre + spécial). Politique **unique** partagée par register / activate /
  reset / change (`auth.ts:passwordPolicyErrors`). Le « mot de passe faible
  accepté » n'est plus reproductible sur le code actuel.
- **Révocation JWT côté serveur** (finding « risque résiduel ») : le claim `tv`
  est comparé à `users.token_version` par `requireAuth` (cache 60 s) ;
  `bumpTokenVersion` invalide TOUTES les sessions sur changement de mot de passe,
  de rôle ou désactivation de compte (`middlewares/auth.ts`). Risque résiduel
  restant : pas de bouton « déconnecter partout » exposé à l'utilisateur ; un
  jeton volé reste valide jusqu'au prochain bump ou l'expiration à 7 j.

### Corrigé sur cette branche

- 🔴 **Bug SQL `dashboard.ts` (92 crashs)** : dans `/stats/delais`, la requête
  `en_retard` joint `users` (colonne `commune` homonyme de `dossiers.commune`) ;
  le filtre de périmètre référençait `commune` **non qualifié** → `column
  reference "commune" is ambiguous` (500) pour tout agent mairie/instructeur à
  périmètre restreint. Colonne qualifiée en `dossiers.commune`.
- **Écoute API configurable via `HOST`** (défaut `0.0.0.0` inchangé) → permet
  `HOST=127.0.0.1` en prod derrière nginx (défense en profondeur, cf. infra ci-dessous).

### Faux positif à confirmer

- **T13 Path traversal (200)** : `/api/uploads/:key` est protégé (regex de clé
  `^[a-zA-Z0-9._-]+$`, refus de `..`, garde `startsWith(UPLOADS_DIR + sep)`,
  `requireAuth`) et les routes `/api/*` inconnues renvoient un 404 JSON. Le 200
  observé provient du **catch-all SPA** (`app.get("*")` → `index.html`) sur un
  chemin HORS `/api` : c'est la coquille HTML de l'app, pas un fichier système.
  → Rejouer le test en inspectant le corps de la réponse (doit être `index.html`).

### ⏳ Infra VPS OVH — hors dépôt, action requise côté serveur

- 🔴 **Réactiver le pare-feu** (ufw/nftables) ; n'exposer que 80/443/22.
- 🔴 **`HOST=127.0.0.1`** pour l'API + vérifier que l'upstream nginx pointe en
  loopback (le code accepte désormais la variable).
- 🔴 **Régénérer/déposer les clés GPG** de chiffrement des sauvegardes
  (`infra/backup`) — sans elles les backups sont irrécupérables en cas de perte
  serveur.
- 🔴 **Câbler le monitoring applicatif** : `SENTRY_DSN` (error tracking) et
  `/metrics` Prometheus existent déjà dans le code — reste à les brancher côté
  supervision + alerting.
- 🟠 **Brute-force SSH + rate limiting nginx** : installer/activer **CrowdSec**
  (`infra/crowdsec/install.sh` puis `enable-blocking.sh`) ; durcir `sshd`
  (authentification par clé uniquement).
