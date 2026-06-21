/**
 * Refresh du cache des zones PLU (Géoportail de l'Urbanisme).
 *
 * Re-télécharge et re-persiste les zones PLU de communes en base via
 * `refreshPluZones`, qui applique désormais la DÉCOUPE géométrique au contour
 * communal (clipZonesToCommune). Utile après un déploiement qui change le
 * pipeline de fetch : les caches d'avant le fix contiennent les zones
 * limitrophes débordantes (PLUi), ce script les régénère proprement.
 *
 * Par défaut, ne traite que les communes ayant DÉJÀ un cache
 * (`plu_zones_geojson` non nul) — celles dont la carte affiche des zones.
 *
 * Usage :
 *   # Toutes les communes déjà en cache (recommandé après déploiement)
 *   npx tsx src/scripts/refresh-plu-cache.ts
 *
 *   # Une seule commune
 *   npx tsx src/scripts/refresh-plu-cache.ts --insee 37003
 *
 *   # Toutes les communes de la table (même sans cache)
 *   npx tsx src/scripts/refresh-plu-cache.ts --all
 *
 *   # Dry-run : liste les communes à traiter sans appeler le GPU
 *   npx tsx src/scripts/refresh-plu-cache.ts --dry-run
 *
 *   # Régler le délai inter-requêtes (ms) pour ménager l'API GPU (défaut 1500)
 *   npx tsx src/scripts/refresh-plu-cache.ts --delay 2000
 */

import { db } from "../db.js";
import { communes } from "@heureka-v1/db";
import { eq, isNotNull } from "drizzle-orm";
import { refreshPluZones } from "../services/pluZones.js";

const args = process.argv.slice(2);
const get = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] ?? null : null; };
const has = (flag: string) => args.includes(flag);

const ONE_INSEE = get("--insee")?.trim();
const ALL = has("--all");
const DRY_RUN = has("--dry-run");
const DELAY_MS = Number(get("--delay") ?? "1500");

async function main() {
  // Sélection des communes à traiter.
  const base = db.select({ insee: communes.insee_code, name: communes.name }).from(communes);
  const rows = ONE_INSEE
    ? await base.where(eq(communes.insee_code, ONE_INSEE))
    : ALL
      ? await base
      : await base.where(isNotNull(communes.plu_zones_geojson));

  const targets = rows.filter(r => !!r.insee);
  console.log(`[refresh-plu] ${targets.length} commune(s) à traiter` +
    (ONE_INSEE ? ` (insee=${ONE_INSEE})` : ALL ? " (--all)" : " (cache existant)") +
    (DRY_RUN ? " — DRY RUN" : ""));

  if (DRY_RUN) {
    for (const t of targets) console.log(`  • ${t.insee}  ${t.name}`);
    return;
  }

  let ok = 0, ko = 0;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]!;
    const tag = `[${i + 1}/${targets.length}] ${t.insee} ${t.name}`;
    try {
      const res = await refreshPluZones(t.insee);
      if (res.ok) {
        ok++;
        console.log(`✓ ${tag} → partition=${res.partition} (${res.zones.features?.length ?? 0} zones)`);
      } else {
        ko++;
        console.warn(`✗ ${tag} → ${res.status} ${res.error}`);
      }
    } catch (e) {
      ko++;
      console.error(`✗ ${tag} → exception`, e);
    }
    // Throttle pour ne pas saturer le Géoportail de l'Urbanisme.
    if (i < targets.length - 1 && DELAY_MS > 0) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  console.log(`[refresh-plu] terminé : ${ok} OK, ${ko} échec(s)`);
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error("[refresh-plu] fatal", e); process.exit(1); });
