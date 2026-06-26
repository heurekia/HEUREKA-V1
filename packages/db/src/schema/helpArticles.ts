import { pgTable, text, integer, timestamp, uuid, index, unique } from "drizzle-orm/pg-core";
import { help_themes } from "./helpThemes.js";
import { users } from "./users.js";

// Articles de documentation rattachés à un thème du sommaire. Le contenu est du
// HTML produit par l'éditeur riche (TipTap) côté super-admin : titres, listes,
// alignement, images (data URL) et vidéos (embed YouTube/Vimeo). Il est
// systématiquement assaini (DOMPurify) avant rendu côté agent.
export const help_articles = pgTable("help_articles", {
  id: uuid("id").primaryKey().defaultRandom(),
  theme_id: uuid("theme_id").notNull().references(() => help_themes.id, { onDelete: "cascade" }),
  // Slug unique au sein d'un thème (cf. contrainte plus bas).
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  // Chapô / résumé affiché dans le sommaire et en tête d'article.
  excerpt: text("excerpt"),
  // HTML de mise en page (jamais rendu sans assainissement préalable).
  content_html: text("content_html").notNull().default(""),
  // Image de couverture optionnelle (data URL base64 ou URL).
  cover_image: text("cover_image"),
  // 'draft' (visible seulement du super-admin) | 'published' (visible des agents).
  status: text("status").notNull().default("draft"),
  sort_order: integer("sort_order").notNull().default(0),
  author_id: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
  view_count: integer("view_count").notNull().default(0),
  published_at: timestamp("published_at"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  unique("help_articles_theme_slug").on(t.theme_id, t.slug),
  index("idx_help_articles_theme").on(t.theme_id),
  index("idx_help_articles_status").on(t.status),
]);

export type HelpArticle = typeof help_articles.$inferSelect;
