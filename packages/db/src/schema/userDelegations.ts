import { pgTable, uuid, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users.js";

// Chaîne de délégation configurée par un utilisateur (l'absent potentiel).
// Lors d'une absence active, les nouveaux dossiers attribués et les dossiers
// dont l'échéance tombe pendant l'absence sont redirigés vers le 1er délégué
// non lui-même absent, en suivant l'ordre de priorité (1 = principal).
export const user_delegations = pgTable(
  "user_delegations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    delegate_user_id: uuid("delegate_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    priority: integer("priority").notNull().default(1),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uniq_user_priority: uniqueIndex("user_delegations_user_priority_uniq").on(t.user_id, t.priority),
  }),
);
