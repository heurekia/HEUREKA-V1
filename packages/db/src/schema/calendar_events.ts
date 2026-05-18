import { pgTable, text, timestamp, boolean, uuid } from "drizzle-orm/pg-core";
import { dossiers } from "./dossiers.js";

export const calendarEvents = pgTable("calendar_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  date: timestamp("date").notNull(),
  end_date: timestamp("end_date"),
  type: text("type").notNull(),
  dossier_id: uuid("dossier_id").references(() => dossiers.id, { onDelete: "set null" }),
  user_id: text("user_id"),
  description: text("description"),
  all_day: boolean("all_day").notNull().default(false),
  created_at: timestamp("created_at").notNull().defaultNow(),
});
