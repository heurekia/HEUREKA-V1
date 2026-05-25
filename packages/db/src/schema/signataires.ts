import { pgTable, uuid, text, date, timestamp, boolean } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const signataires = pgTable("signataires", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // commune name (matches dossiers.commune)
  commune: text("commune").notNull(),
  // maire | adjoint | dgs | responsable_ads | directeur
  role: text("role").notNull(),
  delegation_arrete: text("delegation_arrete"),
  delegation_date: date("delegation_date"),
  active: boolean("active").notNull().default(true),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});
