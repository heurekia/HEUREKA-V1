// Seed du Centre d'aide — documentation utilisateur de l'espace mairie.
//
// Crée (ou met à jour) les thèmes du sommaire et leurs articles à partir des
// données pures décrites dans `help-documentation-content.ts`. Chaque article
// explique une fonctionnalité de la plateforme, classée dans le bon thème.
//
// Idempotent : un thème est rapproché par son `slug` (unique), un article par
// le couple (thème, slug). Une nouvelle exécution MET À JOUR le contenu existant
// (titre, chapô, HTML, ordre) au lieu de le dupliquer — le script fait donc
// aussi office d'outil de mise à jour de la documentation.
//
// Les thèmes et articles sont publiés par défaut (visibles des agents). Passez
// `--draft` pour tout créer en brouillon (révision avant publication).
//
// Usage : `pnpm --filter @heureka-v1/api seed:help-doc`
//         `pnpm --filter @heureka-v1/api seed:help-doc -- --draft`

import "dotenv/config";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db.js";
import { help_themes, help_articles } from "@heureka-v1/db";
import { HELP_THEMES } from "./help-documentation-content.js";

async function main() {
  const publish = !process.argv.includes("--draft");
  const articleStatus = publish ? "published" : "draft";

  let themesCreated = 0;
  let themesUpdated = 0;
  let articlesCreated = 0;
  let articlesUpdated = 0;

  for (let ti = 0; ti < HELP_THEMES.length; ti++) {
    const theme = HELP_THEMES[ti]!;

    // ── Thème (rapproché par slug) ──────────────────────────────────────────
    const [existingTheme] = await db
      .select({ id: help_themes.id })
      .from(help_themes)
      .where(eq(help_themes.slug, theme.slug))
      .limit(1);

    let themeId: string;
    if (existingTheme) {
      themeId = existingTheme.id;
      await db
        .update(help_themes)
        .set({
          title: theme.title,
          description: theme.description,
          icon: theme.icon,
          sort_order: ti,
          is_published: publish,
          updated_at: new Date(),
        })
        .where(eq(help_themes.id, themeId));
      themesUpdated++;
      console.log(`= thème mis à jour : ${theme.icon} ${theme.title}`);
    } else {
      const [inserted] = await db
        .insert(help_themes)
        .values({
          slug: theme.slug,
          title: theme.title,
          description: theme.description,
          icon: theme.icon,
          sort_order: ti,
          is_published: publish,
        })
        .returning({ id: help_themes.id });
      themeId = inserted!.id;
      themesCreated++;
      console.log(`+ thème créé : ${theme.icon} ${theme.title}`);
    }

    // ── Articles du thème (rapprochés par (thème, slug)) ─────────────────────
    for (let ai = 0; ai < theme.articles.length; ai++) {
      const article = theme.articles[ai]!;
      const [existingArticle] = await db
        .select({ id: help_articles.id, published_at: help_articles.published_at })
        .from(help_articles)
        .where(and(eq(help_articles.theme_id, themeId), eq(help_articles.slug, article.slug)))
        .limit(1);

      if (existingArticle) {
        await db
          .update(help_articles)
          .set({
            title: article.title,
            excerpt: article.excerpt,
            content_html: article.html,
            status: articleStatus,
            sort_order: ai,
            // On n'écrase pas une date de publication déjà posée.
            published_at:
              publish && !existingArticle.published_at ? new Date() : existingArticle.published_at,
            updated_at: new Date(),
          })
          .where(eq(help_articles.id, existingArticle.id));
        articlesUpdated++;
      } else {
        await db.insert(help_articles).values({
          theme_id: themeId,
          slug: article.slug,
          title: article.title,
          excerpt: article.excerpt,
          content_html: article.html,
          status: articleStatus,
          sort_order: ai,
          published_at: publish ? new Date() : null,
        });
        articlesCreated++;
      }
    }
    console.log(`  └─ ${theme.articles.length} article(s) traité(s)`);
  }

  const totalArticles = HELP_THEMES.reduce((n, t) => n + t.articles.length, 0);
  console.log(
    `\nTerminé — ${HELP_THEMES.length} thème(s) (${themesCreated} créé(s), ${themesUpdated} mis à jour), ` +
      `${totalArticles} article(s) (${articlesCreated} créé(s), ${articlesUpdated} mis à jour). ` +
      `Statut : ${publish ? "publié" : "brouillon"}.`,
  );

  // Garde-fou informatif : signale d'éventuels articles orphelins (présents en
  // base mais plus dans le seed) — on ne les supprime pas automatiquement.
  const [countRow] = await db.select({ c: sql<number>`count(*)::int` }).from(help_articles);
  const dbArticles = Number(countRow?.c ?? 0);
  if (dbArticles > totalArticles) {
    console.log(
      `Note : ${dbArticles - totalArticles} article(s) en base ne proviennent pas de ce seed ` +
        `(rédigés à la main ou issus d'une version antérieure). Ils sont conservés.`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
