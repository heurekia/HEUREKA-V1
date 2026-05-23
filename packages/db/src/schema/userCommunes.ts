import { pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { communes } from "./communes.js";

export const user_communes = pgTable("user_communes", {
  user_id: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  commune_id: uuid("commune_id").notNull().references(() => communes.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.user_id, t.commune_id] })]);
