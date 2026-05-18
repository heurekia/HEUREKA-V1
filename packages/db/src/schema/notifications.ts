import { pgTable, text, timestamp, boolean, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { dossiers } from "./dossiers.js";

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  dossier_id: uuid("dossier_id").references(() => dossiers.id, { onDelete: "set null" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  is_read: boolean("is_read").notNull().default(false),
  created_at: timestamp("created_at").notNull().defaultNow(),
});
