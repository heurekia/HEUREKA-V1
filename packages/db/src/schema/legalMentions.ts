import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

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
}, (t) => [unique("legal_mentions_code_ref").on(t.code, t.article_ref)]);
