import { pgTable, uuid, jsonb, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const user_availability = pgTable("user_availability", {
  user_id: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  working_days: jsonb("working_days").notNull().default([1, 2, 3, 4, 5]),
  start_time: text("start_time").notNull().default("08:30"),
  end_time: text("end_time").notNull().default("17:30"),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});
