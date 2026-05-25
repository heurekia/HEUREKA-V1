import { pgTable, uuid, text, date, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const user_absences = pgTable("user_absences", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  start_date: date("start_date").notNull(),
  end_date: date("end_date").notNull(),
  reason: text("reason").notNull().default("conges"),
  delegate_user_id: uuid("delegate_user_id").references(() => users.id, { onDelete: "set null" }),
  note: text("note"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});
