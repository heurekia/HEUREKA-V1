/**
 * Centre d'aide — documentation rédigée depuis le super-admin.
 *
 * Deux surfaces :
 *   • helpAdminRouter  (monté sous /api/admin/help, réservé au super-admin)
 *     CRUD complet des thèmes (sommaire) et des articles + réordonnancement.
 *   • helpReaderRouter (monté sous /api/mairie/help, agents mairie/instructeur)
 *     Lecture seule du contenu PUBLIÉ : sommaire + détail d'article.
 *
 * Le contenu HTML des articles est produit par l'éditeur riche côté front
 * (mise en page, images en data URL, vidéos embarquées) ; il est toujours
 * assaini (DOMPurify) avant rendu — voir utils/renderHelpHtml.ts côté web.
 */

import { Router } from "express";
import { db } from "../db.js";
import { help_themes, help_articles, users } from "@heureka-v1/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { type AuthRequest } from "../middlewares/auth.js";
import { logAudit } from "../services/audit.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

// Slug ASCII stable à partir d'un titre français (accents repliés, espaces →
// tirets). Vide → 'article' / 'theme' (garde-fou côté appelant).
function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// Rend un slug unique parmi `existing` en suffixant -2, -3, … si nécessaire.
function uniqueSlug(base: string, existing: Set<string>): string {
  const root = base || "element";
  if (!existing.has(root)) return root;
  let i = 2;
  while (existing.has(`${root}-${i}`)) i++;
  return `${root}-${i}`;
}

const STATUSES = new Set(["draft", "published"]);

// ════════════════════════════════════════════════════════════════════════════
// Administration (super-admin)
// ════════════════════════════════════════════════════════════════════════════

export const helpAdminRouter = Router();

// GET /themes — sommaire complet (thèmes + articles légers, tous statuts).
helpAdminRouter.get("/themes", async (_req, res) => {
  try {
    const themes = await db.select().from(help_themes).orderBy(asc(help_themes.sort_order), asc(help_themes.created_at));
    const articles = await db
      .select({
        id: help_articles.id,
        theme_id: help_articles.theme_id,
        title: help_articles.title,
        slug: help_articles.slug,
        status: help_articles.status,
        sort_order: help_articles.sort_order,
        view_count: help_articles.view_count,
        updated_at: help_articles.updated_at,
      })
      .from(help_articles)
      .orderBy(asc(help_articles.sort_order), asc(help_articles.created_at));

    const byTheme = new Map<string, typeof articles>();
    for (const a of articles) {
      const list = byTheme.get(a.theme_id) ?? [];
      list.push(a);
      byTheme.set(a.theme_id, list);
    }
    res.json(themes.map((t) => ({ ...t, articles: byTheme.get(t.id) ?? [] })));
  } catch (err) {
    console.error("[help:admin:themes]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /themes — crée un thème (slug auto-généré, unique).
helpAdminRouter.post("/themes", async (req: AuthRequest, res) => {
  try {
    const b = (req.body ?? {}) as { title?: string; description?: string; icon?: string; is_published?: boolean };
    const title = (b.title ?? "").trim();
    if (!title) return res.status(400).json({ error: "Titre requis" });

    const rows = await db.select({ slug: help_themes.slug }).from(help_themes);
    const slug = uniqueSlug(slugify(title) || "theme", new Set(rows.map((r) => r.slug)));
    const [max] = await db.select({ m: sql<number>`coalesce(max(${help_themes.sort_order}), -1)` }).from(help_themes);

    const [theme] = await db
      .insert(help_themes)
      .values({
        slug,
        title,
        description: b.description?.trim() || null,
        icon: b.icon?.trim() || null,
        is_published: b.is_published ?? true,
        sort_order: Number(max?.m ?? -1) + 1,
      })
      .returning();
    await logAudit(req, "admin_help_theme_created", { targetType: "help_theme", targetId: theme!.id, metadata: { title } });
    res.status(201).json({ ...theme, articles: [] });
  } catch (err) {
    console.error("[help:admin:theme:create]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// PATCH /themes/:id — met à jour titre / description / icône / publication.
helpAdminRouter.patch("/themes/:id", async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;
    const b = (req.body ?? {}) as { title?: string; description?: string | null; icon?: string | null; is_published?: boolean };
    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (typeof b.title === "string") {
      if (!b.title.trim()) return res.status(400).json({ error: "Titre requis" });
      updates.title = b.title.trim();
    }
    if (b.description !== undefined) updates.description = typeof b.description === "string" ? b.description.trim() || null : null;
    if (b.icon !== undefined) updates.icon = typeof b.icon === "string" ? b.icon.trim() || null : null;
    if (typeof b.is_published === "boolean") updates.is_published = b.is_published;

    const [theme] = await db.update(help_themes).set(updates).where(eq(help_themes.id, id)).returning();
    if (!theme) return res.status(404).json({ error: "Thème introuvable" });
    await logAudit(req, "admin_help_theme_updated", { targetType: "help_theme", targetId: id });
    res.json(theme);
  } catch (err) {
    console.error("[help:admin:theme:update]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// DELETE /themes/:id — supprime un thème ET ses articles (cascade).
helpAdminRouter.delete("/themes/:id", async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;
    const [theme] = await db.delete(help_themes).where(eq(help_themes.id, id)).returning();
    if (!theme) return res.status(404).json({ error: "Thème introuvable" });
    await logAudit(req, "admin_help_theme_deleted", { targetType: "help_theme", targetId: id, metadata: { title: theme.title } });
    res.json({ ok: true });
  } catch (err) {
    console.error("[help:admin:theme:delete]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// PUT /themes/reorder — { ids: [...] } applique l'ordre fourni.
helpAdminRouter.put("/themes/reorder", async (req: AuthRequest, res) => {
  try {
    const ids = ((req.body ?? {}) as { ids?: string[] }).ids;
    if (!Array.isArray(ids)) return res.status(400).json({ error: "ids[] requis" });
    await db.transaction(async (tx) => {
      for (let i = 0; i < ids.length; i++) {
        await tx.update(help_themes).set({ sort_order: i, updated_at: new Date() }).where(eq(help_themes.id, ids[i] as string));
      }
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("[help:admin:theme:reorder]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /articles/:id — article complet (contenu inclus).
helpAdminRouter.get("/articles/:id", async (req, res) => {
  try {
    const [article] = await db.select().from(help_articles).where(eq(help_articles.id, req.params.id as string)).limit(1);
    if (!article) return res.status(404).json({ error: "Article introuvable" });
    res.json(article);
  } catch (err) {
    console.error("[help:admin:article:get]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /articles — crée un article dans un thème.
helpAdminRouter.post("/articles", async (req: AuthRequest, res) => {
  try {
    const b = (req.body ?? {}) as {
      theme_id?: string; title?: string; excerpt?: string; content_html?: string;
      cover_image?: string | null; status?: string;
    };
    const title = (b.title ?? "").trim();
    if (!b.theme_id) return res.status(400).json({ error: "theme_id requis" });
    if (!title) return res.status(400).json({ error: "Titre requis" });
    const [theme] = await db.select({ id: help_themes.id }).from(help_themes).where(eq(help_themes.id, b.theme_id)).limit(1);
    if (!theme) return res.status(404).json({ error: "Thème introuvable" });

    const rows = await db.select({ slug: help_articles.slug }).from(help_articles).where(eq(help_articles.theme_id, b.theme_id));
    const slug = uniqueSlug(slugify(title) || "article", new Set(rows.map((r) => r.slug)));
    const [max] = await db
      .select({ m: sql<number>`coalesce(max(${help_articles.sort_order}), -1)` })
      .from(help_articles)
      .where(eq(help_articles.theme_id, b.theme_id));
    const status = STATUSES.has(b.status ?? "") ? (b.status as string) : "draft";

    const [article] = await db
      .insert(help_articles)
      .values({
        theme_id: b.theme_id,
        slug,
        title,
        excerpt: b.excerpt?.trim() || null,
        content_html: typeof b.content_html === "string" ? b.content_html : "",
        cover_image: b.cover_image || null,
        status,
        sort_order: Number(max?.m ?? -1) + 1,
        author_id: req.user?.id ?? null,
        published_at: status === "published" ? new Date() : null,
      })
      .returning();
    await logAudit(req, "admin_help_article_created", { targetType: "help_article", targetId: article!.id, metadata: { title, status } });
    res.status(201).json(article);
  } catch (err) {
    console.error("[help:admin:article:create]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// PATCH /articles/:id — met à jour le contenu / les métadonnées / le statut.
helpAdminRouter.patch("/articles/:id", async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;
    const [current] = await db.select().from(help_articles).where(eq(help_articles.id, id)).limit(1);
    if (!current) return res.status(404).json({ error: "Article introuvable" });

    const b = (req.body ?? {}) as {
      title?: string; excerpt?: string | null; content_html?: string;
      cover_image?: string | null; status?: string; theme_id?: string;
    };
    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (typeof b.title === "string") {
      if (!b.title.trim()) return res.status(400).json({ error: "Titre requis" });
      updates.title = b.title.trim();
    }
    if (b.excerpt !== undefined) updates.excerpt = typeof b.excerpt === "string" ? b.excerpt.trim() || null : null;
    if (typeof b.content_html === "string") updates.content_html = b.content_html;
    if (b.cover_image !== undefined) updates.cover_image = b.cover_image || null;
    if (b.theme_id && b.theme_id !== current.theme_id) {
      const [theme] = await db.select({ id: help_themes.id }).from(help_themes).where(eq(help_themes.id, b.theme_id)).limit(1);
      if (!theme) return res.status(404).json({ error: "Thème cible introuvable" });
      updates.theme_id = b.theme_id;
    }
    if (typeof b.status === "string" && STATUSES.has(b.status)) {
      updates.status = b.status;
      // Premier passage en publié : on horodate. Repassage en brouillon : on
      // conserve la date de publication initiale (historique).
      if (b.status === "published" && !current.published_at) updates.published_at = new Date();
    }

    const [article] = await db.update(help_articles).set(updates).where(eq(help_articles.id, id)).returning();
    await logAudit(req, "admin_help_article_updated", { targetType: "help_article", targetId: id, metadata: { status: article?.status } });
    res.json(article);
  } catch (err) {
    console.error("[help:admin:article:update]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// DELETE /articles/:id
helpAdminRouter.delete("/articles/:id", async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;
    const [article] = await db.delete(help_articles).where(eq(help_articles.id, id)).returning();
    if (!article) return res.status(404).json({ error: "Article introuvable" });
    await logAudit(req, "admin_help_article_deleted", { targetType: "help_article", targetId: id, metadata: { title: article.title } });
    res.json({ ok: true });
  } catch (err) {
    console.error("[help:admin:article:delete]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// PUT /articles/reorder — { theme_id, ids: [...] } applique l'ordre fourni.
helpAdminRouter.put("/articles/reorder", async (req: AuthRequest, res) => {
  try {
    const b = (req.body ?? {}) as { theme_id?: string; ids?: string[] };
    if (!Array.isArray(b.ids)) return res.status(400).json({ error: "ids[] requis" });
    await db.transaction(async (tx) => {
      for (let i = 0; i < b.ids!.length; i++) {
        await tx.update(help_articles).set({ sort_order: i, updated_at: new Date() }).where(eq(help_articles.id, b.ids![i] as string));
      }
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("[help:admin:article:reorder]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// Lecture (agents mairie / instructeur / admin) — contenu PUBLIÉ uniquement
// ════════════════════════════════════════════════════════════════════════════

export const helpReaderRouter = Router();

// GET /help/sommaire — thèmes publiés + leurs articles publiés (sans le HTML).
helpReaderRouter.get("/help/sommaire", async (_req, res) => {
  try {
    const themes = await db
      .select()
      .from(help_themes)
      .where(eq(help_themes.is_published, true))
      .orderBy(asc(help_themes.sort_order), asc(help_themes.created_at));

    const articles = await db
      .select({
        id: help_articles.id,
        theme_id: help_articles.theme_id,
        slug: help_articles.slug,
        title: help_articles.title,
        excerpt: help_articles.excerpt,
        cover_image: help_articles.cover_image,
        sort_order: help_articles.sort_order,
        updated_at: help_articles.updated_at,
      })
      .from(help_articles)
      .where(eq(help_articles.status, "published"))
      .orderBy(asc(help_articles.sort_order), asc(help_articles.created_at));

    const byTheme = new Map<string, typeof articles>();
    for (const a of articles) {
      const list = byTheme.get(a.theme_id) ?? [];
      list.push(a);
      byTheme.set(a.theme_id, list);
    }
    // On masque les thèmes vides : un sommaire sans article n'a pas d'intérêt.
    const sommaire = themes
      .map((t) => ({
        id: t.id,
        slug: t.slug,
        title: t.title,
        description: t.description,
        icon: t.icon,
        articles: byTheme.get(t.id) ?? [],
      }))
      .filter((t) => t.articles.length > 0);
    res.json(sommaire);
  } catch (err) {
    console.error("[help:reader:sommaire]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /help/articles/:id — article publié complet ; incrémente le compteur de vues.
helpReaderRouter.get("/help/articles/:id", async (req, res) => {
  try {
    const id = req.params.id as string;
    const [article] = await db
      .select({
        id: help_articles.id,
        theme_id: help_articles.theme_id,
        slug: help_articles.slug,
        title: help_articles.title,
        excerpt: help_articles.excerpt,
        content_html: help_articles.content_html,
        cover_image: help_articles.cover_image,
        published_at: help_articles.published_at,
        updated_at: help_articles.updated_at,
        author_prenom: users.prenom,
        author_nom: users.nom,
      })
      .from(help_articles)
      .leftJoin(users, eq(users.id, help_articles.author_id))
      .where(and(eq(help_articles.id, id), eq(help_articles.status, "published")))
      .limit(1);
    if (!article) return res.status(404).json({ error: "Article introuvable" });
    // Compteur best-effort : on n'attend pas et on n'échoue pas la lecture dessus.
    db.update(help_articles)
      .set({ view_count: sql`${help_articles.view_count} + 1` })
      .where(eq(help_articles.id, id))
      .catch(() => {});
    res.json(article);
  } catch (err) {
    console.error("[help:reader:article]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
