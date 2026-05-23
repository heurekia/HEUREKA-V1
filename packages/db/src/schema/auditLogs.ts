import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const audit_logs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  email: text("email"),
  action: text("action").notNull(),
  ip: text("ip"),
  user_agent: text("user_agent"),
  created_at: timestamp("created_at").notNull().defaultNow(),
});
