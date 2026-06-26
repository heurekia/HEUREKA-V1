// Configuration PM2 de l'API en production.
//
// Lance l'ARTEFACT BUNDLÉ `apps/api/dist/index.js` avec `node` — fin du `tsx`
// au runtime (plus d'esbuild qui retranspile tout l'arbre TS à chaque démarrage).
// Prérequis : `pnpm --filter @heureka-v1/api build` (tsup) a produit dist/.
//
// ─── Activation (sur le VPS, une fois le bundle validé) ──────────────────────
// ⚠️ `pm2 startOrReload`/`reload` ne change PAS le script/cwd d'un process DÉJÀ
// existant — il recharge l'ancienne config (tsx). Pour basculer la PREMIÈRE fois
// de tsx vers ce bundle, il faut delete + start :
//   cd /home/ubuntu/heurekia
//   pnpm install --frozen-lockfile && pnpm build
//   pm2 delete heurekia-api
//   pm2 start ecosystem.config.cjs --update-env && pm2 save
//   curl -fsS https://app.heurekia.com/api/health   # readiness (vérifie la DB)
// Les déploiements SUIVANTS peuvent utiliser `pm2 startOrReload ecosystem.config.cjs`
// (le process tourne alors déjà sur ce script). Dans deploy.yml, remplacer la
// ligne `pm2 restart heurekia-api --update-env` par
//   `pm2 startOrReload ecosystem.config.cjs --update-env`
// Tant que la bascule n'est pas faite, pm2 continue de lancer l'API via `tsx`.
//
// `--enable-source-maps` : stacktraces lisibles malgré le bundle (index.js.map).
//
// ⚠️ exec_mode "cluster" + instances > 1 : NE PAS activer tant que l'état
// in-memory n'est pas externalisé (file OCR, rate-limit, crons — cf. Palier 4
// du durcissement). Sinon : crons exécutés en double, quotas de rate-limit
// contournables. On reste donc en `fork` mono-instance, conforme à
// l'architecture actuelle.
module.exports = {
  apps: [
    {
      name: "heurekia-api",
      // cwd = racine du dépôt (PAS apps/api) : l'API charge son .env via
      // `dotenv/config` DEPUIS le dossier courant, et le process existant tourne
      // déjà en cwd racine → il lit `/<repo>/.env`. On garde donc cette même
      // racine pour charger EXACTEMENT le même .env (un apps/api/.env distinct
      // existe mais n'est pas celui utilisé en prod). La résolution des chemins
      // (uploads, frontend, data) passe par import.meta.url et reste correcte
      // quel que soit le cwd (cf. src/paths.ts).
      cwd: ".",
      script: "apps/api/dist/index.js",
      node_args: "--enable-source-maps",
      exec_mode: "fork",
      instances: 1,
      env: {
        NODE_ENV: "production",
      },
      // Garde-fou anti-fuite mémoire (le VPS partage la RAM avec PostgreSQL).
      max_memory_restart: "1G",
    },
  ],
};
