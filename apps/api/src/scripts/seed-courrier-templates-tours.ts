// Seed des modèles de courrier de Tours Métropole Val de Loire.
//
// Insère les modèles reconstruits au format Heureka (cf. données pures dans
// `tours-courrier-templates.ts`) pour chaque commune de l'agglomération.
//
// Idempotent : un modèle déjà présent (même nom + même commune) n'est pas
// recréé. Seules les communes existant déjà dans la table `communes` sont
// servies ; les autres sont signalées et ignorées.
//
// Usage : `pnpm --filter @heureka-v1/api seed:courrier-tours`

import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { db } from "../db.js";
import { courrier_templates, communes } from "@heureka-v1/db";
import { TEMPLATES, TOURS_METROPOLE_INSEE } from "./tours-courrier-templates.js";

async function main() {
  let inserted = 0;
  let skipped = 0;
  const missingCommunes: string[] = [];

  for (const insee of TOURS_METROPOLE_INSEE) {
    const [commune] = await db
      .select({ insee_code: communes.insee_code, name: communes.name })
      .from(communes)
      .where(eq(communes.insee_code, insee))
      .limit(1);

    if (!commune) {
      missingCommunes.push(insee);
      continue;
    }

    for (const tpl of TEMPLATES) {
      const [existing] = await db
        .select({ id: courrier_templates.id })
        .from(courrier_templates)
        .where(and(eq(courrier_templates.commune_insee, insee), eq(courrier_templates.name, tpl.name)))
        .limit(1);

      if (existing) {
        skipped++;
        console.log(`= déjà présent : « ${tpl.name} » pour ${commune.name} (${insee})`);
        continue;
      }

      await db.insert(courrier_templates).values({
        commune_insee: insee,
        commune: commune.name,
        name: tpl.name,
        category: tpl.category,
        body: tpl.body,
      });
      inserted++;
      console.log(`+ inséré : « ${tpl.name} » pour ${commune.name} (${insee})`);
    }
  }

  console.log(`\nTerminé — ${inserted} inséré(s), ${skipped} déjà présent(s).`);
  if (missingCommunes.length > 0) {
    console.log(
      `Communes absentes de la table \`communes\` (modèles non créés) : ${missingCommunes.join(", ")}.\n` +
        `→ créez-les via l'administration (superAdmin /communes) puis relancez le script.`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed:courrier-tours]", err);
    process.exit(1);
  });
