import { pgTable, text, timestamp, jsonb, uuid } from "drizzle-orm/pg-core";
import { dossiers } from "./dossiers.js";

export const instruction_events = pgTable("instruction_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  dossier_id: uuid("dossier_id").notNull().references(() => dossiers.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  user_id: text("user_id"),
  description: text("description"),
  metadata: jsonb("metadata").default({}),
  created_at: timestamp("created_at").notNull().defaultNow(),
});
