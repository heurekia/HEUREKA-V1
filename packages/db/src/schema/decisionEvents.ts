import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { decisions } from "./decisions.js";

export const decision_events = pgTable("decision_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  decision_id: uuid("decision_id").notNull().references(() => decisions.id, { onDelete: "cascade" }),
  user_id: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  // cree | modifie | soumis | approuve | refuse | signe | notifie | archive
  event_type: text("event_type").notNull(),
  note: text("note"),
  metadata: jsonb("metadata"),
  created_at: timestamp("created_at").notNull().defaultNow(),
});
