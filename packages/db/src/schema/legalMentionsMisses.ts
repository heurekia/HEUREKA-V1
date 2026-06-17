import { integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

// Références d'articles que l'utilisateur a essayé d'ouvrir mais qui n'étaient
// ni dans `legal_mentions` ni récupérables depuis Légifrance — l'admin les voit
// dans la page Configuration pour décider de les créer (via l'API Légifrance)
// ou de les ignorer.
export const legal_mentions_misses = pgTable("legal_mentions_misses", {
  id: uuid("id").primaryKey().defaultRandom(),
  code_key: text("code_key").notNull(),
  article_ref: text("article_ref").notNull(),
  first_seen_at: timestamp("first_seen_at").notNull().defaultNow(),
  last_seen_at: timestamp("last_seen_at").notNull().defaultNow(),
  miss_count: integer("miss_count").notNull().default(1),
  // `resolved_at` à null = manquant ; non-null = l'admin a soit créé l'article,
  // soit explicitement ignoré la demande.
  resolved_at: timestamp("resolved_at"),
  resolved_by: uuid("resolved_by"),
  // "created" si l'article a effectivement été créé via Légifrance, "dismissed"
  // si l'admin a marqué la demande comme non pertinente.
  resolution: text("resolution"),
}, (t) => [unique("legal_mentions_misses_code_ref").on(t.code_key, t.article_ref)]);
