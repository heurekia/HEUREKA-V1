# Mise en service — bundle `node` (fin du `tsx` en prod)

Guide d'activation du passage `tsx` → `node` (cf. `docs/durcissement-production.md`
§ 2.5). L'artefact (`apps/api/dist/index.js`) et la config pm2
(`ecosystem.config.cjs`) sont prêts et **boot-vérifiés localement** ; il reste à
basculer pm2 sur le VPS. Rollout en 3 phases, du plus sûr au plus engageant.

## Phase 1 — merger la branche (sans changement de runtime)

Merger `claude/tender-gates-yw1qen` dans `main` est **sans risque côté runtime** :
le déploiement reconstruit le bundle (`pnpm build` lance désormais `tsup` pour
l'API), mais **pm2 continue de lancer l'API via `tsx`** (sa config sur le VPS est
inchangée). Tout le reste du durcissement (Paliers 0/1/3 + observabilité) devient
actif. À faire avant : la **checklist de tests** ci-dessous.

## Phase 2 — activer `node` manuellement (1 fois, sous supervision)

Sur le VPS, quand tu peux observer le résultat :

```bash
cd /home/ubuntu/heurekia
git pull && pnpm install --frozen-lockfile
pnpm build                       # produit apps/api/dist/index.js (tsup) + apps/web/dist (vite)

# Validation HORS pm2 d'abord (sur un port libre, sans toucher au service live).
# PORT explicite : dotenv ne surcharge pas une var déjà définie, donc on écoute
# bien sur 3099 même si .env fixe un autre port.
PORT=3099 node apps/api/dist/index.js & BOOT=$!; sleep 5
curl -fsS http://127.0.0.1:3099/api/health       # doit répondre {"status":"ok","db":"ok"}
kill $BOOT

# Si OK, bascule pm2 (delete + start car le script/cwd change vs l'ancien tsx) :
pm2 delete heurekia-api
pm2 start ecosystem.config.cjs --update-env && pm2 save
curl -fsS https://app.heurekia.com/api/health    # {"status":"ok","db":"ok"}
pm2 logs heurekia-api --lines 50 --nostream      # vérifier le 🚀 et l'absence d'erreur au boot
```

Si quelque chose cloche, **rollback immédiat** (cf. section dédiée).

## Phase 3 — pérenniser dans le déploiement automatique

Une fois la Phase 2 validée, appliquer ce diff à `.github/workflows/deploy.yml`
pour que les déploiements suivants utilisent `node` :

```diff
-            pm2 restart heurekia-api --update-env
+            pm2 startOrReload ecosystem.config.cjs --update-env
             pm2 save
```

Le `pnpm build` déjà présent produit le bundle ; le healthcheck profond
(`/api/health`, qui teste la DB) sert de garde-fou post-déploiement.

## Checklist de tests manuels (avant la mise en ligne)

Les changements de cette branche touchent des flux réels — à smoke-tester :

**Sensibles (nouveau comportement) :**
- [ ] **Dépôt citoyen** : déposer une pièce dans le wizard → badge « ⏳ Analyse
      en cours… » puis le verdict (score) s'affiche tout seul ; le bouton
      « Soumettre » attend la fin de l'analyse.
- [ ] **Blocage hors-sujet** : déposer un document manifestement hors-sujet
      (ex. une photo dans l'emplacement CERFA) → « 🚫 Ne correspond pas à cette
      rubrique » + soumission refusée. Avec les bons documents → soumission OK.
- [ ] **Émission courrier mairie** (« demande de pièces complémentaires ») →
      courrier marqué envoyé + pièces passées en « complément demandé » + statut
      dossier mis à jour (transaction atomique).

**Touchés par le refactor de chemins / le bundle :**
- [ ] **Génération CERFA** (PDF prérempli) → le template est bien trouvé.
- [ ] **Uploads** : une pièce déjà déposée s'affiche / se télécharge.
- [ ] **Frontend servi** : les 3 portails chargent (www, app/mairie, admin) sans
      écran blanc (code splitting + Suspense).
- [ ] **Healthcheck** : `/api/health` → 200 `db:ok` ; `/api/health/live` → 200.

## Rollback

Le passage `node` est réversible sans toucher au code :

```bash
# Revenir à l'exécution via tsx (ancienne config) :
pm2 delete heurekia-api
cd /home/ubuntu/heurekia/apps/api && pm2 start "tsx src/index.ts" --name heurekia-api --update-env
pm2 save
```

Et si le diff Phase 3 a été mergé, le révert du commit correspondant suffit pour
que les déploiements automatiques repassent sur `pm2 restart` (tsx).

## Notes

- **Ne pas** passer pm2 en `cluster`/`instances > 1` : l'état in-memory (file
  OCR, rate-limit, crons) n'est pas encore externalisé (cf. Palier 4). Rester en
  `fork` mono-instance, ce que fait `ecosystem.config.cjs`.
- Variables d'env optionnelles introduites (défauts sûrs) : `LOG_LEVEL`,
  `UPLOADS_DIR`, `FRONTEND_DIST`, `DATA_DIR`, timeouts/rate-limits — cf.
  `docs/durcissement-production.md` § 5.
