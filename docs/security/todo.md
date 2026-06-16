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

- [ ] **RGPD** — Suppression de compte (endpoint + cascade DB)
- [ ] **RGPD** — Export données personnelles (PDF/JSON pour le citoyen)
- [ ] **RGPD** — Page mentions légales + politique de confidentialité
- [ ] **RGPD** — Contact DPD dans le pied de page
- [x] **Purge audit_logs** — cronjob quotidien 02:00, supprime les entrées > 12 mois
- [ ] **pnpm audit** — intégrer dans CI (GitHub Actions)
- [x] **Sauvegardes 3-2-1** — Scripts `infra/backup/` (pg_dump + tar uploads + mirror OVH Object Storage), rétention 7j/4sem/6mois, vérification hebdo automatique. Politique documentée dans [`dossier-exploitation.md`](./dossier-exploitation.md).

## 🟡 À faire — Moyen

- [ ] **RGAA** — Audit accessibilité avec axe-core, corriger niveau AA minimum
- [ ] **Certificat OV** — Négocier avec DSI ou acquérir un certificat OV (DigiCert, Sectigo)
- [ ] **Export CSV dossiers** — Interface mairie : bouton "Exporter les dossiers"
- [ ] **Rate limiting** — `express-rate-limit` sur `/api/auth/login` pour limiter brute-force

## 📄 À produire — Documents

- [ ] **DTC** — Dossier Technique de Conception (architecture, flux, config serveur)
- [ ] **PAS** — Plan d'Assurance Sécurité (remplir le modèle de l'Annexe Technique n°3)
- [x] **Dossier d'Exploitation** — [`docs/security/dossier-exploitation.md`](./dossier-exploitation.md) (backup, restore, mise à jour, gestion incidents)
- [ ] **Cahier de Recette** — Scénarios de test, critères d'acceptance

## Notes

- `JWT_SECRET` doit être une chaîne aléatoire forte (≥ 32 caractères) en production — ne jamais laisser la valeur par défaut `dev-secret-change-me`
- Renouveler le `security.txt` avant la date d'expiration (actuellement 2027-01-01)
