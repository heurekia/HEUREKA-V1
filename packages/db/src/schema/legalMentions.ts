import { jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const legal_mentions = pgTable("legal_mentions", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull(),
  code_name: text("code_name").notNull(),
  article_ref: text("article_ref").notNull(),
  article_title: text("article_title"),
  article_html: text("article_html"),
  legifrance_id: text("legifrance_id"),
  fetched_at: timestamp("fetched_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
  courrier_types: jsonb("courrier_types").$type<string[]>().default(sql`'[]'::jsonb`),
  dossier_types: jsonb("dossier_types").$type<string[]>().default(sql`'[]'::jsonb`),
  categories: jsonb("categories").$type<string[]>().default(sql`'[]'::jsonb`),
  contexte: text("contexte"),
}, (t) => [unique("legal_mentions_code_ref").on(t.code, t.article_ref)]);
