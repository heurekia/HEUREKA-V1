/**
 * Résolution centralisée des chemins de fichiers du serveur.
 *
 * Pourquoi ici (au niveau `src/`) et pas dans chaque service : jusqu'ici, chaque
 * fichier de `src/services/` recalculait ses chemins via `import.meta.url`
 * (`../../uploads`, `../data/cerfa/...`). Ces chemins SONT relatifs à la
 * profondeur du fichier source — ils casseraient si le code était compilé/bundlé
 * vers `dist/index.js` (profondeur différente : uploads introuvables, génération
 * CERFA cassée). En centralisant la résolution dans CE module, situé directement
 * sous `src/` (donc à la MÊME profondeur que `dist/` une fois bundlé : tous deux
 * à un niveau sous `apps/api`), les chemins relatifs deviennent invariants au
 * bundling — c'est le prérequis à la sortie du `tsx` en production.
 *
 * Tous les chemins sont par ailleurs surchargeables par variable d'environnement,
 * pour qu'en production le déploiement puisse fixer des emplacements explicites
 * (et ne dépende d'aucune hypothèse de layout). Les défauts reproduisent
 * EXACTEMENT le comportement historique (dev via tsx) — aucun changement.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

// `apps/api/src` quand exécuté via tsx, `apps/api/dist` une fois bundlé — dans
// les deux cas, la racine du package est le dossier parent.
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(moduleDir, "..");

/** Dossier des pièces déposées (stockage local). Défaut : `apps/api/uploads`. */
export const UPLOADS_DIR = process.env.UPLOADS_DIR ?? path.join(apiRoot, "uploads");

/** Build du frontend servi par Express en fallback. Défaut : `apps/web/dist`. */
export const FRONTEND_DIST_DIR = process.env.FRONTEND_DIST ?? path.resolve(apiRoot, "../web/dist");

/**
 * Assets de données embarqués (templates CERFA, plans de hauteurs…). Défaut :
 * `apps/api/src/data` — présent dans le dépôt déployé, donc lisible même en
 * bundle. À surcharger (`DATA_DIR`) si ces assets sont copiés ailleurs au build.
 */
export const DATA_DIR = process.env.DATA_DIR ?? path.join(apiRoot, "src", "data");

/** Template PDF CERFA PCMI (13406*16) prérempli par le citoyen. */
export const CERFA_TEMPLATE_PATH = path.join(DATA_DIR, "cerfa", "13406-16.pdf");
