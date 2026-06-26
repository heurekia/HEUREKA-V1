import { defineConfig } from "tsup";

// Bundle de production de l'API : remplace l'exécution du TypeScript via `tsx`
// (esbuild au runtime, à chaque démarrage) par un artefact JS unique lancé avec
// `node dist/index.js`.
//
// On BUNDLE les packages workspace (@heureka-v1/*) car ils résolvent vers du TS
// source (et `ingestion` utilise des imports en `.ts`) — node ne saurait pas les
// exécuter. Tout le reste (node_modules : express, postgres, @aws-sdk, pdf-lib…)
// reste EXTERNE et est résolu normalement depuis node_modules au runtime, ce qui
// préserve les modules natifs et les imports dynamiques de dépendances.
export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist",
  format: ["esm"],
  platform: "node",
  target: "node22",
  bundle: true,
  noExternal: [/^@heureka-v1\//],
  sourcemap: true,
  clean: true,
  splitting: false,
  // Pas de minification : sur un serveur le gain de taille est marginal et on
  // garde des stacktraces lisibles.
  minify: false,
});
