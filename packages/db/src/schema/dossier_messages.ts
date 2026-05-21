import { pgTable, text, timestamp, integer, jsonb, uuid } from "drizzle-orm/pg-core";
import { dossiers } from "./dossiers.js";

export const dossier_messages = pgTable("dossier_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  dossier_id: uuid("dossier_id").notNull().references(() => dossiers.id, { onDelete: "cascade" }),
  from_user_id: text("from_user_id").notNull(),
  from_role: text("from_role").notNull(),
  content: text("content").notNull(),
  parent_id: integer("parent_id"),
  mentions: jsonb("mentions").default([]),
  created_at: timestamp("created_at").notNull().defaultNow(),
  read_at: timestamp("read_at"),
});
