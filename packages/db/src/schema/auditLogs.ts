import { pgTable, text, timestamp, uuid, jsonb } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const audit_logs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  email: text("email"),
  // Snapshot of the user's role at the time of the action. Stored separately
  // from users.role because the user may later be deleted (FK set null) or
  // see their role changed — we need to know who acted in which capacity.
  role: text("role"),
  action: text("action").notNull(),
  // Optional target of the action (e.g. "dossier" + dossier UUID, "address"
  // + searched query). Lets the super admin filter "tout ce qui a touché ce
  // dossier" without parsing metadata.
  target_type: text("target_type"),
  target_id: text("target_id"),
  // Free-form JSON with action-specific context (route, method, body diff,
  // searched address, etc). Kept small — large/sensitive fields are stripped
  // before insert by the audit service / middleware.
  metadata: jsonb("metadata"),
  ip: text("ip"),
  user_agent: text("user_agent"),
  created_at: timestamp("created_at").notNull().defaultNow(),
});
