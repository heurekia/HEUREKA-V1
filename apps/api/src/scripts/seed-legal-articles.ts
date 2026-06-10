// Seed initial des articles juridiques cités par le moteur de classification
// et utiles dans le tunnel citoyen / les courriers d'instruction.
// La liste vit dans `@heureka-v1/shared/legalArticlesCatalog` pour être
// partagée avec le frontend (filtres admin, chips de catégories).
//
// Usage : `pnpm --filter @heureka-v1/api seed:legal-articles`
//
// Sans credentials PISTE en environnement, le script échoue proprement
// article par article — les références déjà en base ne sont pas touchées.

import "dotenv/config";
import { eq, and } from "drizzle-orm";
import { db } from "../db.js";
import { legal_mentions } from "@heureka-v1/db";
import { CURATED_ARTICLES, type CuratedArticle } from "@heureka-v1/shared";
import { refreshArticle, resolveCode } from "../services/legifrance.js";

// Met à jour `categories` sans écraser un éventuel HTML déjà fetché.
async function setCategories(art: CuratedArticle): Promise<void> {
  const code = resolveCode(art.code);
  if (!code) return;
  await db
    .update(legal_mentions)
    .set({ categories: art.categories, updated_at: new Date() })
    .where(and(eq(legal_mentions.code, code.id), eq(legal_mentions.article_ref, art.num)));
}

async function main() {
  let ok = 0;
  let ko = 0;
  for (const art of CURATED_ARTICLES) {
    const a = await refreshArticle(art.code, art.num);
    if (a) {
      ok++;
      const size = a.article_html?.length ?? 0;
      console.log(`✓ ${art.code} ${art.num} (${size} car.) — ${art.categories.join(", ")}`);
    } else {
      ko++;
      console.warn(`✗ ${art.code} ${art.num} — non récupéré`);
    }
    // Toujours appliquer les catégories, même si le HTML n'a pas pu être
    // récupéré (ligne déjà en base ou ré-essai ultérieur).
    await setCategories(art);
  }
  console.log(`\nDone. ${ok}/${CURATED_ARTICLES.length} récupérés, ${ko} échec(s). Catégories appliquées.`);
  process.exit(ko === 0 ? 0 : 0); // sortir 0 même avec ✗ — lazy-fetch couvrira
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
