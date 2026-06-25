import { pgTable, text, integer, boolean, timestamp, uuid } from "drizzle-orm/pg-core";

// Thèmes du Centre d'aide — ils constituent le « sommaire » de la documentation.
// Chaque thème regroupe une liste ordonnée d'articles (help_articles). Pilotés
// depuis le super-admin (outil de rédaction), lus par les agents mairie depuis
// le bouton « Documentation » de leur centre d'aide.
export const help_themes = pgTable("help_themes", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Slug stable utilisé pour les ancres/URL ; unique sur l'ensemble des thèmes.
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  // Émoji ou pictogramme affiché dans le sommaire (ex. « 📁 »).
  icon: text("icon"),
  // Ordre d'affichage dans le sommaire (croissant).
  sort_order: integer("sort_order").notNull().default(0),
  // false → thème masqué du centre d'aide agent (brouillon de section).
  is_published: boolean("is_published").notNull().default(true),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

export type HelpTheme = typeof help_themes.$inferSelect;
